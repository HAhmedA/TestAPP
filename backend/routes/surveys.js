// Survey routes
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'

const router = Router()

// Helper to normalize survey rows
const mapSurveyRow = (row) => ({ id: row.id, name: row.name, json: row.json })

// Default survey template
const getDefaultSurveyTemplate = () => ({
    pages: [{
        elements: [
            { type: 'rating', name: 'efficiency', title: 'I believe I can accomplish my learning duties and learning tasks efficiently:', mininumRateDescription: 'Strongly disagree', maximumRateDescription: 'Strongly agree' },
            { type: 'rating', name: 'importance', title: 'I believe that my learning tasks are very important to me:', mininumRateDescription: 'Not important', maximumRateDescription: 'Very important' },
            { type: 'rating', name: 'tracking', title: 'I am keeping track of what I need to do or accomplish:', mininumRateDescription: 'Never', maximumRateDescription: 'Always' },
            { type: 'rating', name: 'clarity', title: 'I know what I have to do to accomplish my learning tasks:', mininumRateDescription: 'Not clear', maximumRateDescription: 'Very clear' },
            { type: 'rating', name: 'effort', title: 'I am putting enough effort into my learning tasks to accomplish them well:', mininumRateDescription: 'Not enough effort', maximumRateDescription: 'A lot of effort' },
            { type: 'rating', name: 'focus', title: 'I am focusing on performing my learning tasks today and resisting distractions:', mininumRateDescription: 'Easily distracted', maximumRateDescription: 'Highly focused' },
            { type: 'rating', name: 'help_seeking', title: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks:', mininumRateDescription: 'Never seek help', maximumRateDescription: 'Always seek help' },
            { type: 'rating', name: 'community', title: 'I am having nice interactions and feeling at home within the college community:', mininumRateDescription: 'Not at all', maximumRateDescription: 'Very much' },
            { type: 'rating', name: 'timeliness', title: 'I am doing my studies on time and keeping up with tasks/deadlines:', mininumRateDescription: 'Always late', maximumRateDescription: 'Always on time' },
            { type: 'rating', name: 'motivation', title: 'I feel enthusiastic/motivated to learn, understand, and get better grades:', mininumRateDescription: 'Not motivated', maximumRateDescription: 'Highly motivated' },
            { type: 'rating', name: 'anxiety', title: 'I feel anxious/stressed working on learning tasks, assignments, or in class:', mininumRateDescription: 'Never anxious', maximumRateDescription: 'Very anxious' },
            { type: 'rating', name: 'enjoyment', title: 'I enjoy my tasks and feel happy about my achievements/work/accomplishment:', mininumRateDescription: 'Do not enjoy', maximumRateDescription: 'Enjoy a lot' },
            { type: 'rating', name: 'learning_from_feedback', title: 'I am learning from feedback and mistakes to accomplish my learning:', mininumRateDescription: 'Rarely learn from feedback', maximumRateDescription: 'Always learn from feedback' },
            { type: 'rating', name: 'self_assessment', title: 'I always assess my performance or work on tasks to improve my skills:', mininumRateDescription: 'Never assess', maximumRateDescription: 'Always assess' }
        ]
    }]
})

// Get all surveys
router.get('/getActive', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, name, json FROM public.surveys ORDER BY name NULLS LAST')
        res.json(rows.map(mapSurveyRow))
    } catch (e) {
        logger.error(`Get surveys error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Create new survey (GET)
router.get('/create', async (req, res) => {
    try {
        const id = uuidv4()
        const name = 'New Survey'
        const json = getDefaultSurveyTemplate()
        const { rows } = await pool.query(
            'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::jsonb) RETURNING id, name, json',
            [id, name, JSON.stringify(json)]
        )
        logger.info(`Survey created: ${id}`)
        res.json(mapSurveyRow(rows[0]))
    } catch (e) {
        logger.error(`Create survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Create new survey (POST)
router.post('/create', async (req, res) => {
    try {
        const id = uuidv4()
        const name = 'New Survey'
        const json = getDefaultSurveyTemplate()
        const { rows } = await pool.query(
            'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::jsonb) RETURNING id, name, json',
            [id, name, JSON.stringify(json)]
        )
        logger.info(`Survey created: ${id}`)
        res.json(mapSurveyRow(rows[0]))
    } catch (e) {
        logger.error(`Create survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Delete survey (GET)
router.get('/delete', async (req, res) => {
    try {
        const id = req.query.id
        await pool.query('DELETE FROM public.surveys WHERE id = $1', [id])
        logger.info(`Survey deleted: ${id}`)
        res.json({ id })
    } catch (e) {
        logger.error(`Delete survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Delete survey (POST)
router.post('/delete', async (req, res) => {
    try {
        const id = req.body?.id
        await pool.query('DELETE FROM public.surveys WHERE id = $1', [id])
        logger.info(`Survey deleted: ${id}`)
        res.json({ id })
    } catch (e) {
        logger.error(`Delete survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Get single survey
router.get('/getSurvey', async (req, res) => {
    try {
        const id = req.query.surveyId
        const { rows } = await pool.query('SELECT id, name, json FROM public.surveys WHERE id = $1', [id])
        res.json(rows[0] ? mapSurveyRow(rows[0]) : null)
    } catch (e) {
        logger.error(`Get survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Update survey JSON
router.post('/changeJson', async (req, res) => {
    try {
        const { id, json } = req.body || {}
        const { rows } = await pool.query(
            'UPDATE public.surveys SET json = $2::jsonb WHERE id = $1 RETURNING id, name, json',
            [id, JSON.stringify(json)]
        )
        if (!rows[0]) return res.status(404).json({ error: 'not found' })
        logger.info(`Survey updated: ${id}`)
        res.json(mapSurveyRow(rows[0]))
    } catch (e) {
        logger.error(`Update survey error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
