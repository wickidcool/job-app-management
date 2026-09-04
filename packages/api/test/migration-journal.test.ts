// WIC-1963: `meta/_journal.json` is generated from the .sql files, not committed.
// These tests are the safety net for that switch. The one that matters most is
// "reproduces every applied migration's `when`": if generation ever changed a
// `when`, drizzle would re-run or skip a migration in production with no error
// (see journal.ts for the full mechanism), and this suite is what catches it.
//
// The fixture it checks against — `fixtures/applied-migrations.json` — is
// deliberately NOT shaped like a drizzle journal, and that is load-bearing
// (WIC-2033). It used to be a verbatim copy of the removed `meta/_journal.json`,
// which made it a 79%-similar match: `git diff --find-renames` paired this
// branch's *delete* of the journal with its *add* of the fixture and reported
// `R079`, so a later migration PR's edit to `meta/_journal.json` was silently
// replayed into the fixture instead. Reproduced on PR #363, which appended an
// unapplied `0026` to the file that exists to record what production has
// already run. A tag→timestamp map shares no line shape with the journal's
// object-per-entry array, so the rename pairing does not form and that PR now
// takes a loud modify/delete on `meta/_journal.json` instead. Keep the shapes
// different: do not "tidy" this fixture back into journal form.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildJournal,
  buildJournalEntries,
  serializeJournal,
  HISTORICAL_WHEN,
  WHEN_STEP,
} from '../src/db/journal.js';

const migrationsDir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

function realSqlFileNames(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * The next unused migration number, derived from the real set. Hardcoding this
 * (it was `0021`) makes every one of the tests below break the moment any
 * migration PR lands — the synthetic name collides with a real file and trips
 * the density guard. Derive it so the suite survives the next migration.
 */
function nextNumber(): number {
  return realSqlFileNames().length + 1;
}
const pad = (n: number) => String(n).padStart(4, '0');

/** The frozen historical `when`s, oldest-first, as an ordered [tag, when] list. */
const HISTORICAL_ENTRIES = Object.entries(HISTORICAL_WHEN);
const MAX_HISTORICAL_WHEN = Math.max(...Object.values(HISTORICAL_WHEN));

/**
 * What production's `drizzle.__drizzle_migrations` table actually holds: every
 * migration already applied there, and the exact `created_at` it carries. This
 * is the oracle the generator has to satisfy — an independent record of
 * deployed state, not a second copy of `HISTORICAL_WHEN`, so editing the map
 * without editing this file is caught rather than rubber-stamped.
 */
const APPLIED = JSON.parse(
  readFileSync(new URL('./fixtures/applied-migrations.json', import.meta.url), 'utf8')
) as { watermark: number; createdAt: Record<string, number> };
const APPLIED_TAGS = Object.keys(APPLIED.createdAt);

describe('migration journal generation (WIC-1963)', () => {
  it("reproduces every applied migration's production `created_at`, in order", () => {
    // Generation from the .sql files on disk must place the already-applied
    // migrations first, in the same order, each with the same `when` production
    // already stored — otherwise the applied/skip watermark moves and drizzle
    // either re-runs or skips a migration, with no error either way.
    //
    // Migrations NOT yet applied in production are deliberately unconstrained
    // here (the next test pins the only thing that matters about them: they sort
    // above the watermark). Asserting on the whole file instead would make this
    // fail on every migration PR, which is how a pin like this gets deleted
    // rather than fixed, taking the tripwire with it.
    const entries = buildJournalEntries(realSqlFileNames());
    expect(entries.length).toBeGreaterThanOrEqual(APPLIED_TAGS.length);
    expect(entries.slice(0, APPLIED_TAGS.length).map((e) => e.tag)).toEqual(APPLIED_TAGS);
    for (const [tag, createdAt] of Object.entries(APPLIED.createdAt)) {
      const entry = entries.find((e) => e.tag === tag);
      expect(entry, `applied migration ${tag} missing from the generated journal`).toBeDefined();
      expect(entry!.when, `${tag} would move production's stored created_at`).toBe(createdAt);
    }
    // The fixture's own watermark must agree with the set it records.
    expect(Math.max(...Object.values(APPLIED.createdAt))).toBe(APPLIED.watermark);
  });

  it('sorts every not-yet-applied migration ABOVE the production watermark (WIC-2031)', () => {
    // The regression this exists for. `HISTORICAL_WHEN` was frozen at 0020 while
    // 0021-0025 were already live, so those five generated BELOW their real
    // created_at and the next migration generated below the watermark too —
    // drizzle skips it forever, silently. Assert it over the REAL migration set
    // rather than only a synthetic one, so a stale map fails here directly.
    const entries = buildJournalEntries(realSqlFileNames());
    for (const entry of entries) {
      if (entry.tag in APPLIED.createdAt) continue;
      expect(
        entry.when,
        `${entry.tag} is not applied in production yet, but generates ${entry.when}, ` +
          `which is not above the watermark ${APPLIED.watermark} — drizzle would skip it forever`
      ).toBeGreaterThan(APPLIED.watermark);
    }
  });

  it('pins the applied set against the sql files on disk', () => {
    // Guards the other direction: a migration recorded as applied in production
    // must still exist, or the deploy's regenerated journal cannot name it.
    const onDisk = new Set(realSqlFileNames().map((n) => n.replace(/\.sql$/, '')));
    for (const tag of APPLIED_TAGS) {
      expect(onDisk.has(tag), `${tag} is applied in production but its .sql file is gone`).toBe(
        true
      );
    }
  });

  it('preserves every historical `when` exactly', () => {
    const entries = buildJournalEntries(realSqlFileNames());
    for (const [tag, when] of HISTORICAL_ENTRIES) {
      const entry = entries.find((e) => e.tag === tag);
      expect(entry, `historical migration ${tag} missing from generated journal`).toBeDefined();
      expect(entry!.when).toBe(when);
    }
  });

  it('emits idx equal to the filename prefix, dense and 1-based', () => {
    const entries = buildJournalEntries(realSqlFileNames());
    entries.forEach((entry, position) => {
      expect(entry.idx).toBe(position + 1);
      expect(entry.idx).toBe(Number.parseInt(entry.tag.slice(0, 4), 10));
    });
  });

  it('emits a strictly increasing `when` sequence', () => {
    const entries = buildJournalEntries(realSqlFileNames());
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].when).toBeGreaterThan(entries[i - 1].when);
    }
  });

  it('is idempotent — regenerating from the same files yields identical bytes', () => {
    const once = serializeJournal(buildJournal(realSqlFileNames()));
    const twice = serializeJournal(buildJournal(realSqlFileNames()));
    expect(twice).toBe(once);
    // ...and order-insensitive to the input listing (a merge can reorder it).
    const shuffled = [...realSqlFileNames()].reverse();
    expect(serializeJournal(buildJournal(shuffled))).toBe(once);
  });

  describe('a new migration appended after the historical set', () => {
    const NEW_TAG = () => `${pad(nextNumber())}_add_widget`;
    const withNew = () => [...realSqlFileNames(), `${NEW_TAG()}.sql`];

    it('gets a `when` strictly greater than the production watermark', () => {
      // This is the whole point: a newly added migration MUST sort above the
      // last applied `when`, or drizzle silently never runs it.
      //
      // Compare against the fixture's watermark — what production actually
      // stores — and NOT against `max(HISTORICAL_WHEN)`. Reading the maximum out
      // of the map under test makes the assertion self-referential: with the map
      // frozen at 0020 while 0021-0025 were live, the appended migration still
      // cleared the map's own (stale, lower) maximum and this test stayed green
      // on the exact defect it is named for (WIC-2031).
      const entries = buildJournalEntries(withNew());
      const added = entries.find((e) => e.tag === NEW_TAG())!;
      expect(added.when).toBeGreaterThan(APPLIED.watermark);
      expect(added.when).toBeGreaterThan(MAX_HISTORICAL_WHEN);
      // The appended migration extends whatever the last real entry is.
      const lastReal = buildJournalEntries(realSqlFileNames()).at(-1)!;
      expect(added.when).toBe(lastReal.when + WHEN_STEP);
      expect(added.idx).toBe(nextNumber());
    });

    it('does not disturb any historical `when`', () => {
      const before = buildJournalEntries(realSqlFileNames());
      const after = buildJournalEntries(withNew());
      for (const [tag, when] of HISTORICAL_ENTRIES) {
        expect(after.find((e) => e.tag === tag)!.when).toBe(when);
        expect(before.find((e) => e.tag === tag)!.when).toBe(when);
      }
    });

    it('numbers two appended migrations monotonically', () => {
      const n = nextNumber();
      const entries = buildJournalEntries([
        ...realSqlFileNames(),
        `${pad(n)}_add_widget.sql`,
        `${pad(n + 1)}_add_gadget.sql`,
      ]);
      const a = entries.find((e) => e.tag === `${pad(n)}_add_widget`)!;
      const b = entries.find((e) => e.tag === `${pad(n + 1)}_add_gadget`)!;
      expect(b.when).toBeGreaterThan(a.when);
      expect(b.idx).toBe(n + 1);
    });
  });

  describe('rejects a broken migration set loudly at generate time', () => {
    it('throws on two migrations claiming the same number (the WIC-1939 shape)', () => {
      expect(() =>
        buildJournalEntries([
          ...realSqlFileNames(),
          `${pad(nextNumber())}_branch_a.sql`,
          `${pad(nextNumber())}_branch_b.sql`,
        ])
      ).toThrow(/not dense|same number/i);
    });

    it('throws on a gap in the numbering', () => {
      expect(() =>
        buildJournalEntries([...realSqlFileNames(), `${pad(nextNumber() + 1)}_skips_ahead.sql`])
      ).toThrow(/not dense/i);
    });

    it('throws on a file with no numeric prefix', () => {
      expect(() => buildJournalEntries([...realSqlFileNames(), 'add_widget.sql'])).toThrow(
        /numeric prefix/i
      );
    });
  });
});
