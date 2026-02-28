// Minimal Express backend used by the React client.
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'

import pool from './config/database.js'
import logger from './utils/logger.js'
import routes from './routes/index.js'
import { ensureFixedSurvey } from './routes/surveys.js'
import { initializeSystemPrompt } from './services/promptAssemblerService.js'
import { seedTestAccountData } from './services/seedDataService.js'
import { specs } from './config/swagger.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { validateEnvironment } from './config/envValidation.js'
import { startCronJobs } from './services/cronService.js'

const app = express()
const isProduction = process.env.NODE_ENV === 'production'

// Validate environment variables (fails in production if critical vars missing)
validateEnvironment(isProduction)

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            connectSrc: [
                "'self'",
                process.env.MOODLE_BASE_URL,
                process.env.LLM_BASE_URL,
            ].filter(Boolean),
            frameAncestors: ["'none'"],
        }
    }
}))

// Let Express trust reverse proxy headers; important for cookies behind Docker
app.set('trust proxy', isProduction ? 1 : false)
const PORT = process.env.PORT || 8080

// Allow cross-origin requests from the frontend
// Configurable via CORS_ORIGINS environment variable (comma-separated)
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000']

const corsOptions = {
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Parse JSON request bodies
app.use(express.json({ limit: '50kb' }))

// Postgres-backed session store
const PgSession = connectPgSimple(session)

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET ?? (process.env.NODE_ENV !== 'production' ? 'dev-secret' : undefined),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}))

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})

// Health check — used by Docker and load balancers
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// Mount all routes under /api with rate limiting
app.use('/api', apiLimiter, routes)

// Swagger API Documentation (dev only)
if (!isProduction) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'server_error',
    message: isProduction ? 'An internal server error occurred' : err.message
  });
});

// Start server
app.listen(PORT, async () => {
  logger.info(`Backend listening on http://0.0.0.0:${PORT}`)

  // Initialize system prompt (seeds from file if database is empty)
  try {
    await initializeSystemPrompt()
  } catch (e) {
    logger.error('Failed to initialize system prompt:', e.message)
  }

  // Ensure the fixed Self-Regulated Learning Questionnaire exists
  try {
    await ensureFixedSurvey()
  } catch (e) {
    logger.error('Failed to initialize fixed survey:', e.message)
  }

  // Generate simulated data for seed test accounts (skipped when SIMULATION_MODE=false)
  // Awaited so that the score recomputation pass finishes before the first client request
  try {
    await seedTestAccountData()
  } catch (e) {
    logger.error('Failed to seed test account data:', e.message)
  }

  // Start nightly background jobs
  startCronJobs()
})
