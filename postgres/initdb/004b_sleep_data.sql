-- Sleep Data Schema
-- Tables for sleep sessions, baselines, and computed judgments
-- Follows the pattern from 004_srl_annotations.sql

-- =============================================================================
-- SLEEP SESSIONS (Raw Data - one record per night)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sleep_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Session timing
  session_date date NOT NULL,
  bedtime timestamptz NOT NULL,
  wake_time timestamptz NOT NULL,
  
  -- Duration metrics (minutes)
  total_sleep_minutes int NOT NULL CHECK (total_sleep_minutes >= 0),
  time_in_bed_minutes int NOT NULL CHECK (time_in_bed_minutes >= 0),
  
  
  -- Interruptions
  awakenings_count int NOT NULL DEFAULT 0 CHECK (awakenings_count >= 0),
  awake_minutes int NOT NULL DEFAULT 0 CHECK (awake_minutes >= 0),
  
  -- Metadata
  is_simulated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- One session per user per date
  CONSTRAINT unique_sleep_session UNIQUE (user_id, session_date)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_sleep_sessions_user ON public.sleep_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sleep_sessions_user_date ON public.sleep_sessions (user_id, session_date DESC);

-- =============================================================================
-- SLEEP BASELINES (Rolling 7-day averages)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sleep_baselines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Duration baseline
  avg_total_sleep_minutes numeric(6,2) NOT NULL DEFAULT 420, -- 7h default
  
  -- Timing baseline (stored as decimal hours, e.g., 23.5 = 11:30 PM)
  avg_bedtime_hour numeric(4,2) NOT NULL DEFAULT 23.0,
  avg_wake_time_hour numeric(4,2) NOT NULL DEFAULT 7.0,
  
  
  -- Metadata
  sessions_count int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  
  -- One baseline per user
  CONSTRAINT unique_sleep_baseline UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_sleep_baselines_user ON public.sleep_baselines (user_id);

-- =============================================================================
-- SLEEP JUDGMENTS (Computed insights - multiple per session)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sleep_judgments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sleep_sessions(id) ON DELETE CASCADE,
  
  -- Judgment classification
  domain varchar(20) NOT NULL CHECK (domain IN ('duration', 'continuity', 'timing')),
  judgment_key varchar(50) NOT NULL,
  severity varchar(10) NOT NULL CHECK (severity IN ('ok', 'warning', 'poor')),
  
  -- Human-readable explanations
  explanation text NOT NULL,           -- Short explanation for UI
  explanation_llm text NOT NULL,       -- Detailed explanation for chatbot
  
  -- Metadata
  computed_at timestamptz NOT NULL DEFAULT now(),
  
  -- One judgment per domain per session
  CONSTRAINT unique_sleep_judgment UNIQUE (session_id, domain)
);

-- Indexes for chatbot lookups
CREATE INDEX IF NOT EXISTS idx_sleep_judgments_user ON public.sleep_judgments (user_id);
CREATE INDEX IF NOT EXISTS idx_sleep_judgments_session ON public.sleep_judgments (session_id);
CREATE INDEX IF NOT EXISTS idx_sleep_judgments_user_computed ON public.sleep_judgments (user_id, computed_at DESC);

-- =============================================================================
-- ADD SIMULATED PROFILE TO STUDENT PROFILES
-- =============================================================================
-- This column drives all data simulators for cross-source consistency
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS simulated_profile varchar(20) 
  CHECK (simulated_profile IN ('high_achiever', 'average', 'low_achiever'));

-- Set default for existing users without a profile
UPDATE public.student_profiles 
SET simulated_profile = 'average' 
WHERE simulated_profile IS NULL;
