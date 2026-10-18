-- Migration: 0027_subscriptions.sql
-- Create the `subscriptions` table for the Careerpin Stripe tiered-signup build
-- (WIC-2641, parent WIC-2570). Stripe test mode only — this is schema, not keys.
--
-- One row per user: `user_id` is UNIQUE, so a user has exactly one subscription
-- record mirroring their Stripe subscription. `status` carries the Stripe
-- subscription lifecycle verbatim; `plan_tier` is the entitlement band the app
-- reads through `getEntitlement` (services/entitlement.service.ts), which returns
-- 'pro' iff `status IN ('trialing','active')`.
--
-- Enums (`subscription_status`, `plan_tier`) rather than TEXT + CHECK: both value
-- sets are closed and owned by us, and they back the typed `SubscriptionStatus` /
-- `PlanTier` schema exports. This matches the dominant table convention
-- (app_status, onboarding_step, …); the TEXT+CHECK form in 0025 was chosen only
-- because `recommendation` is a wire value `FitTier` is defined in terms of.
--
-- Idempotent throughout (guarded `CREATE TYPE`, `IF NOT EXISTS`, guarded FK,
-- `DROP POLICY IF EXISTS`), consistent with 0012/0019/0025 under drizzle's
-- journal-driven migrator.

-- ── enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'paused',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE plan_tier AS ENUM (
    'free',
    'pro'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      TEXT PRIMARY KEY,
  user_id                 UUID NOT NULL UNIQUE,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  status                  subscription_status NOT NULL,
  plan_tier               plan_tier NOT NULL,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                 INTEGER NOT NULL DEFAULT 1
);

-- The entitlement lookup is "the subscription for this user", so the UNIQUE
-- index on user_id already serves it. A secondary index is intentionally
-- omitted; the UNIQUE constraint covers the only access path.

-- ── FK to auth.users, matching every other user-scoped table ──────────────────
-- Guarded so the migration is idempotent (0019/0025 pattern).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_subscriptions_user_id'
      AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT fk_subscriptions_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- The Worker reaches Postgres over the owner role (Hyperdrive in preview, the
-- transaction pooler in production), which bypasses RLS, so this does not change
-- the app's own queries — it closes the auto-generated PostgREST/anon-key surface,
-- matching every other user-scoped table.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_isolation ON subscriptions;

CREATE POLICY subscriptions_isolation ON subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
