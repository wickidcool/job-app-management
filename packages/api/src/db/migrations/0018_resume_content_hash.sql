-- Add content hash column to resumes table for duplicate detection
-- SHA-256 hash of file content, unique per user

-- Idempotent (WIC-930): IF NOT EXISTS so a CI/prod replay is a safe no-op.
ALTER TABLE resumes
ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Unique constraint per user to prevent duplicate uploads
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_user_content_hash
ON resumes (user_id, content_hash)
WHERE content_hash IS NOT NULL;
