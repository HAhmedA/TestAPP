// Auth controller
import bcrypt from 'bcrypt'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { generateStudentData } from '../services/simulationOrchestratorService.js'
import { asyncRoute, AppError } from '../utils/errors.js'

export const login = asyncRoute(async (req, res) => {
        const { email, password } = req.body
        const { rows } = await pool.query('SELECT id, email, name, password_hash, role FROM public.users WHERE email = $1', [email])
        const row = rows[0]
        if (!row) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
        const ok = await bcrypt.compare(password, row.password_hash)
        if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
        const user = { id: row.id, email: row.email, name: row.name, role: row.role }
        req.session.user = user
        logger.info(`User logged in: ${email}`)
        res.json(user)
})

export const logout = (req, res) => {
    const email = req.session.user?.email || 'unknown'
    req.session.destroy((err) => {
        if (err) {
            logger.error(`Logout error: ${err.message}`)
            return res.status(500).json({ error: 'logout_error' })
        }
        res.clearCookie('connect.sid')
        logger.info(`User logged out: ${email}`)
        res.json({})
    })
}

export const getMe = (req, res) => {
    res.json(req.session.user || null)
}

export const register = asyncRoute(async (req, res) => {
        const { email, name, password } = req.body
        const existing = await pool.query('SELECT id FROM public.users WHERE email = $1', [email])
        if (existing.rowCount) throw new AppError('EMAIL_IN_USE', 'Email already registered', 409)
        const passwordHash = await bcrypt.hash(password, 10)
        const insert = await pool.query(
            'INSERT INTO public.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
            [email, name, passwordHash]
        )
        const user = insert.rows[0]
        req.session.user = user
        logger.info(`User registered: ${email}`)

        // Generate simulated data via Orchestrator (dev/test only).
        // Skipped when SIMULATION_MODE=false so production users start with a clean slate.
        if (process.env.SIMULATION_MODE !== 'false') {
            try {
                await generateStudentData(pool, user.id)
                logger.info(`Simulation data generated for user ${user.id}`)
            } catch (simErr) {
                // Log but don't fail registration if simulation fails
                logger.error(`Failed to generate simulation data for user ${user.id}: ${simErr.message}`)
            }
        }

        res.status(201).json(user)
})
