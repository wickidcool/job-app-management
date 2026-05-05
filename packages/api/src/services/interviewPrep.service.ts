import { eq, and, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/client.js';
import {
  interviewPreps,
  interviewPrepStories,
  applications,
  quantifiedBullets,
  type InterviewPrep,
  type NewInterviewPrep,
  type InterviewPrepStory,
  type NewInterviewPrepStory,
  type GeneratedQuestion,
  type GapMitigation,
  type QuickReference,
  type PracticeSession,
  type TalkingPoint,
} from '../db/schema.js';
import { getConfig } from '../config.js';
import { AppError, NotFoundError } from '../types/index.js';

// ── Error classes ─────────────────────────────────────────────────────────────

export class InterviewPrepError extends AppError {
  constructor(code: string, message: string, details?: unknown, statusCode = 400) {
    super(code, message, details, statusCode);
    this.name = 'InterviewPrepError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrepStoryDTO {
  id: string;
  starEntryId: string;
  themes: string[];
  relevanceScore: number;
  oneMinVersion: string;
  twoMinVersion: string;
  fiveMinVersion: string;
  isFavorite: boolean;
  personalNotes?: string | null;
  practiceCount: number;
  lastPracticedAt?: string | null;
  confidenceLevel: string;
  displayOrder: number;
}

export interface InterviewPrepDTO {
  id: string;
  applicationId: string;
  jobFitAnalysisId?: string | null;
  interviewType: string;
  timeAvailable: string;
  focusAreas: string[];
  completeness: number;
  stories: PrepStoryDTO[];
  questions: GeneratedQuestion[];
  gapMitigations: GapMitigation[];
  quickReference?: QuickReference | null;
  practiceLog: PracticeSession[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GenerateInterviewPrepInput {
  applicationId: string;
  jobFitAnalysisId?: string;
  interviewType?: 'behavioral' | 'technical' | 'mixed' | 'case_study';
  timeAvailable?: '30min' | '1hr' | '2hr' | 'full_day';
  focusAreas?: string[];
}

export interface StoryUpdate {
  storyId: string;
  isFavorite?: boolean;
  personalNotes?: string;
  confidenceLevel?: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
  displayOrder?: number;
}

export interface QuestionUpdate {
  questionId: string;
  linkedStoryId?: string | null;
  personalNotes?: string;
  practiceStatus?: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
}

export interface GapUpdate {
  gapId: string;
  selectedStrategy?: 'acknowledge_pivot' | 'growth_mindset' | 'adjacent_experience';
  isAddressed?: boolean;
}

export interface QuickReferenceUpdate {
  sections?: QuickReference['sections'];
  topStoryIds?: string[];
  keyQuestionIds?: string[];
  gapPointIds?: string[];
  companyFacts?: QuickReference['companyFacts'];
}

export interface UpdateInterviewPrepInput {
  storyUpdates?: StoryUpdate[];
  questionUpdates?: QuestionUpdate[];
  gapUpdates?: GapUpdate[];
  quickReference?: QuickReferenceUpdate;
  focusAreas?: string[];
  interviewType?: 'behavioral' | 'technical' | 'mixed' | 'case_study';
  timeAvailable?: '30min' | '1hr' | '2hr' | 'full_day';
  version: number;
}

export interface QuestionPracticeResult {
  questionId: string;
  confidenceRating: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
  usedStoryId?: string;
  notes?: string;
}

export interface StoryPracticeResult {
  storyId: string;
  confidenceRating: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
  timeUsed?: number;
  notes?: string;
}

export interface GapPracticeResult {
  gapId: string;
  strategyUsed: 'acknowledge_pivot' | 'growth_mindset' | 'adjacent_experience';
  confidenceRating: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
  notes?: string;
}

export interface LogPracticeSessionInput {
  type: 'single_question' | 'full_interview' | 'timed_responses';
  startedAt: string;
  endedAt?: string;
  focusAreas?: string[];
  questionResults?: QuestionPracticeResult[];
  storyResults?: StoryPracticeResult[];
  gapResults?: GapPracticeResult[];
  version: number;
}

// ── AI client ─────────────────────────────────────────────────────────────────

function getAiClient(): Anthropic {
  const { anthropicApiKey } = getConfig();
  if (!anthropicApiKey) {
    throw new InterviewPrepError(
      'AI_NOT_CONFIGURED',
      'ANTHROPIC_API_KEY is not configured',
      undefined,
      503
    );
  }
  return new Anthropic({ apiKey: anthropicApiKey });
}

// ── Completeness calculation ──────────────────────────────────────────────────

function calculateCompleteness(
  stories: PrepStoryDTO[],
  questions: GeneratedQuestion[],
  gapMitigations: GapMitigation[],
  quickReference: QuickReference | null | undefined
): number {
  let score = 0;
  const storyCount = stories.filter((s) => s.fiveMinVersion).length;
  score += Math.min(storyCount / 5, 1) * 25;
  const linkedQuestions = questions.filter((q) => q.linkedStoryId).length;
  score += Math.min(linkedQuestions / 5, 1) * 25;
  const totalGaps = gapMitigations.length;
  const addressedGaps = gapMitigations.filter((g) => g.isAddressed).length;
  score += totalGaps > 0 ? (addressedGaps / totalGaps) * 25 : 25;
  score += quickReference?.lastExportedAt ? 25 : 0;
  return Math.round(score);
}

// ── DTO mappers ───────────────────────────────────────────────────────────────

function storyRowToDTO(row: InterviewPrepStory): PrepStoryDTO {
  return {
    id: row.id,
    starEntryId: row.starEntryId,
    themes: (row.themes ?? []) as string[],
    relevanceScore: row.relevanceScore,
    oneMinVersion: row.oneMinVersion,
    twoMinVersion: row.twoMinVersion,
    fiveMinVersion: row.fiveMinVersion,
    isFavorite: row.isFavorite,
    personalNotes: row.personalNotes,
    practiceCount: row.practiceCount,
    lastPracticedAt: row.lastPracticedAt?.toISOString() ?? null,
    confidenceLevel: row.confidenceLevel,
    displayOrder: row.displayOrder,
  };
}

function prepRowToDTO(row: InterviewPrep, stories: InterviewPrepStory[]): InterviewPrepDTO {
  const storyDTOs = stories.map(storyRowToDTO);
  const questions = (row.generatedQuestions ?? []) as GeneratedQuestion[];
  const gapMitigations = (row.gapMitigations ?? []) as GapMitigation[];
  const quickReference = row.quickReference as QuickReference | null;
  return {
    id: row.id,
    applicationId: row.applicationId,
    jobFitAnalysisId: row.jobFitAnalysisId,
    interviewType: row.interviewType,
    timeAvailable: row.timeAvailable,
    focusAreas: (row.focusAreas ?? []) as string[],
    completeness: calculateCompleteness(storyDTOs, questions, gapMitigations, quickReference),
    stories: storyDTOs,
    questions,
    gapMitigations,
    quickReference,
    practiceLog: (row.practiceLog ?? []) as PracticeSession[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

// ── AI generation helpers ─────────────────────────────────────────────────────

interface BulletRow {
  id: string;
  rawText: string;
  impactCategory: string;
}

async function generatePrepWithAI(
  ai: Anthropic,
  app: { jobTitle: string; company: string },
  bullets: BulletRow[],
  interviewType: string,
  timeAvailable: string,
  focusAreas: string[]
): Promise<{
  stories: Array<{
    starEntryId: string;
    themes: string[];
    relevanceScore: number;
    oneMinVersion: string;
    twoMinVersion: string;
    fiveMinVersion: string;
  }>;
  questions: GeneratedQuestion[];
  gapMitigations: GapMitigation[];
  warnings: Array<{ code: string; message: string }>;
}> {
  const bulletList = bullets
    .slice(0, 30)
    .map((b, i) => `${i + 1}. [ID:${b.id}] [Category:${b.impactCategory}] ${b.rawText}`)
    .join('\n');

  const focusStr =
    focusAreas.length > 0 ? focusAreas.join(', ') : 'leadership, technical, problem-solving';

  const prompt = `You are an expert interview coach preparing a candidate for an interview at ${app.company} for the role of ${app.jobTitle}.

Interview type: ${interviewType}
Time available for prep: ${timeAvailable}
Focus areas: ${focusStr}

Here are the candidate's STAR achievement entries from their catalog:
${bulletList}

Generate comprehensive interview prep materials in JSON format with exactly this structure:
{
  "stories": [
    {
      "starEntryId": "<ID from the [ID:...] prefix above>",
      "themes": ["<theme1>", "<theme2>"],
      "relevanceScore": <0-100 integer>,
      "oneMinVersion": "<~100 word concise summary of this achievement>",
      "twoMinVersion": "<~200 word moderate-length version>",
      "fiveMinVersion": "<~400 word full STAR story version>"
    }
  ],
  "questions": [
    {
      "id": "<unique_id_q1>",
      "text": "<interview question text>",
      "category": "<behavioral|technical|situational|role_specific|gap_probing>",
      "difficulty": "<standard|challenging|tough>",
      "whyTheyAsk": "<why interviewers ask this>",
      "whatTheyWant": "<what they look for in the answer>",
      "answerFramework": "<suggested answer structure>",
      "suggestedStoryIds": [],
      "practiceStatus": "not_practiced"
    }
  ],
  "gapMitigations": [
    {
      "id": "<unique_id_g1>",
      "skill": "<skill or gap area>",
      "severity": "<critical|moderate|minor>",
      "description": "<why this gap exists>",
      "whyItMatters": "<why this matters for the role>",
      "strategies": {
        "acknowledgePivot": {
          "title": "Acknowledge & Pivot",
          "script": "<suggested script>",
          "keyPhrases": ["<phrase1>", "<phrase2>"],
          "redirectToStrength": "<how to pivot>"
        },
        "growthMindset": {
          "title": "Growth Mindset",
          "script": "<suggested script>",
          "keyPhrases": ["<phrase1>", "<phrase2>"],
          "redirectToStrength": "<how to pivot>"
        },
        "adjacentExperience": {
          "title": "Adjacent Experience",
          "script": "<suggested script>",
          "keyPhrases": ["<phrase1>", "<phrase2>"],
          "redirectToStrength": "<how to pivot>"
        }
      },
      "relatedStoryIds": [],
      "isAddressed": false
    }
  ],
  "warnings": []
}

Rules:
- Select 5-10 of the most relevant STAR entries as stories. Use the exact IDs from the list above.
- Theme values should be from: leadership, technical, problem_solving, collaboration, communication, analytical, customer_focus, adaptability, innovation
- Generate 8-12 interview questions appropriate for the interview type and role
- Identify 1-3 potential skill gaps based on common ${app.jobTitle} requirements vs. the catalog entries
- Return ONLY valid JSON, no markdown or explanation`;

  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: 'You are an expert interview coach. Always respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new InterviewPrepError(
      'AI_PARSE_FAILED',
      'Failed to parse AI response for interview prep',
      undefined,
      500
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    stories: Array<{
      starEntryId: string;
      themes: string[];
      relevanceScore: number;
      oneMinVersion: string;
      twoMinVersion: string;
      fiveMinVersion: string;
    }>;
    questions: GeneratedQuestion[];
    gapMitigations: GapMitigation[];
    warnings: Array<{ code: string; message: string }>;
  };

  const bulletIds = new Set(bullets.map((b) => b.id));
  const validStories = (parsed.stories ?? []).filter((s) => bulletIds.has(s.starEntryId));

  return {
    stories: validStories,
    questions: parsed.questions ?? [],
    gapMitigations: parsed.gapMitigations ?? [],
    warnings: parsed.warnings ?? [],
  };
}

// ── Generate Interview Prep ───────────────────────────────────────────────────

export async function generateInterviewPrep(
  input: GenerateInterviewPrepInput,
  userId?: string
): Promise<{
  interviewPrep: InterviewPrepDTO;
  storiesGenerated: number;
  questionsGenerated: number;
  gapsIdentified: number;
  catalogEntriesUsed: number;
  warnings: Array<{ code: string; message: string }>;
}> {
  const db = getDb();

  const [app] = await db
    .select({ id: applications.id, jobTitle: applications.jobTitle, company: applications.company })
    .from(applications)
    .where(eq(applications.id, input.applicationId))
    .limit(1);

  if (!app) {
    throw new InterviewPrepError(
      'APPLICATION_NOT_FOUND',
      'Referenced application does not exist',
      undefined,
      404
    );
  }

  const [existing] = await db
    .select({ id: interviewPreps.id })
    .from(interviewPreps)
    .where(eq(interviewPreps.applicationId, input.applicationId))
    .limit(1);

  if (existing) {
    throw new InterviewPrepError(
      'APPLICATION_ALREADY_HAS_PREP',
      'This application already has interview prep materials. Retrieve with GET /interview-preps/{id}',
      { applicationId: input.applicationId, existingPrepId: existing.id },
      409
    );
  }

  const allBullets = await db
    .select({
      id: quantifiedBullets.id,
      rawText: quantifiedBullets.rawText,
      impactCategory: quantifiedBullets.impactCategory,
    })
    .from(quantifiedBullets)
    .limit(200);

  const warnings: Array<{ code: string; message: string }> = [];

  if (allBullets.length === 0) {
    throw new InterviewPrepError(
      'CATALOG_EMPTY',
      'Cannot generate prep without STAR entries in catalog',
      undefined,
      422
    );
  }

  if (allBullets.length < 5) {
    warnings.push({
      code: 'LIMITED_STAR_ENTRIES',
      message: 'Fewer than 5 STAR entries in catalog',
    });
  }
  if (!input.jobFitAnalysisId) {
    warnings.push({
      code: 'NO_FIT_ANALYSIS',
      message: 'Generated without job fit analysis (gaps may be incomplete)',
    });
  }

  const interviewType = input.interviewType ?? 'mixed';
  const timeAvailable = input.timeAvailable ?? '1hr';
  const focusAreas = input.focusAreas ?? [];

  const ai = getAiClient();
  const generated = await generatePrepWithAI(
    ai,
    app,
    allBullets,
    interviewType,
    timeAvailable,
    focusAreas
  );
  warnings.push(...generated.warnings);

  if (generated.stories.length === 0 && focusAreas.length > 0) {
    warnings.push({ code: 'MISSING_THEMES', message: 'Some focus areas have no matching stories' });
  }

  const prepId = ulid();
  const now = new Date();

  const newPrep: NewInterviewPrep = {
    id: prepId,
    userId: userId ?? null,
    applicationId: input.applicationId,
    jobFitAnalysisId: input.jobFitAnalysisId ?? null,
    interviewType,
    timeAvailable,
    focusAreas,
    completeness: 0,
    generatedQuestions: generated.questions,
    gapMitigations: generated.gapMitigations,
    quickReference: null,
    practiceLog: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await db.insert(interviewPreps).values(newPrep);

  const storyRows: NewInterviewPrepStory[] = generated.stories.map((s, i) => ({
    id: ulid(),
    interviewPrepId: prepId,
    starEntryId: s.starEntryId,
    themes: s.themes,
    relevanceScore: Math.min(100, Math.max(0, s.relevanceScore)),
    oneMinVersion: s.oneMinVersion,
    twoMinVersion: s.twoMinVersion,
    fiveMinVersion: s.fiveMinVersion,
    isFavorite: false,
    personalNotes: null,
    practiceCount: 0,
    lastPracticedAt: null,
    confidenceLevel: 'not_practiced',
    displayOrder: i + 1,
    createdAt: now,
    updatedAt: now,
  }));

  if (storyRows.length > 0) {
    await db.insert(interviewPrepStories).values(storyRows);
  }

  const [insertedPrep] = await db
    .select()
    .from(interviewPreps)
    .where(eq(interviewPreps.id, prepId))
    .limit(1);

  const insertedStories = await db
    .select()
    .from(interviewPrepStories)
    .where(eq(interviewPrepStories.interviewPrepId, prepId));

  const dto = prepRowToDTO(insertedPrep, insertedStories);

  const updatedCompleteness = calculateCompleteness(
    dto.stories,
    dto.questions,
    dto.gapMitigations,
    dto.quickReference
  );
  if (updatedCompleteness !== insertedPrep.completeness) {
    await db
      .update(interviewPreps)
      .set({ completeness: updatedCompleteness })
      .where(eq(interviewPreps.id, prepId));
    dto.completeness = updatedCompleteness;
  }

  return {
    interviewPrep: dto,
    storiesGenerated: storyRows.length,
    questionsGenerated: generated.questions.length,
    gapsIdentified: generated.gapMitigations.length,
    catalogEntriesUsed: allBullets.length,
    warnings,
  };
}

// ── Get Interview Prep ────────────────────────────────────────────────────────

export async function getInterviewPrep(
  id: string,
  userId?: string
): Promise<{
  interviewPrep: InterviewPrepDTO;
  application: { id: string; jobTitle: string; company: string; status: string };
  fitAnalysis?: {
    id: string;
    recommendation?: string;
    confidence?: string;
    analysisTimestamp?: string;
  } | null;
}> {
  const db = getDb();

  const whereClause = userId
    ? and(eq(interviewPreps.id, id), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.id, id);

  const [prep] = await db.select().from(interviewPreps).where(whereClause).limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  const stories = await db
    .select()
    .from(interviewPrepStories)
    .where(eq(interviewPrepStories.interviewPrepId, id));

  const [app] = await db
    .select({
      id: applications.id,
      jobTitle: applications.jobTitle,
      company: applications.company,
      status: applications.status,
    })
    .from(applications)
    .where(eq(applications.id, prep.applicationId))
    .limit(1);

  return {
    interviewPrep: prepRowToDTO(prep, stories),
    application: app
      ? { id: app.id, jobTitle: app.jobTitle, company: app.company, status: app.status }
      : { id: prep.applicationId, jobTitle: '', company: '', status: '' },
    fitAnalysis: null,
  };
}

// ── Get Interview Prep by Application ─────────────────────────────────────────

export async function getInterviewPrepByApplication(
  applicationId: string,
  userId?: string
): Promise<{
  interviewPrep: InterviewPrepDTO;
  application: { id: string; jobTitle: string; company: string; status: string };
  fitAnalysis?: { id: string } | null;
}> {
  const db = getDb();

  const whereClause = userId
    ? and(eq(interviewPreps.applicationId, applicationId), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.applicationId, applicationId);

  const [prep] = await db.select().from(interviewPreps).where(whereClause).limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  return getInterviewPrep(prep.id, userId);
}

// ── Update Interview Prep ─────────────────────────────────────────────────────

export async function updateInterviewPrep(
  id: string,
  input: UpdateInterviewPrepInput,
  userId?: string
): Promise<{ interviewPrep: InterviewPrepDTO; completenessChange: number }> {
  const db = getDb();

  const whereClause = userId
    ? and(eq(interviewPreps.id, id), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.id, id);

  const [prep] = await db.select().from(interviewPreps).where(whereClause).limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  if (prep.version !== input.version) {
    throw new AppError(
      'INTERVIEW_PREP_VERSION_CONFLICT',
      'Interview prep was modified by another request',
      undefined,
      409
    );
  }

  const oldCompleteness = prep.completeness;

  if (input.storyUpdates && input.storyUpdates.length > 0) {
    for (const su of input.storyUpdates) {
      const updates: Partial<typeof interviewPrepStories.$inferInsert> = {};
      if (su.isFavorite !== undefined) updates.isFavorite = su.isFavorite;
      if (su.personalNotes !== undefined) updates.personalNotes = su.personalNotes;
      if (su.confidenceLevel !== undefined) updates.confidenceLevel = su.confidenceLevel;
      if (su.displayOrder !== undefined) updates.displayOrder = su.displayOrder;
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db
          .update(interviewPrepStories)
          .set(updates)
          .where(
            and(
              eq(interviewPrepStories.id, su.storyId),
              eq(interviewPrepStories.interviewPrepId, id)
            )
          );
      }
    }
  }

  const prepUpdates: Partial<typeof interviewPreps.$inferInsert> = {
    version: prep.version + 1,
    updatedAt: new Date(),
  };

  if (input.interviewType !== undefined) prepUpdates.interviewType = input.interviewType;
  if (input.timeAvailable !== undefined) prepUpdates.timeAvailable = input.timeAvailable;
  if (input.focusAreas !== undefined) prepUpdates.focusAreas = input.focusAreas;

  let questions = (prep.generatedQuestions ?? []) as GeneratedQuestion[];
  let gapMitigations = (prep.gapMitigations ?? []) as GapMitigation[];
  let quickReference = prep.quickReference as QuickReference | null | undefined;

  if (input.questionUpdates && input.questionUpdates.length > 0) {
    questions = questions.map((q) => {
      const upd = input.questionUpdates!.find((u) => u.questionId === q.id);
      if (!upd) return q;
      return {
        ...q,
        ...(upd.linkedStoryId !== undefined && { linkedStoryId: upd.linkedStoryId ?? undefined }),
        ...(upd.personalNotes !== undefined && { personalNotes: upd.personalNotes }),
        ...(upd.practiceStatus !== undefined && { practiceStatus: upd.practiceStatus }),
      };
    });
    prepUpdates.generatedQuestions = questions;
  }

  if (input.gapUpdates && input.gapUpdates.length > 0) {
    gapMitigations = gapMitigations.map((g) => {
      const upd = input.gapUpdates!.find((u) => u.gapId === g.id);
      if (!upd) return g;
      return {
        ...g,
        ...(upd.selectedStrategy !== undefined && { selectedStrategy: upd.selectedStrategy }),
        ...(upd.isAddressed !== undefined && { isAddressed: upd.isAddressed }),
      };
    });
    prepUpdates.gapMitigations = gapMitigations;
  }

  if (input.quickReference !== undefined) {
    quickReference = {
      sections: input.quickReference.sections ?? quickReference?.sections ?? [],
      topStoryIds: input.quickReference.topStoryIds ?? quickReference?.topStoryIds ?? [],
      keyQuestionIds: input.quickReference.keyQuestionIds ?? quickReference?.keyQuestionIds ?? [],
      gapPointIds: input.quickReference.gapPointIds ?? quickReference?.gapPointIds ?? [],
      companyFacts: input.quickReference.companyFacts ?? quickReference?.companyFacts ?? [],
      lastExportedAt: quickReference?.lastExportedAt,
      exportFormat: quickReference?.exportFormat,
    };
    prepUpdates.quickReference = quickReference;
  }

  await db.update(interviewPreps).set(prepUpdates).where(eq(interviewPreps.id, id));

  const [updatedPrep] = await db
    .select()
    .from(interviewPreps)
    .where(eq(interviewPreps.id, id))
    .limit(1);

  const updatedStories = await db
    .select()
    .from(interviewPrepStories)
    .where(eq(interviewPrepStories.interviewPrepId, id));

  const dto = prepRowToDTO(updatedPrep, updatedStories);
  const newCompleteness = calculateCompleteness(
    dto.stories,
    dto.questions,
    dto.gapMitigations,
    dto.quickReference
  );

  if (newCompleteness !== updatedPrep.completeness) {
    await db
      .update(interviewPreps)
      .set({ completeness: newCompleteness })
      .where(eq(interviewPreps.id, id));
    dto.completeness = newCompleteness;
  }

  return { interviewPrep: dto, completenessChange: newCompleteness - oldCompleteness };
}

// ── Log Practice Session ──────────────────────────────────────────────────────

export async function logPracticeSession(
  id: string,
  input: LogPracticeSessionInput,
  userId?: string
): Promise<{
  session: PracticeSession;
  interviewPrep: InterviewPrepDTO;
  completenessChange: number;
  summary: {
    questionsAttempted: number;
    storiesPracticed: number;
    gapsAddressed: number;
    averageConfidence: string;
    improvementAreas: string[];
  };
}> {
  const db = getDb();

  const prepWhereClause = userId
    ? and(eq(interviewPreps.id, id), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.id, id);

  const [prep] = await db.select().from(interviewPreps).where(prepWhereClause).limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  if (prep.version !== input.version) {
    throw new AppError(
      'INTERVIEW_PREP_VERSION_CONFLICT',
      'Interview prep was modified by another request',
      undefined,
      409
    );
  }

  const oldCompleteness = prep.completeness;
  const sessionId = ulid();

  const confidenceOrder: Record<string, number> = {
    not_practiced: 0,
    needs_work: 1,
    comfortable: 2,
    confident: 3,
  };

  const confCounts = { needsWork: 0, comfortable: 0, confident: 0 };
  let totalConfidenceScore = 0;
  let totalRatings = 0;

  const questionResults = input.questionResults ?? [];
  const storyResults = input.storyResults ?? [];
  const gapResults = input.gapResults ?? [];

  for (const qr of questionResults) {
    if (qr.confidenceRating === 'needs_work') confCounts.needsWork++;
    else if (qr.confidenceRating === 'comfortable') confCounts.comfortable++;
    else if (qr.confidenceRating === 'confident') confCounts.confident++;
    totalConfidenceScore += confidenceOrder[qr.confidenceRating] ?? 0;
    totalRatings++;
  }

  for (const sr of storyResults) {
    totalConfidenceScore += confidenceOrder[sr.confidenceRating] ?? 0;
    totalRatings++;
  }

  const avgScore = totalRatings > 0 ? totalConfidenceScore / totalRatings : 0;
  const avgConfidence = avgScore < 1 ? 'needs_work' : avgScore < 2 ? 'comfortable' : 'confident';

  const session: PracticeSession = {
    id: sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    type: input.type,
    questionsAttempted: questionResults.length,
    confidenceRatings: confCounts,
    focusAreas: input.focusAreas,
  };

  const practiceLog = [...((prep.practiceLog ?? []) as PracticeSession[]), session];

  let questions = (prep.generatedQuestions ?? []) as GeneratedQuestion[];
  let gapMitigations = (prep.gapMitigations ?? []) as GapMitigation[];

  if (questionResults.length > 0) {
    questions = questions.map((q) => {
      const result = questionResults.find((r) => r.questionId === q.id);
      if (!result) return q;
      return { ...q, practiceStatus: result.confidenceRating, lastPracticedAt: input.startedAt };
    });
  }

  if (gapResults.length > 0) {
    gapMitigations = gapMitigations.map((g) => {
      const result = gapResults.find((r) => r.gapId === g.id);
      if (!result) return g;
      return { ...g, selectedStrategy: result.strategyUsed, isAddressed: true };
    });
  }

  await db
    .update(interviewPreps)
    .set({
      practiceLog,
      generatedQuestions: questions,
      gapMitigations,
      version: prep.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(interviewPreps.id, id));

  if (storyResults.length > 0) {
    for (const sr of storyResults) {
      await db
        .update(interviewPrepStories)
        .set({
          confidenceLevel: sr.confidenceRating,
          practiceCount: sql`${interviewPrepStories.practiceCount} + 1`,
          lastPracticedAt: new Date(input.startedAt),
          updatedAt: new Date(),
        })
        .where(
          and(eq(interviewPrepStories.id, sr.storyId), eq(interviewPrepStories.interviewPrepId, id))
        );
    }
  }

  const [updatedPrep] = await db
    .select()
    .from(interviewPreps)
    .where(eq(interviewPreps.id, id))
    .limit(1);

  const updatedStories = await db
    .select()
    .from(interviewPrepStories)
    .where(eq(interviewPrepStories.interviewPrepId, id));

  const dto = prepRowToDTO(updatedPrep, updatedStories);
  const newCompleteness = calculateCompleteness(
    dto.stories,
    dto.questions,
    dto.gapMitigations,
    dto.quickReference
  );

  if (newCompleteness !== updatedPrep.completeness) {
    await db
      .update(interviewPreps)
      .set({ completeness: newCompleteness })
      .where(eq(interviewPreps.id, id));
    dto.completeness = newCompleteness;
  }

  const needsWorkThemes = (input.focusAreas ?? []).filter(() => avgScore < 2);

  return {
    session,
    interviewPrep: dto,
    completenessChange: newCompleteness - oldCompleteness,
    summary: {
      questionsAttempted: questionResults.length,
      storiesPracticed: storyResults.length,
      gapsAddressed: gapResults.filter((g) => g.confidenceRating !== 'needs_work').length,
      averageConfidence: avgConfidence,
      improvementAreas: needsWorkThemes,
    },
  };
}

// ── Export Interview Prep ─────────────────────────────────────────────────────

export async function exportInterviewPrep(
  id: string,
  format: 'pdf' | 'markdown' | 'print',
  sections?: string[],
  userId?: string
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const db = getDb();

  const whereClause = userId
    ? and(eq(interviewPreps.id, id), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.id, id);

  const [prep] = await db.select().from(interviewPreps).where(whereClause).limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  const stories = await db
    .select()
    .from(interviewPrepStories)
    .where(eq(interviewPrepStories.interviewPrepId, id));

  const [app] = await db
    .select({ jobTitle: applications.jobTitle, company: applications.company })
    .from(applications)
    .where(eq(applications.id, prep.applicationId))
    .limit(1);

  const company = app?.company ?? 'company';
  const jobTitle = app?.jobTitle ?? 'role';
  const dateStr = new Date().toISOString().slice(0, 10);

  const storyDTOs = stories.map(storyRowToDTO);
  const questions = (prep.generatedQuestions ?? []) as GeneratedQuestion[];
  const gapMitigations = (prep.gapMitigations ?? []) as GapMitigation[];
  const quickRef = prep.quickReference as QuickReference | null;

  const enabledSections = sections ?? ['stories', 'questions', 'gaps'];

  const lines: string[] = [
    `# Interview Prep — ${jobTitle} at ${company}`,
    `*Generated ${dateStr} | Type: ${prep.interviewType} | Time: ${prep.timeAvailable}*`,
    '',
  ];

  if (enabledSections.includes('stories') && storyDTOs.length > 0) {
    lines.push('## STAR Stories');
    lines.push('');
    for (const story of storyDTOs) {
      lines.push(`### Story (Themes: ${story.themes.join(', ')})`);
      lines.push(`**Relevance Score:** ${story.relevanceScore}/100`);
      lines.push('');
      lines.push('**1-min version:**');
      lines.push(story.oneMinVersion);
      lines.push('');
      lines.push('**2-min version:**');
      lines.push(story.twoMinVersion);
      lines.push('');
      lines.push('**Full story (5-min):**');
      lines.push(story.fiveMinVersion);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (enabledSections.includes('questions') && questions.length > 0) {
    lines.push('## Anticipated Questions');
    lines.push('');
    for (const q of questions) {
      lines.push(`### ${q.text}`);
      lines.push(`*Category: ${q.category} | Difficulty: ${q.difficulty}*`);
      lines.push('');
      lines.push(`**Why they ask:** ${q.whyTheyAsk}`);
      lines.push(`**What they want:** ${q.whatTheyWant}`);
      lines.push(`**Answer framework:** ${q.answerFramework}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (enabledSections.includes('gaps') && gapMitigations.length > 0) {
    lines.push('## Gap Mitigation Talking Points');
    lines.push('');
    for (const gap of gapMitigations) {
      lines.push(`### Gap: ${gap.skill} (${gap.severity})`);
      lines.push(gap.whyItMatters);
      lines.push('');
      const selectedStrategy = gap.selectedStrategy ?? 'acknowledge_pivot';
      const strategyKey =
        selectedStrategy === 'acknowledge_pivot'
          ? 'acknowledgePivot'
          : selectedStrategy === 'growth_mindset'
            ? 'growthMindset'
            : 'adjacentExperience';
      const tp: TalkingPoint = gap.strategies[strategyKey as keyof typeof gap.strategies];
      lines.push(`**Approach:** ${tp.title}`);
      lines.push(tp.script);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (quickRef) {
    lines.push('## Company Research Notes');
    lines.push('');
    for (const fact of quickRef.companyFacts ?? []) {
      lines.push(`- **${fact.useFor === 'mention' ? 'Mention' : 'Ask about'}:** ${fact.fact}`);
    }
    lines.push('');
  }

  const markdownContent = lines.join('\n');

  await db
    .update(interviewPreps)
    .set({
      quickReference: {
        ...(quickRef ?? {
          sections: [],
          topStoryIds: [],
          keyQuestionIds: [],
          gapPointIds: [],
          companyFacts: [],
        }),
        lastExportedAt: new Date().toISOString(),
        exportFormat: format,
      },
      updatedAt: new Date(),
    })
    .where(eq(interviewPreps.id, id));

  if (format === 'markdown') {
    const buffer = Buffer.from(markdownContent, 'utf8');
    return {
      buffer,
      filename: `interview-prep-${company.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.md`,
      contentType: 'text/markdown',
    };
  }

  if (format === 'print') {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Interview Prep — ${jobTitle} at ${company}</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  h1 { border-bottom: 2px solid #333; }
  h2 { border-bottom: 1px solid #ccc; }
  hr { border: none; border-top: 1px solid #eee; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
${markdownToHtml(markdownContent)}
</body>
</html>`;
    return {
      buffer: Buffer.from(html, 'utf8'),
      filename: `interview-prep-${company.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.html`,
      contentType: 'text/html',
    };
  }

  // PDF — return markdown as fallback (no PDF lib dependency)
  const buffer = Buffer.from(markdownContent, 'utf8');
  return {
    buffer,
    filename: `interview-prep-${company.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.md`,
    contentType: 'text/markdown',
  };
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n/g, '<br>\n');
}

// ── Delete Interview Prep ─────────────────────────────────────────────────────

export async function deleteInterviewPrep(id: string, userId?: string): Promise<void> {
  const db = getDb();

  const whereClause = userId
    ? and(eq(interviewPreps.id, id), eq(interviewPreps.userId, userId))
    : eq(interviewPreps.id, id);

  const [prep] = await db
    .select({ id: interviewPreps.id })
    .from(interviewPreps)
    .where(whereClause)
    .limit(1);

  if (!prep) {
    throw new NotFoundError('Interview prep');
  }

  await db.delete(interviewPreps).where(whereClause);
}
