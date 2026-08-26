/**
 * WIC-1464 (AC-c) — tests over the *identification predicate* of the AC-a audit.
 *
 * The engine is **PGlite**, a real Postgres, and it has to be. The predicate is
 * nothing but three-valued logic (`IS DISTINCT FROM` across a nullable column, a
 * sentinel uuid, and a LEFT JOIN that misses) wrapped around JSONB traversal.
 * A hand-rolled stub evaluates none of that; it resolves whatever rows it was
 * primed with and would certify any predicate at all, including no predicate.
 * That failure mode has already shipped twice in this family — WIC-1373's
 * `stubDb` and WIC-1449's catalog stub both passed *with* the bug in place.
 *
 * The queries under test are imported from `scripts/lib/foreign-star-audit.mjs`
 * — the module the CLI runs. Re-typing the SQL into the test would grade the
 * copy.
 *
 * The DDL below mirrors `db/schema.ts` after migration 0017, and the asymmetry
 * it encodes is the entire point of this file: `quantified_bullets.user_id` is
 * **NOT NULL** (0017 step 2) while `resume_variants.user_id`,
 * `interview_preps.user_id` and `interview_prep_stories.user_id` are still
 * nullable. WIC-1464's description assumes both sides can be NULL and warns only
 * about NULL-vs-NULL. On the deployed schema that case cannot occur on the join
 * at all, and the case that *can* — a known owner against 0017's
 * `00000000-…-0` placeholder — is the one a naive `<>` reports as a leak when it
 * is not one. `EC_INDETERMINATE_*` below is that case, and
 * `discriminates against a naive IS DISTINCT FROM` proves the assertion is
 * capable of failing rather than merely passing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  VARIANT_BULLETS_SQL,
  STORY_BULLETS_SQL,
  VARIANT_SELECTED_BULLET_REFS_SQL,
  UNATTRIBUTED_OWNER,
  summarise,
} from '../scripts/lib/foreign-star-audit.mjs';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let db: PGlite;

/** Post-0017 shape of the four tables the predicate joins. */
const DDL = `
CREATE TABLE quantified_bullets (
  id       text PRIMARY KEY,
  user_id  uuid NOT NULL,          -- 0017 step 2
  raw_text text NOT NULL
);
CREATE TABLE resume_variants (
  id               text PRIMARY KEY,
  user_id          uuid,           -- untouched by 0017: still nullable
  content          jsonb NOT NULL,
  selected_bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_history jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE interview_preps (
  id      text PRIMARY KEY,
  user_id uuid
);
CREATE TABLE interview_prep_stories (
  id                text PRIMARY KEY,
  user_id           uuid,
  interview_prep_id text NOT NULL REFERENCES interview_preps(id) ON DELETE CASCADE,
  star_entry_id     text NOT NULL,
  one_min_version   text NOT NULL DEFAULT ''
);`;

const bullet = (id: string, owner: string) =>
  db.query('INSERT INTO quantified_bullets (id, user_id, raw_text) VALUES ($1, $2, $3)', [
    id,
    owner,
    `raw text of ${id}`,
  ]);

/** A variant carrying `bulletIds` under `content.experience[0].bullets`. */
const variant = (
  id: string,
  owner: string | null,
  bulletIds: string[],
  extra: { projects?: string[]; revisionExperience?: string[]; selected?: string[] } = {}
) => {
  const bullets = (ids: string[]) =>
    ids.map((b) => ({ id: b, text: `rewritten copy of ${b}`, source: 'catalog' }));
  const content = {
    experience: [{ id: 'exp-1', company: 'Acme', role: 'Eng', bullets: bullets(bulletIds) }],
    projects: extra.projects
      ? [{ id: 'proj-1', name: 'P', techStack: [], bullets: bullets(extra.projects) }]
      : [],
    skills: { categories: [] },
  };
  const revisionHistory = extra.revisionExperience
    ? [
        {
          id: 'rev-1',
          instructions: 'tighten',
          appliedAt: '2026-01-01T00:00:00Z',
          previousContent: {
            experience: [
              {
                id: 'exp-1',
                company: 'Acme',
                role: 'Eng',
                bullets: bullets(extra.revisionExperience),
              },
            ],
            skills: { categories: [] },
          },
        },
      ]
    : [];
  const selected = extra.selected ? [{ sectionId: 'exp-1', bulletIds: extra.selected }] : [];
  return db.query(
    `INSERT INTO resume_variants (id, user_id, content, selected_bullets, revision_history)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, owner, JSON.stringify(content), JSON.stringify(selected), JSON.stringify(revisionHistory)]
  );
};

const prepWithStory = async (
  prepId: string,
  prepOwner: string | null,
  storyId: string,
  storyOwner: string | null,
  starEntryId: string
) => {
  await db.query('INSERT INTO interview_preps (id, user_id) VALUES ($1, $2)', [prepId, prepOwner]);
  await db.query(
    `INSERT INTO interview_prep_stories (id, user_id, interview_prep_id, star_entry_id)
     VALUES ($1, $2, $3, $4)`,
    [storyId, storyOwner, prepId, starEntryId]
  );
};

type VariantRow = {
  variant_id: string;
  variant_owner_id: string | null;
  carrier: string;
  bullet_id: string;
  bullet_owner_id: string | null;
  verdict: string;
};
type StoryRow = {
  story_id: string;
  prep_owner_id: string | null;
  bullet_owner_id: string | null;
  verdict: string;
  story_owner_matches_prep: boolean | null;
};

let variantRows: VariantRow[];
let storyRows: StoryRow[];

/** All occurrences of `bulletId` on `variantId`, keyed by carrier. */
const verdictsFor = (variantId: string, bulletId: string) =>
  variantRows
    .filter((r) => r.variant_id === variantId && r.bullet_id === bulletId)
    .map((r) => ({ carrier: r.carrier, verdict: r.verdict }));

const soleVerdict = (variantId: string, bulletId: string) => {
  const hits = verdictsFor(variantId, bulletId);
  expect(hits, `expected exactly one occurrence of ${bulletId} on ${variantId}`).toHaveLength(1);
  return hits[0].verdict;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DDL);

  await bullet('b-alice', ALICE);
  await bullet('b-bob', BOB);
  await bullet('b-legacy', UNATTRIBUTED_OWNER);

  // --- resume_variants -----------------------------------------------------
  await variant('v-same', ALICE, ['b-alice']); // matched
  await variant('v-foreign', ALICE, ['b-bob']); // foreign — the leak
  await variant('v-unresolved', ALICE, ['b-deleted']); // source row is gone

  // Both sides unknown. This is the case WIC-1464 names: must NOT be a mismatch.
  await variant('v-null-vs-legacy', null, ['b-legacy']);
  await variant('v-legacy-vs-legacy', UNATTRIBUTED_OWNER, ['b-legacy']);

  // EC_INDETERMINATE_*: exactly one side known. A naive `<>`/`IS DISTINCT FROM`
  // calls both of these a leak. They are not — there is no second *known* user.
  await variant('v-null-vs-known', null, ['b-bob']); // EC_INDETERMINATE_A
  await variant('v-known-vs-legacy', ALICE, ['b-legacy']); // EC_INDETERMINATE_B

  // Carriers WIC-1464's description does not name.
  await variant('v-projects-only', ALICE, [], { projects: ['b-bob'] });
  await variant('v-revision-only', ALICE, [], { revisionExperience: ['b-bob'] });

  // Malformed JSONB must degrade, not abort the audit.
  await db.query(`INSERT INTO resume_variants (id, user_id, content) VALUES ($1, $2, $3::jsonb)`, [
    'v-malformed',
    ALICE,
    JSON.stringify({ experience: { not: 'an array' }, skills: {} }),
  ]);

  // id-only references, no text.
  await variant('v-selected', ALICE, [], { selected: ['b-bob', 'b-alice'] });

  // --- interview_prep_stories ---------------------------------------------
  await prepWithStory('p-same', ALICE, 's-same', ALICE, 'b-alice');
  await prepWithStory('p-foreign', ALICE, 's-foreign', ALICE, 'b-bob');
  await prepWithStory('p-null-vs-legacy', null, 's-null-vs-legacy', null, 'b-legacy');
  await prepWithStory('p-null-vs-known', null, 's-null-vs-known', null, 'b-bob');
  await prepWithStory('p-unresolved', ALICE, 's-unresolved', ALICE, 'b-deleted');
  // Story's own user_id disagrees with its prep's.
  await prepWithStory('p-disagree', ALICE, 's-disagree', BOB, 'b-alice');

  variantRows = (await db.query<VariantRow>(VARIANT_BULLETS_SQL)).rows;
  storyRows = (await db.query<StoryRow>(STORY_BULLETS_SQL)).rows;
});

afterAll(async () => {
  await db?.close();
});

describe('WIC-1464 identification predicate — resume_variants', () => {
  it('flags a bullet owned by another known user as foreign', () => {
    expect(soleVerdict('v-foreign', 'b-bob')).toBe('foreign');
  });

  it('does not flag a bullet the variant owner owns', () => {
    expect(soleVerdict('v-same', 'b-alice')).toBe('matched');
  });

  it('treats "no known owner on either side" as matched, not a mismatch', () => {
    // The case WIC-1464 calls out. On the deployed schema it presents as
    // NULL-vs-placeholder and placeholder-vs-placeholder, never NULL-vs-NULL,
    // because 0017 rewrote the bullet side's NULLs to the placeholder.
    expect(soleVerdict('v-null-vs-legacy', 'b-legacy')).toBe('matched');
    expect(soleVerdict('v-legacy-vs-legacy', 'b-legacy')).toBe('matched');
  });

  it('reports one-sided identity as indeterminate rather than as a leak', () => {
    expect(soleVerdict('v-null-vs-known', 'b-bob')).toBe('indeterminate');
    expect(soleVerdict('v-known-vs-legacy', 'b-legacy')).toBe('indeterminate');
  });

  it('reports a bullet id with no surviving source row as unresolved', () => {
    expect(soleVerdict('v-unresolved', 'b-deleted')).toBe('unresolved');
  });

  it('finds foreign text in content.projects — a carrier the card does not name', () => {
    expect(verdictsFor('v-projects-only', 'b-bob')).toEqual([
      { carrier: 'content.projects', verdict: 'foreign' },
    ]);
  });

  it('finds foreign text frozen in revision_history.previousContent', () => {
    // A remediation scoped to `content` alone would leave this copy behind.
    expect(verdictsFor('v-revision-only', 'b-bob')).toEqual([
      { carrier: 'revision_history.previousContent.experience', verdict: 'foreign' },
    ]);
  });

  it('survives a row whose content.experience is not an array', () => {
    // jsonb_array_elements raises on a scalar; one malformed row must not take
    // the whole audit down.
    expect(variantRows.filter((r) => r.variant_id === 'v-malformed')).toHaveLength(0);
  });

  it('counts every occurrence of the same bullet, not one per variant', async () => {
    // AC-c has to visit each copy, so the grain is the occurrence.
    await variant('v-multi', ALICE, ['b-bob'], {
      projects: ['b-bob'],
      revisionExperience: ['b-bob'],
    });
    const rows = (await db.query<VariantRow>(VARIANT_BULLETS_SQL)).rows;
    const multi = rows.filter((r) => r.variant_id === 'v-multi');
    expect(multi).toHaveLength(3);
    expect(new Set(multi.map((r) => r.carrier))).toEqual(
      new Set([
        'content.experience',
        'content.projects',
        'revision_history.previousContent.experience',
      ])
    );
    expect(multi.every((r) => r.verdict === 'foreign')).toBe(true);
    await db.query('DELETE FROM resume_variants WHERE id = $1', ['v-multi']);
  });

  it('discriminates against a naive IS DISTINCT FROM predicate', async () => {
    // Guards the assertions above against passing for the wrong reason. The
    // obvious predicate — "owners differ" — is *correct on the leak cases* and
    // wrong only on the one-sided ones, so a suite that omits
    // EC_INDETERMINATE_A/B would go green over it.
    const naive = `
      SELECT v.id AS variant_id, qb.user_id IS DISTINCT FROM v.user_id AS flagged
      FROM resume_variants v
      CROSS JOIN LATERAL jsonb_array_elements(v.content->'experience') AS sec
      CROSS JOIN LATERAL jsonb_array_elements(sec->'bullets') AS b
      JOIN quantified_bullets qb ON qb.id = b->>'id'
      WHERE v.id IN ('v-null-vs-known', 'v-known-vs-legacy', 'v-legacy-vs-legacy')`;
    const naiveRows = (await db.query<{ variant_id: string; flagged: boolean }>(naive)).rows;

    // The naive predicate calls the two one-sided cases a leak. It gets
    // v-legacy-vs-legacy right, and that is the point of including it: the two
    // predicates disagree *only* where exactly one side's identity is known, so
    // those are the only fixtures that can catch the mistake.
    expect(
      naiveRows
        .filter((r) => r.flagged)
        .map((r) => r.variant_id)
        .sort()
    ).toEqual(['v-known-vs-legacy', 'v-null-vs-known']);
    expect(naiveRows.find((r) => r.variant_id === 'v-legacy-vs-legacy')?.flagged).toBe(false);
    // ...and the shipped one calls none of them one.
    for (const id of ['v-null-vs-known', 'v-known-vs-legacy', 'v-legacy-vs-legacy']) {
      expect(variantRows.filter((r) => r.variant_id === id && r.verdict === 'foreign')).toEqual([]);
    }
  });
});

describe('WIC-1464 identification predicate — interview_prep_stories', () => {
  const verdictOf = (storyId: string) => storyRows.find((r) => r.story_id === storyId)?.verdict;

  it('flags a story derived from another known user’s bullet', () => {
    expect(verdictOf('s-foreign')).toBe('foreign');
  });

  it('does not flag a story derived from the prep owner’s own bullet', () => {
    expect(verdictOf('s-same')).toBe('matched');
  });

  it('applies the same NULL/placeholder rule as the variant side', () => {
    expect(verdictOf('s-null-vs-legacy')).toBe('matched');
    expect(verdictOf('s-null-vs-known')).toBe('indeterminate');
  });

  it('reports a star_entry_id with no surviving bullet as unresolved', () => {
    expect(verdictOf('s-unresolved')).toBe('unresolved');
  });

  it('surfaces a story whose own user_id disagrees with its prep instead of picking one', () => {
    const row = storyRows.find((r) => r.story_id === 's-disagree');
    expect(row?.story_owner_matches_prep).toBe(false);
    // Judged against the prep owner, per the card — Alice's prep, Alice's bullet.
    expect(row?.verdict).toBe('matched');
    expect(storyRows.filter((r) => r.story_owner_matches_prep === false)).toHaveLength(1);
  });
});

describe('WIC-1464 selected_bullets id-only references', () => {
  it('classifies a foreign id under selected_bullets without claiming leaked text', async () => {
    const rows = (
      await db.query<{ variant_id: string; bullet_id: string; verdict: string }>(
        VARIANT_SELECTED_BULLET_REFS_SQL
      )
    ).rows.filter((r) => r.variant_id === 'v-selected');
    expect(rows.map((r) => [r.bullet_id, r.verdict]).sort()).toEqual([
      ['b-alice', 'matched'],
      ['b-bob', 'foreign'],
    ]);
  });
});

describe('WIC-1464 summarise()', () => {
  it('separates victims from the users exposed to their text', () => {
    const s = summarise(variantRows, 'variant_id', 'variant_owner_id');
    // v-foreign, v-projects-only, v-revision-only — all Alice's, all carrying Bob's.
    expect(s.affectedRows).toBe(3);
    expect(s.victimOwnerIds).toEqual([BOB]);
    expect(s.exposedToOwnerIds).toEqual([ALICE]);
    expect(s.byVerdict.foreign).toBe(3);
  });

  it('counts a container once however many foreign occurrences it holds', () => {
    const rows = [
      { variant_id: 'v1', variant_owner_id: ALICE, bullet_owner_id: BOB, verdict: 'foreign' },
      { variant_id: 'v1', variant_owner_id: ALICE, bullet_owner_id: BOB, verdict: 'foreign' },
      { variant_id: 'v2', variant_owner_id: ALICE, bullet_owner_id: BOB, verdict: 'matched' },
    ];
    const s = summarise(rows, 'variant_id', 'variant_owner_id');
    expect(s.occurrences).toBe(3);
    expect(s.byVerdict.foreign).toBe(2);
    expect(s.affectedRows).toBe(1);
  });

  it('does not let indeterminate rows inflate the victim count', () => {
    const s = summarise(storyRows, 'story_id', 'prep_owner_id');
    expect(s.byVerdict.indeterminate).toBe(1);
    expect(s.distinctVictimOwners).toBe(1); // s-foreign only
  });
});
