-- WIC-187: Add job_description column to applications table
-- Stores the full job posting text for reference and cover letter generation

ALTER TABLE applications
  ADD COLUMN job_description text;

-- No length constraint - job descriptions can be quite long (10k+ chars)
