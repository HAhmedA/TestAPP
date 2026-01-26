// Scores routes - exposes concept scores for dashboard display
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// All score routes require auth
router.use(requireAuth)

/**
 * GET /api/scores
 * Get all concept scores for the current user
 * Returns array of { conceptId, score, trend, computedAt }
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, avg_7d, aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1
             ORDER BY concept_id`,
            [userId]
        )

        // Map concept_id to friendly names
        const conceptNames = {
            sleep: 'Sleep Quality',
            srl: 'Self-Regulated Learning',
            lms: 'LMS Engagement',
            screen_time: 'Screen Time',
            social_media: 'Social Media'
        }

        const scores = rows.map(row => ({
            conceptId: row.concept_id,
            conceptName: conceptNames[row.concept_id] || row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            avg7d: row.avg_7d ? parseFloat(row.avg_7d) : null,
            breakdown: row.aspect_breakdown,
            computedAt: row.computed_at
        }))

        res.json({ scores })
    } catch (e) {
        logger.error('Get concept scores error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

/**
 * GET /api/scores/:conceptId
 * Get a single concept score
 */
router.get('/:conceptId', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { conceptId } = req.params

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, avg_7d, aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1 AND concept_id = $2`,
            [userId, conceptId]
        )

        if (rows.length === 0) {
            return res.status(404).json({ error: 'not_found' })
        }

        const row = rows[0]
        res.json({
            conceptId: row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            avg7d: row.avg_7d ? parseFloat(row.avg_7d) : null,
            breakdown: row.aspect_breakdown,
            computedAt: row.computed_at
        })
    } catch (e) {
        logger.error('Get single concept score error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
