/**
 * WIC-1433 — the storage backfill's two pure decisions.
 *
 * The script itself cannot be run in CI (it needs a production DATABASE_URL and
 * R2 credentials), so it ships as unrun code. These tests pin the two parts that
 * decide *what happens to whose files*, which is where an error would be least
 * recoverable: mis-classifying a key mis-files someone's document, and
 * mis-bucketing a commingled slug would hand one user another user's files under
 * the appearance of a clean migration.
 *
 * The rest of the script — R2 pagination, copy/delete, `fs.rename` — stays
 * unverified here and is called out as such on the PR.
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
  // @ts-expect-error — plain .mjs ops script, no type declarations
} from '../scripts/migrate-project-storage-keys.mjs';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

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
    const { legacy } = await enumerateLocal(projects, new Set([USER_A, USER_B]));
    expect(legacy.map((l: { slug: string }) => l.slug).sort()).toEqual(['acme-corp', 'globex-inc']);
  });

  it('does not walk an already-migrated owner tree as though it were legacy', async () => {
    await write(`${USER_B}/globex-inc/x.md`);
    const { legacy } = await enumerateLocal(projects, new Set([USER_B]));
    // Asking the slug set instead yields `slug=<uuid> fileName=globex-inc` —
    // a directory enumerated as a file, then reported as an orphan.
    expect(legacy).toEqual([]);
  });

  it('reports the already-namespaced keys so a collision is visible', async () => {
    await write(`${USER_B}/globex-inc/x.md`);
    const { existingKeys } = await enumerateLocal(projects, new Set([USER_B]));
    expect([...existingKeys]).toEqual([`projects/${USER_B}/globex-inc/x.md`]);
  });

  it('separates a mixed tree correctly — the migrated half is skipped, the legacy half is not', async () => {
    await write('acme-corp/star.md');
    await write(`${USER_B}/globex-inc/x.md`);
    const { legacy, existingKeys } = await enumerateLocal(projects, new Set([USER_A, USER_B]));
    expect(legacy).toEqual([
      { key: path.join(projects, 'acme-corp', 'star.md'), slug: 'acme-corp', fileName: 'star.md' },
    ]);
    expect(existingKeys.has(`projects/${USER_B}/globex-inc/x.md`)).toBe(true);
  });

  it('collects the legacy global index but not a per-owner one', async () => {
    await write('index.md');
    await write(`${USER_A}/index.md`);
    const { legacy, legacyIndexes } = await enumerateLocal(projects, new Set([USER_A]));
    expect(legacyIndexes).toEqual([path.join(projects, 'index.md')]);
    expect(legacy).toEqual([]);
  });

  it('a purely-legacy tree can never report zero work to do', async () => {
    // The silent failure: skip every legacy dir, enumerate nothing, report
    // zero unresolved slugs, exit 0 — a success that means its own opposite.
    await write('acme-corp/star.md');
    await write('globex-inc/y.md');
    const { legacy } = await enumerateLocal(projects, new Set([USER_A, USER_B]));
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
      new Set()
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
