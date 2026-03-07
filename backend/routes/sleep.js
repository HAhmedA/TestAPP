// Sleep data entry routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { updateDataVersion } from '../services/chatbotPreferencesService.js'

const router = Router()

router.use(requireAuth)

// ── GET /api/sleep/today ────────────────────────────────────
// Returns today's sleep session for the logged-in user (if any).
// "Today's session" means session_date = yesterday (they're logging last night's sleep).
router.get('/today', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const result = await pool.query(
            `SELECT session_date, bedtime, wake_time,
                    total_sleep_minutes, time_in_bed_minutes,
                    awakenings_count, awake_minutes
             FROM public.sleep_sessions
             WHERE user_id = $1
               AND session_date = CURRENT_DATE - INTERVAL '1 day'
               AND is_simulated = false
             LIMIT 1`,
            [userId]
        )

        return res.json({ entry: result.rows[0] || null })
}))

// ── POST /api/sleep ─────────────────────────────────────────
// Accepts: { intervals: [{ start: "HH:mm", end: "HH:mm" }, ...] }
// Computes sleep metrics and upserts into sleep_sessions for yesterday's date.
router.post('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { intervals } = req.body
        if (!Array.isArray(intervals) || intervals.length === 0) {
            throw Errors.VALIDATION('intervals required (array of {start, end})')
        }

        // Parse intervals: convert HH:mm strings to minute-of-day values
        // The slider uses a 12 PM → 12 PM axis, so times can cross midnight.
        // We treat the intervals relative to "yesterday evening → today morning".
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const sessionDate = yesterday.toISOString().split('T')[0] // YYYY-MM-DD

        const parsed = intervals.map(({ start, end }) => {
            const [sh, sm] = start.split(':').map(Number)
            const [eh, em] = end.split(':').map(Number)
            let startMin = sh * 60 + sm
            let endMin = eh * 60 + em
            // If end is before start, it crosses midnight (e.g. 23:00 → 07:00)
            // But in our model, end should always be after start because the
            // slider enforces that. If end < start it means it went past midnight.
            if (endMin <= startMin) endMin += 1440
            return { startMin, endMin, startH: sh, startM: sm, endH: eh, endM: em }
        })

        // Sort by start time
        parsed.sort((a, b) => a.startMin - b.startMin)

        // Earliest bedtime
        const earliest = parsed[0]
        const bedtimeDate = new Date(yesterday)
        bedtimeDate.setHours(earliest.startH, earliest.startM, 0, 0)
        // If bedtime hour >= 12 (noon), it's yesterday evening; otherwise it's today early morning
        if (earliest.startH < 12) {
            // Early morning → this is actually "today"
            bedtimeDate.setDate(bedtimeDate.getDate() + 1)
        }

        // Latest wake time
        const latest = parsed[parsed.length - 1]
        // Find the interval with the latest endMin
        const latestEnd = parsed.reduce((best, p) => p.endMin > best.endMin ? p : best, parsed[0])
        const wakeDate = new Date(yesterday)
        wakeDate.setHours(latestEnd.endH, latestEnd.endM, 0, 0)
        if (latestEnd.endH < 12 || latestEnd.endMin > 1440) {
            // Morning → today
            wakeDate.setDate(wakeDate.getDate() + 1)
        }
        // If the raw end crossed midnight (endMin > 1440), adjust the hour
        if (latestEnd.endMin > 1440) {
            const actualMin = latestEnd.endMin - 1440
            wakeDate.setHours(Math.floor(actualMin / 60), actualMin % 60, 0, 0)
        }

        // Total sleep = sum of all interval durations
        const totalSleepMinutes = parsed.reduce((sum, p) => sum + (p.endMin - p.startMin), 0)

        // Time in bed = wake_time - bedtime in minutes
        const timeInBedMinutes = Math.round((wakeDate.getTime() - bedtimeDate.getTime()) / 60000)

        // Awake minutes = time in bed - total sleep
        const awakeMinutes = Math.max(0, timeInBedMinutes - totalSleepMinutes)

        // Awakenings = number of gaps = intervals - 1
        const awakeningsCount = Math.max(0, parsed.length - 1)

        // Upsert into sleep_sessions (uses unique constraint on user_id + session_date)
        const upsertResult = await pool.query(
            `INSERT INTO public.sleep_sessions
                (user_id, session_date, bedtime, wake_time,
                 total_sleep_minutes, time_in_bed_minutes,
                 awakenings_count, awake_minutes, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
             ON CONFLICT (user_id, session_date)
             DO UPDATE SET
                bedtime = EXCLUDED.bedtime,
                wake_time = EXCLUDED.wake_time,
                total_sleep_minutes = EXCLUDED.total_sleep_minutes,
                time_in_bed_minutes = EXCLUDED.time_in_bed_minutes,
                awakenings_count = EXCLUDED.awakenings_count,
                awake_minutes = EXCLUDED.awake_minutes,
                is_simulated = false,
                created_at = now()
             RETURNING session_date, bedtime, wake_time,
                       total_sleep_minutes, time_in_bed_minutes,
                       awakenings_count, awake_minutes`,
            [userId, sessionDate, bedtimeDate.toISOString(), wakeDate.toISOString(),
                totalSleepMinutes, timeInBedMinutes, awakeningsCount, awakeMinutes]
        )

        // Trigger score recomputation in background (do not await)
        computeAllScores(userId).catch(err => logger.error('Score recomputation error after sleep submit:', err))
        updateDataVersion(userId).catch(err => logger.warn('data version update failed:', err.message))

        return res.json({ entry: upsertResult.rows[0] })
}))

export default router
