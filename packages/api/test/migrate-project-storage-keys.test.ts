/**
 * WIC-1433 / WIC-1806 — the storage backfill's pure decisions.
 *
 * The script itself cannot be run in CI (it needs a production DATABASE_URL and
 * R2 credentials), so it ships as unrun code. These tests pin the parts that
 * decide *what happens to whose files*, which is where an error would be least
 * recoverable: mis-classifying a key mis-files someone's document, and
 * mis-bucketing a commingled slug would hand one user another user's files under
 * the appearance of a clean migration.
 *
 * WIC-1806 closed the gap that made the first round of these tests weaker than
 * they looked: they reached the helpers where they were *defined* but never
 * where `main()` *consumed* them, and `main()` is where both round-2 defects
 * actually lived. Five mutants inside `main()` — including passing the slug set
 * to the walk, which is the original bug verbatim — survived the full green
 * suite. The fix was structural rather than another assertion: `ownerIdsOf` is
 * now the single place the userId set is derived, both enumerators take the
 * slug map itself, and every test below starts from that map rather than from a
 * set someone already derived correctly.
 *
 * Still deliberately unverified here, and called out as such on the PR: R2
 * pagination (`listAllKeys`), the copy/delete and `fs.rename` apply path, the
 * local re-`stat`, the R2 `HeadObject` confirmation, and `CopySource`
 * encoding. Those need a live backend, not a fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classify,
  bucketByOwnership,
  splitCollisions,
  enumerateLocal,
  enumerate,
  ownerIdsOf,
  planFromKeys,
  unresolvedCounts,
  // @ts-expect-error — plain .mjs ops script, no type declarations
} from '../scripts/migrate-project-storage-keys.mjs';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

/**
 * The slug -> [userId] map `ownersBySlug` returns, and the only thing either
 * enumerator accepts (WIC-1806).
 *
 * Starting every enumerator test from *this* rather than from a pre-derived id
 * set is what gives these tests their teeth: the keys are slugs that also
 * appear in the fixtures as legacy directories, so code that derived the id set
 * from `.keys()` instead of `.values()` would read those directories as
 * already-migrated owner trees and skip them — and the assertions below would
 * see the empty enumeration rather than a plausible-looking one.
 */
const OWNERS = new Map<string, string[]>([
  ['acme-corp', [USER_A]],
  ['globex-inc', [USER_B]],
]);

describe('classify — legacy vs already-migrated', () => {
  it('reads a 3-segment key as legacy and splits slug from file name', () => {
    expect(classify('projects/acme-corp/staff-engineer.md')).toEqual({
      kind: 'legacy',
      slug: 'acme-corp',
      fileName: 'staff-engineer.md',
    });
  });

  it('reads a 4-segment key as already namespaced, so the script is idempotent', () => {
    expect(classify(`projects/${USER_A}/acme-corp/staff-engineer.md`)).toEqual({
      kind: 'namespaced',
    });
  });

  it('singles out the legacy global index, which is derived and must not be moved', () => {
    expect(classify('projects/index.md')).toEqual({ kind: 'legacy-index' });
  });

  it('leaves non-project keys alone — resume storage shares the bucket', () => {
    // `buildObjectKey` writes `{userId}/resumes/{file}`. A greedy migration that
    // treated every 3-segment key as legacy would relocate people's resumes.
    expect(classify(`${USER_A}/resumes/cv.pdf`).kind).toBe('foreign');
    expect(classify(`${USER_A}/resume-exports/cv.docx`).kind).toBe('foreign');
  });

  it('a slug containing a dash or dot is still one segment', () => {
    expect(classify('projects/acme-corp.io/notes.v2.md')).toMatchObject({
      kind: 'legacy',
      slug: 'acme-corp.io',
      fileName: 'notes.v2.md',
    });
  });

  // The per-owner index `generateProjectIndex` writes has the same segment
  // count as a legacy key. Read as legacy, no `projects` row owns its "slug"
  // (a userId), so it lands in `orphaned` and pins the exit at 2 forever —
  // which spends the very signal the non-zero exit exists to carry.
  it('reads the per-owner index as namespaced, not as a legacy slug', () => {
    const ownerIds = new Set([USER_A, USER_B]);
    expect(classify(`projects/${USER_A}/index.md`, ownerIds)).toEqual({ kind: 'namespaced' });
  });

  it('still reads a legacy project file named index.md as legacy', () => {
    // Only the *owner id* position disambiguates: `index.md` is a legal
    // project file name, so a real legacy artefact may well be called that.
    expect(classify('projects/acme-corp/index.md', new Set([USER_A]))).toEqual({
      kind: 'legacy',
      slug: 'acme-corp',
      fileName: 'index.md',
    });
  });
});

describe('splitCollisions — never overwrite a live file with a pre-fix one', () => {
  const movable = [
    { key: 'projects/solo-co/c.md', slug: 'solo-co', fileName: 'c.md', userId: USER_A },
    { key: 'projects/acme-corp/a.md', slug: 'acme-corp', fileName: 'a.md', userId: USER_B },
  ];

  it('withholds a legacy file whose namespaced destination already exists', () => {
    // `--apply` copies then deletes the source, so an occupied destination is
    // an unrecoverable overwrite — the owner wrote after the fix shipped, and
    // migrating would replace those bytes with their pre-fix ones.
    const existing = new Set([`projects/${USER_B}/acme-corp/a.md`]);
    const { moves, collisions } = splitCollisions(movable, existing);
    expect(moves.map((m: { slug: string }) => m.slug)).toEqual(['solo-co']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      slug: 'acme-corp',
      dest: `projects/${USER_B}/acme-corp/a.md`,
    });
  });

  it('moves everything when no destination is occupied, and stamps the dest key', () => {
    const { moves, collisions } = splitCollisions(movable, new Set());
    expect(collisions).toEqual([]);
    expect(moves.map((m: { dest: string }) => m.dest)).toEqual([
      `projects/${USER_A}/solo-co/c.md`,
      `projects/${USER_B}/acme-corp/a.md`,
    ]);
  });

  it('accounts for every input file', () => {
    const { moves, collisions } = splitCollisions(
      movable,
      new Set([`projects/${USER_B}/acme-corp/a.md`])
    );
    expect(moves.length + collisions.length).toBe(movable.length);
  });
});

describe('enumerateLocal — the --local walk, which had no cover at all', () => {
  let root: string;
  let projects: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wic1433-'));
    projects = path.join(root, 'projects');
    await fs.mkdir(projects, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, body = 'x') => {
    const p = path.join(projects, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body, 'utf-8');
  };

  // The regression that motivated exporting this: the membership test asked
  // the *slug* map whether a directory name was a *userId*. Both branches
  // invert, and the dangerous direction is silent.
  it('enumerates legacy slug dirs when the tree is entirely legacy', async () => {
    await write('acme-corp/star.md');
    await write('globex-inc/y.md');
    const { legacy } = await enumerateLocal(projects, OWNERS);
    expect(legacy.map((l: { slug: string }) => l.slug).sort()).toEqual(['acme-corp', 'globex-inc']);
  });

  it('does not walk an already-migrated owner tree as though it were legacy', async () => {
    await write(`${USER_B}/globex-inc/x.md`);
    const { legacy } = await enumerateLocal(projects, OWNERS);
    // Asking the slug set instead yields `slug=<uuid> fileName=globex-inc` —
    // a directory enumerated as a file, then reported as an orphan.
    expect(legacy).toEqual([]);
  });

  it('reports the already-namespaced keys so a collision is visible', async () => {
    await write(`${USER_B}/globex-inc/x.md`);
    const { existingKeys } = await enumerateLocal(projects, OWNERS);
    expect([...existingKeys]).toEqual([`projects/${USER_B}/globex-inc/x.md`]);
  });

  it('separates a mixed tree correctly — the migrated half is skipped, the legacy half is not', async () => {
    await write('acme-corp/star.md');
    await write(`${USER_B}/globex-inc/x.md`);
    const { legacy, existingKeys } = await enumerateLocal(projects, OWNERS);
    expect(legacy).toEqual([
      { key: path.join(projects, 'acme-corp', 'star.md'), slug: 'acme-corp', fileName: 'star.md' },
    ]);
    expect(existingKeys.has(`projects/${USER_B}/globex-inc/x.md`)).toBe(true);
  });

  it('collects the legacy global index but not a per-owner one', async () => {
    await write('index.md');
    await write(`${USER_A}/index.md`);
    const { legacy, legacyIndexes } = await enumerateLocal(projects, OWNERS);
    expect(legacyIndexes).toEqual([path.join(projects, 'index.md')]);
    expect(legacy).toEqual([]);
  });

  it('a purely-legacy tree can never report zero work to do', async () => {
    // The silent failure: skip every legacy dir, enumerate nothing, report
    // zero unresolved slugs, exit 0 — a success that means its own opposite.
    await write('acme-corp/star.md');
    await write('globex-inc/y.md');
    const { legacy } = await enumerateLocal(projects, OWNERS);
    const owners = new Map([
      ['acme-corp', [USER_A]],
      ['globex-inc', [USER_B]],
    ]);
    const { movable, commingled, orphaned } = bucketByOwnership(legacy, owners);
    const { moves, collisions } = splitCollisions(movable, new Set());
    expect(moves).toHaveLength(2);
    expect(commingled.size + orphaned.size + collisions.length).toBe(0); // exit 0 — truthfully
  });

  it('returns empty rather than throwing when the projects dir does not exist', async () => {
    const { legacy, legacyIndexes, existingKeys } = await enumerateLocal(
      path.join(root, 'nope'),
      new Map()
    );
    expect([legacy, legacyIndexes, [...existingKeys]]).toEqual([[], [], []]);
  });
});

describe('bucketByOwnership — never guess who owns a commingled slug', () => {
  const legacy = [
    { key: 'projects/acme-corp/a.md', slug: 'acme-corp', fileName: 'a.md' },
    { key: 'projects/acme-corp/b.md', slug: 'acme-corp', fileName: 'b.md' },
    { key: 'projects/solo-co/c.md', slug: 'solo-co', fileName: 'c.md' },
    { key: 'projects/ghost-co/d.md', slug: 'ghost-co', fileName: 'd.md' },
  ];
  const owners = new Map<string, string[]>([
    ['acme-corp', [USER_A, USER_B]], // two owners — the whole point of the defect
    ['solo-co', [USER_A]],
    // ghost-co: no row at all
  ]);

  it('moves only the slug with exactly one owner', () => {
    const { movable } = bucketByOwnership(legacy, owners);
    expect(movable).toEqual([
      { key: 'projects/solo-co/c.md', slug: 'solo-co', fileName: 'c.md', userId: USER_A },
    ]);
  });

  it('refuses a slug held by two users and reports both owners', () => {
    const { commingled, movable } = bucketByOwnership(legacy, owners);
    expect(movable.map((m: { slug: string }) => m.slug)).not.toContain('acme-corp');
    expect(commingled.get('acme-corp')).toEqual({
      owners: [USER_A, USER_B],
      files: ['a.md', 'b.md'],
    });
  });

  it('refuses a slug no row owns rather than dropping it silently', () => {
    const { orphaned, movable } = bucketByOwnership(legacy, owners);
    expect(movable.map((m: { slug: string }) => m.slug)).not.toContain('ghost-co');
    expect(orphaned.get('ghost-co')).toEqual(['d.md']);
  });

  it('accounts for every input file — nothing is silently dropped', () => {
    const { movable, commingled, orphaned } = bucketByOwnership(legacy, owners);
    const total =
      movable.length +
      [...commingled.values()].reduce(
        (n: number, v: { files: string[] }) => n + v.files.length,
        0
      ) +
      [...orphaned.values()].reduce((n: number, v: string[]) => n + v.length, 0);
    expect(total).toBe(legacy.length);
  });

  it('the unresolved count is what drives the non-zero exit', () => {
    const { commingled, orphaned } = bucketByOwnership(legacy, owners);
    // A deploy must not read "partially migrated" as "done".
    expect(commingled.size + orphaned.size).toBeGreaterThan(0);
  });
});

describe('ownerIdsOf — the derivation that used to happen at each caller (WIC-1806)', () => {
  it('derives the userId set from the map values, not its slug keys', () => {
    // `.keys()` here is the round-2 defect in its purest form: it yields
    // 'acme-corp'/'globex-inc', so every legacy directory then looks like an
    // already-migrated owner tree and is skipped.
    expect([...ownerIdsOf(OWNERS)].sort()).toEqual([USER_A, USER_B].sort());
  });

  it('flattens a slug held by two users rather than keeping the array', () => {
    const shared = new Map([['acme-corp', [USER_A, USER_B]]]);
    expect([...ownerIdsOf(shared)].sort()).toEqual([USER_A, USER_B].sort());
  });

  it('refuses a pre-derived set instead of silently honouring it', () => {
    // The point of the throw: a Set answers `.values()` too, so without this
    // guard `ownerIdsOf(new Set(owners.keys()))` returns the slug set and the
    // run reports "all attributable" and exits 0 having moved nothing. Making
    // the wrong argument unpassable is the fix; asserting it wasn't passed is
    // what the previous round did, and it only reached the definition site.
    expect(() => ownerIdsOf(new Set([...OWNERS.keys()]))).toThrow(/not a pre-derived set/);
    expect(() => ownerIdsOf(new Set([USER_A]))).toThrow(TypeError);
  });

  it('refuses undefined rather than treating it as an empty set', () => {
    expect(() => ownerIdsOf(undefined)).toThrow(TypeError);
  });
});

describe('planFromKeys — the R2 classification loop lifted out of main() (WIC-1806)', () => {
  const keys = [
    'projects/index.md',
    'projects/acme-corp/star.md',
    'projects/globex-inc/y.md',
    `projects/${USER_A}/index.md`,
    `projects/${USER_B}/globex-inc/x.md`,
    `${USER_A}/resumes/cv.pdf`,
  ];

  it('reads a purely-legacy listing as legacy, starting from the slug map', () => {
    const { legacy } = planFromKeys(keys, OWNERS);
    expect(legacy.map((l: { slug: string }) => l.slug).sort()).toEqual(['acme-corp', 'globex-inc']);
  });

  it('keeps the per-owner index out of legacy — the exit-2-forever defect', () => {
    // `classify(key)` with no owner ids reads `projects/{userId}/index.md` as a
    // legacy key whose "slug" is a uuid no projects row owns, so it lands in
    // `orphaned` and pins the exit at 2 on every future run.
    const { legacy } = planFromKeys(keys, OWNERS);
    expect(legacy.map((l: { slug: string }) => l.slug)).not.toContain(USER_A);
    const { orphaned } = bucketByOwnership(legacy, OWNERS);
    expect(orphaned.size).toBe(0);
  });

  it('collects already-namespaced keys so a collision is visible', () => {
    // Dropping this re-enables the overwrite-plus-unrecoverable-delete that
    // `splitCollisions` exists to refuse.
    const { existingKeys } = planFromKeys(keys, OWNERS);
    expect(existingKeys.has(`projects/${USER_B}/globex-inc/x.md`)).toBe(true);
    const movable = [
      {
        key: 'projects/globex-inc/x.md',
        slug: 'globex-inc',
        fileName: 'x.md',
        userId: USER_B,
      },
    ];
    expect(splitCollisions(movable, existingKeys).collisions).toHaveLength(1);
  });

  it('separates the legacy global index and leaves foreign keys alone', () => {
    const { legacyIndexes, legacy, existingKeys } = planFromKeys(keys, OWNERS);
    expect(legacyIndexes).toEqual(['projects/index.md']);
    expect([...legacy, ...existingKeys].some((k) => String(k).includes('resumes'))).toBe(false);
  });

  it('agrees with enumerateLocal — both enumerators take the same argument', async () => {
    // The structural claim WIC-1806 rests on: there is one owner-id derivation
    // and both backends go through it, so a caller has nothing left to mix up.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wic1806-'));
    try {
      const projects = path.join(root, 'projects');
      await fs.mkdir(path.join(projects, 'acme-corp'), { recursive: true });
      await fs.writeFile(path.join(projects, 'acme-corp', 'star.md'), 'x');
      await fs.mkdir(path.join(projects, USER_B, 'globex-inc'), { recursive: true });
      await fs.writeFile(path.join(projects, USER_B, 'globex-inc', 'x.md'), 'x');

      const local = await enumerateLocal(projects, OWNERS);
      const r2 = planFromKeys(
        ['projects/acme-corp/star.md', `projects/${USER_B}/globex-inc/x.md`],
        OWNERS
      );
      expect(local.legacy.map((l: { slug: string }) => l.slug)).toEqual(
        r2.legacy.map((l: { slug: string }) => l.slug)
      );
      expect([...local.existingKeys]).toEqual([...r2.existingKeys]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('unresolvedCounts — what blocks the exit, in the units it is printed in (WIC-1806)', () => {
  const build = (over = {}) => ({
    commingled: new Map(),
    orphaned: new Map(),
    collisions: [],
    ...over,
  });

  it('an occupied destination alone still blocks — exit 2, not a silent exit 0', () => {
    // The mutant this kills: `blocked` dropping `collisions`. A run whose only
    // problem is an occupied destination has zero commingled and zero orphaned
    // slugs, so a tally over those two exits 0 on exactly the case where
    // `--apply` would overwrite live bytes with pre-fix ones and delete the
    // evidence.
    const counts = unresolvedCounts(build({ collisions: [{ dest: 'projects/x/y/z.md' }] }));
    expect(counts.blocked).toBe(true);
    expect(counts.occupied).toBe(1);
    expect(counts.slugs).toBe(0);
  });

  it('counts slugs and files separately rather than summing the two units', () => {
    // The old message added slug counts to a file count and called the total
    // "N slug(s)". Two commingled files under one slug is 1 slug, 2 files.
    const counts = unresolvedCounts(
      build({
        commingled: new Map([['acme-corp', { owners: [USER_A, USER_B], files: ['a.md', 'b.md'] }]]),
        orphaned: new Map([['ghost-co', ['d.md']]]),
        collisions: [{ dest: 'projects/x/y/z.md' }],
      })
    );
    expect(counts.slugs).toBe(2);
    expect(counts.files).toBe(4);
    expect(counts.occupied).toBe(1);
  });

  it('a fully attributable run does not block', () => {
    expect(unresolvedCounts(build()).blocked).toBe(false);
  });
});

describe('enumerateLocal — an unreadable directory must not read as an empty one (WIC-1806)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wic1806-eacces-'));
  });
  afterEach(async () => {
    await fs.chmod(path.join(root, 'projects', 'acme-corp'), 0o755).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  it('still returns empty when the projects dir simply is not there', async () => {
    // ENOENT is the one error that legitimately means "nothing to enumerate".
    const { legacy, legacyIndexes, existingKeys } = await enumerateLocal(
      path.join(root, 'nope'),
      new Map()
    );
    expect([legacy, legacyIndexes, [...existingKeys]]).toEqual([[], [], []]);
  });

  it('throws rather than reporting an empty tree when the path is not a directory', async () => {
    // Deterministic stand-in for the whole non-ENOENT class: the old
    // `.catch(() => [])` swallowed this identically to a missing directory.
    const file = path.join(root, 'projects');
    await fs.writeFile(file, 'not a directory', 'utf-8');
    await expect(enumerateLocal(file, new Map())).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  // Skipped for root, which bypasses the permission bits entirely.
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'throws on an unreadable legacy slug directory instead of exiting 0 clean',
    async () => {
      // The false clean this prevents: one chmod-000 legacy directory
      // enumerated as empty, "All legacy project artefacts are attributable",
      // exit 0, and those files still on the shared cross-tenant prefix.
      const projects = path.join(root, 'projects');
      const slug = path.join(projects, 'acme-corp');
      await fs.mkdir(slug, { recursive: true });
      await fs.writeFile(path.join(slug, 'star.md'), 'x', 'utf-8');
      await fs.chmod(slug, 0o000);
      await expect(enumerateLocal(projects, OWNERS)).rejects.toMatchObject({ code: 'EACCES' });
    }
  );
});

describe("enumerate — main()'s backend wiring, now reachable (WIC-1806)", () => {
  let root: string;
  let projects: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wic1806-wiring-'));
    projects = path.join(root, 'projects');
    await fs.mkdir(path.join(projects, 'acme-corp'), { recursive: true });
    await fs.writeFile(path.join(projects, 'acme-corp', 'star.md'), 'x', 'utf-8');
    await fs.mkdir(path.join(projects, 'globex-inc'), { recursive: true });
    await fs.writeFile(path.join(projects, 'globex-inc', 'y.md'), 'x', 'utf-8');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const never = () => {
    throw new Error('listKeys must not be called on the --local path');
  };

  // THE regression. Its failure mode is silent: enumerate nothing, print
  // "Legacy files: 0" and "All legacy project artefacts are attributable",
  // exit 0, and leave every project file on the shared cross-tenant prefix.
  // An operator reads that as done.
  it('a purely-legacy local tree can never enumerate as empty', async () => {
    const { legacy } = await enumerate({ localDir: root, owners: OWNERS, listKeys: never });
    expect(legacy.map((l: { slug: string }) => l.slug).sort()).toEqual(['acme-corp', 'globex-inc']);
  });

  it('hands the walk the slug map, not a set derived from it', async () => {
    // Passing `new Set(owners.keys())` here — the original bug verbatim — is
    // now refused at the boundary rather than honoured into a false exit 0.
    await expect(
      enumerate({
        localDir: root,
        owners: new Set([...OWNERS.keys()]) as never,
        listKeys: never,
      })
    ).rejects.toThrow(/not a pre-derived set/);
  });

  it('routes to the R2 plan when no local dir is given, with the same map', async () => {
    const { legacy, existingKeys } = await enumerate({
      localDir: null,
      owners: OWNERS,
      listKeys: async () => ['projects/acme-corp/star.md', `projects/${USER_B}/globex-inc/x.md`],
    });
    expect(legacy.map((l: { slug: string }) => l.slug)).toEqual(['acme-corp']);
    expect(existingKeys.has(`projects/${USER_B}/globex-inc/x.md`)).toBe(true);
  });

  it('does not touch the object store when --local was given', async () => {
    // `never` throws if called; a mutant that dropped the branch would fail here
    // rather than quietly listing a production bucket during a local run.
    await expect(
      enumerate({ localDir: root, owners: OWNERS, listKeys: never })
    ).resolves.toBeDefined();
  });
});
