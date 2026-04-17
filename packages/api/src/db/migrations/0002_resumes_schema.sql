-- Resumes table
CREATE TABLE IF NOT EXISTS resumes (
  id              TEXT PRIMARY KEY,
  file_name       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  mime_type       TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         INTEGER NOT NULL DEFAULT 1
);

-- Resume exports table
CREATE TABLE IF NOT EXISTS resume_exports (
  id              TEXT PRIMARY KEY,
  resume_id       TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  export_type     TEXT NOT NULL DEFAULT 'star_markdown',
  file_path       TEXT NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resumes_uploaded_at ON resumes(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_exports_resume_id ON resume_exports(resume_id, generated_at DESC);
