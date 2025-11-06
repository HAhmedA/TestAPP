// Minimal Express backend used by the React client.
// Responsibilities:
// - Session-based auth for demo (admin/student)
// - Survey CRUD persisted in Postgres (tables: public.surveys, public.results)
// - CORS configured for the frontend on http://localhost:3000
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import bcrypt from 'bcrypt'
import { body, validationResult } from 'express-validator'
import { v4 as uuidv4 } from 'uuid'
import pkg from 'pg'
const { Pool } = pkg

const app = express()
// Let Express trust reverse proxy headers; important for cookies behind Docker
app.set('trust proxy', 1)
const PORT = process.env.PORT || 8080

// Database pool
// These values are injected from docker compose (see compose.yml)
const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'password',
  database: process.env.PGDATABASE || 'postgres',
})

// Allow cross-origin requests from the frontend (credentials required for session cookie)
const corsOptions = {
  origin: ['http://localhost:3000'],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
// Parse JSON request bodies
app.use(express.json())
// Postgres-backed session store
const PgSession = connectPgSimple(session)
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}))

// Helper mappers
// Normalize DB rows to the shape expected by the frontend
const mapSurveyRow = (row) => ({ id: row.id, name: row.name, json: row.json })

// Auth endpoints (registration/login/logout/me)
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ error: 'validation_error', details: errors.array() })
    next()
  }
]

app.post('/api/auth/register', validate([
  body('email').isEmail().normalizeEmail(),
  body('name').isString().isLength({ min: 1, max: 255 }).trim(),
  body('password').isString().isLength({ min: 8, max: 200 })
]), async (req, res) => {
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
    res.status(201).json(user)
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) })
  }
})

app.post('/api/auth/login', validate([
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 200 })
]), async (req, res) => {
  try {
    const { email, password } = req.body
    const { rows } = await pool.query('SELECT id, email, name, password_hash FROM public.users WHERE email = $1', [email])
    const row = rows[0]
    if (!row) return res.status(401).json({ error: 'invalid_credentials' })
    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' })
    const user = { id: row.id, email: row.email, name: row.name }
    req.session.user = user
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) })
  }
})

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({}))
})

app.get('/api/auth/me', (req, res) => {
  res.json(req.session.user || null)
})

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'unauthorized' })
  next()
}

// Backwards-compatible endpoints used by the current frontend
app.post('/api/login', async (req, res) => {
  // If email/password present, use real login
  if (req.body?.email && req.body?.password) {
    req.url = '/api/auth/login'
    return app._router.handle(req, res)
  }
  // Fallback demo role-based login
  const role = req.body?.role === 'admin' ? 'admin' : 'student'
  const user = { id: 'demo-user', role }
  req.session.user = user
  res.json(user)
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({}))
})

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null)
})

// Survey endpoints (compatible with frontend expectations)
// Return all surveys
app.get('/api/getActive', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, json FROM public.surveys ORDER BY name NULLS LAST')
    res.json(rows.map(mapSurveyRow))
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Create a new survey with the default 14-question template (GET variant)
app.get('/api/create', async (req, res) => {
  try {
    const id = uuidv4()
    const name = 'New Survey'
    const json = {
      pages: [{
        elements: [
          { type: 'rating', name: 'efficiency', title: 'I believe I can accomplish my learning duties and learning tasks efficiently:', mininumRateDescription: 'Strongly disagree', maximumRateDescription: 'Strongly agree' },
          { type: 'rating', name: 'importance', title: 'I believe that my learning tasks are very important to me:', mininumRateDescription: 'Not important', maximumRateDescription: 'Very important' },
          { type: 'rating', name: 'tracking', title: 'I am keeping track of what I need to do or accomplish:', mininumRateDescription: 'Never', maximumRateDescription: 'Always' },
          { type: 'rating', name: 'clarity', title: 'I know what I have to do to accomplish my learning tasks:', mininumRateDescription: 'Not clear', maximumRateDescription: 'Very clear' },
          { type: 'rating', name: 'effort', title: 'I am putting enough effort into my learning tasks to accomplish them well:', mininumRateDescription: 'Not enough effort', maximumRateDescription: 'A lot of effort' },
          { type: 'rating', name: 'focus', title: 'I am focusing on performing my learning tasks today and resisting distractions:', mininumRateDescription: 'Easily distracted', maximumRateDescription: 'Highly focused' },
          { type: 'rating', name: 'help_seeking', title: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks:', mininumRateDescription: 'Never seek help', maximumRateDescription: 'Always seek help' },
          { type: 'rating', name: 'community', title: 'I am having nice interactions and feeling at home within the college community:', mininumRateDescription: 'Not at all', maximumRateDescription: 'Very much' },
          { type: 'rating', name: 'timeliness', title: 'I am doing my studies on time and keeping up with tasks/deadlines:', mininumRateDescription: 'Always late', maximumRateDescription: 'Always on time' },
          { type: 'rating', name: 'motivation', title: 'I feel enthusiastic/motivated to learn, understand, and get better grades:', mininumRateDescription: 'Not motivated', maximumRateDescription: 'Highly motivated' },
          { type: 'rating', name: 'anxiety', title: 'I feel anxious/stressed working on learning tasks, assignments, or in class:', mininumRateDescription: 'Never anxious', maximumRateDescription: 'Very anxious' },
          { type: 'rating', name: 'enjoyment', title: 'I enjoy my tasks and feel happy about my achievements/work/accomplishment:', mininumRateDescription: 'Do not enjoy', maximumRateDescription: 'Enjoy a lot' },
          { type: 'rating', name: 'learning_from_feedback', title: 'I am learning from feedback and mistakes to accomplish my learning:', mininumRateDescription: 'Rarely learn from feedback', maximumRateDescription: 'Always learn from feedback' },
          { type: 'rating', name: 'self_assessment', title: 'I always assess my performance or work on tasks to improve my skills:', mininumRateDescription: 'Never assess', maximumRateDescription: 'Always assess' }
        ]
      }]
    }
    const { rows } = await pool.query(
      'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::json) RETURNING id, name, json',
      [id, name, JSON.stringify(json)]
    )
    res.json(mapSurveyRow(rows[0]))
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.post('/api/create', async (req, res) => {
  try {
    const id = uuidv4()
    const name = 'New Survey'
    const json = {
      pages: [{
        elements: [
          { type: 'rating', name: 'efficiency', title: 'I believe I can accomplish my learning duties and learning tasks efficiently:', mininumRateDescription: 'Strongly disagree', maximumRateDescription: 'Strongly agree' },
          { type: 'rating', name: 'importance', title: 'I believe that my learning tasks are very important to me:', mininumRateDescription: 'Not important', maximumRateDescription: 'Very important' },
          { type: 'rating', name: 'tracking', title: 'I am keeping track of what I need to do or accomplish:', mininumRateDescription: 'Never', maximumRateDescription: 'Always' },
          { type: 'rating', name: 'clarity', title: 'I know what I have to do to accomplish my learning tasks:', mininumRateDescription: 'Not clear', maximumRateDescription: 'Very clear' },
          { type: 'rating', name: 'effort', title: 'I am putting enough effort into my learning tasks to accomplish them well:', mininumRateDescription: 'Not enough effort', maximumRateDescription: 'A lot of effort' },
          { type: 'rating', name: 'focus', title: 'I am focusing on performing my learning tasks today and resisting distractions:', mininumRateDescription: 'Easily distracted', maximumRateDescription: 'Highly focused' },
          { type: 'rating', name: 'help_seeking', title: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks:', mininumRateDescription: 'Never seek help', maximumRateDescription: 'Always seek help' },
          { type: 'rating', name: 'community', title: 'I am having nice interactions and feeling at home within the college community:', mininumRateDescription: 'Not at all', maximumRateDescription: 'Very much' },
          { type: 'rating', name: 'timeliness', title: 'I am doing my studies on time and keeping up with tasks/deadlines:', mininumRateDescription: 'Always late', maximumRateDescription: 'Always on time' },
          { type: 'rating', name: 'motivation', title: 'I feel enthusiastic/motivated to learn, understand, and get better grades:', mininumRateDescription: 'Not motivated', maximumRateDescription: 'Highly motivated' },
          { type: 'rating', name: 'anxiety', title: 'I feel anxious/stressed working on learning tasks, assignments, or in class:', mininumRateDescription: 'Never anxious', maximumRateDescription: 'Very anxious' },
          { type: 'rating', name: 'enjoyment', title: 'I enjoy my tasks and feel happy about my achievements/work/accomplishment:', mininumRateDescription: 'Do not enjoy', maximumRateDescription: 'Enjoy a lot' },
          { type: 'rating', name: 'learning_from_feedback', title: 'I am learning from feedback and mistakes to accomplish my learning:', mininumRateDescription: 'Rarely learn from feedback', maximumRateDescription: 'Always learn from feedback' },
          { type: 'rating', name: 'self_assessment', title: 'I always assess my performance or work on tasks to improve my skills:', mininumRateDescription: 'Never assess', maximumRateDescription: 'Always assess' }
        ]
      }]
    }
    const { rows } = await pool.query(
      'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::json) RETURNING id, name, json',
      [id, name, JSON.stringify(json)]
    )
    res.json(mapSurveyRow(rows[0]))
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.get('/api/delete', async (req, res) => {
  try {
    const id = req.query.id
    await pool.query('DELETE FROM public.surveys WHERE id = $1', [id])
    res.json({ id })
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.post('/api/delete', async (req, res) => {
  try {
    const id = req.body?.id
    await pool.query('DELETE FROM public.surveys WHERE id = $1', [id])
    res.json({ id })
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.get('/api/getSurvey', async (req, res) => {
  try {
    const id = req.query.surveyId
    const { rows } = await pool.query('SELECT id, name, json FROM public.surveys WHERE id = $1', [id])
    res.json(rows[0] ? mapSurveyRow(rows[0]) : null)
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.post('/api/changeJson', async (req, res) => {
  try {
    const { id, json } = req.body || {}
    const { rows } = await pool.query(
      'UPDATE public.surveys SET json = $2::json WHERE id = $1 RETURNING id, name, json',
      [id, JSON.stringify(json)]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json(mapSurveyRow(rows[0]))
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Results endpoints
app.get('/api/results', async (req, res) => {
  try {
    const postId = req.query.postId
    // If logged in, prefer to scope by user
    if (req.session.user) {
      const { rows } = await pool.query('SELECT id, postid, json FROM public.results WHERE postid = $1 AND user_id = $2', [postId, req.session.user.id])
      return res.json(rows)
    }
    const { rows } = await pool.query('SELECT id, postid, json FROM public.results WHERE postid = $1', [postId])
    return res.json(rows)
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.post('/api/post', async (req, res) => {
  try {
    const { postId, surveyResult } = req.body || {}
    const id = uuidv4()
    const userId = req.session.user?.id || null
    await pool.query('INSERT INTO public.results (id, postid, json, user_id) VALUES ($1, $2, $3::json, $4)', [id, postId, JSON.stringify(surveyResult), userId])
    res.json({ id, postId })
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`)
})


