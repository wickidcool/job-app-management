-- Migration: 0020_prep_relevance_score_pct.sql
-- Rename interview_prep_stories.relevance_score -> relevance_score_pct (WIC-1520, ADR-008 §4).
--
-- `relevanceScore` named two different populations: the job-fit / resume-variant
-- one is a ratio in [0,1] (the accepted UC-3 definition), and this one is a 0-100
-- integer. ADR-008 puts ratios at the API boundary and requires a deviating field
-- to carry the unit in its NAME. This population is renamed rather than converted:
-- it is persisted as INTEGER and produced by a prompt asking for a 0-100 integer,
-- so converting would mean a column type change plus a value backfill, whose
-- failure modes are strictly worse than the naming problem.
--
-- RENAME COLUMN moves no data. Every existing row keeps its integer unchanged, and
-- the NOT NULL constraint travels with the column.
--
-- Hand-written, in this repo's house style. `drizzle-kit generate` cannot run here:
-- meta/0001_snapshot.json is an empty stub ("tables": {}) declaring version "7",
-- which the installed drizzle-kit (v0.21.4) rejects as unsupported, and none of the
-- 19 preceding migrations carry drizzle's `--> statement-breakpoint` marker. The
-- meta/_journal.json entry (idx 20) is maintained by hand for the same reason, per
-- the convention established by WIC-930 / WIC-933.

-- Gated on the OLD column still being present, so re-running this migration against
-- an already-renamed database is a strict no-op rather than an error. Without the
-- guard, a second run raises `column "relevance_score" does not exist`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_prep_stories'
      AND column_name = 'relevance_score'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_prep_stories'
      AND column_name = 'relevance_score_pct'
  ) THEN
    ALTER TABLE interview_prep_stories RENAME COLUMN relevance_score TO relevance_score_pct;
  END IF;
END$$;
