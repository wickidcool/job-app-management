-- UC-5: Add extended application tracking fields
-- US-5.1: contact, US-5.2: compTarget, US-5.3: nextAction, US-5.4: nextActionDue

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS contact text,
  ADD COLUMN IF NOT EXISTS comp_target text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_action_due date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_contact_length') THEN
    ALTER TABLE applications ADD CONSTRAINT applications_contact_length
      CHECK (contact IS NULL OR length(contact) <= 200);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_next_action_length') THEN
    ALTER TABLE applications ADD CONSTRAINT applications_next_action_length
      CHECK (next_action IS NULL OR length(next_action) <= 500);
  END IF;
END $$;

-- Partial index for needs-action report
CREATE INDEX IF NOT EXISTS idx_applications_next_action_due
  ON applications (next_action_due)
  WHERE next_action_due IS NOT NULL;

-- Partial index for stale report
CREATE INDEX IF NOT EXISTS idx_applications_stale
  ON applications (status, updated_at)
  WHERE status IN ('applied', 'phone_screen');
