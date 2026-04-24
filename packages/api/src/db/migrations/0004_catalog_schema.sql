-- Catalog enums
DO $$ BEGIN
  CREATE TYPE job_fit_category AS ENUM ('role', 'industry', 'seniority', 'work_style', 'uncategorized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tech_stack_category AS ENUM ('language', 'frontend', 'backend', 'database', 'cloud', 'devops', 'ai_ml', 'uncategorized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE metric_type AS ENUM ('percentage', 'currency', 'count', 'time', 'multiplier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE impact_category AS ENUM ('revenue', 'cost_savings', 'efficiency', 'team_leadership', 'user_growth', 'performance', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE change_action AS ENUM ('create', 'update', 'delete', 'merge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE diff_status AS ENUM ('pending', 'approved', 'rejected', 'partial', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Company catalog
CREATE TABLE IF NOT EXISTS company_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  normalized_name   TEXT NOT NULL UNIQUE,
  aliases           JSONB NOT NULL DEFAULT '[]',
  first_seen_at     TIMESTAMPTZ NOT NULL,
  application_count INTEGER NOT NULL DEFAULT 0,
  latest_status     app_status,
  latest_app_id     TEXT REFERENCES applications(id) ON DELETE SET NULL,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_company_catalog_normalized ON company_catalog(normalized_name);
CREATE INDEX IF NOT EXISTS idx_company_catalog_is_deleted ON company_catalog(is_deleted);

-- Job fit tags
CREATE TABLE IF NOT EXISTS job_fit_tags (
  id              TEXT PRIMARY KEY,
  tag_slug        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  category        job_fit_category NOT NULL DEFAULT 'uncategorized',
  aliases         JSONB NOT NULL DEFAULT '[]',
  source_ids      JSONB NOT NULL DEFAULT '[]',
  mention_count   INTEGER NOT NULL DEFAULT 0,
  needs_review    BOOLEAN NOT NULL DEFAULT FALSE,
  review_options  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_job_fit_tags_category ON job_fit_tags(category);
CREATE INDEX IF NOT EXISTS idx_job_fit_tags_needs_review ON job_fit_tags(needs_review) WHERE needs_review = TRUE;

-- Tech stack tags
CREATE TABLE IF NOT EXISTS tech_stack_tags (
  id                TEXT PRIMARY KEY,
  tag_slug          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  category          tech_stack_category NOT NULL DEFAULT 'uncategorized',
  aliases           JSONB NOT NULL DEFAULT '[]',
  source_ids        JSONB NOT NULL DEFAULT '[]',
  mention_count     INTEGER NOT NULL DEFAULT 0,
  version_mentioned TEXT,
  is_legacy         BOOLEAN NOT NULL DEFAULT FALSE,
  needs_review      BOOLEAN NOT NULL DEFAULT FALSE,
  review_options    JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tech_stack_tags_category ON tech_stack_tags(category);
CREATE INDEX IF NOT EXISTS idx_tech_stack_tags_needs_review ON tech_stack_tags(needs_review) WHERE needs_review = TRUE;

-- Quantified bullets
CREATE TABLE IF NOT EXISTS quantified_bullets (
  id                      TEXT PRIMARY KEY,
  source_type             TEXT NOT NULL,
  source_id               TEXT NOT NULL,
  raw_text                TEXT NOT NULL,
  action_verb             TEXT,
  metric_type             metric_type NOT NULL,
  metric_value            NUMERIC NOT NULL,
  metric_range            JSONB,
  is_approximate          BOOLEAN NOT NULL DEFAULT FALSE,
  secondary_metric_type   metric_type,
  secondary_metric_value  NUMERIC,
  impact_category         impact_category NOT NULL DEFAULT 'other',
  extracted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                 INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_quantified_bullets_source ON quantified_bullets(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_quantified_bullets_impact ON quantified_bullets(impact_category);

-- Recurring themes
CREATE TABLE IF NOT EXISTS recurring_themes (
  id                TEXT PRIMARY KEY,
  theme_slug        TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  aliases           JSONB NOT NULL DEFAULT '[]',
  occurrence_count  INTEGER NOT NULL DEFAULT 0,
  source_ids        JSONB NOT NULL DEFAULT '[]',
  example_excerpts  JSONB NOT NULL DEFAULT '[]',
  is_core_strength  BOOLEAN NOT NULL DEFAULT FALSE,
  is_historical     BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recurring_themes_is_core ON recurring_themes(is_core_strength) WHERE is_core_strength = TRUE;

-- Catalog change log (audit)
CREATE TABLE IF NOT EXISTS catalog_change_log (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  action          change_action NOT NULL,
  before_state    JSONB,
  after_state     JSONB,
  trigger_source  TEXT NOT NULL,
  trigger_id      TEXT,
  diff_id         TEXT,
  committed       BOOLEAN NOT NULL DEFAULT FALSE,
  committed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_change_log_entity ON catalog_change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_diff ON catalog_change_log(diff_id) WHERE diff_id IS NOT NULL;

-- Pending catalog diffs
CREATE TABLE IF NOT EXISTS catalog_diffs (
  id              TEXT PRIMARY KEY,
  trigger_source  TEXT NOT NULL,
  trigger_id      TEXT NOT NULL,
  summary         TEXT NOT NULL,
  changes         JSONB NOT NULL,
  pending_review  JSONB NOT NULL DEFAULT '[]',
  status          diff_status NOT NULL DEFAULT 'pending',
  user_decisions  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catalog_diffs_status ON catalog_diffs(status);
CREATE INDEX IF NOT EXISTS idx_catalog_diffs_trigger ON catalog_diffs(trigger_source, trigger_id);

-- Wikilink registry
CREATE TABLE IF NOT EXISTS wikilink_registry (
  id              TEXT PRIMARY KEY,
  link_text       TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(normalized_text, target_type)
);

CREATE INDEX IF NOT EXISTS idx_wikilink_registry_text ON wikilink_registry(normalized_text);
