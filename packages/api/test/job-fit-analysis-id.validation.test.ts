// WIC-1818 / ADR-012 AC-5a — `jobFitAnalysisId` is rejected at the boundary.
//
// `jobFitAnalysisId` is an accepted request field on five service entry points,
// typed `z.string().optional()` with no format check and no existence check. No
// job fit analysis is ever persisted (WIC-1652), so it can never be dereferenced
// — but rather than being inert it was load-bearing in three separate ways:
//
//   1. it SATISFIED `JOB_CONTEXT_REQUIRED` (all five sites);
//   2. it WAIVED `TARGET_INFO_REQUIRED` (the two `generate` sites), so a caller
//      naming neither company nor role got through;
//   3. it BECAME the job context handed to the model —
//      `` `Job Fit Analysis ID: ${input.jobFitAnalysisId}` `` — and was then
//      written to the `job_fit_analysis_id` column of the generated row.
//
// Plus a fourth, quieter one: `interviewPrep`'s `NO_FIT_ANALYSIS` warning
// ("gaps may be incomplete") was suppressed by any non-empty string.
//
// Until `job_fit_analyses` exists (WIC-1652 AC-1) *every* value is unresolvable,
// so rejecting outright is the correct interim behaviour and is what makes this
// card severable from the table. AC-5b/5c will replace the throw inside
// `resolveJobFitAnalysis` with a scoped lookup; every assertion here is written
// against the *observable contract* (422 + `JOB_FIT_ANALYSIS_NOT_FOUND`, model
// never called, nothing persisted) rather than against the interim
// implementation, so they survive that change.
//
// ── The card enumerated three endpoints. There are five. ─────────────────────
// `POST /cover-letters/outreach` and `POST /resume-variants/suggest-bullets`
// also accept the field and also let it satisfy `JOB_CONTEXT_REQUIRED`; they are
// covered here. Enumerated by grepping the *operation* (`jobFitAnalysisId` in
// `packages/api/src/services`), not the files the card cites.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({ anthropicApiKey: 'sk-test' })),
}));

const anthropicCtor = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages: unknown;
    constructor(opts: unknown) {
      this.messages = anthropicCtor(opts);
    }
  },
}));

import { getDb } from '../src/db/client.js';
import {
  coverLetters,
  outreachMessages,
  resumeVariants,
  applications,
  interviewPreps,
  interviewPrepStories,
} from '../src/db/schema.js';
import { generateCoverLetter, generateOutreach } from '../src/services/cover-letter.service.js';
import { generateResumeVariant, suggestBullets } from '../src/services/resume-variant.service.js';
import { generateInterviewPrep } from '../src/services/interviewPrep.service.js';
import { stubDb, stubAnthropic, type CatalogRow } from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

const BULLET_ID = '01HZ_BUL_MINE';
const APP_ID = '01HZ_APP_001';

/** The literal from the reproduction in the card. Any string is unresolvable. */
const UNRESOLVABLE = 'x';

/** A real job description, long enough to clear `z.string().min(50)` upstream. */
const JD_TEXT =
  'Senior backend engineer. You will own billing services, Postgres schema design, and the invoicing pipeline.';

function bullet(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: BULLET_ID,
    rawText: 'Shipped the billing rewrite at Acme Corp, cutting invoice errors 41%.',
    impactCategory: 'quality',
    sourceId: '01HZ_RES_001',
    userId: CALLER,
    ...overrides,
  };
}

/**
 * A stub wired so that, *absent the fix*, every call below runs to completion:
 * every table the five paths touch is present and the model always answers. That
 * is deliberate — it makes the pre-fix failure of these tests a resolved promise
 * carrying a generated artifact, which is the defect itself, rather than an
 * incidental `TypeError` from an unstubbed dependency.
 */
function install() {
  const stub = stubDb({
    catalog: [bullet()],
    tables: [
      [coverLetters, []],
      [outreachMessages, []],
      [resumeVariants, []],
      [applications, [{ id: APP_ID, jobTitle: 'Staff Engineer', company: 'Acme Corp' }]],
      [interviewPreps, []],
      [interviewPrepStories, []],
    ],
  });
  const ai = stubAnthropic((prompt) => {
    // interviewPrep and resumeVariant parse JSON back; coverLetter/outreach take
    // the text as-is. One reply that satisfies all four.
    const ids = [...prompt.matchAll(/\[ID:([^\]]+)\]/g)].map((m) => m[1]);
    return JSON.stringify({
      stories: ids.map((id) => ({
        starEntryId: id,
        themes: ['delivery'],
        relevanceScore: 80,
        oneMinVersion: `one ${id}`,
        twoMinVersion: `two ${id}`,
        fiveMinVersion: `five ${id}`,
      })),
      questions: [],
      gapMitigations: [],
      warnings: [],
      summary: 'Summary',
      sections: [],
    });
  });
  vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
  anthropicCtor.mockReturnValue(ai.client.messages);
  return { stub, ai };
}

/** The contract AC-5a asks for, asserted identically at every site. */
const REJECTED = { code: 'JOB_FIT_ANALYSIS_NOT_FOUND', statusCode: 422 };

describe('WIC-1818 AC-5a — an unresolvable jobFitAnalysisId is rejected at the boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── The card's reproduction, verbatim ──────────────────────────────────────

  it('rejects the two-guard bypass: an id, no job description, no company, no role', async () => {
    const { ai, stub } = install();

    // Shipped behaviour: this RESOLVED, returning a cover letter whose only job
    // context was the literal string `Job Fit Analysis ID: x`, addressed to
    // "the company" for "this role" — the `targetCompany ?? 'the company'`
    // fallbacks on cover-letter.service.ts:194-195.
    await expect(
      generateCoverLetter(
        { jobFitAnalysisId: UNRESOLVABLE, selectedStarEntryIds: [BULLET_ID] } as never,
        CALLER
      )
    ).rejects.toMatchObject(REJECTED);

    // Rejected *at the boundary* means before the spend and before the write —
    // not merely that the response was an error.
    expect(ai.prompts, 'the model must not be called for a rejected request').toHaveLength(0);
    expect(stub.inserts, 'nothing may be persisted for a rejected request').toHaveLength(0);
  });

  it('rejects it even when the request is otherwise complete', async () => {
    // Isolates the id as the sole cause: this body carries a real job
    // description and both target fields, so neither guard the id used to
    // subvert is in play. If this passed and the case above did not, the fix
    // would be "the guards fire" rather than "the id is validated".
    const { ai } = install();

    await expect(
      generateCoverLetter(
        {
          jobFitAnalysisId: UNRESOLVABLE,
          jobDescriptionText: JD_TEXT,
          targetCompany: 'Acme Corp',
          targetRole: 'Staff Engineer',
          selectedStarEntryIds: [BULLET_ID],
        } as never,
        CALLER
      )
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
  });

  // ── All five accepting sites ───────────────────────────────────────────────

  it('rejects it on POST /cover-letters/outreach', async () => {
    const { ai, stub } = install();

    // Site the card omits. The id alone satisfied `JOB_CONTEXT_REQUIRED` here
    // (cover-letter.service.ts:571-580) and became `contextText` at :615.
    await expect(
      generateOutreach(
        {
          platform: 'linkedin',
          targetCompany: 'Acme Corp',
          jobFitAnalysisId: UNRESOLVABLE,
        } as never,
        CALLER
      )
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
    expect(stub.inserts).toHaveLength(0);
  });

  it('rejects it on POST /resume-variants/generate', async () => {
    const { ai, stub } = install();

    await expect(
      generateResumeVariant({ jobFitAnalysisId: UNRESOLVABLE } as never, CALLER)
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
    expect(stub.inserts).toHaveLength(0);
  });

  it('rejects it on POST /resume-variants/suggest-bullets', async () => {
    const { ai } = install();

    // Second site the card omits (resume-variant.service.ts:878-887).
    await expect(
      suggestBullets({ jobFitAnalysisId: UNRESOLVABLE } as never, CALLER)
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
  });

  it('rejects it on POST /interview-preps/generate', async () => {
    const { ai, stub } = install();

    await expect(
      generateInterviewPrep(
        { applicationId: APP_ID, jobFitAnalysisId: UNRESOLVABLE } as never,
        CALLER
      )
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
    expect(stub.inserts).toHaveLength(0);
  });

  // ── An empty string is supplied-and-unresolvable, not absent ───────────────

  it('rejects the empty string rather than treating it as absent', async () => {
    // `z.string().optional()` admits `''`, and every shipped site tested the
    // field with `!!` / `!`, so `''` read as "not supplied" and silently fell
    // through to the other guards. Presence is `!== undefined`, not truthiness.
    const { ai } = install();

    await expect(
      generateCoverLetter(
        {
          jobFitAnalysisId: '',
          jobDescriptionText: JD_TEXT,
          targetCompany: 'Acme Corp',
          targetRole: 'Staff Engineer',
          selectedStarEntryIds: [BULLET_ID],
        } as never,
        CALLER
      )
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
  });
});

describe('WIC-1818 AC-5c — NO_FIT_ANALYSIS depends on a resolvable row, not a non-empty string', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the warning when no id is supplied', async () => {
    // Reachability control for the case below: proves the warning this suite
    // claims can no longer be suppressed is actually emitted on this path.
    // Without it, "cannot be suppressed" would also pass against a service that
    // never warns at all.
    const { ai } = install();

    const result = await generateInterviewPrep({ applicationId: APP_ID } as never, CALLER);

    expect(ai.prompts).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain('NO_FIT_ANALYSIS');
  });

  it('cannot be suppressed by a junk id — that request is rejected instead', async () => {
    // Shipped behaviour: `interviewPrep.service.ts:494` warned only when the
    // field was absent, so `jobFitAnalysisId: 'x'` silently asserted that gaps
    // had been checked against an analysis that does not exist. There is now no
    // value that both suppresses the warning and completes.
    const { ai } = install();

    await expect(
      generateInterviewPrep({ applicationId: APP_ID, jobFitAnalysisId: 'x' } as never, CALLER)
    ).rejects.toMatchObject(REJECTED);
    expect(ai.prompts).toHaveLength(0);
  });
});

describe('WIC-1818 — the guards the id used to subvert are reachable, and the happy paths still work', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Negative controls. Every "rejects" assertion above is satisfiable by a
  // service that rejects *everything*; these pin the other side.

  it('still raises JOB_CONTEXT_REQUIRED when nothing at all is supplied', async () => {
    install();

    await expect(
      generateCoverLetter({ selectedStarEntryIds: [BULLET_ID] } as never, CALLER)
    ).rejects.toMatchObject({ code: 'JOB_CONTEXT_REQUIRED' });
  });

  it('still raises TARGET_INFO_REQUIRED when the company and role are missing', async () => {
    // The guard the id waived. It has to fire on its own, or "the waiver is
    // gone" is unobservable.
    install();

    await expect(
      generateCoverLetter(
        { jobDescriptionText: JD_TEXT, selectedStarEntryIds: [BULLET_ID] } as never,
        CALLER
      )
    ).rejects.toMatchObject({ code: 'TARGET_INFO_REQUIRED' });
  });

  it('generates normally from a job description, and never mentions a fit analysis id', async () => {
    const { ai, stub } = install();

    const result = await generateCoverLetter(
      {
        jobDescriptionText: JD_TEXT,
        targetCompany: 'Acme Corp',
        targetRole: 'Staff Engineer',
        selectedStarEntryIds: [BULLET_ID],
      } as never,
      CALLER
    );

    expect(ai.prompts).toHaveLength(1);
    expect(ai.prompts[0]).toContain(JD_TEXT);
    // The interpolation at cover-letter.service.ts:217 is gone, not merely
    // unreached: no path constructs it any more.
    expect(ai.prompts[0]).not.toMatch(/Job Fit Analysis ID:/i);
    expect(result.coverLetter).toBeDefined();

    const written = stub.inserts.filter((i) => i.table === coverLetters);
    expect(written).toHaveLength(1);
    expect(
      (written[0].values as { jobFitAnalysisId?: string | null }).jobFitAnalysisId ?? null,
      'no unresolvable id may be written to the job_fit_analysis_id column'
    ).toBeNull();
  });
});
