// Admin routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

// All admin routes require admin privileges
router.use(requireAdmin)

// Get system prompt
router.get('/system-prompt', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT prompt, updated_at FROM public.system_prompts ORDER BY updated_at DESC LIMIT 1'
        )

        if (rows.length === 0) {
            // Return default if no prompt exists
            return res.json({ prompt: 'Be Ethical', updated_at: null })
        }

        res.json(rows[0])
    } catch (e) {
        logger.error('Get system prompt error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Update system prompt
router.put('/system-prompt', async (req, res) => {
    try {
        const { prompt } = req.body
        const userId = req.session.user?.id

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'prompt is required' })
        }

        // Insert new prompt (keep history)
        const { rows } = await pool.query(
            'INSERT INTO public.system_prompts (prompt, created_by, updated_at) VALUES ($1, $2, NOW()) RETURNING prompt, updated_at',
            [prompt, userId]
        )

        logger.info(`System prompt updated by admin: ${userId}`)
        res.json(rows[0])
    } catch (e) {
        logger.error('Update system prompt error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
