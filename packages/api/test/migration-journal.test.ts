// WIC-1963: `meta/_journal.json` is generated from the .sql files, not committed.
// These tests are the safety net for that switch. The one that matters most is
// "reproduces the historical journal byte-for-byte": if generation ever changed
// a `when`, drizzle would re-run or skip a migration in production with no error
// (see journal.ts for the full mechanism), and this suite is what catches it.
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

/** The frozen historical `when`s, oldest-first, as an ordered [tag, when] list. */
const HISTORICAL_ENTRIES = Object.entries(HISTORICAL_WHEN);
const LAST_HISTORICAL_TAG = HISTORICAL_ENTRIES[HISTORICAL_ENTRIES.length - 1][0];
const MAX_HISTORICAL_WHEN = Math.max(...Object.values(HISTORICAL_WHEN));

describe('migration journal generation (WIC-1963)', () => {
  it('reproduces the historical committed journal byte-for-byte', () => {
    // The committed file was removed from git but this fixture pins what it was.
    // Generation from the .sql files on disk must equal it exactly — same order,
    // same idx, and above all the same `when` for every already-applied
    // migration, so production's applied/skip watermark does not move.
    const expected = readFileSync(
      new URL('./fixtures/journal.baseline.json', import.meta.url),
      'utf8'
    );
    const generated = serializeJournal(buildJournal(realSqlFileNames()));
    expect(generated).toBe(expected);
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
    const withNew = () => [...realSqlFileNames(), '0021_add_widget.sql'];

    it('gets a `when` strictly greater than the production watermark', () => {
      // This is the whole point: a newly added migration MUST sort above the
      // last applied `when`, or drizzle silently never runs it.
      const entries = buildJournalEntries(withNew());
      const added = entries.find((e) => e.tag === '0021_add_widget')!;
      expect(added.when).toBeGreaterThan(MAX_HISTORICAL_WHEN);
      expect(added.when).toBe(HISTORICAL_WHEN[LAST_HISTORICAL_TAG] + WHEN_STEP);
      expect(added.idx).toBe(21);
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
      const entries = buildJournalEntries([
        ...realSqlFileNames(),
        '0021_add_widget.sql',
        '0022_add_gadget.sql',
      ]);
      const a = entries.find((e) => e.tag === '0021_add_widget')!;
      const b = entries.find((e) => e.tag === '0022_add_gadget')!;
      expect(b.when).toBeGreaterThan(a.when);
      expect(b.idx).toBe(22);
    });
  });

  describe('rejects a broken migration set loudly at generate time', () => {
    it('throws on two migrations claiming the same number (the WIC-1939 shape)', () => {
      expect(() =>
        buildJournalEntries([...realSqlFileNames(), '0021_branch_a.sql', '0021_branch_b.sql'])
      ).toThrow(/not dense|same number/i);
    });

    it('throws on a gap in the numbering', () => {
      expect(() => buildJournalEntries([...realSqlFileNames(), '0023_skips_ahead.sql'])).toThrow(
        /not dense/i
      );
    });

    it('throws on a file with no numeric prefix', () => {
      expect(() => buildJournalEntries([...realSqlFileNames(), 'add_widget.sql'])).toThrow(
        /numeric prefix/i
      );
    });
  });
});
