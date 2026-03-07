// Chatbot Preferences Service
// Manages per-user persona settings (response_length, tone, answer_style)
// and data-version tracking for stale-greeting detection.

import pool from '../config/database.js'
import logger from '../utils/logger.js'

const VALID_LENGTHS = ['short', 'medium', 'long']
const VALID_TONES = ['friendly', 'formal', 'motivational', 'neutral']
const VALID_STYLES = ['bullets', 'prose', 'mixed']

const DEFAULT_PREFS = {
    response_length: 'medium',
    tone: 'friendly',
    answer_style: 'mixed'
}

// =============================================================================
// READ
// =============================================================================

/**
 * Returns preferences for a user. Inserts defaults if no row exists yet.
 */
export async function getPreferences(userId) {
    const { rows } = await pool.query(
        `INSERT INTO public.chatbot_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = chatbot_preferences.updated_at
         RETURNING response_length, tone, answer_style, data_last_updated_at`,
        [userId]
    )
    return rows[0]
}

// =============================================================================
// WRITE
// =============================================================================

/**
 * Validates and upserts persona settings. Throws on invalid enum values.
 */
export async function upsertPreferences(userId, prefs) {
    const { response_length, tone, answer_style } = prefs

    if (response_length !== undefined && !VALID_LENGTHS.includes(response_length)) {
        throw new Error(`Invalid response_length: ${response_length}`)
    }
    if (tone !== undefined && !VALID_TONES.includes(tone)) {
        throw new Error(`Invalid tone: ${tone}`)
    }
    if (answer_style !== undefined && !VALID_STYLES.includes(answer_style)) {
        throw new Error(`Invalid answer_style: ${answer_style}`)
    }

    const merged = {
        response_length: response_length ?? DEFAULT_PREFS.response_length,
        tone: tone ?? DEFAULT_PREFS.tone,
        answer_style: answer_style ?? DEFAULT_PREFS.answer_style
    }

    const { rows } = await pool.query(
        `INSERT INTO public.chatbot_preferences (user_id, response_length, tone, answer_style)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET response_length = EXCLUDED.response_length,
               tone            = EXCLUDED.tone,
               answer_style    = EXCLUDED.answer_style,
               updated_at      = NOW()
         RETURNING response_length, tone, answer_style, data_last_updated_at`,
        [userId, merged.response_length, merged.tone, merged.answer_style]
    )
    return rows[0]
}

/**
 * Bumps data_last_updated_at to NOW(). Fire-and-forget safe.
 * Upserts so it works even when no preferences row exists yet.
 */
export async function updateDataVersion(userId) {
    try {
        await pool.query(
            `INSERT INTO public.chatbot_preferences (user_id, data_last_updated_at, updated_at)
             VALUES ($1, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE
               SET data_last_updated_at = NOW(),
                   updated_at           = NOW()`,
            [userId]
        )
    } catch (err) {
        logger.warn('updateDataVersion failed for user %s: %s', userId, err.message)
    }
}

// =============================================================================
// STALENESS CHECK
// =============================================================================

/**
 * Returns true if data_last_updated_at > greeting_generated_at for the session.
 * Returns false when either timestamp is NULL (no data submitted yet, or no
 * cached greeting yet — in both cases the greeting is not stale in a harmful way).
 */
export async function isGreetingStale(sessionId) {
    const { rows } = await pool.query(
        `SELECT cs.greeting_generated_at, cp.data_last_updated_at
         FROM public.chat_sessions cs
         LEFT JOIN public.chatbot_preferences cp ON cp.user_id = cs.user_id
         WHERE cs.id = $1`,
        [sessionId]
    )

    if (rows.length === 0) return false

    const { greeting_generated_at, data_last_updated_at } = rows[0]

    if (!greeting_generated_at || !data_last_updated_at) return false

    return data_last_updated_at > greeting_generated_at
}
