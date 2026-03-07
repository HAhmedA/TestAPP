// Screen time self-report routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { updateDataVersion } from '../services/chatbotPreferencesService.js'

const router = Router()

router.use(requireAuth)

// ── GET /api/screen-time/today ──────────────────────────────
// Returns yesterday's screen time session for the logged-in user (if any real entry exists).
router.get('/today', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const result = await pool.query(
            `SELECT session_date, total_screen_minutes,
                    longest_continuous_session, late_night_screen_minutes
             FROM public.screen_time_sessions
             WHERE user_id = $1
               AND session_date = CURRENT_DATE - INTERVAL '1 day'
               AND is_simulated = false
             LIMIT 1`,
            [userId]
        )

        return res.json({ entry: result.rows[0] || null })
}))

// ── POST /api/screen-time ───────────────────────────────────
// Accepts: { totalMinutes, longestSession, preSleepMinutes }
// Upserts into screen_time_sessions for yesterday's date.
router.post('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { totalMinutes, longestSession, preSleepMinutes } = req.body

        if (totalMinutes == null || longestSession == null || preSleepMinutes == null) {
            throw Errors.VALIDATION('All three fields are required: totalMinutes, longestSession, preSleepMinutes')
        }

        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const sessionDate = yesterday.toISOString().split('T')[0]

        // baseline_screen_minutes: use existing baseline or default 300
        const baselineResult = await pool.query(
            `SELECT avg_total_minutes FROM public.screen_time_baselines WHERE user_id = $1`,
            [userId]
        )
        const baselineMinutes = baselineResult.rows.length > 0
            ? Math.round(parseFloat(baselineResult.rows[0].avg_total_minutes))
            : 300

        const upsertResult = await pool.query(
            `INSERT INTO public.screen_time_sessions
                (user_id, session_date, total_screen_minutes, baseline_screen_minutes,
                 longest_continuous_session, late_night_screen_minutes, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, false)
             ON CONFLICT (user_id, session_date)
             DO UPDATE SET
                total_screen_minutes = EXCLUDED.total_screen_minutes,
                baseline_screen_minutes = EXCLUDED.baseline_screen_minutes,
                longest_continuous_session = EXCLUDED.longest_continuous_session,
                late_night_screen_minutes = EXCLUDED.late_night_screen_minutes,
                is_simulated = false,
                created_at = now()
             RETURNING session_date, total_screen_minutes,
                       longest_continuous_session, late_night_screen_minutes`,
            [userId, sessionDate, totalMinutes, baselineMinutes, longestSession, preSleepMinutes]
        )

        // Trigger score recomputation in background (do not await)
        computeAllScores(userId).catch(err => logger.error('Score recomputation error after screen-time submit:', err))
        updateDataVersion(userId).catch(err => logger.warn('data version update failed:', err.message))

        return res.json({ entry: upsertResult.rows[0] })
}))

export default router
