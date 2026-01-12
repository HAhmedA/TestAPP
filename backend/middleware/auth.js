// Authentication middleware
import logger from '../utils/logger.js'

// Middleware to require authenticated user
export const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        logger.warn(`Unauthorized access attempt to ${req.path}`)
        return res.status(401).json({ error: 'not_authenticated' })
    }
    next()
}

// Middleware to require admin role
export const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        logger.warn(`Unauthorized admin access attempt to ${req.path}`)
        return res.status(401).json({ error: 'not_authenticated' })
    }
    const user = req.session.user
    const isAdmin = user.role === 'admin' || user.email === 'admin@example.com'
    if (!isAdmin) {
        logger.warn(`Non-admin user ${user.email} attempted to access ${req.path}`)
        return res.status(403).json({ error: 'forbidden', message: 'Admin access required' })
    }
    next()
}
