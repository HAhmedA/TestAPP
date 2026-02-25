// Results endpoints
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { saveResponses, computeAnnotations } from '../services/annotators/srlAnnotationService.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'

const router = Router()

// Post new result
router.post('/post', async (req, res) => {
    try {
        const { postId, surveyResult } = req.body || {}
        const id = uuidv4()
        const userId = req.session.user?.id || null
        const submittedAt = new Date()

        // Save to questionnaire_results (JSONB backup)
        await pool.query(
            'INSERT INTO public.questionnaire_results (id, postid, answers, user_id, created_at) VALUES ($1, $2, $3::jsonb, $4, $5)',
            [id, postId, JSON.stringify(surveyResult), userId, submittedAt]
        )

        // If user is logged in, save normalized responses and compute annotations
        if (userId) {
            // Save individual SRL responses to normalized table
            await saveResponses(pool, id, userId, surveyResult, submittedAt)

            // Get survey structure for computing annotations
            const surveyQuery = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [postId])
            if (surveyQuery.rows[0]) {
                const surveyStructure = surveyQuery.rows[0].json
                // Compute and cache annotations for this user
                await computeAnnotations(pool, userId, surveyStructure)
            }

            // Trigger full score recomputation in background (do not await)
            computeAllScores(userId).catch(err => logger.error('Score recomputation error after SRL submit:', err))
        }

        logger.info(`Survey response submitted for ${postId}`)
        res.json({ id, postId })
    } catch (e) {
        logger.error('Post submission error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
