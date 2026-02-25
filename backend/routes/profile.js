// Profile routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// All profile routes require auth
router.use(requireAuth)

// Get profile
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { rows } = await pool.query(
            'SELECT user_id, edu_level, field_of_study, major, learning_formats, disabilities, onboarding_completed, updated_at FROM public.student_profiles WHERE user_id = $1',
            [userId]
        )

        if (rows.length === 0) {
            return res.status(404).json({ error: 'profile_not_found' })
        }

        res.json(rows[0])
    } catch (e) {
        logger.error('Get profile error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Update profile
router.put('/', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { edu_level, field_of_study, major, learning_formats, disabilities } = req.body

        // Upsert: insert or update if exists
        const { rows } = await pool.query(
            `INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         edu_level = EXCLUDED.edu_level,
         field_of_study = EXCLUDED.field_of_study,
         major = EXCLUDED.major,
         learning_formats = EXCLUDED.learning_formats,
         disabilities = EXCLUDED.disabilities,
         updated_at = NOW()
       RETURNING user_id, edu_level, field_of_study, major, learning_formats, disabilities, updated_at`,
            [userId, edu_level || '', field_of_study || '', major || '', JSON.stringify(learning_formats || []), JSON.stringify(disabilities || [])]
        )

        logger.info(`Profile updated for user: ${userId}`)
        res.json(rows[0])
    } catch (e) {
        logger.error('Update profile error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Mark onboarding as complete
router.post('/onboarding-complete', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        await pool.query(
            `INSERT INTO public.student_profiles (user_id, onboarding_completed, updated_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET onboarding_completed = true, updated_at = NOW()`,
            [userId]
        )

        logger.info(`Onboarding completed for user: ${userId}`)
        res.json({ success: true })
    } catch (e) {
        logger.error('Onboarding complete error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
