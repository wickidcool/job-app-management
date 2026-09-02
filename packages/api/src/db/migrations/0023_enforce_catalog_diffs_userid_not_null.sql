-- Migration: 0023_enforce_catalog_diffs_userid_not_null.sql
-- WIC-1604 — finish what 0017 started on `catalog_diffs.user_id`.
--
-- The gap. `0017_enforce_userid_not_null.sql` has two relevant steps. Step 1
-- backfills NULL `user_id` to the placeholder `00000000-0000-0000-0000-000000000000`
-- on seven tables; step 2 applies `SET NOT NULL` to six of them. `catalog_diffs`
-- is in the first list (`0017:22`) and absent from the second (`0017:29`-`:34`) —
-- the only one of the seven omitted. `schema.ts` agreed, declaring the column
-- nullable. So the table *looks* migrated: its historical NULLs were cleaned up,
-- but nothing stopped new ones, and `processCatalogChange` wrote
-- `userId ?? null` on every ownerless event. The cleanup was undone at runtime,
-- silently.
--
-- Why the omission was not harmless. `listDiffs`, `getDiff` and `applyDiff` all
-- scope with `eq(catalog_diffs.user_id, <caller>)`, and a NULL never equals
-- anything — so a NULL-owner row is invisible to every *owned* reader. The only
-- caller that could see one is an unscoped anonymous reader, which applies no
-- owner predicate at all. An ownerless diff row was therefore never "kept for
-- later": it was unreachable by its rightful owner and reachable only through
-- the fail-open path WIC-1638 exists to close. The write side is fixed in the
-- same commit as this migration, so no new NULLs arrive after it.
--
-- Ordering matters, and this migration is deliberately numbered after 0021.
-- `0021_backfill_catalog_diffs_user_id.sql` (WIC-1408) recovers the *real* owner
-- of these rows by joining `trigger_id` back to `resumes` / `applications`. This
-- migration sweeps whatever is left to the placeholder, which is irreversible:
-- once a row reads `00000000-…-0` its true owner can no longer be inferred.
-- Running this before 0021 would therefore destroy recoverable ownership. Run
-- `npm run census:catalog-diffs --workspace=@wic/api` first if you want the
-- population before it changes; the notice below reports it either way.
--
-- One cohort is knowingly given up. 0020 deliberately leaves NULL those rows
-- whose source row was deleted, or whose source row is itself unowned, so they
-- stay countable — the second becomes recoverable if that resume or application
-- ever gets an owner. `SET NOT NULL` ends that option: they become placeholder
-- rows, indistinguishable from 0017 step 1's own output. That is the stated
-- cost of making the column honest, and the notice prints the count being
-- converted so the number is on the record rather than inferred.
--
-- Idempotent: the UPDATE is gated on `user_id IS NULL`, so a second pass matches
-- nothing, and `SET NOT NULL` on an already-NOT NULL column is a no-op.

DO $$
DECLARE
  placeholder   uuid    := '00000000-0000-0000-0000-000000000000';
  before_count  integer := 0;
  swept         integer := 0;
  after_count   integer := 0;
BEGIN
  SELECT count(*) INTO before_count FROM catalog_diffs WHERE user_id IS NULL;

  UPDATE catalog_diffs SET user_id = placeholder WHERE user_id IS NULL;
  GET DIAGNOSTICS swept = ROW_COUNT;

  SELECT count(*) INTO after_count FROM catalog_diffs WHERE user_id IS NULL;

  RAISE NOTICE 'WIC-1604 catalog_diffs.user_id: % NULL before, % swept to the placeholder, % NULL after.',
    before_count, swept, after_count;

  IF after_count <> 0 THEN
    RAISE EXCEPTION 'WIC-1604: % catalog_diffs rows still have a NULL user_id after the backfill; refusing to add NOT NULL.', after_count;
  END IF;
END $$;

ALTER TABLE catalog_diffs ALTER COLUMN user_id SET NOT NULL;
