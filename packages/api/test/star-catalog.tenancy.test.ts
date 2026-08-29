// UC-6 / UC-7 tenancy for the two *generating* paths — WIC-1449 D2 and D3.
//
// D1 (`suggestBullets`) is covered in `resume-variant.service.tenancy.test.ts`;
// it only returns foreign `rawText`. These two are worse: the catalog read feeds
// the model prompt and is then written down — into `resume_variants.content` and
// into `interview_prep_stories` — so the leak outlives the request.
//
// Each path is asserted at three depths, because they fail independently:
//   1. the rendered predicate on the `quantified_bullets` read;
//   2. the prompt handed to the model, which is where foreign text escapes first;
//   3. the rows persisted, which is what survives the fix if it lands late.
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
  resumeVariants,
  applications,
  interviewPreps,
  interviewPrepStories,
} from '../src/db/schema.js';
import {
  generateResumeVariant,
  getResumeVariant,
  reviseResumeVariant,
} from '../src/services/resume-variant.service.js';
import {
  generateInterviewPrep,
  InterviewPrepError,
} from '../src/services/interviewPrep.service.js';
import { ResumeVariantError } from '../src/types/index.js';
import {
  stubDb,
  stubAnthropic,
  expectScopedTo,
  render,
  ORPHAN_OWNER,
  type CatalogRow,
} from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

const MINE = 'Shipped the billing rewrite at Acme Corp, cutting invoice errors 41%.';
const THEIRS = 'Recovered $2.1M in churned ARR by rebuilding onboarding at Initech.';

function bullet(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: '01HZ_BUL_MINE',
    rawText: MINE,
    impactCategory: 'revenue',
    sourceId: '01HZ_RES_001',
    userId: CALLER,
    ...overrides,
  };
}

const MIXED_CATALOG: CatalogRow[] = [
  bullet(),
  bullet({ id: '01HZ_BUL_THEIRS', rawText: THEIRS, userId: OTHER }),
];

function install(stub: ReturnType<typeof stubDb>, ai: ReturnType<typeof stubAnthropic>) {
  vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
  anthropicCtor.mockReturnValue(ai.client.messages);
}

describe('generateResumeVariant tenancy (UC-6, D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The model is told to echo one experience entry per bullet it was offered. */
  function aiEchoingBullets() {
    return stubAnthropic((prompt) => {
      const ids = [...prompt.matchAll(/\[ID:([^\]]+)\]/g)].map((m) => m[1]);
      return JSON.stringify({
        summary: null,
        experience: [
          {
            id: '01HZ_RES_001',
            company: 'Acme Corp',
            role: 'Staff Engineer',
            startDate: '2021-01',
            endDate: null,
            bullets: ids.map((id) => ({
              id,
              text: `tailored ${id}`,
              source: 'catalog',
              impactCategory: 'revenue',
            })),
          },
        ],
        skills: { categories: [] },
        projects: [],
        education: [],
        certifications: [],
      });
    });
  }

  it('scopes the catalog read, the prompt, and the persisted content to the caller', async () => {
    const stub = stubDb({ catalog: MIXED_CATALOG, tables: [[resumeVariants, []]] });
    const ai = aiEchoingBullets();
    install(stub, ai);

    const result = await generateResumeVariant(
      { targetRole: 'Staff Engineer', targetCompany: 'Acme Corp', jobDescriptionText: 'billing' },
      CALLER
    );

    // 1. the predicate
    expectScopedTo(stub.catalogClauses()[0], CALLER);

    // 2. the prompt — foreign rawText reaches the model before anything is written
    expect(ai.prompts).toHaveLength(1);
    expect(ai.prompts[0]).toContain(MINE);
    expect(ai.prompts[0], "another user's bullet was pasted into the prompt").not.toContain(THEIRS);

    // 3. what comes back and what is written down
    expect(result.usedBullets.map((b) => b.id)).toEqual(['01HZ_BUL_MINE']);
    expect(result.usedBullets.map((b) => b.rawText)).not.toContain(THEIRS);

    const persisted = stub.inserts.find((i) => i.table === resumeVariants);
    expect(persisted, 'the variant was persisted').toBeDefined();
    expect(JSON.stringify((persisted!.values as { content: unknown }).content)).not.toContain(
      THEIRS
    );
  });

  it('raises CATALOG_EMPTY for a caller with no bullets even when other users have some', async () => {
    // AC-4. While the read was global this branch was unreachable for everyone
    // the moment any single user had one bullet — UC-6's empty state never fired.
    const stub = stubDb({
      catalog: [bullet({ id: '01HZ_BUL_THEIRS', rawText: THEIRS, userId: OTHER })],
      tables: [[resumeVariants, []]],
    });
    const ai = aiEchoingBullets();
    install(stub, ai);

    await expect(
      generateResumeVariant(
        { targetRole: 'Staff Engineer', targetCompany: 'Acme Corp', jobDescriptionText: 'billing' },
        CALLER
      )
    ).rejects.toMatchObject({ code: 'CATALOG_EMPTY' });
    expect(ai.prompts, 'no model call once the catalog is empty for this caller').toHaveLength(0);
  });

  it('rejects a selectedBullets id belonging to another user instead of silently dropping it', async () => {
    // The validation read is a separate statement from the catalog read. Left
    // unscoped it both confirms the existence of a foreign id and — because the
    // selection is intersected with the caller-scoped catalog downstream —
    // produces an empty resume rather than the 404 this branch exists to raise.
    const stub = stubDb({ catalog: MIXED_CATALOG, tables: [[resumeVariants, []]] });
    const ai = aiEchoingBullets();
    install(stub, ai);

    await expect(
      generateResumeVariant(
        {
          targetRole: 'Staff Engineer',
          targetCompany: 'Acme Corp',
          jobDescriptionText: 'billing',
          selectedBullets: [{ sectionId: '01HZ_RES_001', bulletIds: ['01HZ_BUL_THEIRS'] }],
        },
        CALLER
      )
    ).rejects.toMatchObject({
      code: 'BULLET_NOT_FOUND',
      details: { invalidIds: ['01HZ_BUL_THEIRS'] },
    });
  });

  it('is a ResumeVariantError, not a generic failure, when the catalog is empty', async () => {
    const stub = stubDb({ catalog: [], tables: [[resumeVariants, []]] });
    install(stub, aiEchoingBullets());

    await expect(
      generateResumeVariant(
        { targetRole: 'Staff Engineer', targetCompany: 'Acme Corp', jobDescriptionText: 'billing' },
        CALLER
      )
    ).rejects.toBeInstanceOf(ResumeVariantError);
  });
});

describe('getResumeVariant re-hydration tenancy (UC-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("will not resolve a foreign bullet id already sitting in a variant's content", async () => {
    // The fix stops new leakage; it does not clean the rows written before it
    // (AC-7). Any variant generated while the read was global can still name
    // another user's bullet in its persisted `content`, and this is the read
    // that turns such an id back into `rawText` on every GET.
    const stub = stubDb({ catalog: MIXED_CATALOG, tables: [[resumeVariants, [variantFixture()]]] });
    vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);

    const result = await getResumeVariant('01HZ_VAR_001', CALLER);

    expectScopedTo(stub.catalogClauses()[0], CALLER, ['01HZ_BUL_MINE']);
    expect(result.usedBullets.map((b) => b.id)).toEqual(['01HZ_BUL_MINE']);
    expect(result.usedBullets.map((b) => b.rawText)).not.toContain(THEIRS);
  });

  function variantFixture() {
    return {
      id: '01HZ_VAR_001',
      userId: CALLER,
      status: 'draft',
      title: 'Resume - Staff Engineer at Acme Corp',
      targetCompany: 'Acme Corp',
      targetRole: 'Staff Engineer',
      format: 'chronological',
      sectionEmphasis: 'balanced',
      baseResumeId: null,
      jobFitAnalysisId: null,
      jobDescriptionText: 'billing',
      jobDescriptionUrl: null,
      selectedBullets: [],
      selectedTechTags: [],
      selectedThemes: [],
      sectionOrder: [],
      hiddenSections: [],
      content: {
        summary: null,
        experience: [
          {
            id: '01HZ_RES_001',
            company: 'Acme Corp',
            role: 'Staff Engineer',
            bullets: [
              { id: '01HZ_BUL_MINE', text: 'mine', source: 'catalog' },
              { id: '01HZ_BUL_THEIRS', text: 'leaked before the fix', source: 'catalog' },
            ],
          },
        ],
        skills: { categories: [] },
      },
      atsScore: 72,
      revisionHistory: [],
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      version: 1,
    };
  }

  it('applies the same scope on the revise path', async () => {
    // `reviseResumeVariant` re-hydrates `usedBullets` from the revised content
    // with its own copy of the read — a second site that has to be fixed
    // separately, and would otherwise keep the GET-side leak alive.
    const stub = stubDb({ catalog: MIXED_CATALOG, tables: [[resumeVariants, [variantFixture()]]] });
    const ai = stubAnthropic(() =>
      JSON.stringify({
        summary: null,
        experience: [
          {
            id: '01HZ_RES_001',
            company: 'Acme Corp',
            role: 'Staff Engineer',
            bullets: [
              { id: '01HZ_BUL_MINE', text: 'mine', source: 'catalog' },
              { id: '01HZ_BUL_THEIRS', text: 'still referenced', source: 'catalog' },
            ],
          },
        ],
        skills: { categories: [] },
      })
    );
    install(stub, ai);

    const result = await reviseResumeVariant(
      '01HZ_VAR_001',
      { instructions: 'tighten the summary', expectedVersion: 1 } as never,
      CALLER
    );

    expectScopedTo(stub.catalogClauses()[0], CALLER, ['01HZ_BUL_MINE']);
    expect(result.usedBullets.map((b) => b.id)).toEqual(['01HZ_BUL_MINE']);
    expect(result.usedBullets.map((b) => b.rawText)).not.toContain(THEIRS);
  });
});

describe('generateInterviewPrep tenancy (UC-7, D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const APP_ID = '01HZ_APP_001';

  function appFixture() {
    return [
      [applications, [{ id: APP_ID, jobTitle: 'Staff Engineer', company: 'Acme Corp' }]],
    ] as Array<[unknown, Record<string, unknown>[]]>;
  }

  /** One STAR story per bullet the model was offered. */
  function aiEchoingStories() {
    return stubAnthropic((prompt) => {
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
      });
    });
  }

  it('scopes the catalog read, the prompt, and the persisted stories to the caller', async () => {
    const stub = stubDb({
      catalog: MIXED_CATALOG,
      tables: [...appFixture(), [interviewPreps, []], [interviewPrepStories, []]],
    });
    const ai = aiEchoingStories();
    install(stub, ai);

    const result = await generateInterviewPrep({ applicationId: APP_ID }, CALLER);

    expectScopedTo(stub.catalogClauses()[0], CALLER);

    expect(ai.prompts).toHaveLength(1);
    expect(ai.prompts[0]).toContain(MINE);
    expect(ai.prompts[0], "another user's STAR entry was pasted into the prompt").not.toContain(
      THEIRS
    );

    const stories = stub.inserts.filter((i) => i.table === interviewPrepStories);
    expect(stories).toHaveLength(1);
    const written = stories[0].values as Array<{ starEntryId: string }>;
    expect(written.map((s) => s.starEntryId)).toEqual(['01HZ_BUL_MINE']);
    expect(JSON.stringify(written)).not.toContain(THEIRS);
    expect(result.storiesGenerated).toBe(1);
  });

  it('raises CATALOG_EMPTY for a caller with no STAR entries even when other users have some', async () => {
    const stub = stubDb({
      catalog: [bullet({ id: '01HZ_BUL_THEIRS', rawText: THEIRS, userId: OTHER })],
      tables: [...appFixture(), [interviewPreps, []], [interviewPrepStories, []]],
    });
    const ai = aiEchoingStories();
    install(stub, ai);

    await expect(generateInterviewPrep({ applicationId: APP_ID }, CALLER)).rejects.toMatchObject({
      code: 'CATALOG_EMPTY',
    });
    await expect(generateInterviewPrep({ applicationId: APP_ID }, CALLER)).rejects.toBeInstanceOf(
      InterviewPrepError
    );
    expect(ai.prompts).toHaveLength(0);
  });

  it('fails an owner-less caller closed — the scope term survives, so no foreign STAR text is generated', async () => {
    // Counterpart of the UC-6 case: absent identity must never fail open to the
    // whole table.
    //
    // WIC-1465 review, REQUIRED 2: this case used to seed a `userId: null` row
    // and assert it came *back*. That row cannot exist. Migration
    // `0017_enforce_userid_not_null.sql` rewrites pre-existing NULLs to the
    // `00000000-…-0` placeholder (Step 1) and then runs
    // `ALTER COLUMN user_id SET NOT NULL` (Step 2); `quantifiedBullets.userId`
    // is `.notNull()`, and the insert path is rejected with `23502`.
    //
    // WIC-1638 goes one step further. Asserting `IS NULL` was fail-closed, but
    // it kept an owner-absent branch inside `bulletOwnerScope` — the helper
    // added to *centralise* owner scoping, so every new call site inherited the
    // fallback. `bulletOwnerScope` now takes `userId: string` and emits an
    // unconditional equality; absence is rejected once at the route edge by
    // `requireOwner`. This still exercises the predicate directly, so the mutant
    // that restores the ternary is caught here and not only by the compiler.
    const stub = stubDb({
      catalog: [
        bullet({ id: '01HZ_BUL_ORPHAN', rawText: MINE, userId: ORPHAN_OWNER }),
        bullet({ id: '01HZ_BUL_THEIRS', rawText: THEIRS, userId: OTHER }),
      ],
      tables: [...appFixture(), [interviewPreps, []], [interviewPrepStories, []]],
    });
    const ai = aiEchoingStories();
    install(stub, ai);

    await expect(
      generateInterviewPrep({ applicationId: APP_ID }, undefined as unknown as string)
    ).rejects.toMatchObject({ code: 'CATALOG_EMPTY' });

    // Fails closed by predicate, not by an empty fixture: the read carried an
    // owner equality bound to the absent owner, against a table holding two
    // owned rows. Dropping the term would serve both of them.
    const { sql, params } = render(stub.catalogClauses()[0]);
    expect(sql).toContain('"quantified_bullets"."user_id" = $');
    expect(params).toContain(undefined);
    expect(params).not.toContain(ORPHAN_OWNER);
    expect(params).not.toContain(OTHER);
    // Never reached the model, so no foreign `rawText` can be persisted.
    expect(ai.prompts).toHaveLength(0);
  });
});
