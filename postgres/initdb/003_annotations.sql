-- Annotations table for storing SRL survey annotations
CREATE TABLE IF NOT EXISTS public.annotations (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id uuid NOT NULL,
  survey_id uuid NOT NULL,
  period varchar(50) NOT NULL, -- 'today' or '7days'
  construct_name varchar(255) NOT NULL,
  construct_title varchar(500) NOT NULL,
  annotation_text text NOT NULL,
  statistics jsonb NOT NULL, -- Stores min, max, average, trend, etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_annotations_user FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_annotations_survey FOREIGN KEY (survey_id)
    REFERENCES public.surveys(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_survey_period_construct UNIQUE (user_id, survey_id, period, construct_name)
);

CREATE INDEX IF NOT EXISTS idx_annotations_user_survey ON public.annotations (user_id, survey_id);
CREATE INDEX IF NOT EXISTS idx_annotations_period ON public.annotations (period);
CREATE INDEX IF NOT EXISTS idx_annotations_created_at ON public.annotations (created_at);


