import { eq, ilike, or, desc, and, sql, inArray, notInArray, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/client.js';
import { encodeCursor, parseCursor } from '../lib/pagination.js';
import {
  applications,
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
import { resolveJobFitAnalysis } from './job-fit-analysis.service.js';
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

// ── Tenancy ───────────────────────────────────────────────────────────────────

/**
 * Owner predicate for any table this service reads (WIC-1601).
 *
 * Returned **unconditionally**, never `undefined` and never omitted, because the
 * two failure modes this closes are different and both were live:
 *
 * 1. *No owner term at all.* Every read of `resumes` and `tech_stack_tags` here
 *    was keyed on a caller-supplied id alone. `generateResumeVariant` turned
 *    that into an existence oracle over both tables and then persisted the
 *    foreign `baseResumeId` onto the variant, and `getResumeVariant` read it
 *    back out as another user's `fileName`. RLS is not a backstop: the policies
 *    in `0002_rls_current_schema.sql` are `TO authenticated USING (auth.uid() =
 *    user_id)`, but the Worker connects over a raw `postgres://` string and
 *    never sets a JWT claim, so `auth.uid()` is NULL and they never apply.
 *
 * 2. *The absent-caller fail-open.* The owner-bearing predicates were all
 *    `userId ? and(idTerm, ownerTerm) : idTerm` — the idiom WIC-1482 records on
 *    `fetchStarEntries` and WIC-1500 found reachable in a fully-configured
 *    deployment through a `sub`-less JWT. Under ADR-003 an anonymous caller is
 *    a legitimate local-dev case, but the honest reading of "anonymous" is
 *    *the rows nobody owns*, not *every row*.
 *
 * `IS NULL` is therefore what an absent caller scopes to, and what that selects
 * depends on the table:
 *
 * - `resume_variants.user_id` is nullable and the insert path writes
 *   `userId ?? null`, so anonymous rows genuinely exist and are exactly what
 *   comes back. Local dev is unchanged.
 * - `resumes.user_id` is nullable for the same reason.
 * - `tech_stack_tags.user_id` and `quantified_bullets.user_id` are `.notNull()`
 *   since migration `0017_enforce_userid_not_null.sql` (pre-existing NULLs
 *   rewritten to the `00000000-…-0` placeholder, then `SET NOT NULL`), so
 *   `IS NULL` selects the empty set. That is deliberate: an anonymous caller
 *   gets nothing rather than everything, and the read's caller must be prepared
 *   for it. The `userId ?? null` insert path that once justified a nullable
 *   reading is dead for the same reason — post-0017 it is rejected with `23502`.
 *   Do not cite `personal-info.service.ts:34` as precedent either:
 *   `personalInfo.userId` is nullable, so `IS NULL` genuinely selects that
 *   table's anonymous rows; here it selects none.
 *
 * `quantified_bullets` is the case WIC-1449 landed a dedicated `bulletOwnerScope`
 * for. That helper is gone: it was this function with the table pre-applied, and
 * one predicate with one name is the point. `rawText` is the user-authored
 * accomplishment sentence and is returned verbatim to the caller and persisted
 * into `resume_variants.content`, so every read of that table must carry this.
 *
 * `userId` stays optional here and the fallback stays with it (WIC-1764). WIC-1638
 * made the owner *required* on the bullet-catalog path and deleted the equivalent
 * branch from the `bulletOwnerScope` this replaced — but that helper served one
 * `.notNull()` table, and this one also serves `resume_variants` and `resumes`,
 * which are nullable and whose insert paths write `userId ?? null`. Requiring the
 * owner here would break the ADR-003 local-dev anonymous path and the entry points
 * in this file that still take `userId?: string`.
 *
 * WIC-1638's guarantee is therefore carried where it holds without that cost:
 * `requireOwner(c)` rejects an absent owner at the route edge with `401
 * OWNER_REQUIRED`, and `generateResumeVariant` / `getResumeVariant` /
 * `reviseResumeVariant` / `suggestBullets` take `userId: string`. The `IS NULL`
 * branch is unreachable from those paths, and fail-closed on `quantified_bullets`
 * regardless. Do not "finish the job" by making `userId` required here.
 */
function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string) {
  return userId ? eq(table.userId, userId) : isNull(table.userId);
}

// ── Application association (WIC-1544) ────────────────────────────────────────

/**
 * Resolve a caller-supplied `applicationId` to an application this caller owns.
 *
 * Uses the same `ownerScope` as every other read in this file, for the same
 * reason and one more: `applicationId` is a client-supplied foreign key, so an
 * unscoped lookup would let a caller staple another user's application id onto
 * their own variant. Throws 404 rather than dropping the id silently, matching
 * `BASE_RESUME_NOT_FOUND` below.
 */
/**
 * Resolve an application id the caller is entitled to reference.
 *
 * Takes the owner *scope* rather than the owner itself. `ownerScope` is a
 * single-expression fail-closed helper (an absent owner scopes to `IS NULL`,
 * never to the whole table), so the absent-owner decision is made once, in the
 * one place the owner-predicate audit recognises and checks by shape — instead
 * of this function carrying an optional owner of its own, which is the [SIG]
 * shape that audit exists to stop spreading.
 */
async function resolveOwnedApplicationId(applicationId: string, owner: SQL): Promise<string> {
  const db = getDb();
  const [app] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), owner))
    .limit(1);
  if (!app) {
    throw new ResumeVariantError(
      'APPLICATION_NOT_FOUND',
      'Referenced application does not exist',
      undefined,
      404
    );
  }
  return app.id;
}

// ── DTO mappers ───────────────────────────────────────────────────────────────

function toDTO(row: ResumeVariantRow): ResumeVariantDTO {
  return {
    id: row.id,
    applicationId: row.applicationId,
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
    applicationId: row.applicationId,
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
  userId: string
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
  // See generateCoverLetter: resolved before every other guard, so an
  // unresolvable id cannot satisfy JOB_CONTEXT_REQUIRED or waive
  // TARGET_INFO_REQUIRED below (WIC-1818 AC-5a).
  const hasAnalysis = (await resolveJobFitAnalysis(input.jobFitAnalysisId, userId)) !== null;

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

  const applicationId = input.applicationId
    ? await resolveOwnedApplicationId(input.applicationId, ownerScope(applications, userId))
    : null;

  // Validate base resume if provided
  if (input.baseResumeId) {
    const [baseResume] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, input.baseResumeId), ownerScope(resumes, userId)))
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
      // Scoped too, not just the catalog read below: unscoped this both confirms
      // the existence of another user's bullet id and, because the selection is
      // later intersected with the caller-scoped catalog, silently yields an
      // empty resume instead of the BULLET_NOT_FOUND this branch exists to raise.
      const foundBullets = await db
        .select({ id: quantifiedBullets.id })
        .from(quantifiedBullets)
        .where(
          and(ownerScope(quantifiedBullets, userId), inArray(quantifiedBullets.id, allBulletIds))
        );
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
      .where(
        and(inArray(techStackTags.id, input.selectedTechTags), ownerScope(techStackTags, userId))
      );
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
    .where(ownerScope(quantifiedBullets, userId))
    .limit(200);

  // Evaluated over the caller's catalog, so UC-6's empty-state is reachable for a
  // user with no bullets even when other users have some.
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

  // The third arm was `Job fit analysis ID: ${input.jobFitAnalysisId}` — a
  // caller-controlled id standing in for the job description. Unreachable today
  // and fails closed; AC-5b puts the stored analysis here.
  if (!hasJdText && !hasJdUrl) {
    throw new ResumeVariantError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }
  const jdContext = hasJdText
    ? input.jobDescriptionText!
    : `Job posting URL: ${input.jobDescriptionUrl}`;

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
      applicationId,
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
  userId: string
): Promise<{
  variant: ResumeVariantDTO;
  usedBullets: UsedBulletDTO[];
  baseResume?: { id: string; fileName: string };
}> {
  const db = getDb();
  const whereClause = and(eq(resumeVariants.id, id), ownerScope(resumeVariants, userId));
  const [row] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!row) throw new NotFoundError('Resume variant');

  const content = row.content as ResumeContent;
  const usedIds = (content.experience ?? []).flatMap((e) => (e.bullets ?? []).map((b) => b.id));
  let usedBullets: UsedBulletDTO[] = [];
  if (usedIds.length > 0) {
    // `usedIds` comes out of the variant's own persisted `content`, which for any
    // variant generated before this fix can already name another user's bullets.
    // Scoping the re-hydration stops those ids resolving back to foreign
    // `rawText` on every GET; it does not clean the rows (see AC-7 follow-up).
    const rows = await db
      .select({
        id: quantifiedBullets.id,
        rawText: quantifiedBullets.rawText,
        impactCategory: quantifiedBullets.impactCategory,
      })
      .from(quantifiedBullets)
      .where(and(ownerScope(quantifiedBullets, userId), inArray(quantifiedBullets.id, usedIds)));
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
    // `baseResumeId` was written unscoped before this change, so a variant the
    // caller genuinely owns can still name another user's resume. Fixing the
    // write does not clean what it already wrote (WIC-1437), so the read carries
    // the predicate too and a foreign base degrades to `undefined`.
    const [br] = await db
      .select({ id: resumes.id, fileName: resumes.fileName })
      .from(resumes)
      .where(and(eq(resumes.id, row.baseResumeId), ownerScope(resumes, userId)))
      .limit(1);
    if (br) baseResume = br;
  }

  return { variant: toDTO(row), usedBullets, baseResume };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listResumeVariants(
  params: {
    status?: string;
    applicationId?: string;
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
  const offset = parseCursor(params.cursor);

  // Unconditional, not `if (userId)`: the owner term is the one condition that
  // must survive an absent caller, and pushing it conditionally is how the array
  // form hid the same fail-open the ternaries above carried.
  const conditions: ReturnType<typeof eq>[] = [ownerScope(resumeVariants, userId) as any];
  if (params.status === 'draft' || params.status === 'finalized') {
    conditions.push(eq(resumeVariants.status, params.status as any));
  }
  if (params.format) {
    const validFormats = ['chronological', 'functional', 'hybrid'];
    if (validFormats.includes(params.format)) {
      conditions.push(eq(resumeVariants.format, params.format as any));
    }
  }
  if (params.applicationId) {
    // `eq`, not `ilike` — see the route schema note (WIC-1544 AC-3).
    conditions.push(eq(resumeVariants.applicationId, params.applicationId) as any);
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
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
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

  const whereClause = and(
    eq(resumeVariants.id, id),
    eq(resumeVariants.version, input.version),
    ownerScope(resumeVariants, userId)
  );

  const [row] = await db.update(resumeVariants).set(updates).where(whereClause).returning();

  if (!row) {
    const existingWhere = and(eq(resumeVariants.id, id), ownerScope(resumeVariants, userId));
    const [existing] = await db.select().from(resumeVariants).where(existingWhere).limit(1);
    if (!existing) throw new NotFoundError('Resume variant');
    throw new VersionConflictError();
  }

  return toDTO(row);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteResumeVariant(id: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = and(eq(resumeVariants.id, id), ownerScope(resumeVariants, userId));
  const [existing] = await db.select().from(resumeVariants).where(whereClause).limit(1);
  if (!existing) throw new NotFoundError('Resume variant');
  await db.delete(resumeVariants).where(whereClause);
}

// ── Revise ────────────────────────────────────────────────────────────────────

export async function reviseResumeVariant(
  id: string,
  input: ReviseResumeVariantInput,
  userId: string
): Promise<{
  variant: ResumeVariantDTO;
  changesApplied: string[];
  usedBullets: UsedBulletDTO[];
  atsScore?: number;
}> {
  const db = getDb();
  const whereClause = and(eq(resumeVariants.id, id), ownerScope(resumeVariants, userId));
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
    // Same re-hydration hazard as `getResumeVariant` — scoped for the same reason.
    const bulletRows = await db
      .select({
        id: quantifiedBullets.id,
        rawText: quantifiedBullets.rawText,
        impactCategory: quantifiedBullets.impactCategory,
      })
      .from(quantifiedBullets)
      .where(and(ownerScope(quantifiedBullets, userId), inArray(quantifiedBullets.id, usedIds)));
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
  userId: string
): Promise<{
  suggestions: BulletSuggestionDTO[];
  totalCatalogBullets: number;
}> {
  const hasJdText = !!input.jobDescriptionText;
  const hasJdUrl = !!input.jobDescriptionUrl;
  // Site the WIC-1818 card does not enumerate. The id satisfied
  // JOB_CONTEXT_REQUIRED here, so `{"jobFitAnalysisId":"x"}` alone reached the
  // catalog and returned bullet suggestions scored against no job context at
  // all (`keywords` is `[]` without `jobDescriptionText`).
  const hasAnalysis = (await resolveJobFitAnalysis(input.jobFitAnalysisId, userId)) !== null;

  if (!hasJdText && !hasJdUrl && !hasAnalysis) {
    throw new ResumeVariantError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }

  const db = getDb();

  // Named `bulletScope`, not `ownerScope`: WIC-1601 introduced a module-scope
  // `ownerScope(table, userId)` and a local of the same name would shadow it for
  // the whole function body. Both reads below must carry this, including the
  // `excludeBulletIds` branch — an owner term in only one arm of that ternary is
  // the WIC-1601 defect.
  const bulletScope = ownerScope(quantifiedBullets, userId);

  const [{ count: totalCatalogBullets }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(quantifiedBullets)
    .where(bulletScope);

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
        ? and(bulletScope, notInArray(quantifiedBullets.id, input.excludeBulletIds))
        : bulletScope
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
  const whereClause = and(eq(resumeVariants.id, id), ownerScope(resumeVariants, userId));
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
