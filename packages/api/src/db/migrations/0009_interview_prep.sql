-- UC-7: Interview Prep Pull

CREATE TYPE interview_type AS ENUM ('behavioral', 'technical', 'mixed', 'case_study');

CREATE TYPE prep_time AS ENUM ('30min', '1hr', '2hr', 'full_day');

CREATE TYPE confidence_level AS ENUM ('not_practiced', 'needs_work', 'comfortable', 'confident');

CREATE TYPE question_category AS ENUM (
  'behavioral',
  'technical',
  'situational',
  'role_specific',
  'gap_probing'
);

CREATE TYPE question_difficulty AS ENUM ('standard', 'challenging', 'tough');

CREATE TYPE gap_severity AS ENUM ('critical', 'moderate', 'minor');

CREATE TYPE mitigation_strategy AS ENUM (
  'acknowledge_pivot',
  'growth_mindset',
  'adjacent_experience'
);

CREATE TABLE interview_preps (
  id                    TEXT PRIMARY KEY,
  application_id        TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_fit_analysis_id   TEXT,
  interview_type        interview_type NOT NULL DEFAULT 'mixed',
  time_available        prep_time NOT NULL DEFAULT '1hr',
  focus_areas           JSONB NOT NULL DEFAULT '[]',
  completeness          INTEGER NOT NULL DEFAULT 0,
  generated_questions   JSONB NOT NULL DEFAULT '[]',
  gap_mitigations       JSONB NOT NULL DEFAULT '[]',
  quick_reference       JSONB,
  practice_log          JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1,
  UNIQUE (application_id)
);

CREATE TABLE interview_prep_stories (
  id                    TEXT PRIMARY KEY,
  interview_prep_id     TEXT NOT NULL REFERENCES interview_preps(id) ON DELETE CASCADE,
  star_entry_id         TEXT NOT NULL,
  themes                JSONB NOT NULL DEFAULT '[]',
  relevance_score       INTEGER NOT NULL,
  one_min_version       TEXT NOT NULL,
  two_min_version       TEXT NOT NULL,
  five_min_version      TEXT NOT NULL,
  is_favorite           BOOLEAN NOT NULL DEFAULT FALSE,
  personal_notes        TEXT,
  practice_count        INTEGER NOT NULL DEFAULT 0,
  last_practiced_at     TIMESTAMPTZ,
  confidence_level      confidence_level NOT NULL DEFAULT 'not_practiced',
  display_order         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prep_question_story_links (
  id                    TEXT PRIMARY KEY,
  question_id           TEXT NOT NULL,
  story_id              TEXT NOT NULL REFERENCES interview_prep_stories(id) ON DELETE CASCADE,
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  match_score           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_preps_application ON interview_preps(application_id);
CREATE INDEX idx_interview_preps_created ON interview_preps(created_at DESC);
CREATE INDEX idx_interview_prep_stories_prep ON interview_prep_stories(interview_prep_id);
CREATE INDEX idx_interview_prep_stories_star ON interview_prep_stories(star_entry_id);
CREATE INDEX idx_prep_question_story_links_story ON prep_question_story_links(story_id);
