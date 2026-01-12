// Minimal Express backend used by the React client.
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import pool from './config/database.js'
import logger from './utils/logger.js'
import routes from './routes/index.js'

import helmet from 'helmet'

const app = express()

// Security headers
app.use(helmet())

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() })
})

// Let Express trust reverse proxy headers; important for cookies behind Docker
app.set('trust proxy', 1)
const PORT = process.env.PORT || 8080

// Allow cross-origin requests from the frontend
const corsOptions = {
  origin: ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Parse JSON request bodies
app.use(express.json())

// Postgres-backed session store
const PgSession = connectPgSimple(session)
const isProduction = process.env.NODE_ENV === 'production'

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}))

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})

import swaggerUi from 'swagger-ui-express'
import { specs } from './config/swagger.js'

// ... existing code ...

import { apiLimiter } from './middleware/rateLimit.js'

// Mount all routes under /api with rate limiting
app.use('/api', apiLimiter, routes)

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'server_error',
    message: isProduction ? 'An internal server error occurred' : err.message
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Backend listening on http://0.0.0.0:${PORT}`)
})
