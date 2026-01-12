// Annotation routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { getAnnotations, getAnnotationsForChatbot } from '../services/annotationService.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// All annotation routes require auth
router.use(requireAuth)

// Get annotations for current user (for UI display)
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { timeWindow } = req.query // '24h', '7d', or null for both
        const annotations = await getAnnotations(pool, userId, timeWindow, false)

        res.json({ annotations })
    } catch (e) {
        logger.error('Get annotations error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Get annotations formatted for chatbot/LLM (for Prompt Assembler)
router.get('/chatbot', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const annotationsText = await getAnnotationsForChatbot(pool, userId)

        res.json({ annotationsText })
    } catch (e) {
        logger.error('Get chatbot annotations error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
