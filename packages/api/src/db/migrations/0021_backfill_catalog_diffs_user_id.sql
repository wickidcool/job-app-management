-- Migration: 0020_backfill_catalog_diffs_user_id.sql
-- WIC-1408 — recover the owner of `catalog_diffs` rows that
-- `POST /api/catalog/generate-diff` persisted with `user_id` NULL.
--
-- Why the rows exist. Until WIC-1373 (#132) the route called
-- `processCatalogChange` with no `metadata`, so the diff row it wrote took the
-- `userId ?? null` branch with `userId` undefined. Migration 0017 backfilled the
-- NULLs that existed *at that moment* to the placeholder
-- `00000000-0000-0000-0000-000000000000` (step 1) but deliberately left
-- `catalog_diffs.user_id` nullable — the table is absent from step 2's
-- `SET NOT NULL` list, and `schema.ts` still declares the column nullable. So
-- every diff the route wrote *after* 0017 went in NULL again. `listDiffs`,
-- `getDiff` and `applyDiff` are all owner-scoped, which makes those rows
-- invisible to the user whose upload produced them.
--
-- Why they are recoverable. `trigger_id` names the row that triggered the diff —
-- `resumes.id` when `trigger_source = 'resume_upload'`, `applications.id` when it
-- is `'app_change'` — and that row carries the owner. All three id columns are
-- `text` and all three `user_id` columns are `uuid`, so the joins below need no
-- casts.
--
-- What this deliberately does NOT touch:
--
--   * A source row whose own `user_id` is NULL. `resumes.user_id` and
--     `applications.user_id` were never made NOT NULL (0011 added them, 0017 left
--     them alone), so an unowned source is possible. Copying NULL onto NULL is a
--     no-op anyway; the predicate states the intent.
--   * A source row carrying 0017's placeholder. That row is itself an orphan.
--     Copying the placeholder across would launder this diff into a row that no
--     longer *counts* as orphaned while remaining just as unreachable — the
--     census would go quiet without anything being recovered. Left NULL on
--     purpose, so it stays countable.
--   * A `trigger_id` with no surviving source row (the resume or application was
--     deleted). Nothing to recover from.
--   * `catalog_diffs` rows already carrying the placeholder. Those are 0017
--     step 1's own output — pre-0017 orphans, a different cause, out of scope
--     here. `scripts/census-catalog-diff-owners.mjs` counts them separately so
--     the decision about them stays visible rather than being made silently.
--
-- Safe on an empty set and safe to re-run: both statements are gated on
-- `user_id IS NULL`, so a second pass matches nothing. Run
-- `npm run census:catalog-diffs --workspace=@wic/api` against the target
-- database first if you want the population before it changes.

DO $$
DECLARE
  placeholder       uuid    := '00000000-0000-0000-0000-000000000000';
  from_resumes      integer := 0;
  from_applications integer := 0;
  still_unowned     integer := 0;
BEGIN
  UPDATE catalog_diffs d
     SET user_id = r.user_id
    FROM resumes r
   WHERE d.user_id IS NULL
     AND d.trigger_source = 'resume_upload'
     AND d.trigger_id = r.id
     AND r.user_id IS NOT NULL
     AND r.user_id <> placeholder;
  GET DIAGNOSTICS from_resumes = ROW_COUNT;

  UPDATE catalog_diffs d
     SET user_id = a.user_id
    FROM applications a
   WHERE d.user_id IS NULL
     AND d.trigger_source = 'app_change'
     AND d.trigger_id = a.id
     AND a.user_id IS NOT NULL
     AND a.user_id <> placeholder;
  GET DIAGNOSTICS from_applications = ROW_COUNT;

  SELECT count(*) INTO still_unowned FROM catalog_diffs WHERE user_id IS NULL;

  RAISE NOTICE 'WIC-1408 catalog_diffs owner backfill: % recovered via resumes, % via applications, % still unowned.',
    from_resumes, from_applications, still_unowned;
END $$;
