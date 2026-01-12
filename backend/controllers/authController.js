// Auth controller 
import bcrypt from 'bcrypt'
import pool from '../config/database.js'
import logger from '../utils/logger.js'

export const login = async (req, res) => {
    try {
        const { email, password } = req.body
        const { rows } = await pool.query('SELECT id, email, name, password_hash, role FROM public.users WHERE email = $1', [email])
        const row = rows[0]
        if (!row) return res.status(401).json({ error: 'invalid_credentials' })
        const ok = await bcrypt.compare(password, row.password_hash)
        if (!ok) return res.status(401).json({ error: 'invalid_credentials' })
        const user = { id: row.id, email: row.email, name: row.name, role: row.role }
        req.session.user = user
        logger.info(`User logged in: ${email}`)
        res.json(user)
    } catch (e) {
        logger.error(`Login error: ${e.message}`)
        res.status(500).json({ error: 'server_error', details: String(e) })
    }
}

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

export const register = async (req, res) => {
    try {
        const { email, name, password } = req.body
        const existing = await pool.query('SELECT id FROM public.users WHERE email = $1', [email])
        if (existing.rowCount) return res.status(409).json({ error: 'email_in_use' })
        const passwordHash = await bcrypt.hash(password, 10)
        const insert = await pool.query(
            'INSERT INTO public.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
            [email, name, passwordHash]
        )
        const user = insert.rows[0]
        req.session.user = user
        logger.info(`User registered: ${email}`)
        res.status(201).json(user)
    } catch (e) {
        logger.error(`Registration error: ${e.message}`)
        res.status(500).json({ error: 'server_error', details: String(e) })
    }
}
