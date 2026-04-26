import { eq, ilike, or, desc, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/client.js';
import { coverLetters, outreachMessages, quantifiedBullets } from '../db/schema.js';
import type { CoverLetter, OutreachMessage, RevisionEntry } from '../db/schema.js';
import { getConfig } from '../config.js';
import {
  CoverLetterDTO,
  CoverLetterSummaryDTO,
  UsedStarEntryDTO,
  GenerationWarningDTO,
  GenerateCoverLetterInput,
  ReviseCoverLetterInput,
  UpdateCoverLetterInput,
  OutreachMessageDTO,
  GenerateOutreachInput,
  ExportCoverLetterInput,
  RevisionEntryDTO,
  CoverLetterError,
  NotFoundError,
} from '../types/index.js';

// ── DTO mappers ───────────────────────────────────────────────────────────────

function toDTO(cl: CoverLetter): CoverLetterDTO {
  return {
    id: cl.id,
    status: cl.status as CoverLetterDTO['status'],
    title: cl.title,
    targetCompany: cl.targetCompany,
    targetRole: cl.targetRole,
    tone: cl.tone as CoverLetterDTO['tone'],
    lengthVariant: cl.lengthVariant as CoverLetterDTO['lengthVariant'],
    jobDescriptionText: cl.jobDescriptionText,
    jobDescriptionUrl: cl.jobDescriptionUrl,
    jobFitAnalysisId: cl.jobFitAnalysisId,
    selectedStarEntryIds: cl.selectedStarEntryIds ?? [],
    content: cl.content,
    revisionHistory: ((cl.revisionHistory ?? []) as RevisionEntry[]).map((r) => ({
      id: r.id,
      instructions: r.instructions,
      previousContent: r.previousContent,
      createdAt: r.createdAt,
    })),
    createdAt: cl.createdAt.toISOString(),
    updatedAt: cl.updatedAt.toISOString(),
    version: cl.version,
  };
}

function toSummaryDTO(cl: CoverLetter): CoverLetterSummaryDTO {
  return {
    id: cl.id,
    status: cl.status as CoverLetterSummaryDTO['status'],
    title: cl.title,
    targetCompany: cl.targetCompany,
    targetRole: cl.targetRole,
    tone: cl.tone as CoverLetterSummaryDTO['tone'],
    lengthVariant: cl.lengthVariant as CoverLetterSummaryDTO['lengthVariant'],
    preview: cl.content.slice(0, 200),
    createdAt: cl.createdAt.toISOString(),
    updatedAt: cl.updatedAt.toISOString(),
  };
}

function toOutreachDTO(om: OutreachMessage): OutreachMessageDTO {
  return {
    id: om.id,
    platform: om.platform as OutreachMessageDTO['platform'],
    targetCompany: om.targetCompany,
    targetRole: om.targetRole,
    subject: om.subject,
    body: om.body,
    characterCount: om.characterCount,
    createdAt: om.createdAt.toISOString(),
  };
}

// ── AI client ─────────────────────────────────────────────────────────────────

function getAiClient(): Anthropic {
  const { anthropicApiKey } = getConfig();
  if (!anthropicApiKey) {
    throw new CoverLetterError('AI_NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured', undefined, 503);
  }
  return new Anthropic({ apiKey: anthropicApiKey });
}

// ── Generation helpers ────────────────────────────────────────────────────────

const WORD_TARGETS: Record<string, { min: number; max: number }> = {
  concise: { min: 150, max: 250 },
  standard: { min: 300, max: 400 },
  detailed: { min: 450, max: 550 },
};

const TONE_DESCRIPTORS: Record<string, string> = {
  professional: 'formal business tone',
  conversational: 'friendly but professional tone',
  enthusiastic: 'high-energy, startup-friendly tone',
  technical: 'technically precise tone that emphasises technical depth',
};

async function fetchStarEntries(ids: string[]): Promise<{ id: string; rawText: string }[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ id: quantifiedBullets.id, rawText: quantifiedBullets.rawText })
    .from(quantifiedBullets)
    .where(inArray(quantifiedBullets.id, ids));
  return rows;
}

// ── Generate ──────────────────────────────────────────────────────────────────

export async function generateCoverLetter(input: GenerateCoverLetterInput): Promise<{
  coverLetter: CoverLetterDTO;
  usedStarEntries: UsedStarEntryDTO[];
  matchedThemes: string[];
  warnings: GenerationWarningDTO[];
}> {
  // Validation
  const hasJdText = !!input.jobDescriptionText;
  const hasJdUrl = !!input.jobDescriptionUrl;
  const hasAnalysis = !!input.jobFitAnalysisId;

  if (!hasJdText && !hasJdUrl && !hasAnalysis) {
    throw new CoverLetterError('JOB_CONTEXT_REQUIRED', 'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId');
  }
  if (hasJdText && hasJdUrl) {
    throw new CoverLetterError('JOB_CONTEXT_CONFLICT', 'Provide either jobDescriptionText or jobDescriptionUrl, not both');
  }
  if (!input.selectedStarEntryIds || input.selectedStarEntryIds.length === 0) {
    throw new CoverLetterError('STAR_ENTRIES_REQUIRED', 'At least one STAR entry ID is required');
  }
  if (input.selectedStarEntryIds.length > 10) {
    throw new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 10 STAR entries allowed');
  }
  if (!hasAnalysis && (!input.targetCompany || !input.targetRole)) {
    throw new CoverLetterError('TARGET_INFO_REQUIRED', 'targetCompany and targetRole are required when jobFitAnalysisId is not provided');
  }

  const starEntries = await fetchStarEntries(input.selectedStarEntryIds);

  // Validate all IDs exist
  const foundIds = new Set(starEntries.map((e) => e.id));
  const invalidIds = input.selectedStarEntryIds.filter((id) => !foundIds.has(id));
  if (invalidIds.length > 0) {
    throw new CoverLetterError('STAR_ENTRY_NOT_FOUND', 'One or more selected STAR entry IDs do not exist', { invalidIds }, 404);
  }

  if (starEntries.length === 0) {
    throw new CoverLetterError('CATALOG_EMPTY', 'No catalog data available for generation', undefined, 422);
  }

  const targetCompany = input.targetCompany ?? 'the company';
  const targetRole = input.targetRole ?? 'this role';
  const tone = input.tone ?? 'professional';
  const lengthVariant = input.lengthVariant ?? 'standard';
  const wordTarget = WORD_TARGETS[lengthVariant];

  const jdContext = hasJdText
    ? `Job Description:\n${input.jobDescriptionText}`
    : hasJdUrl
      ? `Job Posting URL: ${input.jobDescriptionUrl}`
      : `Job Fit Analysis ID: ${input.jobFitAnalysisId}`;

  const starBullets = starEntries.map((e, i) => `${i + 1}. ${e.rawText}`).join('\n');

  const prompt = `You are a professional cover letter writer. Generate a cover letter based only on the provided STAR entries — never invent credentials or metrics.

Target Role: ${targetRole}
Target Company: ${targetCompany}
${jdContext}

STAR Achievements to incorporate:
${starBullets}

Tone: ${TONE_DESCRIPTORS[tone]}
Length: ${wordTarget.min}–${wordTarget.max} words (${lengthVariant})
${input.emphasizeThemes?.length ? `Emphasize themes: ${input.emphasizeThemes.join(', ')}` : ''}
${input.customInstructions ? `Additional instructions: ${input.customInstructions}` : ''}

Rules:
- Use only facts from the STAR entries above
- If there are skill gaps, acknowledge them constructively
- Start with "Dear Hiring Manager,"
- Sign off with "Sincerely,\n[Your Name]"
- Return only the cover letter text, no commentary`;

  const client = getAiClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0].type === 'text' ? message.content[0].text : '';

  const warnings: GenerationWarningDTO[] = [];
  if (starEntries.length < 3) {
    warnings.push({ code: 'LIMITED_STAR_ENTRIES', message: 'Fewer STAR entries selected than recommended (3+)' });
  }

  const usedStarEntries: UsedStarEntryDTO[] = starEntries.map((e, i) => ({
    id: e.id,
    rawText: e.rawText,
    placement: i === 0 ? 'opening' : i === starEntries.length - 1 ? 'closing' : 'body',
  }));

  const title = `Cover Letter - ${targetRole} at ${targetCompany}`;

  const db = getDb();
  const id = ulid();
  const now = new Date();

  const [row] = await db
    .insert(coverLetters)
    .values({
      id,
      status: 'draft',
      title,
      targetCompany,
      targetRole,
      tone: tone as any,
      lengthVariant: lengthVariant as any,
      jobDescriptionText: input.jobDescriptionText,
      jobDescriptionUrl: input.jobDescriptionUrl,
      jobFitAnalysisId: input.jobFitAnalysisId,
      selectedStarEntryIds: input.selectedStarEntryIds,
      content,
      revisionHistory: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .returning();

  return {
    coverLetter: toDTO(row),
    usedStarEntries,
    matchedThemes: input.emphasizeThemes ?? [],
    warnings,
  };
}

// ── Get ───────────────────────────────────────────────────────────────────────

export async function getCoverLetter(id: string): Promise<{
  coverLetter: CoverLetterDTO;
  usedStarEntries: UsedStarEntryDTO[];
}> {
  const db = getDb();
  const [row] = await db.select().from(coverLetters).where(eq(coverLetters.id, id)).limit(1);
  if (!row) throw new NotFoundError('Cover letter');

  const starEntries = await fetchStarEntries(row.selectedStarEntryIds ?? []);
  const usedStarEntries: UsedStarEntryDTO[] = starEntries.map((e, i) => ({
    id: e.id,
    rawText: e.rawText,
    placement: i === 0 ? 'opening' : i === starEntries.length - 1 ? 'closing' : 'body',
  }));

  return { coverLetter: toDTO(row), usedStarEntries };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listCoverLetters(params: {
  status?: string;
  company?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ coverLetters: CoverLetterSummaryDTO[]; nextCursor?: string }> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 20, 100);

  const query = db.select().from(coverLetters);

  const conditions: ReturnType<typeof eq>[] = [];
  if (params.status === 'draft' || params.status === 'finalized') {
    conditions.push(eq(coverLetters.status, params.status as any));
  }
  if (params.company) {
    conditions.push(ilike(coverLetters.targetCompany, `%${params.company}%`) as any);
  }
  if (params.search) {
    const q = `%${params.search}%`;
    conditions.push(
      or(
        ilike(coverLetters.title, q),
        ilike(coverLetters.targetCompany, q),
        ilike(coverLetters.targetRole, q),
        ilike(coverLetters.content, q)
      ) as any
    );
  }

  const rows = await (conditions.length > 0
    ? query.where(conditions.reduce((a, b) => (a as any) && (b as any), conditions[0]) as any)
    : query
  )
    .orderBy(desc(coverLetters.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const result = hasMore ? rows.slice(0, limit) : rows;

  return {
    coverLetters: result.map(toSummaryDTO),
    nextCursor: hasMore ? Buffer.from(String(limit)).toString('base64url') : undefined,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateCoverLetter(
  id: string,
  input: UpdateCoverLetterInput
): Promise<CoverLetterDTO> {
  const db = getDb();
  const [existing] = await db.select().from(coverLetters).where(eq(coverLetters.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Cover letter');
  if (existing.version !== input.version) {
    throw new CoverLetterError('COVER_LETTER_VERSION_CONFLICT', 'Version mismatch', undefined, 409);
  }

  const updates: Partial<typeof existing> = {
    updatedAt: new Date(),
    version: existing.version + 1,
  };
  if (input.title !== undefined) updates.title = input.title;
  if (input.status !== undefined) updates.status = input.status as any;

  const [row] = await db
    .update(coverLetters)
    .set(updates)
    .where(eq(coverLetters.id, id))
    .returning();

  return toDTO(row);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteCoverLetter(id: string): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(coverLetters).where(eq(coverLetters.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Cover letter');
  await db.delete(coverLetters).where(eq(coverLetters.id, id));
}

// ── Revise ────────────────────────────────────────────────────────────────────

export async function reviseCoverLetter(
  id: string,
  input: ReviseCoverLetterInput
): Promise<{
  coverLetter: CoverLetterDTO;
  changesApplied: string[];
  usedStarEntries: UsedStarEntryDTO[];
}> {
  const db = getDb();
  const [existing] = await db.select().from(coverLetters).where(eq(coverLetters.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Cover letter');
  if (existing.version !== input.version) {
    throw new CoverLetterError('COVER_LETTER_VERSION_CONFLICT', 'Version mismatch', undefined, 409);
  }

  const selectedIds = input.selectedStarEntryIds ?? existing.selectedStarEntryIds ?? [];
  const starEntries = await fetchStarEntries(selectedIds);

  const tone = (input.tone ?? existing.tone) as string;
  const lengthVariant = (input.lengthVariant ?? existing.lengthVariant) as string;
  const wordTarget = WORD_TARGETS[lengthVariant];
  const starBullets = starEntries.map((e, i) => `${i + 1}. ${e.rawText}`).join('\n');

  const prompt = `You are revising an existing cover letter. Apply the following instructions and return only the revised cover letter text.

Current cover letter:
${existing.content}

Revision instructions:
${input.instructions}

Tone: ${TONE_DESCRIPTORS[tone]}
Length: ${wordTarget.min}–${wordTarget.max} words (${lengthVariant})

STAR Achievements available:
${starBullets}

Rules:
- Use only facts from the original content or STAR entries provided
- Return only the revised letter text, no commentary`;

  const client = getAiClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const newContent = message.content[0].type === 'text' ? message.content[0].text : '';

  const revisionEntry: RevisionEntry = {
    id: ulid(),
    instructions: input.instructions,
    previousContent: existing.content,
    createdAt: new Date().toISOString(),
  };

  const revisionHistory = [...((existing.revisionHistory ?? []) as RevisionEntry[]), revisionEntry];
  const now = new Date();

  const [row] = await db
    .update(coverLetters)
    .set({
      content: newContent,
      tone: (input.tone ?? existing.tone) as any,
      lengthVariant: (input.lengthVariant ?? existing.lengthVariant) as any,
      selectedStarEntryIds: selectedIds,
      revisionHistory,
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(eq(coverLetters.id, id))
    .returning();

  const usedStarEntries: UsedStarEntryDTO[] = starEntries.map((e, i) => ({
    id: e.id,
    rawText: e.rawText,
    placement: i === 0 ? 'opening' : i === starEntries.length - 1 ? 'closing' : 'body',
  }));

  return {
    coverLetter: toDTO(row),
    changesApplied: [`Applied revision: ${input.instructions.slice(0, 100)}`],
    usedStarEntries,
  };
}

// ── Generate Outreach ─────────────────────────────────────────────────────────

export async function generateOutreach(input: GenerateOutreachInput): Promise<{
  message: OutreachMessageDTO;
}> {
  // Validation
  if (!input.coverLetterId && !input.jobFitAnalysisId && (!input.selectedStarEntryIds || input.selectedStarEntryIds.length === 0)) {
    throw new CoverLetterError('JOB_CONTEXT_REQUIRED', 'Provide coverLetterId, jobFitAnalysisId, or selectedStarEntryIds');
  }
  if (input.selectedStarEntryIds && input.selectedStarEntryIds.length > 3) {
    throw new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 3 STAR entries for outreach');
  }
  if (input.keyPoints && input.keyPoints.length > 3) {
    throw new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 3 key points allowed');
  }

  const platform = input.platform;
  const maxLength = platform === 'linkedin'
    ? Math.min(input.maxLength ?? 300, 500)
    : Math.min(input.maxLength ?? 500, 1000);

  let contextText = '';

  if (input.coverLetterId) {
    const db = getDb();
    const [cl] = await db.select().from(coverLetters).where(eq(coverLetters.id, input.coverLetterId)).limit(1);
    if (!cl) throw new CoverLetterError('COVER_LETTER_NOT_FOUND', 'Cover letter not found', undefined, 404);
    contextText = `Based on this cover letter excerpt:\n${cl.content.slice(0, 500)}`;
  } else if (input.selectedStarEntryIds?.length) {
    const entries = await fetchStarEntries(input.selectedStarEntryIds);
    contextText = `Key achievements:\n${entries.map((e) => `- ${e.rawText}`).join('\n')}`;
  } else {
    contextText = `Job Fit Analysis ID: ${input.jobFitAnalysisId}`;
  }

  const recipientLine = input.targetName ? `Hi ${input.targetName},` : 'Hi there,';
  const ctaDescriptions: Record<string, string> = {
    coffee_chat: 'ask for a 15-minute coffee chat',
    referral: 'request a referral',
    application_follow_up: 'follow up on a job application',
    informational: 'request an informational interview',
  };
  const ctaGoal = input.callToAction ? ctaDescriptions[input.callToAction] : 'introduce yourself';

  const prompt = `Write a short ${platform === 'linkedin' ? 'LinkedIn message' : 'email'} for a job seeker.

Target: ${input.targetName ?? 'Hiring contact'}${input.targetTitle ? `, ${input.targetTitle}` : ''} at ${input.targetCompany}
Role of interest: ${input.targetRole ?? 'an open position'}
Goal: ${ctaGoal}
${input.keyPoints?.length ? `Key points to mention: ${input.keyPoints.join(', ')}` : ''}
${contextText}

Requirements:
- Maximum ${maxLength} characters (STRICT)
- Start with: "${recipientLine}"
- ${platform === 'email' ? 'Include a brief subject line on the first line prefixed with "Subject: "' : 'No subject line needed'}
- Authentic and professional
- Return only the message text`;

  const client = getAiClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '';

  let subject: string | undefined;
  let body = rawText;

  if (platform === 'email' && rawText.startsWith('Subject:')) {
    const lines = rawText.split('\n');
    subject = lines[0].replace(/^Subject:\s*/i, '').trim();
    body = lines.slice(1).join('\n').trim();
  }

  const db = getDb();
  const id = ulid();
  const now = new Date();

  const [row] = await db
    .insert(outreachMessages)
    .values({
      id,
      platform: platform as any,
      targetCompany: input.targetCompany,
      targetRole: input.targetRole,
      targetName: input.targetName,
      targetTitle: input.targetTitle,
      coverLetterId: input.coverLetterId,
      jobFitAnalysisId: input.jobFitAnalysisId,
      subject,
      body,
      characterCount: body.length,
      createdAt: now,
    })
    .returning();

  return { message: toOutreachDTO(row) };
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportCoverLetter(
  id: string,
  input: ExportCoverLetterInput
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  if (input.format !== 'docx') {
    throw new CoverLetterError('EXPORT_FORMAT_INVALID', 'Only docx export is currently supported');
  }

  const db = getDb();
  const [row] = await db.select().from(coverLetters).where(eq(coverLetters.id, id)).limit(1);
  if (!row) throw new NotFoundError('Cover letter');

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

  const paragraphs = [];

  if (input.includeHeader && input.headerInfo) {
    const { name, email, phone, linkedin } = input.headerInfo;
    paragraphs.push(
      new Paragraph({
        text: name,
        heading: HeadingLevel.HEADING_2,
      })
    );
    const contactParts = [email, phone, linkedin].filter(Boolean);
    if (contactParts.length > 0) {
      paragraphs.push(new Paragraph({ text: contactParts.join(' | ') }));
    }
    paragraphs.push(new Paragraph({ text: '' }));
  }

  const fontSize = (input.fontSize ?? 11) * 2;

  for (const line of row.content.split('\n')) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line, size: fontSize })],
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(doc);
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = row.targetCompany.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filename = `cover-letter-${slug}-${dateStr}.docx`;

  return {
    buffer,
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
