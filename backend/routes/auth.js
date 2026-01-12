// Authentication routes
import { Router } from 'express'
import bcrypt from 'bcrypt'
import { body } from 'express-validator'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { validate } from '../middleware/validation.js'

import { register, login, logout, getMe } from '../controllers/authController.js'
import { authLimiter } from '../middleware/rateLimit.js'

const router = Router()

// Register new user (with stricter rate limiting)
router.post('/register', authLimiter, validate([
    body('email').isEmail().normalizeEmail(),
    body('name').isString().isLength({ min: 1, max: 255 }).trim(),
    body('password').isString().isLength({ min: 8, max: 200 })
]), register)

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *                 role:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authLimiter, validate([
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty()
]), login)

// Logout
router.post('/logout', logout)

// Get current user
router.get('/me', getMe)

// Legacy endpoints (backwards compatible)
router.post('/legacy-login', async (req, res) => {
    // If email/password present, use real login
    if (req.body?.email && req.body?.password) {
        return login(req, res)
    }
    // Fallback demo role-based login
    const role = req.body?.role === 'admin' ? 'admin' : 'student'
    const user = { id: 'demo-user', role }
    req.session.user = user
    logger.info(`Demo login as: ${role}`)
    res.json(user)
})

export default router
