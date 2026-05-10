-- Add 'personal_info' to onboarding_step enum
ALTER TYPE onboarding_step ADD VALUE IF NOT EXISTS 'personal_info' AFTER 'welcome';

-- Add personal info step tracking columns to onboarding_status
ALTER TABLE onboarding_status
ADD COLUMN IF NOT EXISTS personal_info_step_completed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS personal_info_step_skipped BOOLEAN NOT NULL DEFAULT false;
