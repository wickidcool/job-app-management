-- UC-6: Resume Variant Generation

CREATE TYPE resume_variant_status AS ENUM ('draft', 'finalized');

CREATE TYPE resume_format AS ENUM (
  'chronological',
  'functional',
  'hybrid'
);

CREATE TYPE section_emphasis AS ENUM (
  'experience_heavy',
  'skills_heavy',
  'balanced'
);

CREATE TABLE resume_variants (
  id                    TEXT PRIMARY KEY,
  status                resume_variant_status NOT NULL DEFAULT 'draft',
  title                 TEXT NOT NULL,
  target_company        TEXT NOT NULL,
  target_role           TEXT NOT NULL,
  format                resume_format NOT NULL DEFAULT 'chronological',
  section_emphasis      section_emphasis NOT NULL DEFAULT 'balanced',

  -- Source references
  base_resume_id        TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  job_fit_analysis_id   TEXT,
  job_description_text  TEXT,
  job_description_url   TEXT,

  -- Selected content from catalog
  selected_bullets      JSONB NOT NULL DEFAULT '[]',
  selected_tech_tags    JSONB NOT NULL DEFAULT '[]',
  selected_themes       JSONB NOT NULL DEFAULT '[]',

  -- Section ordering and visibility
  section_order         JSONB NOT NULL DEFAULT '["summary","experience","skills","projects","education"]',
  hidden_sections       JSONB NOT NULL DEFAULT '[]',

  -- Generated content
  content               JSONB NOT NULL,

  -- ATS score (0-100, optional)
  ats_score             INTEGER,

  -- Revision tracking
  revision_history      JSONB NOT NULL DEFAULT '[]',

  -- Timestamps and versioning
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_resume_variants_status ON resume_variants(status);
CREATE INDEX idx_resume_variants_company ON resume_variants(target_company);
CREATE INDEX idx_resume_variants_created ON resume_variants(created_at DESC);
