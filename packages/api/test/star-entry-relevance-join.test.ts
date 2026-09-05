// WIC-1820 — `StarEntryPicker`'s "Recommended" section becomes reachable.
//
// The defect: `listStarEntries` hardcoded `relevanceScore: undefined`, so the picker's
// `relevanceScore != null && >= 0.8` filter could never match. The section was dead rather than
// wrong — `showRecommended={!!fitAnalysisId}` reads like a live gate and opened onto a filter with
// no possible input. Now that WIC-1652 persists analyses, the score has a producer to join to.
//
// These run against a real Postgres (PGlite) with the project's real migrations replayed, because
// the load-bearing claim is a *join*: that `recommended_star_entries[].id` and the ids
// `listStarEntries` returns are the same id space. Both sides read `quantified_bullets`, and a stub
// would have to model that correspondence to check it — a stub that models the answer is not
// evidence. The join is also the one thing a type checker cannot see: both sides are `string`.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';

const harness = vi.hoisted(() => ({ db: null as any }));

vi.mock('../src/db/client.js', () => ({ getDb: () => harness.db }));

const { listStarEntries } = await import('../src/services/catalog.service.js');
const { JobFitAnalysisNotFoundError } = await import('../src/services/job-fit-analysis.service.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const HOT = 'BUL00000000000000000000001'; // 0.9  — above the picker's threshold
const EDGE = 'BUL00000000000000000000002'; // 0.8  — exactly on it
const COLD = 'BUL00000000000000000000003'; // 0.5  — scored, but below it
const UNSCORED = 'BUL00000000000000000000004'; // absent from the analysis entirely

const ANALYSIS_A = 'JFA00000000000000000000001';
const ANALYSIS_B = 'JFA00000000000000000000002'; // USER_B's

/**
 * The picker's own partition, mirrored from `packages/web/src/components/StarEntryPicker.tsx`.
 *
 * Duplicated deliberately: the assertion this file exists to make is "the API now produces data
 * this predicate accepts", and importing across the package boundary is not possible from an api
 * test. `!= null` rather than truthiness, because `0` is a legitimate ratio — copying the loose
 * check is the point, since a truthiness bug there would be invisible to a stricter mirror.
 */
const RECOMMENDED_MIN_RELEVANCE = 0.8;
const recommended = (entries: { relevanceScore?: number }[]) =>
  entries.filter((e) => e.relevanceScore != null && e.relevanceScore >= RECOMMENDED_MIN_RELEVANCE);

let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];

async function seed() {
  // One statement per call: the PGlite wire path prepares each statement, and a prepared
  // statement may not carry multiple commands.
  await harness.db.execute(sql`DELETE FROM job_fit_analyses`);
  await harness.db.execute(sql`DELETE FROM quantified_bullets`);

  // `extracted_at` is set explicitly and descending, so the returned order is deterministic and
  // the by-id join cannot be confused with a positional one.
  await harness.db.execute(sql`
    INSERT INTO quantified_bullets
      (id, user_id, source_type, source_id, raw_text, metric_type, metric_value,
       impact_category, extracted_at)
    VALUES
      (${HOT},      ${USER_A}, 'resume', 'SRC1', 'Cut p99 latency by 40%.',   'percentage', 40, 'performance', now() - interval '1 hour'),
      (${EDGE},     ${USER_A}, 'resume', 'SRC1', 'Grew signups by 25%.',      'percentage', 25, 'user_growth', now() - interval '2 hour'),
      (${COLD},     ${USER_A}, 'resume', 'SRC1', 'Reduced build time by 10%.','percentage', 10, 'performance', now() - interval '3 hour'),
      (${UNSCORED}, ${USER_A}, 'resume', 'SRC1', 'Mentored 3 engineers.',     'count',       3, 'team_leadership', now() - interval '4 hour')
  `);

  const recommendedStarEntries = JSON.stringify([
    {
      id: HOT,
      rawText: 'Cut p99 latency by 40%.',
      impactCategory: 'performance',
      relevanceScore: 0.9,
    },
    {
      id: EDGE,
      rawText: 'Grew signups by 25%.',
      impactCategory: 'user_growth',
      relevanceScore: 0.8,
    },
    {
      id: COLD,
      rawText: 'Reduced build time by 10%.',
      impactCategory: 'performance',
      relevanceScore: 0.5,
    },
  ]);

  await harness.db.execute(sql`
    INSERT INTO job_fit_analyses
      (id, user_id, summary, confidence, parsed_jd, recommended_star_entries)
    VALUES
      (${ANALYSIS_A}, ${USER_A}, 'ok', 'high', '{}'::jsonb, ${recommendedStarEntries}::jsonb),
      (${ANALYSIS_B}, ${USER_B}, 'ok', 'high', '{}'::jsonb, ${recommendedStarEntries}::jsonb)
  `);
}

beforeAll(async () => {
  const made = await createMigratedDb();
  client = made.client;
  harness.db = made.db;

  // `job_fit_analyses.user_id` carries a real FK to `auth.users` (WIC-1652 / #283), so the owners
  // have to exist before an analysis can reference them. `quantified_bullets` has no such
  // constraint, which is why only these two rows are needed.
  await harness.db.execute(sql`
    INSERT INTO auth.users (id) VALUES (${USER_A}), (${USER_B}) ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  await client?.close();
});

beforeEach(seed);

describe('WIC-1820 — listStarEntries joins a stored analysis by entry id', () => {
  /**
   * The negative control, and the pre-fix behaviour preserved verbatim: with no analysis id every
   * entry is unscored, so the picker's Recommended section is empty. Without this the positive
   * case below could pass against an implementation that scored everything unconditionally.
   */
  it('leaves every entry unscored when no analysis is named', async () => {
    const entries = await listStarEntries(USER_A);

    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.relevanceScore === undefined)).toBe(true);
    expect(recommended(entries)).toHaveLength(0);
  });

  it("scores exactly the analysis's recommended entries, by id", async () => {
    const entries = await listStarEntries(USER_A, ANALYSIS_A);
    const byId = new Map(entries.map((e) => [e.id, e.relevanceScore]));

    expect(byId.get(HOT)).toBe(0.9);
    expect(byId.get(EDGE)).toBe(0.8);
    expect(byId.get(COLD)).toBe(0.5);
    // Not in the analysis: `undefined` means "not scored in this request", never zero. A zero here
    // would be a real score and would read as a deliberate "no match" judgement.
    expect(byId.get(UNSCORED)).toBeUndefined();
  });

  /**
   * The card's actual deliverable. Asserting only that Recommended is non-empty would be satisfied
   * by a producer emitting 0-100 — every such value clears `>= 0.8` trivially. The exclusion of
   * COLD is what makes the unit load-bearing: it can only be excluded if the scores really are
   * ratios in [0, 1] (ADR-008 §1).
   */
  it('makes the Recommended section reachable, and still excludes a below-threshold entry', async () => {
    const entries = await listStarEntries(USER_A, ANALYSIS_A);

    expect(
      recommended(entries)
        .map((e) => e.id)
        .sort()
    ).toEqual([HOT, EDGE].sort());

    for (const e of entries) {
      if (e.relevanceScore === undefined) continue;
      expect(e.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(e.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it('keeps returning every entry — scoring is an enrichment, not a filter', async () => {
    const entries = await listStarEntries(USER_A, ANALYSIS_A);
    expect(entries.map((e) => e.id).sort()).toEqual([HOT, EDGE, COLD, UNSCORED].sort());
  });
});

describe('WIC-1820 — an unresolvable analysis id is refused, not ignored', () => {
  /**
   * The whole point of the card is that an id which validates and then means nothing is the
   * defect. Degrading to "no scores" would make a stale id indistinguishable from an analysis that
   * recommended nothing, which is the phantom-identifier behaviour under a new name.
   */
  it('throws on an id that does not exist', async () => {
    await expect(listStarEntries(USER_A, 'JFA00000000000000000000404')).rejects.toBeInstanceOf(
      JobFitAnalysisNotFoundError
    );
  });

  it("throws on another user's analysis, and leaks no scores", async () => {
    // ANALYSIS_B holds scores for USER_A's bullet ids, so a missing owner term would not merely
    // widen access — it would return a fully populated, plausible result.
    await expect(listStarEntries(USER_A, ANALYSIS_B)).rejects.toBeInstanceOf(
      JobFitAnalysisNotFoundError
    );
  });

  it('treats the empty string as supplied-but-unresolvable, not as absent', async () => {
    // The WIC-1818 trap one layer up: every shipped call site tested this field with `!!`, so `''`
    // read as "not supplied". Presence is `!== undefined`.
    await expect(listStarEntries(USER_A, '')).rejects.toBeInstanceOf(JobFitAnalysisNotFoundError);
  });

  it('refuses an analysis id when the caller has no identity at all', async () => {
    // Still refused, but by a nearer guard than before — so the assertion moved
    // rather than weakened.
    //
    // Previously this expected `JobFitAnalysisNotFoundError`: `ownerScope` sent
    // an absent owner to `user_id IS NULL`, both seeded analyses are owned, so
    // the relevance lookup matched nothing and threw. That reasoning was sound
    // for the analysis join and said nothing about the *bullet* read below it,
    // which on the same call had no predicate at all and returned every
    // tenant's rows (WIC-2071). `listStarEntries` now takes `userId: string`
    // and rejects before either query is built.
    //
    // `AppError`, not `JobFitAnalysisNotFoundError`, is the point: an identity
    // failure should not be reported as a fact about which analyses exist.
    await expect(listStarEntries(undefined as unknown as string, ANALYSIS_A)).rejects.toThrow(
      /required to list STAR entries/i
    );
  });
});
