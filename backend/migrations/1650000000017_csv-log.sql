-- CSV Log Upload Schema
-- Stores uploaded Moodle activity log CSVs and persistent name→user mappings.

-- =============================================================================
-- CSV LOG UPLOADS (one row per uploaded file)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.csv_log_uploads (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploaded_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename         text NOT NULL,
  csv_content      text NOT NULL,
  row_count        int  NOT NULL DEFAULT 0,
  date_range_start date NULL,
  date_range_end   date NULL,
  status           text NOT NULL DEFAULT 'pending',
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  imported_at      timestamptz NULL,

  CONSTRAINT csv_log_uploads_status_check CHECK (status IN ('pending', 'imported', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_csv_log_uploads_admin
  ON public.csv_log_uploads (uploaded_by, uploaded_at DESC);

-- =============================================================================
-- CSV PARTICIPANT ALIASES (persistent name → user mapping)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.csv_participant_aliases (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  csv_name   text NOT NULL,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT csv_participant_aliases_name_unique UNIQUE (csv_name)
);

CREATE INDEX IF NOT EXISTS idx_csv_participant_aliases_user
  ON public.csv_participant_aliases (user_id);
