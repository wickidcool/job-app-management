// WIC-1939: proves the migration-journal guard is live.
//
// Two halves:
//  1. the REAL tree (`packages/api/src/db/migrations`) audits clean — this is
//     the check that runs on every PR and fails the build on a broken merge;
//  2. a mutant matrix — for every check the guard implements, a synthetic tree
//     that breaks exactly that invariant, asserting the EXACT set of checks that
//     fire. Asserting the exact set (rather than "at least one") means a check
//     that over-fires is caught too, and a clean baseline that quietly stops
//     being clean cannot hide behind another check's failure.
//
// Why a synthetic baseline rather than mutating files on disk: the guard is a
// pure function of (journal text, file names), so the mutants are literal
// values. No fixture directory to leave behind, no ordering coupling with other
// suites, and the duplicate-key mutant can be expressed as raw text — which is
// the whole point, since `JSON.parse` cannot represent it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  auditMigrationJournal,
  parseJsonReportingDuplicateKeys,
} from '../scripts/migration-journal-guard.mjs';
import { JOURNAL_PATH, auditRealMigrationTree } from '../scripts/audit-migration-journal.mjs';

type Violation = { check: string; message: string };

const firedChecks = (violations: Violation[]): string[] =>
  [...new Set(violations.map((v) => v.check))].sort();

// --- synthetic baseline ------------------------------------------------------
// Deliberately mirrors the real journal's shape, including that it starts at
// idx 1 rather than drizzle's usual 0.
type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };

const baseEntries: Entry[] = [
  { idx: 1, version: '7', when: 1713196800000, tag: '0001_initial_schema', breakpoints: true },
  { idx: 2, version: '7', when: 1713283200000, tag: '0002_resumes_schema', breakpoints: true },
  { idx: 3, version: '7', when: 1713369600000, tag: '0003_projects_schema', breakpoints: true },
];

const journalTextFor = (entries: Entry[]): string =>
  JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2);

const filesFor = (entries: Entry[]): string[] => entries.map((e) => `${e.tag}.sql`).sort();

const baseJournalText = journalTextFor(baseEntries);
const baseFiles = filesFor(baseEntries);

describe('migration journal guard — the real tree', () => {
  it('audits clean, so any failure below is the mutant and not a pre-existing break', () => {
    expect(auditRealMigrationTree()).toEqual([]);
  });

  it('is clean on the synthetic baseline too', () => {
    expect(
      auditMigrationJournal({ journalText: baseJournalText, sqlFileNames: baseFiles })
    ).toEqual([]);
  });
});

// --- AC-4: one mutant per check ---------------------------------------------
type Mutant = {
  name: string;
  journalText: string;
  sqlFileNames: string[];
  /** The EXACT set of checks expected to fire, sorted. */
  expected: string[];
  /** Why this set, in particular why any check beyond the target one is unavoidable. */
  note: string;
};

const withoutEntry = (tag: string): Entry[] => baseEntries.filter((e) => e.tag !== tag);

const mutants: Mutant[] = [
  {
    // AC-4 (a): drop a journal entry. This is the *downstream shape* of the
    // WIC-1939 loss — the file survives on disk, the journal forgets it.
    name: 'drop a journal entry (file stays on disk)',
    journalText: journalTextFor(withoutEntry('0003_projects_schema')),
    sqlFileNames: baseFiles,
    expected: [CHECKS.ORPHAN_SQL],
    note: 'Only orphan-sql: idx 1..2 is still dense, no duplicates, and no journal entry points at a missing file.',
  },
  {
    // AC-4 (b): duplicate an idx — two parallel branches claiming the same number.
    name: 'duplicate an idx (two branches claim 3)',
    journalText: journalTextFor([
      ...baseEntries,
      {
        idx: 3,
        version: '7',
        when: 1713370000000,
        tag: '0003_backfill_catalog_diffs_user_id',
        breakpoints: true,
      },
    ]),
    sqlFileNames: [...baseFiles, '0003_backfill_catalog_diffs_user_id.sql'].sort(),
    expected: [CHECKS.DUPLICATE_IDX, CHECKS.IDX_SEQUENCE].sort(),
    note:
      'duplicate-idx is the diagnostic (it names both colliding tags); idx-sequence necessarily fires too, ' +
      'because a repeated idx is by construction not strictly increasing. The two cannot be separated, ' +
      'and duplicate-idx is kept because its message tells you which two migrations collided.',
  },
  {
    // The sequence check on its own: a gap, with everything else consistent.
    name: 'gap in idx (3 renumbered to 4, file and tag together)',
    journalText: journalTextFor([
      ...withoutEntry('0003_projects_schema'),
      { idx: 4, version: '7', when: 1713369600000, tag: '0004_projects_schema', breakpoints: true },
    ]),
    sqlFileNames: [
      '0001_initial_schema.sql',
      '0002_resumes_schema.sql',
      '0004_projects_schema.sql',
    ],
    expected: [CHECKS.IDX_SEQUENCE],
    note: 'Only idx-sequence: tag prefix matches idx, files and journal agree, no duplicates. Just a hole at 3.',
  },
  {
    // AC-4 (c): an orphan .sql — a migration added to the directory but never journaled.
    name: 'orphan .sql on disk',
    journalText: baseJournalText,
    sqlFileNames: [...baseFiles, '0004_enforce_catalog_diffs_userid_not_null.sql'].sort(),
    expected: [CHECKS.ORPHAN_SQL],
    note: 'Only orphan-sql. Same check as the dropped entry, reached from the other direction.',
  },
  {
    name: 'journal entry with no .sql on disk',
    journalText: journalTextFor([
      ...baseEntries,
      { idx: 4, version: '7', when: 1713456000000, tag: '0004_ghost', breakpoints: true },
    ]),
    sqlFileNames: baseFiles,
    expected: [CHECKS.MISSING_SQL],
    note: 'Only missing-sql: idx 1..4 is dense and the tag prefix matches, so nothing else has an opinion.',
  },
  {
    name: 'duplicate tag (idx 3 re-uses idx 2s tag)',
    journalText: journalTextFor([
      ...withoutEntry('0003_projects_schema'),
      { idx: 3, version: '7', when: 1713369600000, tag: '0002_resumes_schema', breakpoints: true },
    ]),
    sqlFileNames: baseFiles,
    expected: [CHECKS.DUPLICATE_TAG, CHECKS.IDX_PREFIX_MISMATCH, CHECKS.ORPHAN_SQL].sort(),
    note:
      'duplicate-tag is the target. Re-using a tag at a different idx cannot avoid also disagreeing with that ' +
      "tag's own numeric prefix (idx-prefix-mismatch), and it necessarily abandons the file it replaced " +
      '(orphan-sql). All three are true statements about this tree.',
  },
  {
    // AC-4 (d), isolated: a duplicate key that changes nothing semantically.
    // JSON.parse cannot see this at all; only the duplicate-key parser can.
    name: 'duplicate key inside one entry object, benign value',
    journalText: baseJournalText.replace(
      '"tag": "0003_projects_schema",',
      '"tag": "0003_projects_schema",\n      "breakpoints": true,'
    ),
    sqlFileNames: baseFiles,
    expected: [CHECKS.DUPLICATE_KEY],
    note:
      'Only duplicate-key, and it is the ONLY check that can see it: the parsed value is byte-identical to the ' +
      'clean baseline, so every other check passes. A JSON.parse-based guard would report nothing at all.',
  },
  {
    // AC-4 (d), the real thing: the exact object the WIC-1939 merge produced.
    name: 'duplicate "tag" key — the WIC-1939 merge resolution',
    journalText: baseJournalText.replace(
      '"tag": "0003_projects_schema",',
      '"tag": "0003_projects_schema",\n      "tag": "0003_backfill_catalog_diffs_user_id",'
    ),
    sqlFileNames: [...baseFiles, '0003_backfill_catalog_diffs_user_id.sql'].sort(),
    expected: [CHECKS.DUPLICATE_KEY, CHECKS.ORPHAN_SQL].sort(),
    note:
      'duplicate-key names the CAUSE (a merge kept both sides in one object); orphan-sql reports the DAMAGE ' +
      '(the losing migration still on disk, now unreachable by migrate()). A JSON.parse-based guard would see ' +
      'only the damage and could not say why — which is precisely how this class of merge slips through review.',
  },
  {
    name: 'idx disagrees with its own tag prefix (half-finished renumber)',
    journalText: journalTextFor([
      ...withoutEntry('0003_projects_schema'),
      { idx: 3, version: '7', when: 1713369600000, tag: '0004_projects_schema', breakpoints: true },
    ]),
    sqlFileNames: [
      '0001_initial_schema.sql',
      '0002_resumes_schema.sql',
      '0004_projects_schema.sql',
    ],
    expected: [CHECKS.IDX_PREFIX_MISMATCH],
    note:
      'Only idx-prefix-mismatch: the file was renamed 0003 -> 0004 and the tag updated, but idx was left at 3. ' +
      'The journal is dense, has no duplicates and points at a file that exists — every other check is happy. ' +
      'This is the exact mistake the PR #238 / #261 renumber can make.',
  },
  {
    // WIC-1955, the headline case: a hand renumber that kept the old timestamp.
    // This is PR #261's exact shape — `0022_enforce_catalog_diffs_userid_not_null`
    // renumbered around #238's `0021_backfill_catalog_diffs_user_id` and carrying
    // its `when`. Note what the OTHER checks say about this tree: nothing. idx is
    // dense, tags are unique, prefixes agree, every file is on disk. Before this
    // check existed the guard reported zero violations on it.
    name: 'when ties the previous entry (renumbered without regenerating the timestamp)',
    journalText: journalTextFor([
      ...baseEntries,
      {
        idx: 4,
        version: '7',
        when: 1713369600000, // === idx 3's `when`
        tag: '0004_enforce_catalog_diffs_userid_not_null',
        breakpoints: true,
      },
    ]),
    sqlFileNames: [...baseFiles, '0004_enforce_catalog_diffs_userid_not_null.sql'].sort(),
    expected: [CHECKS.WHEN_SEQUENCE],
    note:
      'Only when-sequence, and that is the entire point: every idx/tag/file check passes, because a hand ' +
      'renumber updates exactly the fields those checks look at. drizzle never reads idx, so on any database ' +
      'that already applied 0003 this migration is skipped forever while db:migrate exits 0.',
  },
  {
    // The same failure reached from the other direction. A tie is not the only
    // way to lose a migration — anything that fails to exceed the running max
    // does, and the strict `<` makes the two cases identical in production.
    name: 'when goes backwards (non-monotonic, no tie)',
    journalText: journalTextFor([
      ...baseEntries,
      { idx: 4, version: '7', when: 1713300000000, tag: '0004_later', breakpoints: true },
    ]),
    sqlFileNames: [...baseFiles, '0004_later.sql'].sort(),
    expected: [CHECKS.WHEN_SEQUENCE],
    note:
      'when 1713300000000 is unique — no duplicate anywhere — but it is below idx 3s 1713369600000, so the ' +
      'strict `<` gate fails exactly as a tie does. A duplicate-when check alone would miss this; the ' +
      'invariant has to be strict monotonicity, not uniqueness.',
  },
  {
    name: 'when is a string rather than a number',
    journalText: baseJournalText.replace('"when": 1713369600000', '"when": "1713369600000"'),
    sqlFileNames: baseFiles,
    expected: [CHECKS.JOURNAL_PARSE],
    note:
      'Quoting the timestamp is a plausible hand edit and is fatal: drizzle compares Number(created_at) < when, ' +
      'which is NaN for a string, and NaN is false against every operand — so the entry is skipped on every run, ' +
      'fresh database included. Rejected at parse time rather than by when-sequence, since an unordered type ' +
      'cannot be meaningfully compared against the running maximum.',
  },
  {
    name: 'journal is not valid JSON',
    journalText: baseJournalText.replace('"entries"', '"entries'),
    sqlFileNames: baseFiles,
    expected: [CHECKS.JOURNAL_PARSE],
    note: 'Parse failure short-circuits: reporting downstream checks against a value we could not read would be noise.',
  },
];

describe.each(mutants)('mutant: $name', ({ journalText, sqlFileNames, expected, note }) => {
  it(`fires exactly [${expected.join(', ')}] — ${note}`, () => {
    const violations = auditMigrationJournal({ journalText, sqlFileNames }) as Violation[];
    expect(violations.length).toBeGreaterThan(0);
    expect(firedChecks(violations)).toEqual(expected);
  });
});

it('every check the guard implements is exercised by at least one mutant', () => {
  const covered = new Set(mutants.flatMap((m) => m.expected));
  expect([...Object.values(CHECKS)].filter((c) => !covered.has(c))).toEqual([]);
});

// --- WIC-1955: an oracle that does not consult CHECKS ------------------------
// The meta-assertion above iterates `CHECKS`, so it proves the matrix covers
// the checks that *exist* — never that the checks that *need* to exist do. It
// was green for the whole life of PR #338 with the `when` gap present, and it
// would have stayed green if this fix had never been written. Self-consistency
// is not coverage.
//
// This is the missing half, and it is deliberately phrased in terms of the
// mechanism rather than a check id: a refactor that renames or deletes
// WHEN_SEQUENCE fails here rather than silently disarming the guard.
describe('the guard rejects every journal drizzle would skip a migration from', () => {
  /**
   * Model of `PgDialect.migrate()`. The gate — the newest applied `created_at`
   * — is read ONCE, before the loop, so within a single deploy every entry is
   * compared against the same pre-run value.
   */
  const applyOneDeploy = (entries: Entry[], appliedMax: number | null) => {
    const applied: string[] = [];
    let newMax = appliedMax;
    for (const entry of entries) {
      if (appliedMax === null || appliedMax < entry.when) {
        applied.push(entry.tag);
        newMax = newMax === null || entry.when > newMax ? entry.when : newMax;
      }
    }
    return { applied, max: newMax };
  };

  /**
   * Tags that never run, over every possible split of the journal into two
   * deploys. A journal is safe only if no split loses anything — the boundary
   * is whenever someone happened to merge, which nobody controls.
   */
  const tagsLostUnderSomeDeploySplit = (entries: Entry[]): string[] => {
    const lost = new Set<string>();
    for (let k = 0; k <= entries.length; k += 1) {
      const first = applyOneDeploy(entries.slice(0, k), null);
      const second = applyOneDeploy(entries.slice(k), first.max);
      const applied = new Set([...first.applied, ...second.applied]);
      for (const entry of entries) if (!applied.has(entry.tag)) lost.add(entry.tag);
    }
    return [...lost].sort();
  };

  const realEntries: Entry[] = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')).entries;

  it('positive control: a fresh database applies the broken tree fine, which is why CI cannot catch it', () => {
    const tied: Entry[] = [
      ...baseEntries,
      { idx: 4, version: '7', when: 1713369600000, tag: '0004_tied', breakpoints: true },
    ];
    // One pass over an empty database: `lastDbMigration` is null, the strict
    // `<` never runs, everything applies. This is the measurement that makes
    // the bug invisible to every from-scratch test in the suite.
    expect(applyOneDeploy(tied, null).applied).toHaveLength(4);
    // Split the same journal across two deploys and one migration is gone.
    expect(tagsLostUnderSomeDeploySplit(tied)).toEqual(['0004_tied']);
  });

  it('flags the tied journal without being told which check should fire', () => {
    const tied: Entry[] = [
      ...baseEntries,
      { idx: 4, version: '7', when: 1713369600000, tag: '0004_tied', breakpoints: true },
    ];
    expect(tagsLostUnderSomeDeploySplit(tied).length).toBeGreaterThan(0);
    expect(
      auditMigrationJournal({ journalText: journalTextFor(tied), sqlFileNames: filesFor(tied) })
    ).not.toEqual([]);
  });

  it('the real journal loses nothing under any deploy split', () => {
    expect(tagsLostUnderSomeDeploySplit(realEntries)).toEqual([]);
  });

  it('agrees with the guard across every mutant: a lost migration is always reported', () => {
    for (const mutant of mutants) {
      let entries: Entry[];
      try {
        entries = JSON.parse(mutant.journalText).entries;
      } catch {
        continue; // the malformed-JSON mutant has no entries to simulate
      }
      if (!entries.every((e) => Number.isInteger(e.when))) continue;
      if (tagsLostUnderSomeDeploySplit(entries).length === 0) continue;
      expect(
        auditMigrationJournal({
          journalText: mutant.journalText,
          sqlFileNames: mutant.sqlFileNames,
        }),
        `${mutant.name}: drizzle would skip a migration on this tree, so the guard must report something`
      ).not.toEqual([]);
    }
  });
});

// --- the duplicate-key parser itself ----------------------------------------
describe('parseJsonReportingDuplicateKeys', () => {
  it('sees a duplicate key that JSON.parse silently collapses', () => {
    const text = '{"idx": 20, "tag": "a", "tag": "b"}';
    // The premise of the whole bug: this is valid JSON and the first tag is gone.
    expect(JSON.parse(text)).toEqual({ idx: 20, tag: 'b' });

    const { value, duplicates } = parseJsonReportingDuplicateKeys(text);
    expect(value).toEqual({ idx: 20, tag: 'b' });
    expect(duplicates).toEqual([{ path: '$', key: 'tag' }]);
  });

  it('reports the path of a duplicate nested inside an array of objects', () => {
    const { duplicates } = parseJsonReportingDuplicateKeys(
      '{"entries": [{"a": 1}, {"b": 2, "b": 3}]}'
    );
    expect(duplicates).toEqual([{ path: 'entries[1]', key: 'b' }]);
  });

  it('does not mistake a colon or a brace inside a string value for structure', () => {
    const text = '{"tag": "0020_x", "note": "{\\"tag\\": 1, \\"tag\\": 2}"}';
    const { value, duplicates } = parseJsonReportingDuplicateKeys(text);
    expect(duplicates).toEqual([]);
    expect(value).toEqual(JSON.parse(text));
  });

  it('agrees with JSON.parse on the real journal, escapes and all', () => {
    const journalText = readFileSync(JOURNAL_PATH, 'utf8');
    const { value, duplicates } = parseJsonReportingDuplicateKeys(journalText);
    expect(duplicates).toEqual([]);
    expect(value).toEqual(JSON.parse(journalText));
  });

  it('rejects trailing content instead of silently accepting a truncated file', () => {
    expect(() => parseJsonReportingDuplicateKeys('{"a": 1} {"b": 2}')).toThrow(/trailing content/);
  });
});
