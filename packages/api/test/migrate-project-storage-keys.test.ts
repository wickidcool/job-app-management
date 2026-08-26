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
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs ops script, no type declarations
import { classify, bucketByOwnership } from '../scripts/migrate-project-storage-keys.mjs';

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
