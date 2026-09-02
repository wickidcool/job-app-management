// WIC-1963: the drizzle migration journal is *derivable*, so we generate it
// instead of committing it — which retires an entire conflict class.
//
// Why this is safe, and where the one real landmine is
// ----------------------------------------------------
// Every migration PR used to append an object to the same `entries` array in
// `meta/_journal.json`, so any two concurrent migration PRs conflicted by
// construction, and the "keep both" resolution silently dropped an entry more
// than once (WIC-236, WIC-930, and the WIC-1939 duplicate-`tag` shape).
//
// Read drizzle's runner (`node_modules/drizzle-orm/migrator.js` +
// `pg-core/dialect.js`) before touching this file. It reads the journal and,
// per entry **in array order**, applies `${tag}.sql` iff
// `lastAppliedCreatedAt < entry.when`. Concretely:
//
//   * `idx`  is **never read by execution.** `grep -n idx migrator.js` is empty.
//            It is decorative — we still emit it (tooling and humans read it) and
//            keep it equal to the file's numeric prefix, but nothing runs on it.
//   * `tag`  names the `.sql` file on disk. Must be unique and must resolve.
//   * `when` (a.k.a. `folderMillis`) **is** read: it is stored as
//            `drizzle.__drizzle_migrations.created_at` and is the *sole* key the
//            runner uses to decide "already applied?". It is NOT a cosmetic
//            timestamp.
//
// That last point is the landmine. Production's migrations table already holds
// `created_at` values equal to the historical `when`s below. So a generated
// journal MUST reproduce each historical `when` **exactly**:
//   - make an already-applied migration's `when` *larger* than the stored
//     watermark and drizzle RE-RUNS it (a bare `CREATE TABLE` then errors, or
//     worse, a data migration runs twice);
//   - make a new migration's `when` *smaller* than the watermark and drizzle
//     SKIPS it forever (schema drift, no error).
// Neither surfaces as a conflict or a failed parse. This is why `when` cannot be
// invented from a directory listing, an ordinal, or a file mtime — the historical
// values are real, irregular, and already committed to production state. We
// freeze them here and derive only *new* migrations' `when` as a strictly
// increasing extension of the last known value.

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** drizzle journal schema version + dialect for this project (postgres, v7). */
export const JOURNAL_VERSION = '7';
export const JOURNAL_DIALECT = 'postgresql';
/** Every migration in this repo has run with breakpoints enabled. */
export const DEFAULT_BREAKPOINTS = true;

/**
 * Gap between generated `when` values for migrations that are NOT in the frozen
 * historical set. Any positive integer works — drizzle only ever compares `when`
 * with `<`, never does arithmetic on it — but 1000 keeps generated values
 * readable as "one notch past the previous migration".
 */
export const WHEN_STEP = 1000;

/**
 * Frozen `when` (folderMillis) for every migration that has ever been applied to
 * a real database. These MUST equal what `drizzle.__drizzle_migrations.created_at`
 * already contains, so the applied/skip watermark is byte-for-byte unchanged.
 *
 * ⛔ NEVER edit or reorder an existing value. Doing so re-runs or skips a
 * migration in production with no error. This map is append-only in spirit, but
 * you should not even need to append to it: a brand-new migration is picked up
 * automatically as `previousWhen + WHEN_STEP` (see {@link buildJournalEntries}).
 * Add an entry here only to *freeze* a value you want pinned forever; if you do,
 * it must be strictly greater than the current maximum below.
 */
export const HISTORICAL_WHEN: Readonly<Record<string, number>> = Object.freeze({
  '0001_initial_schema': 1713196800000,
  '0002_resumes_schema': 1713283200000,
  '0003_projects_schema': 1713369600000,
  '0004_catalog_schema': 1745529600000,
  '0005_cover_letters_schema': 1745616000000,
  '0006_cover_letters_emphasis': 1745769600000,
  '0007_extended_application_fields': 1777390404000,
  '0008_resume_variants': 1777395208000,
  '0009_interview_prep': 1777421247000,
  '0010_job_description': 1777561920000,
  '0011_add_user_id_multi_tenancy': 1777587858000,
  '0012_onboarding_status': 1777591458000,
  '0013_personal_info': 1777595058000,
  '0014_fix_personal_info_schema': 1777598658000,
  '0015_onboarding_personal_info_step': 1777602258000,
  '0016_personal_info_rls': 1777605858000,
  '0017_enforce_userid_not_null': 1777609458000,
  '0018_resume_content_hash': 1777613058000,
  '0019_onboarding_status_rls': 1777616658000,
  '0020_prep_relevance_score_pct': 1777620258000,
});

/** `0020_prep_relevance_score_pct.sql` -> `0020_prep_relevance_score_pct`. */
export function tagFromFileName(fileName: string): string {
  return fileName.replace(/\.sql$/, '');
}

/** `0020_prep_relevance_score_pct` -> 20, or null when there is no NNNN_ prefix. */
export function prefixOf(tag: string): number | null {
  const m = /^(\d+)_/.exec(tag);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Build the ordered journal entries from a list of `.sql` file names.
 *
 * Pure: no filesystem, no clock, no randomness — the same file list always
 * yields the same journal, which is what makes a generated (uncommitted) journal
 * safe to reproduce in CI, in the deploy's migrate step, and in tests.
 *
 * Ordering and numbering rules (all violations throw, loudly, at generate time —
 * which is exactly where a same-number collision between two branches now
 * surfaces, instead of as a silently dropped journal entry after a merge):
 *   - files are sorted by their numeric prefix;
 *   - `idx` is dense and 1-based, and MUST equal the file's own numeric prefix
 *     (a gap or a same-number collision makes these disagree → throw);
 *   - `when` is the frozen historical value when known, else the previous
 *     entry's `when` + {@link WHEN_STEP}; the sequence must be strictly
 *     increasing (guaranteed by construction, asserted defensively).
 *
 * @throws {Error} on a missing/duplicate prefix, a non-dense idx, or a
 *   non-monotonic `when` — every one of these is a real migration-set bug.
 */
export function buildJournalEntries(sqlFileNames: readonly string[]): JournalEntry[] {
  const tags = sqlFileNames
    .filter((name) => name.endsWith('.sql'))
    .map(tagFromFileName)
    .sort((a, b) => {
      const pa = prefixOf(a);
      const pb = prefixOf(b);
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      // No prefix, or equal prefix: fall back to a stable string order so the
      // result is deterministic even for a malformed set (which then throws below).
      return a < b ? -1 : a > b ? 1 : 0;
    });

  const entries: JournalEntry[] = [];
  let prevWhen = Number.NEGATIVE_INFINITY;

  tags.forEach((tag, position) => {
    const idx = position + 1;
    const prefix = prefixOf(tag);
    if (prefix === null) {
      throw new Error(
        `Migration "${tag}.sql" has no NNNN_ numeric prefix; cannot place it in the journal.`
      );
    }
    if (prefix !== idx) {
      // Same-number collision (two files share a prefix) and gaps both land here:
      // in sorted order the running position no longer equals the file's own
      // number. This is the WIC-1939 "two branches claimed the same migration
      // number" case, now caught before it can be applied.
      throw new Error(
        `Migration numbering is not dense: "${tag}.sql" sits at ordinal ${idx} but its ` +
          `filename prefix is ${prefix}. Two migrations likely claimed the same number, or a ` +
          `number was skipped. Renumber so the prefixes are 0001, 0002, … with no gap or repeat.`
      );
    }

    const historical = HISTORICAL_WHEN[tag];
    const when =
      historical ?? (prevWhen === Number.NEGATIVE_INFINITY ? WHEN_STEP : prevWhen + WHEN_STEP);
    if (when <= prevWhen) {
      // Only reachable if HISTORICAL_WHEN were edited to be non-increasing.
      throw new Error(
        `Journal "when" must be strictly increasing, but "${tag}" resolved to ${when} which is ` +
          `not greater than the previous entry's ${prevWhen}. Check HISTORICAL_WHEN.`
      );
    }
    prevWhen = when;

    entries.push({ idx, version: JOURNAL_VERSION, when, tag, breakpoints: DEFAULT_BREAKPOINTS });
  });

  return entries;
}

/** Build the full journal object (what `meta/_journal.json` should contain). */
export function buildJournal(sqlFileNames: readonly string[]): Journal {
  return {
    version: JOURNAL_VERSION,
    dialect: JOURNAL_DIALECT,
    entries: buildJournalEntries(sqlFileNames),
  };
}

/** Serialize a journal exactly as drizzle-kit writes it (2-space indent, trailing newline). */
export function serializeJournal(journal: Journal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}
