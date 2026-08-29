/**
 * WIC-1549 — `generateInterviewPrep` must not read *or write* against another
 * user's application.
 *
 * ## Why this file exists next to `resume-variant-interview-prep.tenancy.test.ts`
 *
 * WIC-1601 (PR #206, this file's base) already scopes the `applications` read in
 * `generateInterviewPrep` and covers it with a stub-backed test. That test is
 * good, and it is not what this card asked for. Two gaps are left, and both are
 * about the half of the defect WIC-1464's one-line flag understated:
 *
 *  1. **It is a write, not just a read.** The disclosure (`jobTitle`/`company`
 *     into the LLM prompt) is only the first half. The function continues on to
 *     INSERT an `interview_preps` row against the foreign application — and
 *     `interview_preps.application_id` carries a **UNIQUE** constraint
 *     (`db/schema.ts`). So the first caller to reach that insert takes the only
 *     prep slot that application will ever have, and the legitimate owner is
 *     locked out with a 409 forever. That is a hijack/denial on top of the
 *     disclosure.
 *
 *     Scope note, because the tense matters: this file closes that path for
 *     **new** hijacks — no stranger can reach the insert any more. It does not
 *     repair applications that already carry a foreign prep. For those the owner
 *     is still locked out, and post-fix the lockout is *worse-shaped*: the
 *     now-scoped probe no longer matches the foreign row, so the call falls past
 *     the 409 guard into a raw UNIQUE violation (`23505`, no `statusCode`) —
 *     a 500, not a clean `APPLICATION_ALREADY_HAS_PREP`. Anyone triaging that
 *     population by 409 post-merge will find none. Remediating it is WIC-1622.
 *
 *     A test that asserts only the response code cannot see any of this: a
 *     not-found guard and an ownership guard both answer `APPLICATION_NOT_FOUND`,
 *     and neither tells you whether a row was written on the way out.
 *
 *  2. **A stub cannot answer the question this defect asks.** The base's stub
 *     resolves rows it was primed with; it does not run a planner. The claim
 *     here is about what a *real* engine does with `WHERE id = $1` versus
 *     `WHERE id = $1 AND user_id = $2` when a UNIQUE index is in play — the
 *     UNIQUE violation is the whole severity, and only Postgres raises it. So
 *     `getDb` here is **PGlite**, the same real-engine choice
 *     `project.tenancy.test.ts` (WIC-1433) makes and for the same reason.
 *
 * Every assertion below therefore lands on one of three things the response code
 * cannot carry: an insert that did not happen, a row that is not in the table,
 * or a string that never reached the model.
 *
 * ## The three-way proof that "no row was written" means something
 *
 * `SELECT count(*) = 0` is worthless on its own — it also passes if the call
 * died for an unrelated reason (`CATALOG_EMPTY` was the near-miss here; the
 * catalog has to be seeded or every case "passes" before it reaches the guard).
 * So each negative case is pinned three ways, and the suite carries a positive
 * control that must show the exact opposite:
 *
 *   a. the `db.insert` spy recorded no call        (AC-2, the literal ask)
 *   b. `interview_preps` really is empty           (the consequence, in the DB)
 *   c. the foreign `company` never reached the LLM (the disclosure)
 *   + `generateInterviewPrep succeeds for the application's own owner` shows
 *     (a) recording `interview_preps`, (b) returning a row, and (c) the caller's
 *     own company in the prompt. Without that control, all three negatives are
 *     satisfiable by a function that does nothing at all.
 *
 * ## Nullability — why absent identity is `IS NULL` and not "skip the term"
 *
 * `applications.user_id` is `uuid('user_id')` with no `.notNull()`, and
 * migration `0017_enforce_userid_not_null.sql` does **not** name `applications`
 * (it is one of the tables 0017 skips). So NULL owners genuinely occur, the
 * `IS NULL` branch selects real rows rather than the empty set, and the
 * anonymous cases below assert on data rather than on a vacuous truth.
 *
 * ## The DDL
 *
 * Mirrors `db/schema.ts` for the four tables this entry point touches. The enum
 * columns are declared `text`: Drizzle sends enum values as strings, the
 * predicate under test is on `id`/`user_id`, and hand-rolling six `CREATE TYPE`s
 * would add no coverage. The one constraint that is *not* cosmetic and is
 * reproduced exactly is `interview_preps.application_id UNIQUE` — it is the
 * mechanism of the lockout in `the UNIQUE slot` case below.
 *
 * ## The matrix this file is accepted against
 *
 * Each cell mutates ONE predicate in `interviewPrep.service.ts` and runs this
 * file. The `×n` is the point, not the RED/GREEN: a site count only proves a
 * mutation was *applied*, the kill count proves it changed behaviour this file
 * can actually see (WIC-1574). Re-derive the line numbers with `grep -n` before
 * re-running — they drift the moment the file is edited.
 *
 *   :427  generateInterviewPrep application read   THE DEFECT    RED ×4
 *   :443  generateInterviewPrep uniqueness probe                 RED ×1
 *   :48   ownerScope absent-caller fallback → undefined          RED ×1
 *   :629  getInterviewPrep application read        CONTROL     GREEN ×0
 *   :1000 exportInterviewPrep application read     CONTROL     GREEN ×0
 *
 * All five matched the count predicted before the run.
 *
 * **The two controls are the card's actual thesis.** `:629` and `:1000` are
 * `main`'s `:593` and `:974` — the two reads a shape-based sweep flags as the
 * same defect, because they are `eq(applications.id, …)` with no owner term
 * next to one that was genuinely broken. They are not defects: both take their
 * id from `prep.applicationId`, and `prep` was itself resolved through an
 * owner-scoped `whereClause` a few lines above. The identity is carried by the
 * entry point, so mutating them kills nothing here. `:427` is the only one where
 * nothing upstream establishes it — the id comes straight off the request.
 * That is the recurring lesson of this cluster stated in reverse: a scoping
 * predicate is only as good as the identity its entry point carries, and two
 * call sites that *look* identical can differ entirely on that ground.
 *
 * A trap worth keeping: `:629` and `:1000` are **byte-identical** lines. A
 * string-anchored mutation matches both and silently mutates the wrong one
 * (WIC-1435). `scripts/wic1549-mutation-matrix.py` addresses them by line number
 * and asserts the anchor matched exactly the two sites it expected. Re-run it
 * from the repo root to reproduce the table above.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableName, sql, type Table } from 'drizzle-orm';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const MY_APP = 'app_mine';
const THEIR_APP = 'app_theirs';
const NOBODYS_APP = 'app_nobodys';

/** Recorded by the `getDb` proxy: one entry per `db.insert(table)` call. */
let insertedInto: string[] = [];
/** Every `messages.create` prompt, so disclosure is checked at the boundary. */
const prompts = vi.hoisted(() => [] as string[]);

let client: PGlite;
let realDb: ReturnType<typeof drizzle>;
/** What the service sees. Identical to `realDb` except `insert` is observed. */
let db: unknown;

vi.mock('../src/db/client.js', () => ({
  // Lazy: `db` is assigned in beforeAll, long after this factory is hoisted.
  getDb: () => db,
  closeDb: async () => {},
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ anthropicApiKey: 'test-key-not-used-for-network' }),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { messages: Array<{ content: string }> }) => {
        prompts.push(args.messages[0].content);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                stories: [
                  {
                    starEntryId: 'bullet_caller',
                    themes: ['leadership'],
                    relevanceScore: 90,
                    oneMinVersion: 'one',
                    twoMinVersion: 'two',
                    fiveMinVersion: 'five',
                  },
                ],
                questions: [],
                gapMitigations: [],
                warnings: [],
              }),
            },
          ],
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

const DDL = `
  CREATE TABLE applications (
    id text PRIMARY KEY,
    user_id uuid,
    job_title text NOT NULL,
    company text NOT NULL,
    url text,
    location text,
    salary_range text,
    status text NOT NULL DEFAULT 'saved',
    cover_letter_id text,
    resume_version_id text,
    applied_at timestamptz,
    contact text,
    comp_target text,
    next_action text,
    next_action_due date,
    job_description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1
  );

  CREATE TABLE interview_preps (
    id text PRIMARY KEY,
    user_id uuid,
    application_id text NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    job_fit_analysis_id text,
    interview_type text NOT NULL DEFAULT 'mixed',
    time_available text NOT NULL DEFAULT '1hr',
    focus_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
    completeness integer NOT NULL DEFAULT 0,
    generated_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    gap_mitigations jsonb NOT NULL DEFAULT '[]'::jsonb,
    quick_reference jsonb,
    practice_log jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1
  );

  CREATE TABLE interview_prep_stories (
    id text PRIMARY KEY,
    user_id uuid,
    interview_prep_id text NOT NULL REFERENCES interview_preps(id) ON DELETE CASCADE,
    star_entry_id text NOT NULL,
    themes jsonb NOT NULL DEFAULT '[]'::jsonb,
    relevance_score integer NOT NULL,
    one_min_version text NOT NULL,
    two_min_version text NOT NULL,
    five_min_version text NOT NULL,
    is_favorite boolean NOT NULL DEFAULT false,
    personal_notes text,
    practice_count integer NOT NULL DEFAULT 0,
    last_practiced_at timestamptz,
    confidence_level text NOT NULL DEFAULT 'not_practiced',
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE quantified_bullets (
    id text PRIMARY KEY,
    user_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    raw_text text NOT NULL,
    action_verb text,
    metric_type text NOT NULL,
    metric_value numeric NOT NULL,
    metric_range jsonb,
    is_approximate boolean NOT NULL DEFAULT false,
    secondary_metric_type text,
    secondary_metric_value numeric,
    impact_category text NOT NULL DEFAULT 'other',
    extracted_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1
  );
`;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client);
  db = new Proxy(realDb as object, {
    get(target, prop, receiver) {
      if (prop === 'insert') {
        return (table: Table) => {
          insertedInto.push(getTableName(table));
          return (target as ReturnType<typeof drizzle>).insert(table);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  await client.exec(DDL);
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  insertedInto = [];
  prompts.length = 0;

  await client.exec(`
    TRUNCATE interview_prep_stories, interview_preps, quantified_bullets, applications CASCADE;
  `);

  await client.exec(`
    INSERT INTO applications (id, user_id, job_title, company) VALUES
      ('${MY_APP}',      '${CALLER}', 'Staff Engineer', 'Initech'),
      ('${THEIR_APP}',   '${OTHER}',  'Chief Financial Officer', 'Umbrella'),
      ('${NOBODYS_APP}', NULL,        'Unowned Role', 'Nobodys Corp');

    INSERT INTO quantified_bullets
      (id, user_id, source_type, source_id, raw_text, metric_type, metric_value)
    VALUES
      ('bullet_caller', '${CALLER}', 'resume', 'r1', 'Cut latency 40%', 'percentage', 40),
      ('bullet_anon',   '${OTHER}',  'resume', 'r2', 'Grew revenue 20%', 'percentage', 20);
  `);
});

/** Rows currently in `interview_preps`, as the DB really holds them. */
async function prepRows(): Promise<Array<{ id: string; application_id: string }>> {
  const res = await realDb.execute(
    sql`SELECT id, application_id, user_id FROM interview_preps ORDER BY id`
  );
  return res.rows as Array<{ id: string; application_id: string }>;
}

/**
 * The three-way negative assertion. `insertedInto` is the AC-2 spy, the row
 * count is the consequence, and the prompt scan is the disclosure.
 */
async function expectNothingWritten(foreignCompany: string) {
  expect(insertedInto).toEqual([]);
  expect(await prepRows()).toEqual([]);
  expect(prompts.join('\n')).not.toContain(foreignCompany);
}

describe('generateInterviewPrep — a foreign application is refused before any write', () => {
  it('refuses another user’s application and writes no interview_preps row', async () => {
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await expect(
      generateInterviewPrep({ applicationId: THEIR_APP } as never, CALLER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    // Not merely "a 404 came back" — nothing was inserted, the table is empty,
    // and 'Umbrella' never reached the model.
    await expectNothingWritten('Umbrella');
  });

  it('refuses an unowned application for an identified caller', async () => {
    // `IS NULL` is the *anonymous* branch, not a wildcard: an identified caller
    // must not inherit the rows nobody owns.
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await expect(
      generateInterviewPrep({ applicationId: NOBODYS_APP } as never, CALLER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    await expectNothingWritten('Nobodys Corp');
  });

  it('refuses an owned application for an absent caller', async () => {
    // The absent-caller fail-open (WIC-1482): `undefined` must mean
    // `user_id IS NULL`, not "no owner term at all".
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await expect(
      generateInterviewPrep({ applicationId: MY_APP } as never, undefined)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    await expectNothingWritten('Initech');
  });
});

describe('generateInterviewPrep — the positive controls that make the above falsifiable', () => {
  it('succeeds for the application’s own owner', async () => {
    // Without this, every assertion in the block above is satisfied by a
    // function that never inserts anything under any circumstances.
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    const result = await generateInterviewPrep({ applicationId: MY_APP } as never, CALLER);

    expect(insertedInto).toContain('interview_preps');
    const rows = await prepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].application_id).toBe(MY_APP);
    expect(result.interviewPrep.applicationId).toBe(MY_APP);
    // The caller's own company is expected to reach the model.
    expect(prompts.join('\n')).toContain('Initech');
  });

  it('succeeds for an absent caller against the application nobody owns', async () => {
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await generateInterviewPrep({ applicationId: NOBODYS_APP } as never, undefined);

    expect(insertedInto).toContain('interview_preps');
    const rows = await prepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].application_id).toBe(NOBODYS_APP);
  });
});

describe('generateInterviewPrep — the UNIQUE slot cannot be taken by a stranger', () => {
  it('leaves the owner able to generate after a foreign attempt', async () => {
    // This is the severity WIC-1464's read-only framing missed.
    // `interview_preps.application_id` is UNIQUE, so an attacker who reaches the
    // insert consumes the owner's only slot and locks them out permanently.
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await expect(
      generateInterviewPrep({ applicationId: MY_APP } as never, OTHER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    expect(insertedInto).toEqual([]);

    // The owner is still able to claim their own slot afterwards. Unfixed, this
    // second call fails with APPLICATION_ALREADY_HAS_PREP (409).
    const result = await generateInterviewPrep({ applicationId: MY_APP } as never, CALLER);

    expect(result.interviewPrep.applicationId).toBe(MY_APP);
    const rows = await prepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].application_id).toBe(MY_APP);
  });

  it('scopes the uniqueness probe, so a foreign prep is never named in the failure', async () => {
    // The uniqueness probe at :443 is owner-scoped, so a foreign prep sitting on
    // the caller's own application is not matched by it.
    //
    // Note what that means for the shipped tree: because the probe does NOT see
    // `prep_theirs`, the function falls *past* the APPLICATION_ALREADY_HAS_PREP
    // guard and reaches the INSERT, which trips the UNIQUE constraint raw —
    // `code: '23505'`, `statusCode`/`details` both undefined. There is no 409 on
    // this path. Unfixed, the probe matched the foreign row and put its id in
    // `details.existingPrepId`; that disclosure is what this pins shut, and it
    // remains the single kill for the :443 matrix cell.
    //
    // The residual is documented, not fixed here: an application that ALREADY
    // carries a foreign prep leaves its owner locked out, now behind an
    // unhandled 23505 rather than a clean 409. Mapping that to a 409 is runtime
    // code and the backfill of such rows is out of this card's scope (WIC-1622).
    const { generateInterviewPrep } = await import('../src/services/interviewPrep.service.js');

    await client.exec(`
      INSERT INTO interview_preps (id, user_id, application_id)
      VALUES ('prep_theirs', '${OTHER}', '${MY_APP}');
    `);

    const err = await generateInterviewPrep({ applicationId: MY_APP } as never, CALLER).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).not.toBeNull();

    // Pin the failure positively, not just negatively. `not.toContain` alone is
    // satisfied trivially by any driver error, since one cannot know the prep's
    // id — so on its own it would certify nothing. Naming the constraint is what
    // makes this assert the scoped-probe path was actually taken.
    expect(err).toMatchObject({ code: '23505' });
    expect(String(err)).toContain('interview_preps_application_id_key');

    // And it must not name the foreign prep. Unfixed, the uniqueness probe
    // matched it and put its id in `details.existingPrepId`.
    expect(
      JSON.stringify({ m: String(err), d: (err as { details?: unknown }).details })
    ).not.toContain('prep_theirs');
  });
});
