// Student mood routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// All mood routes require auth
router.use(requireAuth)

// Get mood statistics for a specific student
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { period } = req.query // 'today' or '7days'
        const surveyId = req.query.surveyId

        if (!surveyId) {
            return res.status(400).json({ error: 'surveyId required' })
        }

        // Get survey structure to extract construct names
        const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
        if (!surveyResult.rows[0]) {
            return res.status(404).json({ error: 'survey_not_found' })
        }

        const survey = surveyResult.rows[0]
        const constructs = []
        if (survey.json && survey.json.pages) {
            survey.json.pages.forEach((page) => {
                if (page.elements) {
                    page.elements.forEach((element) => {
                        if (element.name && element.type === 'rating') {
                            constructs.push({
                                name: element.name,
                                title: element.title
                            })
                        }
                    })
                }
            })
        }

        // Build date filter
        let dateFilter = ''
        if (period === 'today') {
            dateFilter = "AND DATE(created_at) = CURRENT_DATE"
        } else if (period === '7days') {
            dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'"
        }

        // Get results for this user and survey
        const resultsQuery = await pool.query(
            `SELECT id, answers, created_at FROM public.questionnaire_results 
       WHERE postid = $1 AND user_id = $2 ${dateFilter}
       ORDER BY created_at ASC`,
            [surveyId, userId]
        )

        const results = resultsQuery.rows.map(row => ({
            id: row.id,
            createdAt: row.created_at,
            data: typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers
        }))

        if (results.length === 0) {
            // Return constructs list even when no data, so frontend knows what to display
            const emptyConstructs = constructs.map(construct => ({
                name: construct.name,
                title: construct.title,
                average: null,
                min: null,
                max: null,
                count: 0
            }))
            return res.json({
                period,
                constructs: emptyConstructs,
                hasData: false,
                totalResponses: 0
            })
        }

        // Calculate statistics for each construct
        const constructStats = constructs.map(construct => {
            const values = results
                .map(result => {
                    const value = result.data[construct.name]
                    return value !== undefined && value !== null ? Number(value) : null
                })
                .filter(v => v !== null && !isNaN(v))

            if (values.length === 0) {
                return {
                    name: construct.name,
                    title: construct.title,
                    average: null,
                    min: null,
                    max: null,
                    count: 0
                }
            }

            const sum = values.reduce((a, b) => a + b, 0)
            const avg = sum / values.length
            const min = Math.min(...values)
            const max = Math.max(...values)

            return {
                name: construct.name,
                title: construct.title,
                average: Math.round(avg * 10) / 10,
                min,
                max,
                count: values.length
            }
        })

        res.json({
            period,
            constructs: constructStats,
            hasData: true,
            totalResponses: results.length
        })
    } catch (e) {
        logger.error('Student mood error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Get mood history (line graph data)
router.get('/history', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const surveyId = req.query.surveyId
        const period = req.query.period // 'today' or undefined (for all time)
        if (!surveyId) {
            return res.status(400).json({ error: 'surveyId required' })
        }

        // Get survey structure to extract construct names
        const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
        if (!surveyResult.rows[0]) {
            return res.status(404).json({ error: 'survey_not_found' })
        }

        const survey = surveyResult.rows[0]
        const constructs = []
        if (survey.json && survey.json.pages) {
            survey.json.pages.forEach((page) => {
                if (page.elements) {
                    page.elements.forEach((element) => {
                        if (element.name && element.type === 'rating') {
                            constructs.push({
                                name: element.name,
                                title: element.title
                            })
                        }
                    })
                }
            })
        }

        // Build date filter for "today" period
        let dateFilter = ''
        if (period === 'today') {
            dateFilter = "AND DATE(created_at) = CURRENT_DATE"
        }

        // Get all results for this user and survey
        const resultsQuery = await pool.query(
            `SELECT id, answers, created_at FROM public.questionnaire_results 
       WHERE postid = $1 AND user_id = $2 ${dateFilter}
       ORDER BY created_at ASC`,
            [surveyId, userId]
        )

        const results = resultsQuery.rows.map(row => {
            const data = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers
            const date = new Date(row.created_at)
            const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
            const timeStr = date.toTimeString().split(' ')[0].substring(0, 5) // HH:MM

            return {
                id: row.id,
                date: dateStr,
                time: timeStr,
                timestamp: row.created_at,
                data
            }
        })

        let chartData = []

        if (period === 'today') {
            // For today, show individual responses with time
            chartData = results.map(result => {
                const point = { time: result.time, timestamp: result.timestamp }
                constructs.forEach(construct => {
                    const value = result.data[construct.name]
                    if (value !== undefined && value !== null) {
                        const numValue = Number(value)
                        if (!isNaN(numValue)) {
                            point[construct.name] = numValue
                        } else {
                            point[construct.name] = null
                        }
                    } else {
                        point[construct.name] = null
                    }
                })
                return point
            })
        } else {
            // For other periods, group by date and calculate daily averages
            const dailyData = {}
            results.forEach(result => {
                if (!dailyData[result.date]) {
                    dailyData[result.date] = {}
                    constructs.forEach(construct => {
                        dailyData[result.date][construct.name] = []
                    })
                }
                constructs.forEach(construct => {
                    const value = result.data[construct.name]
                    if (value !== undefined && value !== null) {
                        const numValue = Number(value)
                        if (!isNaN(numValue)) {
                            dailyData[result.date][construct.name].push(numValue)
                        }
                    }
                })
            })

            // Calculate daily averages
            chartData = Object.keys(dailyData).sort().map(date => {
                const dayData = { date }
                constructs.forEach(construct => {
                    const values = dailyData[date][construct.name]
                    if (values.length > 0) {
                        const sum = values.reduce((a, b) => a + b, 0)
                        dayData[construct.name] = Math.round((sum / values.length) * 10) / 10
                    } else {
                        dayData[construct.name] = null
                    }
                })
                return dayData
            })
        }

        res.json({
            constructs: constructs.map(c => ({ name: c.name, title: c.title })),
            data: chartData,
            period: period || 'all'
        })
    } catch (e) {
        logger.error('Student mood history error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
