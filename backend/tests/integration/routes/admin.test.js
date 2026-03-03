/**
 * Integration tests for admin routes
 * GET /api/admin/prompt
 * GET /api/admin/prompts
 * PUT /api/admin/prompt
 * GET /api/admin/students
 * GET /api/admin/students/:studentId/scores
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery          = jest.fn()
const mockLogInfo        = jest.fn()
const mockLogError       = jest.fn()
const mockLogWarn        = jest.fn()
const mockGetAnnotations = jest.fn().mockResolvedValue([])

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: mockLogWarn, debug: jest.fn() }
}))
jest.unstable_mockModule('../../../services/alignmentService.js', () => ({
    DEFAULT_ALIGNMENT_PROMPT: 'default alignment prompt'
}))
jest.unstable_mockModule('../../../services/annotators/srlAnnotationService.js', () => ({
    getAnnotations: mockGetAnnotations
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: adminRouter } = await import('../../../routes/admin.js')

function buildApp(role = 'admin') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => {
        req.session.user = { id: 'admin-1', email: 'admin@test.com', role }
        next()
    })
    app.use('/api/admin', adminRouter)
    return app
}

function buildUnauthApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/admin', adminRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockGetAnnotations.mockReset()
    mockGetAnnotations.mockResolvedValue([])
})

describe('Authentication & Authorization', () => {
    test('returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/admin/students')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('returns 403 when logged in as student', async () => {
        const res = await request(buildApp('student')).get('/api/admin/students')
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('forbidden')
    })
})

describe('GET /api/admin/prompt', () => {
    test('returns default system prompt when no DB entry', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/admin/prompt?type=system')
        expect(res.status).toBe(200)
        expect(res.body.prompt).toBeDefined()
        expect(res.body.prompt_type).toBe('system')
    })

    test('returns stored prompt when found', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { prompt: 'custom system', prompt_type: 'system', updated_at: '2026-01-01' }
        ]})
        const res = await request(buildApp()).get('/api/admin/prompt?type=system')
        expect(res.status).toBe(200)
        expect(res.body.prompt).toBe('custom system')
    })

    test('returns 400 for invalid prompt type', async () => {
        const res = await request(buildApp()).get('/api/admin/prompt?type=invalid')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    test('returns default alignment prompt when no DB entry', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/admin/prompt?type=alignment')
        expect(res.status).toBe(200)
        expect(res.body.prompt).toBe('default alignment prompt')
    })
})

describe('PUT /api/admin/prompt', () => {
    test('returns 400 when prompt body is missing', async () => {
        const res = await request(buildApp())
            .put('/api/admin/prompt')
            .send({ type: 'system' })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    test('returns 400 for invalid prompt type', async () => {
        const res = await request(buildApp())
            .put('/api/admin/prompt')
            .send({ type: 'bad', prompt: 'hello' })
        expect(res.status).toBe(400)
    })

    test('returns updated prompt on success', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { prompt: 'new system prompt', prompt_type: 'system', updated_at: '2026-02-26' }
        ]})
        const res = await request(buildApp())
            .put('/api/admin/prompt')
            .send({ type: 'system', prompt: 'new system prompt' })
        expect(res.status).toBe(200)
        expect(res.body.prompt).toBe('new system prompt')
    })
})

describe('GET /api/admin/students', () => {
    test('returns empty list when no students', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/admin/students')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.students)).toBe(true)
        expect(res.body.students).toHaveLength(0)
    })

    test('returns student list', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: 's1', name: 'Alice', email: 'alice@test.com' },
            { id: 's2', name: 'Bob', email: 'bob@test.com' }
        ]})
        const res = await request(buildApp()).get('/api/admin/students')
        expect(res.status).toBe(200)
        expect(res.body.students).toHaveLength(2)
        expect(res.body.students[0].name).toBe('Alice')
    })
})

describe('GET /api/admin/students/:studentId/scores', () => {
    test('returns empty scores when student has no scores', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/admin/students/student-1/scores')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.scores)).toBe(true)
        expect(res.body.scores).toHaveLength(0)
    })

    test('returns mapped scores for a student', async () => {
        // concept_scores
        mockQuery.mockResolvedValueOnce({ rows: [
            { concept_id: 'sleep', score: '75.0', trend: 'stable', aspect_breakdown: null, computed_at: '2026-02-26' }
        ]})
        // yesterday
        mockQuery.mockResolvedValueOnce({ rows: [] })
        // cluster info
        mockQuery.mockResolvedValueOnce({ rows: [] })
        // getConceptPoolSizes (all concepts have enough users → no cold-start entries added)
        mockQuery.mockResolvedValueOnce({ rows: [
            { concept: 'sleep', user_count: '15' },
            { concept: 'screen_time', user_count: '15' },
            { concept: 'lms', user_count: '15' },
            { concept: 'srl', user_count: '15' }
        ]})
        // getUserConceptDataSet
        mockQuery.mockResolvedValueOnce({ rows: [{ concept: 'sleep' }] })

        const res = await request(buildApp()).get('/api/admin/students/student-1/scores')
        expect(res.status).toBe(200)
        expect(res.body.scores[0].conceptId).toBe('sleep')
        expect(res.body.scores[0].score).toBe(75.0)
    })
})
