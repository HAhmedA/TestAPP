/**
 * Integration tests for mood routes
 * GET /api/mood        — mood statistics
 * GET /api/mood/history — line graph data
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery    = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: moodRouter } = await import('../../../routes/mood.js')

// ── Survey fixture with one rating construct ───────────────────────────────────
const SURVEY_JSON = {
    pages: [{
        elements: [{ name: 'mood', type: 'rating', title: 'How are you feeling?' }]
    }]
}

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => {
        req.session.user = { id: 'user-1', email: 'user@test.com', role: 'student' }
        next()
    })
    app.use('/api/mood', moodRouter)
    return app
}

function buildUnauthApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/mood', moodRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
})

// ── Authentication ─────────────────────────────────────────────────────────────

describe('Authentication', () => {
    test('GET / returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/mood?surveyId=s1')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })
})

// ── GET / ──────────────────────────────────────────────────────────────────────

describe('GET /api/mood', () => {
    test('returns 400 when surveyId is missing', async () => {
        const res = await request(buildApp()).get('/api/mood')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('surveyId required')
    })

    test('returns 400 for invalid period', async () => {
        const res = await request(buildApp()).get('/api/mood?surveyId=s1&period=badperiod')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('invalid period')
    })

    test('returns 404 when survey not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/mood?surveyId=s1')
        expect(res.status).toBe(404)
        expect(res.body.error).toBe('survey_not_found')
    })

    test('returns hasData: false when no questionnaire results exist', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ json: SURVEY_JSON }] }) // survey lookup
            .mockResolvedValueOnce({ rows: [] })                       // no results
        const res = await request(buildApp()).get('/api/mood?surveyId=s1')
        expect(res.status).toBe(200)
        expect(res.body.hasData).toBe(false)
        expect(res.body.totalResponses).toBe(0)
        expect(res.body.constructs[0].name).toBe('mood')
        expect(res.body.constructs[0].average).toBeNull()
    })

    test('returns computed stats when results exist', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ json: SURVEY_JSON }] })
            .mockResolvedValueOnce({ rows: [
                { id: 'r1', answers: JSON.stringify({ mood: 4 }), created_at: '2026-03-01T10:00:00Z' },
                { id: 'r2', answers: JSON.stringify({ mood: 2 }), created_at: '2026-03-01T11:00:00Z' },
            ]})
        const res = await request(buildApp()).get('/api/mood?surveyId=s1')
        expect(res.status).toBe(200)
        expect(res.body.hasData).toBe(true)
        expect(res.body.totalResponses).toBe(2)
        const moodStat = res.body.constructs.find(c => c.name === 'mood')
        expect(moodStat.average).toBe(3)  // (4+2)/2
        expect(moodStat.min).toBe(2)
        expect(moodStat.max).toBe(4)
    })
})

// ── GET /history ───────────────────────────────────────────────────────────────

describe('GET /api/mood/history', () => {
    test('returns 400 when surveyId is missing', async () => {
        const res = await request(buildApp()).get('/api/mood/history')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('surveyId required')
    })

    test('returns 404 when survey not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/mood/history?surveyId=s1')
        expect(res.status).toBe(404)
        expect(res.body.error).toBe('survey_not_found')
    })

    test('returns 400 for invalid period', async () => {
        const res = await request(buildApp()).get('/api/mood/history?surveyId=s1&period=badperiod')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('invalid period')
    })

    test('returns time-bucketed chart points for period=today', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ json: SURVEY_JSON }] })
            .mockResolvedValueOnce({ rows: [
                { id: 'r1', answers: JSON.stringify({ mood: 3 }), created_at: '2026-03-01T09:30:00Z' }
            ]})
        const res = await request(buildApp()).get('/api/mood/history?surveyId=s1&period=today')
        expect(res.status).toBe(200)
        expect(res.body.period).toBe('today')
        expect(Array.isArray(res.body.data)).toBe(true)
        expect(res.body.data[0]).toHaveProperty('time')
        expect(res.body.data[0].mood).toBe(3)
    })

    test('returns datetime-labelled points for period=7days', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ json: SURVEY_JSON }] })
            .mockResolvedValueOnce({ rows: [
                { id: 'r1', answers: JSON.stringify({ mood: 4 }), created_at: '2026-02-28T14:00:00Z' }
            ]})
        const res = await request(buildApp()).get('/api/mood/history?surveyId=s1&period=7days')
        expect(res.status).toBe(200)
        expect(res.body.period).toBe('7days')
        expect(res.body.data[0]).toHaveProperty('datetime')
        expect(res.body.data[0].mood).toBe(4)
    })

    test('returns daily averages when no period specified', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ json: SURVEY_JSON }] })
            .mockResolvedValueOnce({ rows: [
                { id: 'r1', answers: JSON.stringify({ mood: 4 }), created_at: '2026-03-01T09:00:00Z' },
                { id: 'r2', answers: JSON.stringify({ mood: 2 }), created_at: '2026-03-01T15:00:00Z' },
            ]})
        const res = await request(buildApp()).get('/api/mood/history?surveyId=s1')
        expect(res.status).toBe(200)
        expect(res.body.period).toBe('all')
        // Two results on same day → averaged
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].mood).toBe(3)  // (4+2)/2
    })
})
