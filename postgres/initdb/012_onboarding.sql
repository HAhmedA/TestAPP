-- Onboarding completion tracking
-- Adds onboarding_completed flag to student_profiles so the
-- first-login modal is only shown once per account.

ALTER TABLE public.student_profiles
    ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
