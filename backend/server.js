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
import { AnnotationsService } from './annotations.js'

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
const isProduction = process.env.NODE_ENV === 'production'
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    // Ensure session table exists if missing
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction, // allow HTTP locally, secure in production
    // Keep users logged in across refreshes (30 days)
    maxAge: 1000 * 60 * 60 * 24 * 30
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
  body('password').isString().notEmpty()
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

// User profile endpoints
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const { rows } = await pool.query(
      'SELECT * FROM public.user_profiles WHERE user_id = $1',
      [userId]
    )

    if (rows.length === 0) {
      return res.json(null) // No profile yet
    }

    const profile = rows[0]
    res.json({
      userId: profile.user_id,
      eduLevel: profile.edu_level,
      fieldOfStudy: profile.field_of_study,
      major: profile.major,
      learningFormats: profile.learning_formats || [],
      disabilities: profile.disabilities || {},
      createdAt: profile.created_at,
      updatedAt: profile.updated_at
    })
  } catch (e) {
    console.error('Profile fetch error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

app.post('/api/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const { eduLevel, fieldOfStudy, major, learningFormats, disabilities } = req.body

    // Validate learning_formats is an array if provided
    let learningFormatsJson = null
    if (learningFormats && Array.isArray(learningFormats)) {
      learningFormatsJson = JSON.stringify(learningFormats)
    }

    // Validate disabilities - convert array to structured format by category
    let disabilitiesJson = null
    if (disabilities) {
      if (typeof disabilities === 'object' && !Array.isArray(disabilities)) {
        // Already in structured format
        disabilitiesJson = JSON.stringify(disabilities)
      } else if (Array.isArray(disabilities) && disabilities.length > 0) {
        // Convert flat array to structured format by category
        const structuredDisabilities = {}
        const disabilityCategories = {
          'Reading Disabilities': ['Dyslexia', 'Hyperlexia', 'Visual Processing Disorder'],
          'Writing Disabilities': ['Dysgraphia', 'Written Expression Disorder', 'Motor Coordination Disorder'],
          'Mathematics Disabilities': ['Dyscalculia', 'Math Reasoning Disorder', 'Number Processing Disorder'],
          'Attention & Focus Disorders': ['Attention Deficit Disorder (ADD)', 'Attention Deficit Hyperactivity Disorder (ADHD)', 'Executive Function Disorder'],
          'Language & Communication Disorders': ['Auditory Processing Disorder (APD)', 'Expressive Language Disorder', 'Receptive Language Disorder'],
          'Memory & Cognitive Processing Disorders': ['Working Memory Deficit', 'Slow Processing Speed', 'Nonverbal Learning Disability (NVLD)'],
          'Autism Spectrum-Related Learning Differences': ['High-Functioning Autism', 'Asperger\'s Syndrome', 'Social Communication Disorder'],
          'Generalized Learning Disorders': ['Specific Learning Disorder (SLD)', 'Global Developmental Delay', 'Mild Cognitive Impairment']
        }
        
        // Group disabilities by category
        disabilities.forEach(disability => {
          for (const [category, items] of Object.entries(disabilityCategories)) {
            if (items.includes(disability)) {
              if (!structuredDisabilities[category]) {
                structuredDisabilities[category] = []
              }
              structuredDisabilities[category].push(disability)
              break
            }
          }
        })
        
        disabilitiesJson = JSON.stringify(structuredDisabilities)
      }
    }

    const query = `
      INSERT INTO public.user_profiles 
        (user_id, edu_level, field_of_study, major, learning_formats, disabilities, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now(), now())
      ON CONFLICT (user_id)
      DO UPDATE SET
        edu_level = EXCLUDED.edu_level,
        field_of_study = EXCLUDED.field_of_study,
        major = EXCLUDED.major,
        learning_formats = EXCLUDED.learning_formats,
        disabilities = EXCLUDED.disabilities,
        updated_at = now()
      RETURNING *
    `

    const result = await pool.query(query, [
      userId,
      eduLevel || null,
      fieldOfStudy || null,
      major || null,
      learningFormatsJson,
      disabilitiesJson
    ])

    const profile = result.rows[0]
    res.json({
      userId: profile.user_id,
      eduLevel: profile.edu_level,
      fieldOfStudy: profile.field_of_study,
      major: profile.major,
      learningFormats: profile.learning_formats || [],
      disabilities: profile.disabilities || {},
      createdAt: profile.created_at,
      updatedAt: profile.updated_at
    })
  } catch (e) {
    console.error('Profile save error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
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
    await pool.query('INSERT INTO public.results (id, postid, json, user_id, created_at) VALUES ($1, $2, $3::json, $4, now())', [id, postId, JSON.stringify(surveyResult), userId])
    res.json({ id, postId })
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Student mood endpoint: get mood statistics for a specific student
app.get('/api/student/mood', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const { period } = req.query // 'today' or '7days'
    const surveyId = req.query.surveyId

    if (!surveyId) {
      return res.status(400).json({ error: 'surveyId required' })
    }

    // Get survey structure to extract construct names
    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) {
      return res.status(404).json({ error: 'survey_not_found' })
    }

    const survey = surveyResult.rows[0]
    const constructs = []
    if (survey.json && survey.json.pages) {
      survey.json.pages.forEach((page) => {
        if (page.elements) {
          page.elements.forEach((element) => {
            if (element.name && element.type === 'rating') {
              constructs.push({
                name: element.name,
                title: element.title
              })
            }
          })
        }
      })
    }

    // Build date filter
    let dateFilter = ''
    if (period === 'today') {
      dateFilter = "AND DATE(created_at) = CURRENT_DATE"
    } else if (period === '7days') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'"
    }

    // Get results for this user and survey
    const resultsQuery = await pool.query(
      `SELECT id, json, created_at FROM public.results 
       WHERE postid = $1 AND user_id = $2 ${dateFilter}
       ORDER BY created_at ASC`,
      [surveyId, userId]
    )

    const results = resultsQuery.rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      data: typeof row.json === 'string' ? JSON.parse(row.json) : row.json
    }))

    if (results.length === 0) {
      // Return constructs list even when no data, so frontend knows what to display
      const emptyConstructs = constructs.map(construct => ({
        name: construct.name,
        title: construct.title,
        average: null,
        min: null,
        max: null,
        count: 0
      }))
      return res.json({
        period,
        constructs: emptyConstructs,
        hasData: false,
        totalResponses: 0
      })
    }

    // Calculate statistics for each construct
    const constructStats = constructs.map(construct => {
      const values = results
        .map(result => {
          const value = result.data[construct.name]
          return value !== undefined && value !== null ? Number(value) : null
        })
        .filter(v => v !== null && !isNaN(v))

      if (values.length === 0) {
        return {
          name: construct.name,
          title: construct.title,
          average: null,
          min: null,
          max: null,
          count: 0
        }
      }

      const sum = values.reduce((a, b) => a + b, 0)
      const avg = sum / values.length
      const min = Math.min(...values)
      const max = Math.max(...values)

      return {
        name: construct.name,
        title: construct.title,
        average: Math.round(avg * 10) / 10,
        min,
        max,
        count: values.length
      }
    })

    // Generate and store annotations using the Annotations module
    const annotationsService = new AnnotationsService(pool)
    try {
      // Delete old insufficient_data annotations first
      await pool.query(
        `DELETE FROM public.annotations 
         WHERE user_id = $1 AND survey_id = $2 AND period = $3 
         AND (annotation_text LIKE '%insufficient data%' OR statistics->'trend'->>'type' = 'insufficient_data')`,
        [userId, surveyId, period]
      )
      
      await annotationsService.generateAndStoreAnnotations(
        userId,
        surveyId,
        period,
        results,
        constructs
      )
    } catch (annotationError) {
      // Log but don't fail the request if annotation generation fails
      console.error('Annotation generation error:', annotationError)
    }

    res.json({
      period,
      constructs: constructStats,
      hasData: true,
      totalResponses: results.length
    })
  } catch (e) {
    console.error('Student mood error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Student mood history endpoint: get all responses with dates for line graph
app.get('/api/student/mood/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const surveyId = req.query.surveyId
    const period = req.query.period // 'today' or undefined (for all time)
    if (!surveyId) {
      return res.status(400).json({ error: 'surveyId required' })
    }

    // Get survey structure to extract construct names
    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) {
      return res.status(404).json({ error: 'survey_not_found' })
    }

    const survey = surveyResult.rows[0]
    const constructs = []
    if (survey.json && survey.json.pages) {
      survey.json.pages.forEach((page) => {
        if (page.elements) {
          page.elements.forEach((element) => {
            if (element.name && element.type === 'rating') {
              constructs.push({
                name: element.name,
                title: element.title
              })
            }
          })
        }
      })
    }

    // Build date filter for "today" period
    let dateFilter = ''
    if (period === 'today') {
      dateFilter = "AND DATE(created_at) = CURRENT_DATE"
    }

    // Get all results for this user and survey
    const resultsQuery = await pool.query(
      `SELECT id, json, created_at FROM public.results 
       WHERE postid = $1 AND user_id = $2 ${dateFilter}
       ORDER BY created_at ASC`,
      [surveyId, userId]
    )

    const results = resultsQuery.rows.map(row => {
      const data = typeof row.json === 'string' ? JSON.parse(row.json) : row.json
      const date = new Date(row.created_at)
      const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
      const timeStr = date.toTimeString().split(' ')[0].substring(0, 5) // HH:MM

      return {
        id: row.id,
        date: dateStr,
        time: timeStr,
        timestamp: row.created_at,
        data
      }
    })

    let chartData = []

    if (period === 'today') {
      // For today, show individual responses with time
      chartData = results.map(result => {
        const point = { time: result.time, timestamp: result.timestamp }
        constructs.forEach(construct => {
          const value = result.data[construct.name]
          if (value !== undefined && value !== null) {
            const numValue = Number(value)
            if (!isNaN(numValue)) {
              point[construct.name] = numValue
            } else {
              point[construct.name] = null
            }
          } else {
            point[construct.name] = null
          }
        })
        return point
      })
    } else {
      // For other periods, group by date and calculate daily averages
      const dailyData = {}
      results.forEach(result => {
        if (!dailyData[result.date]) {
          dailyData[result.date] = {}
          constructs.forEach(construct => {
            dailyData[result.date][construct.name] = []
          })
        }
        constructs.forEach(construct => {
          const value = result.data[construct.name]
          if (value !== undefined && value !== null) {
            const numValue = Number(value)
            if (!isNaN(numValue)) {
              dailyData[result.date][construct.name].push(numValue)
            }
          }
        })
      })

      // Calculate daily averages
      chartData = Object.keys(dailyData).sort().map(date => {
        const dayData = { date }
        constructs.forEach(construct => {
          const values = dailyData[date][construct.name]
          if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0)
            dayData[construct.name] = Math.round((sum / values.length) * 10) / 10
          } else {
            dayData[construct.name] = null
          }
        })
        return dayData
      })
    }

    res.json({
      constructs: constructs.map(c => ({ name: c.name, title: c.title })),
      data: chartData,
      period: period || 'all'
    })
  } catch (e) {
    console.error('Student mood history error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Annotations endpoint: get annotations for a user's survey results
app.get('/api/annotations', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const { surveyId, period } = req.query

    if (!surveyId || !period) {
      return res.status(400).json({ error: 'surveyId and period are required' })
    }

    if (period !== 'today' && period !== '7days') {
      return res.status(400).json({ error: 'period must be "today" or "7days"' })
    }

    const annotationsService = new AnnotationsService(pool)
    const annotations = await annotationsService.getAnnotations(userId, surveyId, period)

    // Filter out any annotations with insufficient data (double-check)
    const filteredAnnotations = annotations.filter(a => {
      if (a.annotationText && a.annotationText.toLowerCase().includes('insufficient data')) {
        return false
      }
      if (a.statistics && a.statistics.trend && a.statistics.trend.type === 'insufficient_data') {
        return false
      }
      return true
    })

    res.json({
      period,
      annotations: filteredAnnotations.map(a => ({
        constructName: a.constructName,
        constructTitle: a.constructTitle,
        annotationText: a.annotationText,
        statistics: a.statistics
      }))
    })
  } catch (e) {
    console.error('Annotations fetch error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Dashboard endpoint: aggregate results by question
app.get('/api/results/dashboard/:surveyId', async (req, res) => {
  try {
    const surveyId = req.params.surveyId
    
    // Get survey structure
    const surveyResult = await pool.query('SELECT id, name, json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) {
      return res.status(404).json({ error: 'survey_not_found' })
    }
    const survey = surveyResult.rows[0]
    
    // Get all results for this survey (admin sees all, not filtered by user)
    const resultsQuery = await pool.query('SELECT id, json, user_id FROM public.results WHERE postid = $1', [surveyId])
    const results = resultsQuery.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      data: typeof row.json === 'string' ? JSON.parse(row.json) : row.json
    }))
    
    // Extract questions from survey structure
    const questions = []
    if (survey.json && survey.json.pages) {
      survey.json.pages.forEach((page) => {
        if (page.elements) {
          page.elements.forEach((element) => {
            if (element.name && element.title) {
              questions.push({
                name: element.name,
                title: element.title,
                type: element.type || 'text',
                choices: element.choices || (element.type === 'radiogroup' || element.type === 'checkbox' ? [] : null),
                rateValues: element.rateValues,
                rateMin: element.rateMin || 1,
                rateMax: element.rateMax || 5,
                mininumRateDescription: element.mininumRateDescription,
                maximumRateDescription: element.maximumRateDescription
              })
            }
          })
        }
      })
    }
    
    // Aggregate responses by question
    const aggregated = questions.map(question => {
      const responses = results
        .map(result => {
          // Handle nested answers (e.g., question name might be nested in object)
          let value = result.data[question.name]
          if (value === undefined) {
            // Try to find nested values
            const keys = Object.keys(result.data)
            for (const key of keys) {
              if (typeof result.data[key] === 'object' && result.data[key] !== null) {
                value = result.data[key][question.name]
                if (value !== undefined) break
              }
            }
          }
          return value
        })
        .filter(v => v !== undefined && v !== null && v !== '')
      
      const totalResponses = responses.length
      const responseRate = results.length > 0 ? (totalResponses / results.length) * 100 : 0
      
      let aggregation = {
        questionName: question.name,
        questionTitle: question.title,
        questionType: question.type,
        totalResponses,
        responseRate: Math.round(responseRate * 10) / 10,
        totalSubmissions: results.length
      }
      
      // Aggregate based on question type
      if (question.type === 'rating') {
        const numericResponses = responses.map(r => Number(r)).filter(n => !isNaN(n))
        if (numericResponses.length > 0) {
          const sum = numericResponses.reduce((a, b) => a + b, 0)
          const avg = sum / numericResponses.length
          const min = Math.min(...numericResponses)
          const max = Math.max(...numericResponses)
          
          // Distribution
          const distribution = {}
          numericResponses.forEach(r => {
            distribution[r] = (distribution[r] || 0) + 1
          })
          
          aggregation.average = Math.round(avg * 10) / 10
          aggregation.min = min
          aggregation.max = max
          aggregation.distribution = distribution
          aggregation.allResponses = numericResponses
        }
      } else if (question.type === 'radiogroup' || question.type === 'dropdown') {
        // Count each choice
        const choiceCounts = {}
        responses.forEach(r => {
          const key = String(r)
          choiceCounts[key] = (choiceCounts[key] || 0) + 1
        })
        aggregation.choiceCounts = choiceCounts
        aggregation.allResponses = responses
      } else if (question.type === 'checkbox') {
        // Count each selected option (responses might be arrays)
        const choiceCounts = {}
        responses.forEach(r => {
          const options = Array.isArray(r) ? r : [r]
          options.forEach(opt => {
            const key = String(opt)
            choiceCounts[key] = (choiceCounts[key] || 0) + 1
          })
        })
        aggregation.choiceCounts = choiceCounts
        aggregation.allResponses = responses
      } else if (question.type === 'text' || question.type === 'comment') {
        // Show all text responses
        aggregation.allResponses = responses.map(r => String(r))
        aggregation.uniqueResponses = [...new Set(responses.map(r => String(r)))]
      } else {
        // Default: show all responses
        aggregation.allResponses = responses
      }
      
      return aggregation
    })
    
    res.json({
      surveyId: survey.id,
      surveyName: survey.name,
      totalSubmissions: results.length,
      questions: aggregated
    })
  } catch (e) {
    console.error('Dashboard error:', e)
    res.status(500).json({ error: 'db_error', details: String(e) })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`)
})


