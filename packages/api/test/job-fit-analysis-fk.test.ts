// `job_fit_analysis_id` is a real foreign key — WIC-1652 AC-4, ADR-012.
//
// `docs/architecture/DATA_MODEL.md:981` has specified
// `job_fit_analysis_id TEXT REFERENCES job_fit_analyses(id) ON DELETE SET NULL`
// since UC-7 was written, and lists the relationship in its index — but the
// referent table was never built, so four tables shipped the column as bare
// `TEXT` referencing nothing. That is what let an unvalidated request field be
// written straight into it.
//
// These assertions read the drizzle table objects rather than grepping the
// schema source, so a column that *looks* like it declares a reference but binds
// to the wrong table or the wrong action fails them.
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applications,
  coverLetters,
  interviewPreps,
  jobFitAnalyses,
  outreachMessages,
  resumeVariants,
} from '../src/db/schema.js';

/**
 * The four tables `DATA_MODEL.md` gives a `job_fit_analysis_id` column.
 *
 * Enumerated by hand from the schema and cross-checked below against a grep of
 * the column name, because the failure this card exists to close is an
 * enumeration that was one site short (WIC-1818 found five call sites where the
 * card said three).
 */
const REFERRERS = [
  { name: 'cover_letters', table: coverLetters },
  { name: 'resume_variants', table: resumeVariants },
  { name: 'outreach_messages', table: outreachMessages },
  { name: 'interview_preps', table: interviewPreps },
] as const;

const schemaSource = readFileSync(
  fileURLToPath(new URL('../src/db/schema.ts', import.meta.url)),
  'utf8'
);

/**
 * Resolved from the journal by name, not by number. This migration gets
 * renumbered whenever another branch lands first and claims the index (which is
 * the very collision the assertions below exist to catch), so pinning the
 * numeric prefix here would break this suite every time that happened.
 */
const JOB_FIT_ANALYSES_TAG = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/db/migrations/meta/_journal.json', import.meta.url)),
      'utf8'
    )
  ) as { entries: { tag: string }[] }
).entries.find((e) => e.tag.endsWith('_job_fit_analyses'))!.tag;

const migration = readFileSync(
  fileURLToPath(new URL(`../src/db/migrations/${JOB_FIT_ANALYSES_TAG}.sql`, import.meta.url)),
  'utf8'
);

describe('job_fit_analyses table (AC-1)', () => {
  it('exists, and is the table DATA_MODEL.md names', () => {
    expect(getTableName(jobFitAnalyses)).toBe('job_fit_analyses');
  });

  it('is owned by a user and optionally by an application', () => {
    const { columns, foreignKeys } = getTableConfig(jobFitAnalyses);
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(byName['user_id']).toBeDefined();
    expect(byName['application_id']).toBeDefined();
    // Nullable on purpose: analysing a bare job description with no application
    // is a shipped flow, and NOT NULL here would reject it.
    expect(byName['application_id'].notNull).toBe(false);

    const appFk = foreignKeys
      .map((fk) => fk.reference())
      .find((r) => r.foreignTable === applications);
    expect(appFk, 'application_id must actually reference applications').toBeDefined();
    expect(appFk!.columns.map((c) => c.name)).toEqual(['application_id']);
  });

  it('scores and tiers are nullable together', () => {
    // `null` is the "unscored" result, not "not analysed". A NOT NULL
    // `fit_score` would force a 0 that reads as "0% match".
    const byName = Object.fromEntries(
      getTableConfig(jobFitAnalyses).columns.map((c) => [c.name, c])
    );
    expect(byName['recommendation'].notNull).toBe(false);
    expect(byName['fit_score'].notNull).toBe(false);
  });
});

describe('the four job_fit_analysis_id columns are real FKs (AC-4)', () => {
  it('the referrer list is exhaustive', () => {
    // Guards the enumeration itself: a fifth table gaining the column must fail
    // here rather than silently shipping without a constraint.
    const declared = schemaSource.match(/text\('job_fit_analysis_id'\)/g) ?? [];
    expect(declared).toHaveLength(REFERRERS.length);
  });

  for (const { name, table } of REFERRERS) {
    it(`${name}.job_fit_analysis_id references job_fit_analyses(id) ON DELETE SET NULL`, () => {
      const fks = getTableConfig(table).foreignKeys.filter((fk) =>
        fk.reference().columns.some((c) => c.name === 'job_fit_analysis_id')
      );

      expect(fks, `${name} declares no FK on job_fit_analysis_id`).toHaveLength(1);
      const ref = fks[0].reference();
      expect(ref.foreignTable).toBe(jobFitAnalyses);
      expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
      // `SET NULL`, not `CASCADE`: deleting an analysis must not delete the
      // cover letter that was generated with it.
      expect(fks[0].onDelete).toBe('set null');
    });
  }
});

describe('migration 0022 (AC-4)', () => {
  it('nulls every dangling referrer before adding any constraint', () => {
    // ORDER IS THE ASSERTION. Every existing value names an analysis that has
    // never existed, so `ADD CONSTRAINT` on real data fails unless the NULLing
    // ran first. A migration that passes on an empty preview database and
    // breaks on production is exactly what this pins.
    const addConstraint = migration.indexOf('ADD CONSTRAINT %I FOREIGN KEY (job_fit_analysis_id)');
    expect(addConstraint, 'migration must add the FK constraints').toBeGreaterThan(-1);

    for (const { name } of REFERRERS) {
      const nulling = migration.indexOf(`UPDATE ${name}`);
      expect(nulling, `migration must null dangling ${name}.job_fit_analysis_id`).toBeGreaterThan(
        -1
      );
      expect(migration.slice(nulling)).toMatch(
        new RegExp(`^UPDATE ${name}\\s+SET job_fit_analysis_id = NULL`)
      );
      expect(nulling).toBeLessThan(addConstraint);
    }
  });

  it('is registered in the drizzle journal, last, with the newest timestamp', () => {
    // A migration file the runner never reads is not a migration (WIC-1408) —
    // but registration alone is not enough here, and this assertion is the one
    // that caught a real silent skip.
    //
    // `drizzle-orm/pg-core/dialect.js:56` applies a migration only when
    // `Number(lastDbMigration.created_at) < migration.folderMillis`, comparing
    // against the *single newest* applied row. `created_at` is the journal's
    // `when`. So a migration whose `when` is not strictly greater than
    // everything already applied to the target database is **skipped in
    // silence** — `db:migrate` prints "Migrations complete." and exits 0.
    //
    // This is not hypothetical: the first cut of this migration was numbered
    // 0020 with `when: 1777620258000`, which collided exactly with PR #238's
    // `0020_backfill_catalog_diffs_user_id` and sat below PR #261's `0021`
    // (1777623858000). Both had already run against the shared preview
    // database, so this file never executed there and the deploy still went
    // green — caught only because `verify-rls.mjs` derives its table list from
    // the live schema and `job_fit_analyses` was missing from it.
    const journal = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../src/db/migrations/meta/_journal.json', import.meta.url)),
        'utf8'
      )
    ) as { entries: { idx: number; when: number; tag: string }[] };

    const entry = journal.entries.find((e) => e.tag === JOB_FIT_ANALYSES_TAG);
    expect(
      entry,
      `${JOB_FIT_ANALYSES_TAG} must be in _journal.json or db:migrate skips it`
    ).toBeDefined();
    expect(entry!.idx).toBe(Math.max(...journal.entries.map((e) => e.idx)));
    expect(entry!.when).toBe(Math.max(...journal.entries.map((e) => e.when)));
  });

  it('the journal has unique indices and strictly increasing timestamps', () => {
    // The general form of the same trap, for whoever adds 0023. Two branches
    // that each pick "the next number" produce a duplicate `idx` and, more
    // dangerously, a non-monotonic `when` — and the loser is skipped with no
    // error anywhere.
    const journal = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../src/db/migrations/meta/_journal.json', import.meta.url)),
        'utf8'
      )
    ) as { entries: { idx: number; when: number; tag: string }[] };

    const indices = journal.entries.map((e) => e.idx);
    expect(new Set(indices).size, 'duplicate idx in _journal.json').toBe(indices.length);

    const whens = journal.entries.map((e) => e.when);
    for (let i = 1; i < whens.length; i++) {
      expect(
        whens[i],
        `${journal.entries[i].tag} must have a later \`when\` than ${journal.entries[i - 1].tag}`
      ).toBeGreaterThan(whens[i - 1]);
    }
  });

  it('creates the table before it is referenced', () => {
    expect(migration.indexOf('CREATE TABLE IF NOT EXISTS job_fit_analyses')).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT %I FOREIGN KEY (job_fit_analysis_id)')
    );
  });
});
