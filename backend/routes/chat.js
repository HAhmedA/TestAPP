// Chat routes
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import pool from '../config/database.js'
import { asyncRoute } from '../utils/errors.js'
import {
    sendMessage,
    generateInitialGreeting,
    getSessionHistory,
    getUserSessions,
    getOrCreateSession,
    resetSession
} from '../services/contextManagerService.js'
import { checkAvailability } from '../services/apiConnectorService.js'
import { getPreferences, upsertPreferences } from '../services/chatbotPreferencesService.js'

const router = Router()
router.use(requireAuth)

router.get('/session', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)
    res.json({ sessionId, isNew })
}))

router.get('/initial', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)

    if (!isNew) {
        const recentMessages = await getSessionHistory(sessionId, 10)
        if (recentMessages.length > 0) {
            return res.json({ greeting: null, messages: recentMessages, sessionId, hasExistingSession: true, success: true })
        }
    }

    const result = await generateInitialGreeting(userId)
    res.json({
        greeting: result.greeting,
        messages: null,
        sessionId: result.sessionId,
        hasExistingSession: false,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

router.post('/message', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { message } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' })
    }
    if (message.length > 5000) {
        return res.status(400).json({ error: 'message too long (max 5000 characters)' })
    }

    const result = await sendMessage(userId, message.trim())
    res.json({
        response: result.response,
        sessionId: result.sessionId,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

router.get('/history', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, limit = 20, before } = req.query

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })

    // Ownership check — IDOR guard: user may only read their own sessions
    const { rows: sessionCheck } = await pool.query(
        'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    )
    if (sessionCheck.length === 0) return res.status(403).json({ error: 'forbidden' })

    const parsedLimit = Math.min(parseInt(limit) || 20, 50)
    const messages = await getSessionHistory(sessionId, parsedLimit, before || null)
    res.json({ messages, hasMore: messages.length === parsedLimit })
}))

router.get('/sessions', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const sessions = await getUserSessions(userId)
    res.json({ sessions })
}))

router.post('/reset', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const result = await resetSession(userId)

    if (!result.success) return res.status(500).json({ error: 'reset_failed' })

    const greeting = await generateInitialGreeting(userId)
    res.json({ sessionId: result.newSessionId, greeting: greeting.greeting, success: true })
}))

// LLM availability status — used by the chatbot UI to show Online/Offline
router.get('/status', asyncRoute(async (req, res) => {
    const result = await checkAvailability()
    res.json({ available: result.available, models: result.models })
}))

// Persona / style preferences
router.get('/preferences', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const prefs = await getPreferences(userId)
    res.json(prefs)
}))

router.put('/preferences', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { response_length, tone, answer_style } = req.body

    // Must supply at least one valid key
    if (response_length === undefined && tone === undefined && answer_style === undefined) {
        return res.status(400).json({ error: 'At least one preference field is required' })
    }

    try {
        const updated = await upsertPreferences(userId, { response_length, tone, answer_style })
        res.json(updated)
    } catch (err) {
        if (err.message.startsWith('Invalid ')) {
            return res.status(400).json({ error: err.message })
        }
        throw err
    }
}))

export default router
