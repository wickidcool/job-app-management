-- Migration: 0028_variant_usage.sql
-- Create the `variant_usage` table for the Careerpin Free quota (WIC-2644,
-- parent WIC-2570). Enforces the Free plan's "3 resume variant generations per
-- month" from the live pricing page; Pro is unlimited and never reads this.
--
-- One row per (user, calendar month): `period` is the UTC month key 'YYYY-MM',
-- `count` the number of successful variant generations in that month. A surrogate
-- `id` PK plus a UNIQUE (user_id, period) index matches the dominant table
-- convention (every table keys on a TEXT id) and is the conflict target the
-- per-generation increment upserts onto. Counting generation *events* here rather
-- than live `resume_variants` rows is deliberate — deleting a variant must not
-- refund a used quota slot.
--
-- Idempotent throughout (`IF NOT EXISTS`, guarded FK, `DROP POLICY IF EXISTS`),
-- consistent with 0019/0025/0027 under drizzle's journal-driven migrator.

-- ── table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_usage (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  period      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One usage row per user per month. This is both the access path (the gate reads
-- "this user's row for the current period") and the conflict target for the
-- increment upsert, so it is a UNIQUE index rather than a plain one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_usage_user_period
  ON variant_usage (user_id, period);

-- ── FK to auth.users, matching every other user-scoped table ──────────────────
-- Guarded so the migration is idempotent (0019/0025/0027 pattern).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_variant_usage_user_id'
      AND table_name = 'variant_usage'
  ) THEN
    ALTER TABLE variant_usage
      ADD CONSTRAINT fk_variant_usage_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- The Worker reaches Postgres over the owner role (Hyperdrive in preview, the
-- transaction pooler in production), which bypasses RLS, so this does not change
-- the app's own queries — it closes the auto-generated PostgREST/anon-key surface,
-- matching every other user-scoped table.
ALTER TABLE variant_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS variant_usage_isolation ON variant_usage;

CREATE POLICY variant_usage_isolation ON variant_usage
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
