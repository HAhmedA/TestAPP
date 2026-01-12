-- SRL Responses and Annotations Schema
-- This file creates tables for normalized SRL responses and cached annotations

-- Normalized individual responses (extracted from questionnaire_results.answers)
CREATE TABLE IF NOT EXISTS public.srl_responses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  questionnaire_id uuid NOT NULL REFERENCES public.questionnaire_results(id) ON DELETE CASCADE,
  concept_key varchar(50) NOT NULL,
  score smallint NOT NULL CHECK (score >= 1 AND score <= 5),
  submitted_at timestamptz NOT NULL,
  
  -- Ensure one score per concept per questionnaire
  CONSTRAINT unique_srl_response UNIQUE (questionnaire_id, concept_key)
);

-- Indexes for efficient time-windowed queries
CREATE INDEX IF NOT EXISTS idx_srl_responses_user_concept_time 
  ON public.srl_responses (user_id, concept_key, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_srl_responses_user_time 
  ON public.srl_responses (user_id, submitted_at DESC);

-- Cached annotations (recomputed after each submission)
CREATE TABLE IF NOT EXISTS public.srl_annotations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_key varchar(50) NOT NULL,
  time_window varchar(10) NOT NULL CHECK (time_window IN ('24h', '7d')),
  
  -- Statistics
  avg_score numeric(3,2),
  min_score smallint,
  max_score smallint,
  response_count int NOT NULL DEFAULT 0,
  
  -- Trend: improving, declining, stable_high, stable_avg, stable_low
  trend varchar(20) NOT NULL DEFAULT 'stable_avg',
  
  -- Is this concept inverted (e.g., anxiety: high = bad)
  is_inverted boolean NOT NULL DEFAULT false,
  
  -- Threshold tracking (need 3 responses for 24h, 3 distinct days for 7d)
  has_sufficient_data boolean NOT NULL DEFAULT false,
  distinct_day_count int,  -- Only used for 7d window
  
  -- Generated text for display
  annotation_text text NOT NULL,
  
  -- Full text for LLM/chatbot (includes full question title)
  annotation_text_llm text NOT NULL,
  
  -- Timestamps
  computed_at timestamptz NOT NULL DEFAULT now(),
  
  -- One annotation per user per concept per time window
  CONSTRAINT unique_srl_annotation UNIQUE (user_id, concept_key, time_window)
);

-- Index for fast chatbot lookups
CREATE INDEX IF NOT EXISTS idx_srl_annotations_user ON public.srl_annotations (user_id);
CREATE INDEX IF NOT EXISTS idx_srl_annotations_user_window ON public.srl_annotations (user_id, time_window);
