-- Migration: 0022_catalog_diff_open_review_count.sql
-- Make catalog ambiguities raised on resume uploads reachable in the product (WIC-1428).
--
-- `catalog_diffs.status` was being asked to mean two independent things: "have the
-- changes been applied?" and "is there an ambiguity still outstanding?". On the
-- resume auto-apply path those genuinely diverge -- the changes ARE applied AND an
-- ambiguity IS outstanding -- and `approved` can only express the first. Because
-- `listDiffs` defaults to `status = 'pending'`, every `pending_review` item raised
-- on a resume upload was recorded and then listed to nobody.
--
-- This adds the second concept as its own column so the two stop fighting over one
-- enum. `open_review_count` is the number of `pending_review` items that still have
-- no user decision; the default list returns a diff when it is `pending` OR when it
-- has open review items, whatever its apply status.
--
-- Deliberately NOT done: leaving such a diff at `status = 'pending'` (the card's
-- option 1). `applyDiff` gates re-application on `status = 'pending'`, so that would
-- expose already-applied changes to a second `approve_all` -- and `company_catalog`
-- updates increment `application_count` non-idempotently -- plus a `reject_all` that
-- marks the row rejected without un-applying anything. Keeping `status` truthful
-- about the apply decision keeps that existing guard doing its job.

ALTER TABLE catalog_diffs
  ADD COLUMN IF NOT EXISTS open_review_count INTEGER NOT NULL DEFAULT 0;

-- Backfill. History must not suddenly flood the default list, so only rows that are
-- still `pending` carry their outstanding items forward; every row that already
-- reached a terminal status was dispositioned by the user under the old model and is
-- treated as reviewed (0). Pending rows are listed by the status arm anyway, so this
-- is about the column telling the truth rather than about what is visible today.
DO $$
DECLARE
  updated_pending INTEGER;
  updated_total   INTEGER;
BEGIN
  UPDATE catalog_diffs
     SET open_review_count = jsonb_array_length(pending_review)
   WHERE status = 'pending'
     AND jsonb_array_length(pending_review) > 0
     AND open_review_count = 0;
  GET DIAGNOSTICS updated_pending = ROW_COUNT;

  SELECT count(*) INTO updated_total FROM catalog_diffs;

  RAISE NOTICE 'WIC-1428 backfill: % of % catalog_diffs rows carried open review items forward; all other rows left at 0.',
    updated_pending, updated_total;
END $$;

-- Serves the `open_review_count > 0` arm of the default list. Partial, because the
-- overwhelming majority of rows are 0 and never need to be visited.
CREATE INDEX IF NOT EXISTS idx_catalog_diffs_open_review
  ON catalog_diffs(open_review_count)
  WHERE open_review_count > 0;
