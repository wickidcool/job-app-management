// WIC-1939: the drizzle migration journal can silently lose an entry.
//
// `packages/api/src/db/migrate.ts` calls drizzle's `migrate()`, which is
// **journal-driven**: it reads `meta/_journal.json` and applies `${tag}.sql`
// for each entry, in `idx` order. A `.sql` file that is on disk but absent from
// the journal is never applied. Nothing in the suite noticed, because the tests
// that build a migration chain do it from `readdirSync(MIGRATIONS_DIR)` — the
// directory, not the journal. That single divergence between test and
// production is exactly where the damage lands.
//
// The concrete loss: merge-base `bb701190` had no `0020`. `main` claimed idx 20
// for `0020_prep_relevance_score_pct` (WIC-1520) while PR #238 independently
// claimed idx 20 for `0020_backfill_catalog_diffs_user_id`. The merge conflicts
// on the idx-20 object's `tag` line and nowhere else, so the natural resolution
// — keep both migrations, both are wanted — produces one object with two `tag`
// keys:
//
//     { "idx": 20, "when": 1777620258000,
//       "tag": "0020_prep_relevance_score_pct",
//       "tag": "0020_backfill_catalog_diffs_user_id",
//       "breakpoints": true }
//
// That is *valid JSON*. Every parser keeps the last key, so WIC-1520's
// migration vanishes from the journal while its `.sql` stays on disk, and on a
// fresh database it would never run. `JSON.parse` cannot see the cause — only
// the downstream orphan — which is why `auditMigrationJournal` parses the raw
// text with a duplicate-key-detecting parser rather than `JSON.parse`.
//
// This module is pure: it takes the journal *text* and a list of file names and
// returns violations. That keeps it trivially testable against synthetic broken
// trees (see `test/migration-journal.guard.test.ts`) without touching the real
// migrations directory. `audit-migration-journal.mjs` is the CLI that feeds it
// the real tree.

/**
 * Stable check identifiers. Tests assert against these, so treat them as API:
 * rename one and you silently disarm the mutant that proves it.
 */
export const CHECKS = {
  /** The journal text is not valid JSON, or is not shaped like a drizzle journal. */
  JOURNAL_PARSE: 'journal-parse',
  /** An object in the raw journal text declares the same key twice (the WIC-1939 shape). */
  DUPLICATE_KEY: 'duplicate-key',
  /** Two journal entries share an `idx`. */
  DUPLICATE_IDX: 'duplicate-idx',
  /** Two journal entries share a `tag`. */
  DUPLICATE_TAG: 'duplicate-tag',
  /** A journal entry's `tag` has no matching `.sql` on disk. */
  MISSING_SQL: 'missing-sql',
  /** A `.sql` on disk appears in no journal entry — it would never be applied. */
  ORPHAN_SQL: 'orphan-sql',
  /** `idx` values are not dense and strictly increasing by 1. */
  IDX_SEQUENCE: 'idx-sequence',
  /** An entry's `idx` disagrees with the numeric prefix of its own `tag`. */
  IDX_PREFIX_MISMATCH: 'idx-prefix-mismatch',
};

// AC-1 asked to exempt `*_rls.sql` from the "every file is journaled" rule.
// Deliberately NOT implemented as a suffix rule: the only two `_rls.sql` files
// in this directory — `0016_personal_info_rls.sql` and
// `0019_onboarding_status_rls.sql` — are genuine drizzle migrations, journaled
// at idx 16 and 19. A blanket suffix carve-out would let a merge drop either
// from the journal without the guard noticing, i.e. it would exempt exactly the
// class of file this guard exists to protect. The unjournaled RLS SQL lives
// under `supabase/migrations/` and is applied by `scripts/apply-rls.mjs`, which
// is a different directory and outside this guard's scope.
//
// If a genuinely non-journaled `.sql` ever needs to live here, add it to this
// list *with a reason*. An empty list is the correct state today.
export const UNJOURNALED_SQL_ALLOWLIST = Object.freeze([]);

/**
 * A strict JSON parser that reports duplicate keys instead of silently keeping
 * the last one. `JSON.parse` has no `object_pairs_hook` equivalent, and a regex
 * over the raw text cannot tell a key from a `"..."` value that looks like one.
 *
 * Returns `{ value, duplicates }`. `value` follows last-key-wins, identical to
 * `JSON.parse`; the caller cross-checks that equivalence so a bug in this parser
 * fails loudly rather than quietly changing what the guard sees.
 *
 * @param {string} text
 * @returns {{ value: unknown, duplicates: Array<{ path: string, key: string }> }}
 */
export function parseJsonReportingDuplicateKeys(text) {
  const duplicates = [];
  let i = 0;

  const fail = (msg) => {
    throw new SyntaxError(`${msg} at position ${i}`);
  };

  const skipWs = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) {
      i += 1;
    }
  };

  const parseString = () => {
    if (text[i] !== '"') fail('expected string');
    const start = i;
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        // Let the platform parser own escape semantics (\u, \n, ...) so this
        // parser cannot disagree with JSON.parse about string *values*.
        return JSON.parse(text.slice(start, i));
      }
      if (ch === '\n') fail('unterminated string');
      i += 1;
    }
    return fail('unterminated string');
  };

  const parseValue = (path) => {
    skipWs();
    const ch = text[i];
    if (ch === '{') {
      i += 1;
      const obj = {};
      const seen = new Set();
      skipWs();
      if (text[i] === '}') {
        i += 1;
        return obj;
      }
      for (;;) {
        skipWs();
        const key = parseString();
        if (seen.has(key)) {
          duplicates.push({ path: path || '$', key });
        }
        seen.add(key);
        skipWs();
        if (text[i] !== ':') fail('expected ":"');
        i += 1;
        // Last-key-wins, matching JSON.parse.
        obj[key] = parseValue(path ? `${path}.${key}` : key);
        skipWs();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return obj;
        }
        return fail('expected "," or "}"');
      }
    }
    if (ch === '[') {
      i += 1;
      const arr = [];
      skipWs();
      if (text[i] === ']') {
        i += 1;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(`${path}[${arr.length}]`));
        skipWs();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return arr;
        }
        return fail('expected "," or "]"');
      }
    }
    if (ch === '"') return parseString();
    // Numbers, true, false, null: hand the literal to JSON.parse.
    const start = i;
    while (i < text.length && !' \t\n\r,]}'.includes(text[i])) i += 1;
    if (i === start) fail('unexpected end of input');
    const literal = text.slice(start, i);
    try {
      return JSON.parse(literal);
    } catch {
      return fail(`invalid literal ${JSON.stringify(literal)}`);
    }
  };

  const value = parseValue('');
  skipWs();
  if (i !== text.length) fail('trailing content after JSON value');
  return { value, duplicates };
}

/** `0020_prep_relevance_score_pct` -> 20. Returns null when there is no numeric prefix. */
function tagPrefixIdx(tag) {
  const m = /^(\d+)_/.exec(tag);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Audit a drizzle migration journal against the migrations directory listing.
 *
 * @param {object} input
 * @param {string} input.journalText Raw contents of `meta/_journal.json`.
 * @param {string[]} input.sqlFileNames Base names of the `.sql` files in the migrations directory.
 * @returns {Array<{ check: string, message: string }>} Violations; empty means the tree is consistent.
 */
export function auditMigrationJournal({ journalText, sqlFileNames }) {
  const violations = [];
  const add = (check, message) => violations.push({ check, message });

  let parsed;
  try {
    parsed = parseJsonReportingDuplicateKeys(journalText);
  } catch (err) {
    add(CHECKS.JOURNAL_PARSE, `_journal.json is not valid JSON: ${err.message}`);
    return violations;
  }

  // Self-check: this parser must agree with the platform parser on the *value*.
  // If it ever diverges, the guard is measuring something other than what
  // drizzle will read, and that must be loud rather than silent.
  try {
    const canonical = JSON.parse(journalText);
    if (JSON.stringify(canonical) !== JSON.stringify(parsed.value)) {
      add(
        CHECKS.JOURNAL_PARSE,
        'internal error: the duplicate-key parser disagrees with JSON.parse about the journal value'
      );
      return violations;
    }
  } catch (err) {
    add(CHECKS.JOURNAL_PARSE, `_journal.json is not valid JSON: ${err.message}`);
    return violations;
  }

  for (const dup of parsed.duplicates) {
    add(
      CHECKS.DUPLICATE_KEY,
      `duplicate key "${dup.key}" inside a single JSON object at ${dup.path} — ` +
        'valid JSON, but every parser keeps only the last one, so the earlier value is lost. ' +
        'This is the signature of a merge that resolved a journal conflict by keeping both sides.'
    );
  }

  const journal = parsed.value;
  if (journal === null || typeof journal !== 'object' || Array.isArray(journal) || !Array.isArray(journal.entries)) {
    add(CHECKS.JOURNAL_PARSE, '_journal.json has no `entries` array');
    return violations;
  }

  const entries = journal.entries;
  for (const [position, entry] of entries.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      add(CHECKS.JOURNAL_PARSE, `entry at position ${position} is not an object`);
      return violations;
    }
    if (!Number.isInteger(entry.idx)) {
      add(CHECKS.JOURNAL_PARSE, `entry at position ${position} has a non-integer idx (${JSON.stringify(entry.idx)})`);
      return violations;
    }
    if (typeof entry.tag !== 'string' || entry.tag === '') {
      add(CHECKS.JOURNAL_PARSE, `entry idx ${entry.idx} has a missing or non-string tag`);
      return violations;
    }
  }

  // --- duplicate idx / duplicate tag -----------------------------------------
  const byIdx = new Map();
  const byTag = new Map();
  for (const entry of entries) {
    if (byIdx.has(entry.idx)) {
      add(
        CHECKS.DUPLICATE_IDX,
        `idx ${entry.idx} is claimed twice: "${byIdx.get(entry.idx)}" and "${entry.tag}". ` +
          'Two branches numbered a migration the same; renumber the later one.'
      );
    } else {
      byIdx.set(entry.idx, entry.tag);
    }
    if (byTag.has(entry.tag)) {
      add(CHECKS.DUPLICATE_TAG, `tag "${entry.tag}" appears twice in the journal (idx ${byTag.get(entry.tag)} and ${entry.idx})`);
    } else {
      byTag.set(entry.tag, entry.idx);
    }
  }

  // --- idx is dense and strictly increasing (AC-3) ---------------------------
  // Anchored to the first entry's idx rather than a hard-coded 0: this repo's
  // journal starts at idx 1 (`0001_initial_schema`), not drizzle's usual 0. What
  // matters is that the sequence has no gap and no repeat, so a number claimed
  // by two parallel branches cannot merge quietly.
  if (entries.length > 0) {
    const base = entries[0].idx;
    for (const [position, entry] of entries.entries()) {
      const expected = base + position;
      if (entry.idx !== expected) {
        add(
          CHECKS.IDX_SEQUENCE,
          `idx must be dense and strictly increasing by 1: entry at position ${position} ("${entry.tag}") ` +
            `has idx ${entry.idx}, expected ${expected}.`
        );
        // One report is enough — every later entry would be off by the same
        // amount and the cascade buries the actual break.
        break;
      }
    }
  }

  // --- idx agrees with the tag's own numeric prefix --------------------------
  // Catches a half-finished renumber: the file was renamed `0020_x` -> `0021_x`
  // and the tag updated, but the `idx` was left at 20 (or the reverse). Drizzle
  // orders by `idx` and resolves the file by `tag`, so the two disagreeing is a
  // real ordering bug, not a cosmetic one.
  for (const entry of entries) {
    const prefix = tagPrefixIdx(entry.tag);
    if (prefix === null) {
      add(CHECKS.IDX_PREFIX_MISMATCH, `tag "${entry.tag}" (idx ${entry.idx}) has no NNNN_ numeric prefix`);
    } else if (prefix !== entry.idx) {
      add(
        CHECKS.IDX_PREFIX_MISMATCH,
        `idx ${entry.idx} disagrees with its own tag prefix "${entry.tag}" (${prefix}) — ` +
          'a renumber that changed one but not the other.'
      );
    }
  }

  // --- journal <-> directory agreement (AC-1) --------------------------------
  const filesOnDisk = new Set(sqlFileNames);
  for (const entry of entries) {
    const expectedFile = `${entry.tag}.sql`;
    if (!filesOnDisk.has(expectedFile)) {
      add(
        CHECKS.MISSING_SQL,
        `journal entry idx ${entry.idx} names "${entry.tag}" but ${expectedFile} is not on disk — ` +
          'db:migrate would fail trying to read it.'
      );
    }
  }

  const journaledFiles = new Set([...byTag.keys()].map((tag) => `${tag}.sql`));
  const allowlist = new Set(UNJOURNALED_SQL_ALLOWLIST);
  for (const file of sqlFileNames) {
    if (journaledFiles.has(file) || allowlist.has(file)) continue;
    add(
      CHECKS.ORPHAN_SQL,
      `${file} is on disk but has no journal entry — drizzle's migrate() is journal-driven, ` +
        'so this migration would never run on a fresh database.'
    );
  }

  return violations;
}
