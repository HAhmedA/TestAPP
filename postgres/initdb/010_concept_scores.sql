-- Concept Scores Schema
-- Stores aggregated 0-100 scores for each data domain (sleep, srl, lms, screen_time, social_media)
-- Replaces detailed bullet-point judgments with single scores for LLM consumption

-- =============================================================================
-- CONCEPT SCORES (One score per concept per user)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.concept_scores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Concept identification
  concept_id varchar(30) NOT NULL CHECK (concept_id IN ('sleep', 'srl', 'lms', 'screen_time', 'social_media')),
  
  -- Score (0-100 scale)
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  
  -- Trend compared to 7-day average
  trend varchar(20) CHECK (trend IN ('improving', 'declining', 'stable')),
  
  -- Individual aspect scores for debugging (e.g., {duration: {severity: 'ok', score: 1.0}, ...})
  aspect_breakdown jsonb NOT NULL DEFAULT '{}',
  
  -- Historical 7-day average for trend calculation
  avg_7d numeric(5,2),
  
  -- Metadata
  computed_at timestamptz NOT NULL DEFAULT now(),
  
  -- One score per user per concept
  CONSTRAINT unique_concept_score UNIQUE (user_id, concept_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_concept_scores_user ON public.concept_scores (user_id);
CREATE INDEX IF NOT EXISTS idx_concept_scores_user_concept ON public.concept_scores (user_id, concept_id);

-- =============================================================================
-- CONCEPT SCORE HISTORY (For tracking score changes over time)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.concept_score_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id varchar(30) NOT NULL,
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  score_date date NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  
  -- One score per user per concept per date
  CONSTRAINT unique_concept_score_history UNIQUE (user_id, concept_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_concept_score_history_user ON public.concept_score_history (user_id);
CREATE INDEX IF NOT EXISTS idx_concept_score_history_user_date ON public.concept_score_history (user_id, score_date DESC);
