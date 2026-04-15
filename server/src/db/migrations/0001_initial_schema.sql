-- Create application status enum
CREATE TYPE app_status AS ENUM (
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn'
);

-- Applications table
CREATE TABLE IF NOT EXISTS applications (
  id              TEXT PRIMARY KEY,
  job_title       TEXT NOT NULL,
  company         TEXT NOT NULL,
  url             TEXT,
  location        TEXT,
  salary_range    TEXT,
  status          app_status NOT NULL DEFAULT 'saved',
  cover_letter_id TEXT,
  resume_version_id TEXT,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         INTEGER NOT NULL DEFAULT 1
);

-- Status history table
CREATE TABLE IF NOT EXISTS status_history (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status     app_status,
  to_status       app_status NOT NULL,
  note            TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_company ON applications(company);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_updated_at ON applications(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_application ON status_history(application_id, changed_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
