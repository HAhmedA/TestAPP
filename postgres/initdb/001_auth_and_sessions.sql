-- Users and session storage
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for registration/login
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  email varchar(255) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- Link questionnaire results to users (each user can have many questionnaire results)
ALTER TABLE public.questionnaire_results
  ADD COLUMN IF NOT EXISTS user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT fk_questionnaire_results_user FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questionnaire_results_user ON public.questionnaire_results (user_id);

-- express-session store using connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

