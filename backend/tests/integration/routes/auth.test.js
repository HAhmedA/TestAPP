/**
 * Integration tests for auth routes
 * POST /api/auth/login, POST /api/auth/register, GET /api/auth/me
 *
 * Uses jest.unstable_mockModule for ESM modules and jest.mock for CJS (bcrypt).
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
const mockBcryptCompare  = jest.fn()
const mockBcryptHash     = jest.fn()
const mockGenerateData   = jest.fn().mockResolvedValue('high_achiever')

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: mockLogWarn, debug: jest.fn() }
}))
jest.unstable_mockModule('bcrypt', () => ({
    default: { compare: mockBcryptCompare, hash: mockBcryptHash }
}))
jest.unstable_mockModule('../../../services/simulationOrchestratorService.js', () => ({
    generateStudentData: mockGenerateData
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: authRouter } = await import('../../../routes/auth.js')

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/auth', authRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockBcryptCompare.mockReset()
    mockBcryptHash.mockReset()
    mockGenerateData.mockReset()
    mockGenerateData.mockResolvedValue('high_achiever')
})

describe('POST /api/auth/login', () => {
    test('returns 401 when user not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp())
            .post('/api/auth/login')
            .send({ email: 'unknown@example.com', password: 'pass' })
        expect(res.status).toBe(401)
    })

    test('returns 401 on wrong password', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: '1', email: 'u@e.com', name: 'User', password_hash: 'hash', role: 'student' }
        ]})
        mockBcryptCompare.mockResolvedValue(false)

        const res = await request(buildApp())
            .post('/api/auth/login')
            .send({ email: 'u@e.com', password: 'wrong' })
        expect(res.status).toBe(401)
    })

    test('returns 200 with user on valid credentials', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: '1', email: 'u@e.com', name: 'User', password_hash: 'hash', role: 'student' }
        ]})
        mockBcryptCompare.mockResolvedValue(true)

        const res = await request(buildApp())
            .post('/api/auth/login')
            .send({ email: 'u@e.com', password: 'correct' })
        expect(res.status).toBe(200)
        expect(res.body.email).toBe('u@e.com')
    })
})

describe('GET /api/auth/me', () => {
    test('returns null when not logged in', async () => {
        const res = await request(buildApp()).get('/api/auth/me')
        expect(res.status).toBe(200)
        expect(res.body).toBeNull()
    })
})

// ── Security regression: SEC-01 / CRIT-T1 ─────────────────────────────────────
// legacy-login must not grant admin access in production.
// If this test fails, the production guard has been removed — do not merge.
describe('POST /api/auth/legacy-login — production security (CRIT-T1)', () => {
    const originalEnv = process.env.NODE_ENV

    afterAll(() => {
        process.env.NODE_ENV = originalEnv
    })

    test('returns 404 in production when role=admin is supplied without credentials', async () => {
        process.env.NODE_ENV = 'production'
        const res = await request(buildApp())
            .post('/api/auth/legacy-login')
            .send({ role: 'admin' })
        expect(res.status).toBe(404)
        process.env.NODE_ENV = originalEnv
    })

    test('returns 404 in production when role=student is supplied without credentials', async () => {
        process.env.NODE_ENV = 'production'
        const res = await request(buildApp())
            .post('/api/auth/legacy-login')
            .send({ role: 'student' })
        expect(res.status).toBe(404)
        process.env.NODE_ENV = originalEnv
    })
})
