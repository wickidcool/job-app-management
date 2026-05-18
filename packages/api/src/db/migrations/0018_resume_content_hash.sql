-- Add content hash column to resumes table for duplicate detection
-- SHA-256 hash of file content, unique per user

ALTER TABLE resumes
ADD COLUMN content_hash TEXT;

-- Unique constraint per user to prevent duplicate uploads
CREATE UNIQUE INDEX idx_resumes_user_content_hash
ON resumes (user_id, content_hash)
WHERE content_hash IS NOT NULL;
