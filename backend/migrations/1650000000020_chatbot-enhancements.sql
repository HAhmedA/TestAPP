-- Migration: chatbot-enhancements
-- Adds chatbot_preferences table (persona settings + data version tracking)
-- Adds greeting_generated_at to chat_sessions (stale greeting detection)

-- New table: chatbot_preferences
CREATE TABLE IF NOT EXISTS public.chatbot_preferences (
    user_id              UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    response_length      VARCHAR(10) NOT NULL DEFAULT 'medium'
                             CHECK (response_length IN ('short', 'medium', 'long')),
    tone                 VARCHAR(15) NOT NULL DEFAULT 'friendly'
                             CHECK (tone IN ('friendly', 'formal', 'motivational', 'neutral')),
    answer_style         VARCHAR(10) NOT NULL DEFAULT 'mixed'
                             CHECK (answer_style IN ('bullets', 'prose', 'mixed')),
    data_last_updated_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_preferences_user
    ON public.chatbot_preferences (user_id);

-- New column on chat_sessions for stale-greeting detection
ALTER TABLE public.chat_sessions
    ADD COLUMN IF NOT EXISTS greeting_generated_at TIMESTAMPTZ;

-- Backfill existing cached greetings (approximate: session created_at)
UPDATE public.chat_sessions
SET greeting_generated_at = created_at
WHERE initial_greeting IS NOT NULL AND greeting_generated_at IS NULL;
