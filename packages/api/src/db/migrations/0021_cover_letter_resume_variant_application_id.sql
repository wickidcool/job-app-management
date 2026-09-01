-- Migration: 0022_cover_letter_resume_variant_application_id.sql
-- WIC-1544 — record the application a cover letter / resume variant was written for.
--
-- The defect. Both tables carry `target_company` and `target_role` and nothing
-- else tying them to the application that prompted them. The web app collects
-- the association (`CoverLetterGenerator` takes an `applicationId` prop) and
-- throws it away: the generate route's Zod object is `.strict()` with no such
-- key, so the id could not even be sent. WIC-1533 shipped the entry point by
-- *reconstructing* the link client-side from `(target_company, target_role)`,
-- which is exactly as precise as that pair — and the pair is not unique. Two
-- applications for the same role at the same company are indistinguishable, a
-- ceiling pinned as an explicit test in `packages/web/src/constants/
-- coverLetterMatch.test.ts`. It is not liftable from the web side.
--
-- Numbering. 0020 is claimed by three open PRs (#238, #244, #249) and 0021 by
-- #261, so this takes 0022 to avoid a fourth filename collision. Drizzle
-- resolves migrations by the `tag` in `meta/_journal.json`, not by the numeric
-- prefix, so the gap is cosmetic if any of those land out of order.
--
-- Nullable, and deliberately not backfilled. Every existing row predates the
-- association, and the only way to guess one is the (company, role) heuristic
-- the web already applies — which would write a *wrong* id wherever that
-- heuristic is ambiguous, replacing an honest "best match" with a false record
-- of fact. NULL means "we do not know", which is true. AC-4.
--
-- ON DELETE SET NULL, not CASCADE. A cover letter is the user's writing; it
-- outlives the application it was aimed at. Deleting the application drops the
-- association and keeps the letter. AC-5.

-- Idempotent (WIC-930): IF NOT EXISTS so a CI/prod replay is a safe no-op.
ALTER TABLE cover_letters
ADD COLUMN IF NOT EXISTS application_id TEXT;

ALTER TABLE resume_variants
ADD COLUMN IF NOT EXISTS application_id TEXT;

-- `ADD CONSTRAINT` has no IF NOT EXISTS in Postgres, so guard on the catalog to
-- keep the replay a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cover_letters_application_id_fkey'
  ) THEN
    ALTER TABLE cover_letters
      ADD CONSTRAINT cover_letters_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resume_variants_application_id_fkey'
  ) THEN
    ALTER TABLE resume_variants
      ADD CONSTRAINT resume_variants_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The filter this column exists to serve is an equality lookup on a column that
-- is NULL for every pre-existing row, so index only the rows that have one.
CREATE INDEX IF NOT EXISTS idx_cover_letters_application
ON cover_letters (application_id)
WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resume_variants_application
ON resume_variants (application_id)
WHERE application_id IS NOT NULL;
