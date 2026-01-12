// Basic health check tests
import request from 'supertest'
import express from 'express'

// Create a minimal app for testing
const app = express()
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date() })
})

describe('Health Check Endpoint', () => {
    test('GET /health returns status ok', async () => {
        const response = await request(app).get('/health')
        expect(response.status).toBe(200)
        expect(response.body.status).toBe('ok')
        expect(response.body.timestamp).toBeDefined()
    })
})

describe('Rate Limiting Middleware', () => {
    test('authLimiter is configured correctly', async () => {
        const { authLimiter } = await import('../middleware/rateLimit.js')
        expect(authLimiter).toBeDefined()
        expect(typeof authLimiter).toBe('function')
    })

    test('apiLimiter is configured correctly', async () => {
        const { apiLimiter } = await import('../middleware/rateLimit.js')
        expect(apiLimiter).toBeDefined()
        expect(typeof apiLimiter).toBe('function')
    })
})
