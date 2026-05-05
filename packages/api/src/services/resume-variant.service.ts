import { eq, ilike, or, desc, and, sql, inArray, notInArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/client.js';
import {
  resumeVariants,
  quantifiedBullets,
  techStackTags,
  resumes,
  type ResumeVariantRow,
  type VariantRevisionEntry,
  type ResumeContent,
  type SectionBulletSelection,
} from '../db/schema.js';
import { getConfig } from '../config.js';
import {
  ResumeVariantDTO,
  ResumeVariantSummaryDTO,
  UsedBulletDTO,
  VariantGenerationWarningDTO,
  BulletSuggestionDTO,
  GenerateResumeVariantInput,
  ReviseResumeVariantInput,
  UpdateResumeVariantInput,
  SuggestBulletsInput,
  ExportResumeVariantInput,
  ResumeVariantError,
  NotFoundError,
  VersionConflictError,
} from '../types/index.js';

// ── DTO mappers ───────────────────────────────────────────────────────────────

function toDTO(row: ResumeVariantRow): ResumeVariantDTO {
  return {
    id: row.id,
    status: row.status as ResumeVariantDTO['status'],
    title: row.title,
    targetCompany: row.targetCompany,
    targetRole: row.targetRole,
    format: row.format as ResumeVariantDTO['format'],
    sectionEmphasis: row.sectionEmphasis as ResumeVariantDTO['sectionEmphasis'],
    baseResumeId: row.baseResumeId,
    jobFitAnalysisId: row.jobFitAnalysisId,
    jobDescriptionText: row.jobDescriptionText,
    jobDescriptionUrl: row.jobDescriptionUrl,
    selectedBullets: (row.selectedBullets ?? []) as ResumeVariantDTO['selectedBullets'],
    selectedTechTags: (row.selectedTechTags ?? []) as string[],
    selectedThemes: (row.selectedThemes ?? []) as string[],
    sectionOrder: (row.sectionOrder ?? []) as string[],
    hiddenSections: (row.hiddenSections ?? []) as string[],
    content: row.content as ResumeVariantDTO['content'],
    atsScore: row.atsScore,
    revisionHistory: ((row.revisionHistory ?? []) as VariantRevisionEntry[]).map((r) => ({
      id: r.id,
      instructions: r.instructions,
      previousContent: r.previousContent as ResumeVariantDTO['content'],
      appliedAt: r.appliedAt,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toSummaryDTO(row: ResumeVariantRow): ResumeVariantSummaryDTO {
  return {
    id: row.id,
    status: row.status as ResumeVariantSummaryDTO['status'],
    title: row.title,
    targetCompany: row.targetCompany,
    targetRole: row.targetRole,
    format: row.format as ResumeVariantSummaryDTO['format'],
    atsScore: row.atsScore,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── AI client ─────────────────────────────────────────────────────────────────

function getAiClient(): Anthropic {
  const { anthropicApiKey } = getConfig();
  if (!anthropicApiKey) {
    throw new ResumeVariantError(
      'AI_NOT_CONFIGURED',
      'ANTHROPIC_API_KEY is not configured',
      undefined,
      503
    );
  }
  return new Anthropic({ apiKey: anthropicApiKey });
}

// ── Bullet scoring ────────────────────────────────────────────────────────────

function scoreRelevance(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0.5;
  const lower = text.toLowerCase();
  const matched = keywords.filter((k) => lower.includes(k.toLowerCase()));
  return Math.min(matched.length / Math.max(keywords.length, 1), 1);
}

function extractKeywords(jdText: string): string[] {
  // Simple keyword extraction: meaningful words 4+ chars, deduplicated
  const stopWords = new Set([
    'with',
    'that',
    'this',
    'from',
    'your',
    'have',
    'will',
    'they',
    'team',
    'work',
    'able',
    'been',
    'more',
    'also',
    'into',
    'over',
    'such',
    'well',
    'both',
    'than',
    'then',
    'when',
    'some',
    'each',
    'very',
    'must',
  ]);
  const words = jdText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
  return [...new Set(words)].slice(0, 50);
}

// ── Generate ──────────────────────────────────────────────────────────────────

export async function generateResumeVariant(
  input: GenerateResumeVariantInput,
  userId?: string
): Promise<{
  variant: ResumeVariantDTO;
  usedBullets: UsedBulletDTO[];
  matchedTechTags: string[];
  matchedThemes: string[];
  atsScore?: number;
  warnings: VariantGenerationWarningDTO[];
}> {
  const hasJdText = !!input.jobDescriptionText;
  const hasJdUrl = !!input.jobDescriptionUrl;
  const hasAnalysis = !!input.jobFitAnalysisId;

  if (!hasJdText && !hasJdUrl && !hasAnalysis) {
    throw new ResumeVariantError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }
  if (hasJdText && hasJdUrl) {
    throw new ResumeVariantError(
      'JOB_CONTEXT_CONFLICT',
      'Provide either jobDescriptionText or jobDescriptionUrl, not both'
    );
  }
  if (!hasAnalysis && (!input.targetCompany || !input.targetRole)) {
    throw new ResumeVariantError(
      'TARGET_INFO_REQUIRED',
      'targetCompany and targetRole are required when jobFitAnalysisId is not provided'
    );
  }

  const db = getDb();

  // Validate base resume if provided
  if (input.baseResumeId) {
    const [baseResume] = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, input.baseResumeId))
      .limit(1);
    if (!baseResume) {
      throw new ResumeVariantError(
        'BASE_RESUME_NOT_FOUND',
        'Specified base resume does not exist',
        undefined,
        404
      );
    }
  }

  // Validate selected bullet IDs
  if (input.selectedBullets && input.selectedBullets.length > 0) {
    const allBulletIds = input.selectedBullets.flatMap((s) => s.bulletIds);
    if (allBulletIds.length > 0) {
      const foundBullets = await db
        .select({ id: quantifiedBullets.id })
        .from(quantifiedBullets)
        .where(inArray(quantifiedBullets.id, allBulletIds));
      const foundIds = new Set(foundBullets.map((b) => b.id));
      const invalidIds = allBulletIds.filter((id) => !foundIds.has(id));
      if (invalidIds.length > 0) {
        throw new ResumeVariantError(
          'BULLET_NOT_FOUND',
          'One or more selected bullet IDs do not exist in your catalog',
          { invalidIds },
          404
        );
      }
    }
  }

  // Validate tech tag IDs
  if (input.selectedTechTags && input.selectedTechTags.length > 0) {
    const foundTags = await db
      .select({ id: techStackTags.id })
      .from(techStackTags)
      .where(inArray(techStackTags.id, input.selectedTechTags));
    const foundIds = new Set(foundTags.map((t) => t.id));
    const invalidIds = input.selectedTechTags.filter((id) => !foundIds.has(id));
    if (invalidIds.length > 0) {
      throw new ResumeVariantError(
        'TAG_NOT_FOUND',
        'One or more tech tag IDs do not exist',
        { invalidIds },
        404
      );
    }
  }

  // Validate section order
  const validSections = new Set([
    'summary',
    'experience',
    'skills',
    'projects',
    'education',
    'certifications',
  ]);
  if (input.sectionOrder) {
    const seen = new Set<string>();
    for (const s of input.sectionOrder) {
      if (!validSections.has(s) || seen.has(s)) {
        throw new ResumeVariantError(
          'INVALID_SECTION_ORDER',
          'Section order contains invalid or duplicate sections',
          { invalid: s }
        );
      }
      seen.add(s);
    }
  }

  // Fetch all bullets from catalog for AI selection
  const maxBulletsPerRole = Math.min(input.maxBulletsPerRole ?? 5, 8);
  const allBullets = await db
    .select({
      id: quantifiedBullets.id,
      rawText: quantifiedBullets.rawText,
      sourceId: quantifiedBullets.sourceId,
      impactCategory: quantifiedBullets.impactCategory,
    })
    .from(quantifiedBullets)
    .limit(200);

  if (allBullets.length === 0) {
    throw new ResumeVariantError(
      'CATALOG_EMPTY',
      'Cannot generate without catalog data',
      undefined,
      422
    );
  }

  const targetCompany = input.targetCompany ?? 'the company';
  const targetRole = input.targetRole ?? 'this role';
  const format = input.format ?? 'chronological';
  const sectionEmphasis = input.sectionEmphasis ?? 'balanced';
  const atsOptimized = input.atsOptimized ?? true;

  const jdContext = hasJdText
    ? input.jobDescriptionText!
    : hasJdUrl
      ? `Job posting URL: ${input.jobDescriptionUrl}`
      : `Job fit analysis ID: ${input.jobFitAnalysisId}`;

  const keywords = hasJdText ? extractKeywords(input.jobDescriptionText!) : [];

  // Determine which bullets to use
  let selectedBulletList: typeof allBullets;
  if (input.selectedBullets && input.selectedBullets.length > 0) {
    const selectedIds = new Set(input.selectedBullets.flatMap((s) => s.bulletIds));
    selectedBulletList = allBullets.filter((b) => selectedIds.has(b.id));
  } else {
    // Score and sort by relevance, take top N per source
    const scored = allBullets
      .map((b) => ({ ...b, score: scoreRelevance(b.rawText, keywords) }))
      .sort((a, b) => b.score - a.score);

    const bySource = new Map<string, typeof scored>();
    for (const b of scored) {
      if (!bySource.has(b.sourceId)) bySource.set(b.sourceId, []);
      const list = bySource.get(b.sourceId)!;
      if (list.length < maxBulletsPerRole) list.push(b);
    }
    selectedBulletList = [...bySource.values()].flat();
  }

  // Build a structured resume content using the AI
  const bulletList = selectedBulletList
    .slice(0, 40)
    .map((b, i) => `${i + 1}. [ID:${b.id}] [Section:${b.sourceId}] ${b.rawText}`)
    .join('\n');

  const emphasisGuide = {
    experience_heavy: 'Prioritize work experience section with more bullets and detail.',
    skills_heavy: 'Lead with a prominent skills section grouped by category.',
    balanced: 'Give equal weight to experience and skills sections.',
  }[sectionEmphasis];

  const sectionOrderStr = (
    input.sectionOrder ?? ['summary', 'experience', 'skills', 'projects', 'education']
  ).join(', ');
  const hiddenStr =
    (input.hiddenSections ?? []).length > 0
      ? `Exclude these sections: ${(input.hiddenSections ?? []).join(', ')}.`
      : '';

  const prompt = `You are a professional resume writer. Generate a structured resume JSON for a ${targetRole} position at ${targetCompany}.

Job Context:
${jdContext}

Available achievement bullets (use only these — do NOT invent metrics or credentials):
${bulletList}

Instructions:
- Format: ${format}
- Section emphasis: ${emphasisGuide}
- Section order: ${sectionOrderStr}
${hiddenStr}
- ATS optimized: ${atsOptimized ? 'yes — use standard headers, no tables or graphics, incorporate job keywords naturally' : 'no'}
${input.summaryInstructions ? `- Summary guidance: ${input.summaryInstructions}` : ''}

Return ONLY valid JSON matching this structure (no markdown, no commentary):
{
  "summary": "string or null",
  "experience": [
    {
      "id": "use the sourceId from the bullet list",
      "company": "string",
      "role": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM or null",
      "bullets": [{"id": "bullet ID from list", "text": "slightly keyword-tailored bullet text", "source": "catalog", "impactCategory": "impact category"}]
    }
  ],
  "skills": {
    "categories": [{"name": "string", "skills": ["string"]}]
  },
  "projects": [],
  "education": [],
  "certifications": []
}`;

  const client = getAiClient();
  let aiMessage;
  try {
    aiMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw new ResumeVariantError(
      'AI_GENERATION_FAILED',
      'AI generation failed',
      { cause: String(err) },
      502
    );
  }

  const rawText = aiMessage.content[0].type === 'text' ? aiMessage.content[0].text : '{}';

  let content: ResumeContent;
  try {
    // Strip any possible markdown code fences
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    content = JSON.parse(cleaned) as ResumeContent;
  } catch {
    // Fall back to a minimal valid structure
    content = {
      summary: null as unknown as undefined,
      experience: [],
      skills: { categories: [] },
    };
  }

  const warnings: VariantGenerationWarningDTO[] = [];
  if (aiMessage.stop_reason === 'max_tokens') {
    warnings.push({
      code: 'CONTENT_TRUNCATED',
      message: 'Resume content may be incomplete — generation hit the output limit',
    });
  }

  // Score ATS
  const atsScore = atsOptimized
    ? Math.min(
        100,
        60 +
          Math.round(
            keywords.slice(0, 20).filter((k) => JSON.stringify(content).toLowerCase().includes(k))
              .length * 2
          )
      )
    : undefined;

  if (atsScore !== undefined && atsScore < 60) {
    warnings.push({ code: 'ATS_KEYWORD_LOW', message: 'Low keyword density for ATS optimization' });
  }

  // Build usedBullets
  const usedBulletIds = new Set(
    (content.experience ?? []).flatMap((e) => (e.bullets ?? []).map((b) => b.id))
  );
  const usedBullets: UsedBulletDTO[] = selectedBulletList
    .filter((b) => usedBulletIds.has(b.id))
    .map((b) => ({
      id: b.id,
      rawText: b.rawText,
      section: 'experience',
      impactCategory: b.impactCategory as string,
      relevanceScore: scoreRelevance(b.rawText, keywords),
    }));

  const title = `Resume - ${targetRole} at ${targetCompany}`;
  const id = ulid();
  const now = new Date();

  const selectedBulletsSaved: SectionBulletSelection[] = (input.selectedBullets ?? []).map((s) => ({
    sectionId: s.sectionId,
    bulletIds: s.bulletIds,
  }));

  const [row] = await db
    .insert(resumeVariants)
    .values({
      id,
      userId: userId ?? null,
      status: 'draft',
      title,
      targetCompany,
      targetRole,
      format: format as any,
      sectionEmphasis: sectionEmphasis as any,
      baseResumeId: input.baseResumeId,
      jobFitAnalysisId: input.jobFitAnalysisId,
      jobDescriptionText: input.jobDescriptionText,
      jobDescriptionUrl: input.jobDescriptionUrl,
      selectedBullets: selectedBulletsSaved,
      selectedTechTags: input.selectedTechTags ?? [],
      selectedThemes: input.selectedThemes ?? [],
      sectionOrder: input.sectionOrder ?? [
        'summary',
        'experience',
        'skills',
        'projects',
        'education',
      ],
      hiddenSections: input.hiddenSections ?? [],
      content,
      atsScore: atsScore ?? null,
      revisionHistory: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .returning();

  return {
    variant: toDTO(row),
    usedBullets,
    matchedTechTags: input.selectedTechTags ?? [],
    matchedThemes: input.selectedThemes ?? [],
    atsScore,
    warnings,
  };
}

// ── Get ───────────────────────────────────────────────────────────────────────

export async function getResumeVariant(
  id: string,
  userId?: string
): Promise<{
  variant: ResumeVariantDTO;
  usedBullets: UsedBulletDTO[];
  baseResume?: { id: string; fileName: string };
}> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumeVariants.id, id), eq(resumeVariants.userId, userId))
    : eq(resumeVariants.id, id);
  const [row] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!row) throw new NotFoundError('Resume variant');

  const content = row.content as ResumeContent;
  const usedIds = (content.experience ?? []).flatMap((e) => (e.bullets ?? []).map((b) => b.id));
  let usedBullets: UsedBulletDTO[] = [];
  if (usedIds.length > 0) {
    const rows = await db
      .select({
        id: quantifiedBullets.id,
        rawText: quantifiedBullets.rawText,
        impactCategory: quantifiedBullets.impactCategory,
      })
      .from(quantifiedBullets)
      .where(inArray(quantifiedBullets.id, usedIds));
    usedBullets = rows.map((b) => ({
      id: b.id,
      rawText: b.rawText,
      section: 'experience',
      impactCategory: b.impactCategory as string,
      relevanceScore: 1,
    }));
  }

  let baseResume: { id: string; fileName: string } | undefined;
  if (row.baseResumeId) {
    const [br] = await db
      .select({ id: resumes.id, fileName: resumes.fileName })
      .from(resumes)
      .where(eq(resumes.id, row.baseResumeId))
      .limit(1);
    if (br) baseResume = br;
  }

  return { variant: toDTO(row), usedBullets, baseResume };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listResumeVariants(
  params: {
    status?: string;
    company?: string;
    search?: string;
    format?: string;
    limit?: number;
    cursor?: string;
  },
  userId?: string
): Promise<{ variants: ResumeVariantSummaryDTO[]; nextCursor?: string }> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.cursor
    ? parseInt(Buffer.from(params.cursor, 'base64url').toString('utf-8'), 10)
    : 0;

  const conditions: ReturnType<typeof eq>[] = [];
  if (userId) {
    conditions.push(eq(resumeVariants.userId, userId) as any);
  }
  if (params.status === 'draft' || params.status === 'finalized') {
    conditions.push(eq(resumeVariants.status, params.status as any));
  }
  if (params.format) {
    const validFormats = ['chronological', 'functional', 'hybrid'];
    if (validFormats.includes(params.format)) {
      conditions.push(eq(resumeVariants.format, params.format as any));
    }
  }
  if (params.company) {
    conditions.push(ilike(resumeVariants.targetCompany, `%${params.company}%`) as any);
  }
  if (params.search) {
    const q = `%${params.search}%`;
    conditions.push(
      or(
        ilike(resumeVariants.title, q),
        ilike(resumeVariants.targetCompany, q),
        ilike(resumeVariants.targetRole, q)
      ) as any
    );
  }

  const baseQuery = db.select().from(resumeVariants);
  const filteredQuery =
    conditions.length > 0
      ? baseQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : baseQuery;

  const rows = await filteredQuery
    .orderBy(desc(resumeVariants.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const result = hasMore ? rows.slice(0, limit) : rows;

  return {
    variants: result.map(toSummaryDTO),
    nextCursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateResumeVariant(
  id: string,
  input: UpdateResumeVariantInput,
  userId?: string
): Promise<ResumeVariantDTO> {
  const db = getDb();

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
    version: sql`${resumeVariants.version} + 1`,
  };
  if (input.title !== undefined) updates.title = input.title;
  if (input.status !== undefined) updates.status = input.status;

  const whereClause = userId
    ? and(
        eq(resumeVariants.id, id),
        eq(resumeVariants.version, input.version),
        eq(resumeVariants.userId, userId)
      )
    : and(eq(resumeVariants.id, id), eq(resumeVariants.version, input.version));

  const [row] = await db.update(resumeVariants).set(updates).where(whereClause).returning();

  if (!row) {
    const existingWhere = userId
      ? and(eq(resumeVariants.id, id), eq(resumeVariants.userId, userId))
      : eq(resumeVariants.id, id);
    const [existing] = await db.select().from(resumeVariants).where(existingWhere).limit(1);
    if (!existing) throw new NotFoundError('Resume variant');
    throw new VersionConflictError();
  }

  return toDTO(row);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteResumeVariant(id: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumeVariants.id, id), eq(resumeVariants.userId, userId))
    : eq(resumeVariants.id, id);
  const [existing] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!existing) throw new NotFoundError('Resume variant');
  await db.delete(resumeVariants).where(whereClause);
}

// ── Revise ────────────────────────────────────────────────────────────────────

export async function reviseResumeVariant(
  id: string,
  input: ReviseResumeVariantInput,
  userId?: string
): Promise<{
  variant: ResumeVariantDTO;
  changesApplied: string[];
  usedBullets: UsedBulletDTO[];
  atsScore?: number;
}> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumeVariants.id, id), eq(resumeVariants.userId, userId))
    : eq(resumeVariants.id, id);
  const [existing] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!existing) throw new NotFoundError('Resume variant');

  const currentContent = existing.content as ResumeContent;

  const prompt = `You are revising an existing resume. Apply the following instructions and return only the revised resume JSON.

Current resume content:
${JSON.stringify(currentContent, null, 2)}

Revision instructions:
${input.instructions}

${input.format ? `Format: ${input.format}` : ''}
${input.sectionEmphasis ? `Section emphasis: ${input.sectionEmphasis}` : ''}

Rules:
- Only use facts already present in the content — do NOT invent new metrics or credentials
- Return ONLY valid JSON with the same structure as the input, no commentary or markdown`;

  const client = getAiClient();
  let aiMessage;
  try {
    aiMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw new ResumeVariantError(
      'AI_GENERATION_FAILED',
      'AI generation failed',
      { cause: String(err) },
      502
    );
  }

  const rawText = aiMessage.content[0].type === 'text' ? aiMessage.content[0].text : '{}';
  let newContent: ResumeContent;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    newContent = JSON.parse(cleaned) as ResumeContent;
  } catch {
    newContent = currentContent;
  }

  const revisionEntry: VariantRevisionEntry = {
    id: ulid(),
    instructions: input.instructions,
    previousContent: currentContent,
    appliedAt: new Date().toISOString(),
  };
  const revisionHistory = [
    ...((existing.revisionHistory ?? []) as VariantRevisionEntry[]),
    revisionEntry,
  ];

  const jdText = existing.jobDescriptionText ?? '';
  const keywords = jdText ? extractKeywords(jdText) : [];
  const atsScore =
    keywords.length > 0
      ? Math.min(
          100,
          60 +
            Math.round(
              keywords
                .slice(0, 20)
                .filter((k) => JSON.stringify(newContent).toLowerCase().includes(k)).length * 2
            )
        )
      : undefined;

  const updateFields: Record<string, unknown> = {
    content: newContent,
    revisionHistory,
    updatedAt: new Date(),
    version: sql`${resumeVariants.version} + 1`,
  };
  if (input.selectedBullets !== undefined) updateFields.selectedBullets = input.selectedBullets;
  if (input.selectedTechTags !== undefined) updateFields.selectedTechTags = input.selectedTechTags;
  if (input.sectionOrder !== undefined) updateFields.sectionOrder = input.sectionOrder;
  if (input.hiddenSections !== undefined) updateFields.hiddenSections = input.hiddenSections;
  if (input.format !== undefined) updateFields.format = input.format;
  if (input.sectionEmphasis !== undefined) updateFields.sectionEmphasis = input.sectionEmphasis;
  if (atsScore !== undefined) updateFields.atsScore = atsScore;

  const [row] = await db
    .update(resumeVariants)
    .set(updateFields)
    .where(and(eq(resumeVariants.id, id), eq(resumeVariants.version, input.version)))
    .returning();

  if (!row) throw new VersionConflictError();

  const usedIds = (newContent.experience ?? []).flatMap((e) => (e.bullets ?? []).map((b) => b.id));
  let usedBullets: UsedBulletDTO[] = [];
  if (usedIds.length > 0) {
    const bulletRows = await db
      .select({
        id: quantifiedBullets.id,
        rawText: quantifiedBullets.rawText,
        impactCategory: quantifiedBullets.impactCategory,
      })
      .from(quantifiedBullets)
      .where(inArray(quantifiedBullets.id, usedIds));
    usedBullets = bulletRows.map((b) => ({
      id: b.id,
      rawText: b.rawText,
      section: 'experience',
      impactCategory: b.impactCategory as string,
      relevanceScore: 1,
    }));
  }

  return {
    variant: toDTO(row),
    changesApplied: [`Applied revision: ${input.instructions.slice(0, 150)}`],
    usedBullets,
    atsScore,
  };
}

// ── Suggest Bullets ───────────────────────────────────────────────────────────

export async function suggestBullets(
  input: SuggestBulletsInput,
  _userId?: string
): Promise<{
  suggestions: BulletSuggestionDTO[];
  totalCatalogBullets: number;
}> {
  const hasJdText = !!input.jobDescriptionText;
  const hasJdUrl = !!input.jobDescriptionUrl;
  const hasAnalysis = !!input.jobFitAnalysisId;

  if (!hasJdText && !hasJdUrl && !hasAnalysis) {
    throw new ResumeVariantError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }

  const db = getDb();

  const [{ count: totalCatalogBullets }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(quantifiedBullets);

  const allBullets = await db
    .select({
      id: quantifiedBullets.id,
      rawText: quantifiedBullets.rawText,
      impactCategory: quantifiedBullets.impactCategory,
      sourceId: quantifiedBullets.sourceId,
    })
    .from(quantifiedBullets)
    .where(
      input.excludeBulletIds?.length
        ? notInArray(quantifiedBullets.id, input.excludeBulletIds)
        : undefined
    )
    .limit(500);

  const jdText = input.jobDescriptionText ?? '';
  const keywords = jdText ? extractKeywords(jdText) : [];
  const maxPerSection = input.maxBulletsPerSection ?? 5;

  const filtered = allBullets.filter((b) => {
    if (
      input.impactCategories?.length &&
      !input.impactCategories.includes(b.impactCategory as string)
    )
      return false;
    return true;
  });

  const scored = filtered
    .map((b) => ({
      ...b,
      score: scoreRelevance(b.rawText, keywords),
      matchedKeywords: keywords.filter((k) => b.rawText.toLowerCase().includes(k.toLowerCase())),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPerSection * 5);

  const suggestions: BulletSuggestionDTO[] = scored.slice(0, maxPerSection * 3).map((b) => ({
    bulletId: b.id,
    rawText: b.rawText,
    impactCategory: b.impactCategory as string,
    relevanceScore: Math.round(b.score * 100) / 100,
    matchedKeywords: b.matchedKeywords.slice(0, 5),
    suggestedSection: 'experience',
    reasoning:
      b.matchedKeywords.length > 0
        ? `Matches JD keywords: ${b.matchedKeywords.slice(0, 3).join(', ')}`
        : 'Strong quantified achievement for general relevance',
  }));

  return { suggestions, totalCatalogBullets };
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportResumeVariant(
  id: string,
  input: ExportResumeVariantInput,
  userId?: string
): Promise<{ buffer: Buffer; filename: string; contentType: string; pageCount: number }> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumeVariants.id, id), eq(resumeVariants.userId, userId))
    : eq(resumeVariants.id, id);
  const [row] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!row) throw new NotFoundError('Resume variant');

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await import('docx');

  const content = row.content as ResumeContent;
  const fontSize = (input.fontSize ?? 11) * 2;
  const paragraphs: InstanceType<typeof Paragraph>[] = [];

  // Header
  const { name, email, phone, linkedin, location } = input.headerInfo;
  paragraphs.push(
    new Paragraph({ text: name, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER })
  );
  const contactParts = [email, phone, linkedin, location].filter(Boolean);
  if (contactParts.length > 0) {
    paragraphs.push(
      new Paragraph({ text: contactParts.join(' | '), alignment: AlignmentType.CENTER })
    );
  }
  paragraphs.push(new Paragraph({ text: '' }));

  const sectionOrder = (row.sectionOrder ?? []) as string[];
  const hiddenSections = new Set((row.hiddenSections ?? []) as string[]);

  for (const section of sectionOrder) {
    if (hiddenSections.has(section)) continue;

    if (section === 'summary' && content.summary) {
      paragraphs.push(new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }));
      paragraphs.push(
        new Paragraph({ children: [new TextRun({ text: content.summary, size: fontSize })] })
      );
      paragraphs.push(new Paragraph({ text: '' }));
    }

    if (section === 'experience' && content.experience?.length) {
      paragraphs.push(new Paragraph({ text: 'Experience', heading: HeadingLevel.HEADING_2 }));
      for (const exp of content.experience) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${exp.role} — ${exp.company}`, bold: true, size: fontSize }),
            ],
          })
        );
        const dateStr = `${exp.startDate} – ${exp.endDate ?? 'Present'}`;
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: dateStr, size: fontSize - 2, italics: true })],
          })
        );
        for (const bullet of exp.bullets ?? []) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: `• ${bullet.text}`, size: fontSize })],
              indent: { left: 360 },
            })
          );
        }
        paragraphs.push(new Paragraph({ text: '' }));
      }
    }

    if (section === 'skills' && content.skills?.categories?.length) {
      paragraphs.push(new Paragraph({ text: 'Skills', heading: HeadingLevel.HEADING_2 }));
      for (const cat of content.skills.categories) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${cat.name}: `, bold: true, size: fontSize }),
              new TextRun({ text: cat.skills.join(', '), size: fontSize }),
            ],
          })
        );
      }
      paragraphs.push(new Paragraph({ text: '' }));
    }

    if (section === 'projects' && content.projects?.length) {
      paragraphs.push(new Paragraph({ text: 'Projects', heading: HeadingLevel.HEADING_2 }));
      for (const proj of content.projects) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: proj.name, bold: true, size: fontSize })],
          })
        );
        if (proj.description) {
          paragraphs.push(
            new Paragraph({ children: [new TextRun({ text: proj.description, size: fontSize })] })
          );
        }
        if (proj.techStack?.length) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Tech: ${proj.techStack.join(', ')}`,
                  size: fontSize - 2,
                  italics: true,
                }),
              ],
            })
          );
        }
        for (const bullet of proj.bullets ?? []) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: `• ${bullet.text}`, size: fontSize })],
              indent: { left: 360 },
            })
          );
        }
        paragraphs.push(new Paragraph({ text: '' }));
      }
    }

    if (section === 'education' && content.education?.length) {
      paragraphs.push(new Paragraph({ text: 'Education', heading: HeadingLevel.HEADING_2 }));
      for (const edu of content.education) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${edu.degree}${edu.field ? `, ${edu.field}` : ''} — ${edu.institution}`,
                bold: true,
                size: fontSize,
              }),
            ],
          })
        );
        if (edu.graduationDate) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: edu.graduationDate, size: fontSize - 2, italics: true }),
              ],
            })
          );
        }
        paragraphs.push(new Paragraph({ text: '' }));
      }
    }

    if (section === 'certifications' && content.certifications?.length) {
      paragraphs.push(new Paragraph({ text: 'Certifications', heading: HeadingLevel.HEADING_2 }));
      for (const cert of content.certifications) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `• ${cert}`, size: fontSize })],
            indent: { left: 360 },
          })
        );
      }
      paragraphs.push(new Paragraph({ text: '' }));
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = row.targetCompany
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const filename = `resume-${slug}-${dateStr}.docx`;

  return {
    buffer,
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pageCount: 1,
  };
}
