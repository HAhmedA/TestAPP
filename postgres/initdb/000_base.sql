-- Base schema to ensure core tables exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Surveys table
CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  name varchar NULL,
  json jsonb NULL
);

-- Questionnaire Results table (uses postid to match existing code)
CREATE TABLE IF NOT EXISTS public.questionnaire_results (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  postid uuid NOT NULL,
  answers jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_questionnaire_results_postid ON public.questionnaire_results (postid);

-- GIN indexes for JSONB columns (enables fast nested field queries)
CREATE INDEX IF NOT EXISTS idx_surveys_json ON public.surveys USING GIN (json);
CREATE INDEX IF NOT EXISTS idx_questionnaire_results_answers ON public.questionnaire_results USING GIN (answers);

