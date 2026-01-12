// Results endpoints
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { saveResponses, computeAnnotations } from '../services/annotationService.js'

const router = Router()

// Get results
router.get('/', async (req, res) => {
    try {
        const postId = req.query.postId
        // If logged in, prefer to scope by user
        if (req.session.user) {
            const { rows } = await pool.query('SELECT id, postid, answers FROM public.questionnaire_results WHERE postid = $1 AND user_id = $2', [postId, req.session.user.id])
            return res.json(rows)
        }
        const { rows } = await pool.query('SELECT id, postid, answers FROM public.questionnaire_results WHERE postid = $1', [postId])
        return res.json(rows)
    } catch (e) {
        logger.error(`Get results error: ${e.message}`)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

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
        }

        logger.info(`Survey response submitted for ${postId}`)
        res.json({ id, postId })
    } catch (e) {
        logger.error('Post submission error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Dashboard endpoint: aggregate results by question
router.get('/dashboard/:surveyId', async (req, res) => {
    try {
        const surveyId = req.params.surveyId

        // Get survey structure
        const surveyResult = await pool.query('SELECT id, name, json FROM public.surveys WHERE id = $1', [surveyId])
        if (!surveyResult.rows[0]) {
            return res.status(404).json({ error: 'survey_not_found' })
        }
        const survey = surveyResult.rows[0]

        // Get all results for this survey (admin sees all, not filtered by user)
        const resultsQuery = await pool.query('SELECT id, answers, user_id FROM public.questionnaire_results WHERE postid = $1', [surveyId])
        const results = resultsQuery.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            data: typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers
        }))

        // Extract questions from survey structure
        const questions = []
        if (survey.json && survey.json.pages) {
            survey.json.pages.forEach((page) => {
                if (page.elements) {
                    page.elements.forEach((element) => {
                        if (element.name && element.title) {
                            questions.push({
                                name: element.name,
                                title: element.title,
                                type: element.type || 'text',
                                choices: element.choices || (element.type === 'radiogroup' || element.type === 'checkbox' ? [] : null),
                                rateValues: element.rateValues,
                                rateMin: element.rateMin || 1,
                                rateMax: element.rateMax || 5,
                                mininumRateDescription: element.mininumRateDescription,
                                maximumRateDescription: element.maximumRateDescription
                            })
                        }
                    })
                }
            })
        }

        // Aggregate responses by question
        const aggregated = questions.map(question => {
            const responses = results
                .map(result => {
                    // Handle nested answers (e.g., question name might be nested in object)
                    let value = result.data[question.name]
                    if (value === undefined) {
                        // Try to find nested values
                        const keys = Object.keys(result.data)
                        for (const key of keys) {
                            if (typeof result.data[key] === 'object' && result.data[key] !== null) {
                                value = result.data[key][question.name]
                                if (value !== undefined) break
                            }
                        }
                    }
                    return value
                })
                .filter(v => v !== undefined && v !== null && v !== '')

            const totalResponses = responses.length
            const responseRate = results.length > 0 ? (totalResponses / results.length) * 100 : 0

            let aggregation = {
                questionName: question.name,
                questionTitle: question.title,
                questionType: question.type,
                totalResponses,
                responseRate: Math.round(responseRate * 10) / 10,
                totalSubmissions: results.length
            }

            // Aggregate based on question type
            if (question.type === 'rating') {
                const numericResponses = responses.map(r => Number(r)).filter(n => !isNaN(n))
                if (numericResponses.length > 0) {
                    const sum = numericResponses.reduce((a, b) => a + b, 0)
                    const avg = sum / numericResponses.length
                    const min = Math.min(...numericResponses)
                    const max = Math.max(...numericResponses)

                    // Distribution
                    const distribution = {}
                    numericResponses.forEach(r => {
                        distribution[r] = (distribution[r] || 0) + 1
                    })

                    aggregation.average = Math.round(avg * 10) / 10
                    aggregation.min = min
                    aggregation.max = max
                    aggregation.distribution = distribution
                    aggregation.allResponses = numericResponses
                }
            } else if (question.type === 'radiogroup' || question.type === 'dropdown') {
                // Count each choice
                const choiceCounts = {}
                responses.forEach(r => {
                    const key = String(r)
                    choiceCounts[key] = (choiceCounts[key] || 0) + 1
                })
                aggregation.choiceCounts = choiceCounts
                aggregation.allResponses = responses
            } else if (question.type === 'checkbox') {
                // Count each selected option (responses might be arrays)
                const choiceCounts = {}
                responses.forEach(r => {
                    const options = Array.isArray(r) ? r : [r]
                    options.forEach(opt => {
                        const key = String(opt)
                        choiceCounts[key] = (choiceCounts[key] || 0) + 1
                    })
                })
                aggregation.choiceCounts = choiceCounts
                aggregation.allResponses = responses
            } else if (question.type === 'text' || question.type === 'comment') {
                // Show all text responses
                aggregation.allResponses = responses.map(r => String(r))
                aggregation.uniqueResponses = [...new Set(responses.map(r => String(r)))]
            } else {
                // Default: show all responses
                aggregation.allResponses = responses
            }

            return aggregation
        })

        res.json({
            surveyId: survey.id,
            surveyName: survey.name,
            totalSubmissions: results.length,
            questions: aggregated
        })
    } catch (e) {
        logger.error('Dashboard error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

export default router
