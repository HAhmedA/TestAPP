-- Base schema to ensure core tables exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Surveys table
CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  name varchar NULL,
  json json NULL
);

-- Results table (uses postid to match existing code)
CREATE TABLE IF NOT EXISTS public.results (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  postid uuid NOT NULL,
  json json NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_results_postid ON public.results (postid);

