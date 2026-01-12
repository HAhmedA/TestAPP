// Route aggregator
import { Router } from 'express'
import authRoutes from './auth.js'
import surveyRoutes from './surveys.js'
import resultRoutes from './results.js'
import moodRoutes from './mood.js'
import annotationRoutes from './annotations.js'
import profileRoutes from './profile.js'
import adminRoutes from './admin.js'

import { login, logout, getMe } from '../controllers/authController.js'

const router = Router()

// Mount routes
router.use('/auth', authRoutes)

// Legacy Auth Aliases (Backward Compatibility)
router.post('/login', login)
router.post('/logout', logout)
router.get('/me', getMe)

router.use('/', surveyRoutes) // Mounts directly since paths are like /api/create, /api/getActive
router.use('/', resultRoutes) // Mounts directly for /api/results, /api/post etc.

// Namespaced routes
router.use('/student/mood', moodRoutes)
router.use('/annotations', annotationRoutes)
router.use('/profile', profileRoutes)
router.use('/admin', adminRoutes)

export default router
