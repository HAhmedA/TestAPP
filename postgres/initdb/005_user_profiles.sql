-- User profiles table (1:1 relationship with users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY,
  edu_level varchar(50) NULL, -- Bachelor's, Master's, PhD, Post Doc
  field_of_study varchar(255) NULL, -- Broad category (e.g., Engineering & Technology)
  major varchar(255) NULL, -- Specific major (e.g., Civil Engineering)
  learning_formats jsonb NULL, -- Array of strings: ["Reading", "Listening", "Watching", etc.]
  disabilities jsonb NULL, -- Structured JSON storing category and specific issues
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_field_of_study ON public.user_profiles (field_of_study);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON public.user_profiles (updated_at);

-- Example structure for disabilities JSONB:
-- {
--   "Reading Disabilities": ["Dyslexia", "Hyperlexia"],
--   "Attention & Focus Disorders": ["ADHD"]
-- }
--
-- Example structure for learning_formats JSONB:
-- ["Reading", "Listening", "Watching"]


