import { eq, ilike, or, desc, inArray, and, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/client.js';
import { encodeCursor, parseCursor } from '../lib/pagination.js';
import { applications, coverLetters, outreachMessages, quantifiedBullets } from '../db/schema.js';
import type { CoverLetter, OutreachMessage, RevisionEntry } from '../db/schema.js';
import { getConfig } from '../config.js';
import { fetchJobDescriptionFromUrl } from './job-fit.service.js';
import { resolveJobFitAnalysis } from './job-fit-analysis.service.js';
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
  VersionConflictError,
} from '../types/index.js';

// ── Application association (WIC-1544) ────────────────────────────────────────

/**
 * Resolve a caller-supplied `applicationId` to an application this caller owns.
 *
 * Scoped, and scoped unconditionally. The owner term is `eq` for an identified
 * caller and `IS NULL` for an anonymous one, never *absent*: an unscoped lookup
 * here would both confirm the existence of another user's application id and
 * write that id into this user's `cover_letters.application_id`, manufacturing
 * a cross-tenant reference out of a field the client fully controls. `IS NULL`
 * is the right anonymous branch rather than a dead one because `applications`
 * is one of the tables migration 0017 left `user_id` nullable on.
 *
 * Returns the id on success so the caller can persist it, and throws 404 rather
 * than silently dropping it — a letter that quietly forgets the application it
 * was asked to record is the defect this card exists to fix.
 */
/**
 * Fail closed: an absent owner scopes to `user_id IS NULL`, never to the whole
 * table. Mirrors the helper of the same name in interviewPrep/job-fit/
 * resume-variant, and is the shape the owner-predicate audit recognises.
 */
function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string) {
  return userId ? eq(table.userId, userId) : isNull(table.userId);
}

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
    throw new CoverLetterError(
      'APPLICATION_NOT_FOUND',
      'Referenced application does not exist',
      undefined,
      404
    );
  }
  return app.id;
}

// ── DTO mappers ───────────────────────────────────────────────────────────────

function toDTO(cl: CoverLetter): CoverLetterDTO {
  return {
    id: cl.id,
    applicationId: cl.applicationId,
    status: cl.status as CoverLetterDTO['status'],
    title: cl.title,
    targetCompany: cl.targetCompany,
    targetRole: cl.targetRole,
    tone: cl.tone as CoverLetterDTO['tone'],
    lengthVariant: cl.lengthVariant as CoverLetterDTO['lengthVariant'],
    emphasis: (cl.emphasis as CoverLetterDTO['emphasis']) ?? 'balanced',
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
    applicationId: cl.applicationId,
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
    throw new CoverLetterError(
      'AI_NOT_CONFIGURED',
      'ANTHROPIC_API_KEY is not configured',
      undefined,
      503
    );
  }
  return new Anthropic({ apiKey: anthropicApiKey });
}

// ── Generation helpers ────────────────────────────────────────────────────────

const WORD_TARGETS: Record<string, { min: number; max: number }> = {
  concise: { min: 250, max: 350 },
  standard: { min: 400, max: 550 },
  detailed: { min: 600, max: 800 },
};

const TONE_DESCRIPTORS: Record<string, string> = {
  professional: 'formal business tone',
  conversational: 'friendly but professional tone',
  enthusiastic: 'high-energy, startup-friendly tone',
  technical: 'technically precise tone that emphasises technical depth',
};

const EMPHASIS_DESCRIPTORS: Record<string, string> = {
  technical: 'Emphasize technical skills, engineering depth, and specific technologies.',
  leadership: 'Emphasize leadership experience, team impact, and strategic contributions.',
  balanced: 'Balance technical skills and leadership qualities equally.',
};

// `userId` is positionally required — not optional — so that no call site can
// silently forget to scope a caller-supplied id list. It still accepts
// `undefined` to match the auth-bypass path the eight row-addressed handlers
// use (`c.get('userId') ?? undefined`); see the sibling lookups below.
//
// WIC-1482. The owner term is always present. It used to be the whole
// conjunction that was conditional — `userId ? and(ids, owner) : ids` — which
// scoped the authenticated branch and left the anonymous one selecting purely
// by caller-supplied ids, i.e. the original defect, narrowed rather than
// closed. An absent caller scopes to `IS NULL`, never to nothing, matching
// `bulletOwnerScope` in `resume-variant.service.ts` / `interviewPrep.service.ts`,
// both of which carry this exact `userId ? eq : isNull` shape. Those two are cited
// deliberately and `job-fit.service.ts` is not: its `quantified_bullets` read is the
// other half of WIC-1482 and lands on a separate branch, so its state here depends on
// merge order and any claim about it would be stale in one tree or the other.
// `quantified_bullets.user_id` is
// `uuid NOT NULL` (`schema.ts:265`), so there is no legacy-null cohort for
// `IS NULL` to reach and the anonymous local-dev caller gets zero rows — the
// `STAR_ENTRY_NOT_FOUND` / `CATALOG_EMPTY` empty state, not a global read.
async function fetchStarEntries(
  ids: string[],
  userId: string | undefined
): Promise<{ id: string; rawText: string }[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const whereClause = and(
    inArray(quantifiedBullets.id, ids),
    userId ? eq(quantifiedBullets.userId, userId) : isNull(quantifiedBullets.userId)
  );
  const rows = await db
    .select({ id: quantifiedBullets.id, rawText: quantifiedBullets.rawText })
    .from(quantifiedBullets)
    .where(whereClause);
  return rows;
}

// ── Generate ──────────────────────────────────────────────────────────────────

export async function generateCoverLetter(
  input: GenerateCoverLetterInput,
  userId?: string
): Promise<{
  coverLetter: CoverLetterDTO;
  usedStarEntries: UsedStarEntryDTO[];
  matchedThemes: string[];
  warnings: GenerationWarningDTO[];
}> {
  // Validation
  const hasJdText = !!input.jobDescriptionText;
  const hasJdUrl = !!input.jobDescriptionUrl;
  // Resolved before any other guard, and before the model spend and the write:
  // an unresolvable id is rejected 422 rather than being allowed to satisfy
  // JOB_CONTEXT_REQUIRED and waive TARGET_INFO_REQUIRED below (WIC-1818 AC-5a).
  // Always false today — nothing resolves until `job_fit_analyses` exists — but
  // the two guards keep reading it so AC-5b restores the waiver by changing
  // `resolveJobFitAnalysis` alone.
  const hasAnalysis = (await resolveJobFitAnalysis(input.jobFitAnalysisId, userId)) !== null;

  if (!hasJdText && !hasJdUrl && !hasAnalysis) {
    throw new CoverLetterError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }
  if (hasJdText && hasJdUrl) {
    throw new CoverLetterError(
      'JOB_CONTEXT_CONFLICT',
      'Provide either jobDescriptionText or jobDescriptionUrl, not both'
    );
  }
  if (!input.selectedStarEntryIds || input.selectedStarEntryIds.length === 0) {
    throw new CoverLetterError('STAR_ENTRIES_REQUIRED', 'At least one STAR entry ID is required');
  }
  if (input.selectedStarEntryIds.length > 10) {
    throw new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 10 STAR entries allowed');
  }
  if (!hasAnalysis && (!input.targetCompany || !input.targetRole)) {
    throw new CoverLetterError(
      'TARGET_INFO_REQUIRED',
      'targetCompany and targetRole are required when jobFitAnalysisId is not provided'
    );
  }

  const applicationId = input.applicationId
    ? await resolveOwnedApplicationId(input.applicationId, ownerScope(applications, userId))
    : null;

  const starEntries = await fetchStarEntries(input.selectedStarEntryIds, userId);

  // Validate all IDs exist
  const foundIds = new Set(starEntries.map((e) => e.id));
  const invalidIds = input.selectedStarEntryIds.filter((id) => !foundIds.has(id));
  if (invalidIds.length > 0) {
    throw new CoverLetterError(
      'STAR_ENTRY_NOT_FOUND',
      'One or more selected STAR entry IDs do not exist',
      { invalidIds },
      404
    );
  }

  if (starEntries.length === 0) {
    throw new CoverLetterError(
      'CATALOG_EMPTY',
      'No catalog data available for generation',
      undefined,
      422
    );
  }

  const targetCompany = input.targetCompany ?? 'the company';
  const targetRole = input.targetRole ?? 'this role';
  const tone = input.tone ?? 'professional';
  const lengthVariant = input.lengthVariant ?? 'standard';
  const emphasis = input.emphasis ?? 'balanced';
  const wordTarget = WORD_TARGETS[lengthVariant];

  let jdContext: string;
  if (hasJdText) {
    jdContext = `Job Description:\n${input.jobDescriptionText}`;
  } else if (hasJdUrl) {
    try {
      const fetchedText = await fetchJobDescriptionFromUrl(input.jobDescriptionUrl!);
      jdContext = `Job Description:\n${fetchedText}`;
    } catch (err) {
      throw new CoverLetterError(
        'JOB_URL_FETCH_FAILED',
        `Failed to fetch job description from URL: ${String(err)}`,
        undefined,
        502
      );
    }
  } else {
    // Was `jdContext = \`Job Fit Analysis ID: ${input.jobFitAnalysisId}\``, which
    // handed the model a caller-controlled id as the entire job description.
    // Unreachable today (an analysis is the only other way past
    // JOB_CONTEXT_REQUIRED, and none resolve), and fails closed rather than
    // silently prompting with no job context if that ever changes. AC-5b fills
    // this branch with the stored analysis.
    throw new CoverLetterError(
      'JOB_CONTEXT_REQUIRED',
      'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId'
    );
  }

  const starBullets = starEntries.map((e, i) => `${i + 1}. ${e.rawText}`).join('\n');

  const prompt = `You are a professional cover letter writer. Generate a cover letter based only on the provided STAR entries — never invent credentials or metrics.

Target Role: ${targetRole}
Target Company: ${targetCompany}
${jdContext}

STAR Achievements to incorporate:
${starBullets}

Tone: ${TONE_DESCRIPTORS[tone]}
Target length: ${wordTarget.min}–${wordTarget.max} words — aim for this range but always write a complete, properly concluded letter. Never stop mid-sentence or mid-paragraph to hit a word count.
Emphasis: ${EMPHASIS_DESCRIPTORS[emphasis]}
${input.emphasizeThemes?.length ? `Emphasize themes: ${input.emphasizeThemes.join(', ')}` : ''}
${input.customInstructions ? `Additional instructions: ${input.customInstructions}` : ''}

Rules:
- Use only facts from the STAR entries above
- If there are skill gaps, acknowledge them constructively
- Start with "Dear Hiring Manager,"
- Sign off with "Sincerely,\n[Your Name]"
- Return only the cover letter text, no commentary
- Write a fully complete letter — do not truncate or trail off`;

  const client = getAiClient();
  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw new CoverLetterError(
      'AI_GENERATION_FAILED',
      'AI generation failed',
      { cause: String(err) },
      502
    );
  }

  const content = message.content[0].type === 'text' ? message.content[0].text : '';

  const warnings: GenerationWarningDTO[] = [];
  if (message.stop_reason === 'max_tokens') {
    warnings.push({
      code: 'CONTENT_TRUNCATED',
      message: 'Cover letter may be incomplete — generation hit the output limit',
    });
  }
  if (starEntries.length < 3) {
    warnings.push({
      code: 'LIMITED_STAR_ENTRIES',
      message: 'Fewer STAR entries selected than recommended (3+)',
    });
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
      userId: userId ?? null,
      applicationId,
      status: 'draft',
      title,
      targetCompany,
      targetRole,
      tone: tone as any,
      lengthVariant: lengthVariant as any,
      emphasis: emphasis as any,
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

export async function getCoverLetter(
  id: string,
  userId?: string
): Promise<{
  coverLetter: CoverLetterDTO;
  usedStarEntries: UsedStarEntryDTO[];
}> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))
    : eq(coverLetters.id, id);
  const [row] = await db.select().from(coverLetters).where(whereClause).limit(1);
  if (!row) throw new NotFoundError('Cover letter');

  const starEntries = await fetchStarEntries(row.selectedStarEntryIds ?? [], userId);
  const usedStarEntries: UsedStarEntryDTO[] = starEntries.map((e, i) => ({
    id: e.id,
    rawText: e.rawText,
    placement: i === 0 ? 'opening' : i === starEntries.length - 1 ? 'closing' : 'body',
  }));

  return { coverLetter: toDTO(row), usedStarEntries };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listCoverLetters(
  params: {
    status?: string;
    applicationId?: string;
    company?: string;
    search?: string;
    limit?: number;
    cursor?: string;
  },
  userId?: string
): Promise<{ coverLetters: CoverLetterSummaryDTO[]; nextCursor?: string }> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = parseCursor(params.cursor);

  const conditions: ReturnType<typeof eq>[] = [];
  if (userId) {
    conditions.push(eq(coverLetters.userId, userId) as any);
  }
  if (params.status === 'draft' || params.status === 'finalized') {
    conditions.push(eq(coverLetters.status, params.status as any));
  }
  if (params.applicationId) {
    // `eq`, not `ilike`. See the route schema note: an id is matched whole or
    // not at all, so one application's letters never leak into another's list
    // through a shared ULID prefix (WIC-1544 AC-3).
    conditions.push(eq(coverLetters.applicationId, params.applicationId) as any);
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

  const baseQuery = db.select().from(coverLetters);
  const filteredQuery =
    conditions.length > 0
      ? baseQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : baseQuery;

  const rows = await filteredQuery
    .orderBy(desc(coverLetters.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const result = hasMore ? rows.slice(0, limit) : rows;

  return {
    coverLetters: result.map(toSummaryDTO),
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateCoverLetter(
  id: string,
  input: UpdateCoverLetterInput,
  userId?: string
): Promise<CoverLetterDTO> {
  const db = getDb();

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
    version: sql`${coverLetters.version} + 1`,
  };
  if (input.title !== undefined) updates.title = input.title;
  if (input.content !== undefined) updates.content = input.content;
  if (input.status !== undefined) updates.status = input.status;

  const whereClause = userId
    ? and(
        eq(coverLetters.id, id),
        eq(coverLetters.version, input.version),
        eq(coverLetters.userId, userId)
      )
    : and(eq(coverLetters.id, id), eq(coverLetters.version, input.version));

  const [row] = await db.update(coverLetters).set(updates).where(whereClause).returning();

  if (!row) {
    const existingWhere = userId
      ? and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))
      : eq(coverLetters.id, id);
    const [existing] = await db.select().from(coverLetters).where(existingWhere).limit(1);
    if (!existing) throw new NotFoundError('Cover letter');
    throw new VersionConflictError();
  }

  return toDTO(row);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteCoverLetter(id: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))
    : eq(coverLetters.id, id);
  const [existing] = await db.select().from(coverLetters).where(whereClause).limit(1);
  if (!existing) throw new NotFoundError('Cover letter');
  await db.delete(coverLetters).where(whereClause);
}

// ── Revise ────────────────────────────────────────────────────────────────────

export async function reviseCoverLetter(
  id: string,
  input: ReviseCoverLetterInput,
  userId?: string
): Promise<{
  coverLetter: CoverLetterDTO;
  changesApplied: string[];
  usedStarEntries: UsedStarEntryDTO[];
}> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))
    : eq(coverLetters.id, id);
  const [existing] = await db.select().from(coverLetters).where(whereClause).limit(1);
  if (!existing) throw new NotFoundError('Cover letter');

  const selectedIds = input.selectedStarEntryIds ?? existing.selectedStarEntryIds ?? [];
  const starEntries = await fetchStarEntries(selectedIds, userId);

  // WIC-1492: `selectedIds` was persisted raw at the UPDATE below, so any id the
  // fetch above did not resolve was still written onto the row. Mirrors the
  // `generateCoverLetter` guard, with one deliberate difference.
  //
  // Validate `input.selectedStarEntryIds`, NOT `selectedIds`. The two differ
  // exactly when the caller omits the field and `selectedIds` falls back to
  // `existing.selectedStarEntryIds` — and validating that fallback would make a
  // row that *already* stores an unresolvable id impossible to revise ever
  // again, including by an instructions-only edit that never mentions STAR
  // entries. Those rows are not hypothetical: WIC-1492 filed this defect
  // precisely because this write path keeps minting them, so a check over the
  // fallback would brick the exact cohort the fix exists to stop growing.
  // Narrowing to the caller-supplied list closes the write vector without
  // stranding what it already wrote.
  //
  // The other rejected option — persisting `starEntries.map((e) => e.id)` — keeps
  // the endpoint non-throwing but silently drops ids the caller asked for, and
  // silently drops the row's stored ids on an instructions-only revise. Failing
  // loudly on bad input is preferable to either.
  if (input.selectedStarEntryIds) {
    const foundIds = new Set(starEntries.map((e) => e.id));
    const invalidIds = input.selectedStarEntryIds.filter((id) => !foundIds.has(id));
    if (invalidIds.length > 0) {
      throw new CoverLetterError(
        'STAR_ENTRY_NOT_FOUND',
        'One or more selected STAR entry IDs do not exist',
        { invalidIds },
        404
      );
    }
  }

  const tone = (input.tone ?? existing.tone) as string;
  const lengthVariant = (input.lengthVariant ?? existing.lengthVariant) as string;
  const emphasis = (input.emphasis ?? existing.emphasis ?? 'balanced') as string;
  const wordTarget = WORD_TARGETS[lengthVariant];
  const starBullets = starEntries.map((e, i) => `${i + 1}. ${e.rawText}`).join('\n');

  const prompt = `You are revising an existing cover letter. Apply the following instructions and return only the revised cover letter text.

Current cover letter:
${existing.content}

Revision instructions:
${input.instructions}

Tone: ${TONE_DESCRIPTORS[tone]}
Target length: ${wordTarget.min}–${wordTarget.max} words — aim for this range but always write a complete, properly concluded letter. Never stop mid-sentence or mid-paragraph to hit a word count.
Emphasis: ${EMPHASIS_DESCRIPTORS[emphasis]}

STAR Achievements available:
${starBullets}

Rules:
- Use only facts from the original content or STAR entries provided
- Return only the revised letter text, no commentary
- Write a fully complete letter — do not truncate or trail off`;

  const client = getAiClient();
  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw new CoverLetterError(
      'AI_GENERATION_FAILED',
      'AI generation failed',
      { cause: String(err) },
      502
    );
  }

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
      version: sql`${coverLetters.version} + 1`,
    })
    .where(and(eq(coverLetters.id, id), eq(coverLetters.version, input.version)))
    .returning();

  if (!row) throw new VersionConflictError();

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

export async function generateOutreach(
  input: GenerateOutreachInput,
  userId?: string
): Promise<{
  message: OutreachMessageDTO;
}> {
  // Validation.
  //
  // Site the WIC-1818 card does not enumerate: the id satisfied
  // JOB_CONTEXT_REQUIRED here too, and became `contextText` below. Resolved
  // first, so an unresolvable id is 422 rather than the sole context for an
  // outreach message sent to a named human (WIC-1818 AC-5a).
  const hasAnalysis = (await resolveJobFitAnalysis(input.jobFitAnalysisId, userId)) !== null;

  if (
    !input.coverLetterId &&
    !hasAnalysis &&
    (!input.selectedStarEntryIds || input.selectedStarEntryIds.length === 0)
  ) {
    throw new CoverLetterError(
      'JOB_CONTEXT_REQUIRED',
      'Provide coverLetterId, jobFitAnalysisId, or selectedStarEntryIds'
    );
  }
  if (input.selectedStarEntryIds && input.selectedStarEntryIds.length > 3) {
    throw new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 3 STAR entries for outreach');
  }
  if (input.keyPoints && input.keyPoints.length > 3) {
    throw new CoverLetterError('KEY_POINTS_LIMIT', 'Maximum 3 key points allowed');
  }

  const platform = input.platform;
  const maxLength =
    platform === 'linkedin'
      ? Math.min(input.maxLength ?? 300, 500)
      : Math.min(input.maxLength ?? 500, 1000);

  let contextText = '';

  if (input.coverLetterId) {
    const db = getDb();
    const whereClause = userId
      ? and(eq(coverLetters.id, input.coverLetterId), eq(coverLetters.userId, userId))
      : eq(coverLetters.id, input.coverLetterId);
    const [cl] = await db.select().from(coverLetters).where(whereClause).limit(1);
    if (!cl)
      throw new CoverLetterError(
        'COVER_LETTER_NOT_FOUND',
        'Cover letter not found',
        undefined,
        404
      );
    contextText = `Based on this cover letter excerpt:\n${cl.content.slice(0, 500)}`;
  } else if (input.selectedStarEntryIds?.length) {
    const entries = await fetchStarEntries(input.selectedStarEntryIds, userId);
    contextText = `Key achievements:\n${entries.map((e) => `- ${e.rawText}`).join('\n')}`;
  } else {
    // Was `contextText = \`Job Fit Analysis ID: ${input.jobFitAnalysisId}\``.
    // See the equivalent branch in generateCoverLetter — unreachable today,
    // fails closed, and is where AC-5b puts the stored analysis.
    throw new CoverLetterError(
      'JOB_CONTEXT_REQUIRED',
      'Provide coverLetterId, jobFitAnalysisId, or selectedStarEntryIds'
    );
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
  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw new CoverLetterError(
      'AI_GENERATION_FAILED',
      'AI generation failed',
      { cause: String(err) },
      502
    );
  }

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
      userId: userId ?? null,
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
  input: ExportCoverLetterInput,
  userId?: string
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))
    : eq(coverLetters.id, id);
  const [row] = await db.select().from(coverLetters).where(whereClause).limit(1);
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
  const slug = row.targetCompany
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const filename = `cover-letter-${slug}-${dateStr}.docx`;

  return {
    buffer,
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
