# Sprint 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the five Sprint 2 hardening items: silhouette sampling cap, asyncRoute migration, Compose hardening, sync-all background job with p-limit concurrency, and full node-pg-migrate schema versioning.

**Architecture:** Each task is self-contained and isolated. Tasks 1–3 are mechanical edits with no new dependencies. Task 4 adds `p-limit` and an in-memory job store to the existing LMS routes. Task 5 (migrations) is the most invasive — it replaces `postgres/initdb/` as the schema source of truth. Execute in the order listed; task 5 must be last.

**Note:** P-C2 (cohort-level PGMoE refactor) is intentionally excluded — per-user PGMoE fits are a product decision for per-user cluster granularity.

**Tech Stack:** Node.js ESM, Express, pg, p-limit (ESM), node-pg-migrate, Docker Compose

---

## Task 1: Cap silhouette/Davies-Bouldin to O(100²) — P-C1

**Files:**
- Modify: `backend/services/scoring/clusterPeerService.js` (lines 195–211)

The silhouette and Davies-Bouldin calls are O(N²) and run inside the per-user scoring path. Capping input to 100 random samples bounds cost at ~10K comparisons while keeping diagnostics statistically meaningful. The `nUsers` field in `storeDiagnostics` must still reflect the **real** cohort size (not the sample) so the admin panel shows accurate context.

**Step 1: Locate the diagnostic block**

Open `backend/services/scoring/clusterPeerService.js` and find the block starting at:
```js
// Compute and store diagnostics (fire-and-forget — does not block scoring)
{
    const silhouette = computeSilhouetteScore(centered, model.assignments, k);
```

**Step 2: Replace the diagnostic block**

Replace the entire `{ ... storeDiagnostics(...).catch(...) }` block with:

```js
// Compute and store diagnostics (fire-and-forget — does not block scoring)
// Silhouette/Davies-Bouldin are O(N²). Cap to 100 random samples so cost is
// bounded at ~10K comparisons regardless of cohort size. nUsers still reflects
// the real cohort size so the admin panel shows accurate context.
{
    const DIAG_SAMPLE = 100;
    const nAll = centered.length;
    let sampledCentered, sampledAssignments;
    if (nAll <= DIAG_SAMPLE) {
        sampledCentered    = centered;
        sampledAssignments = model.assignments;
    } else {
        const indices = Array.from({ length: DIAG_SAMPLE }, () =>
            Math.floor(Math.random() * nAll)
        );
        sampledCentered    = indices.map(i => centered[i]);
        sampledAssignments = indices.map(i => model.assignments[i]);
    }

    const silhouette    = computeSilhouetteScore(sampledCentered, sampledAssignments, k);
    const daviesBouldin = computeDaviesBouldinIndex(sampledCentered, sampledAssignments, k, model.means);
    const clusterSizes  = [];
    for (let c = 0; c < k; c++) {
        clusterSizes.push(model.assignments.filter(a => a === c).length);
    }
    storeDiagnostics(conceptId, {
        silhouette,
        daviesBouldin,
        diagnostics,
        clusterSizes,
        nUsers: userIds.length,       // real count, not sample
        nDimensions: dimKeys.length
    }).catch(err => logger.error(`storeDiagnostics fire-and-forget error: ${err.message}`));
}
```

**Step 3: Run the full backend test suite**

```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```
Expected: all 110 tests pass. The pgmoeAlgorithm tests exercise silhouette/DB and will confirm nothing broke.

**Step 4: Commit**

```bash
git add backend/services/scoring/clusterPeerService.js
git commit -m "perf: cap silhouette/Davies-Bouldin to 100-user sample (P-C1)

Silhouette and Davies-Bouldin are O(N²) and run in the per-user scoring path.
Sampling to min(N, 100) bounds cost at ~10K comparisons while nUsers still
reflects the real cohort size for admin diagnostics."
```

---

## Task 2: Migrate chat.js, mood.js, annotations.js, results.js to asyncRoute — FW-H2

**Files:**
- Modify: `backend/routes/chat.js`
- Modify: `backend/routes/mood.js`
- Modify: `backend/routes/annotations.js`
- Modify: `backend/routes/results.js`

**Key rules:**
- Replace every `async (req, res) => { try { ... } catch (e) { res.status(500)... } }` with `asyncRoute(async (req, res) => { ... })`
- Keep all explicit `return res.status(4xx)` guards (400 validations, 403 IDOR, 404 not found) — these are intentional early returns, not errors.
- Remove the redundant `if (!userId) return res.status(401)...` guards in `mood.js` and `annotations.js` — `requireAuth` already guarantees `req.session.user.id`.
- `results.js` has no `requireAuth` — keep it as-is but still wrap with `asyncRoute`.
- Import `asyncRoute` from `'../utils/errors.js'` at the top of each file.

**⚠️ Error response shape change:** The old handlers returned `{ error: 'server_error' }` or `{ error: 'db_error', details: ... }`. `asyncRoute` returns `{ error: 'DB_ERROR', message: 'Database error' }` for generic throws. The HTTP status code (500) is preserved. Update tests accordingly.

**Step 1: Rewrite `backend/routes/annotations.js`**

This is the simplest file — replace the entire content with:

```js
// Annotation routes
import { Router } from 'express'
import pool from '../config/database.js'
import { getAnnotations, getAnnotationsForChatbot } from '../services/annotators/srlAnnotationService.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()
router.use(requireAuth)

// Get annotations for current user (for UI display)
router.get('/', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { timeWindow } = req.query
    const annotations = await getAnnotations(pool, userId, timeWindow, false)
    res.json({ annotations })
}))

// Get annotations formatted for chatbot/LLM
router.get('/chatbot', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const annotationsText = await getAnnotationsForChatbot(pool, userId)
    res.json({ annotationsText })
}))

export default router
```

**Step 2: Rewrite `backend/routes/results.js`**

```js
// Results endpoints
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { saveResponses, computeAnnotations } from '../services/annotators/srlAnnotationService.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()

// Post new result
router.post('/post', asyncRoute(async (req, res) => {
    const { postId, surveyResult } = req.body || {}
    const id = uuidv4()
    const userId = req.session.user?.id || null
    const submittedAt = new Date()

    await pool.query(
        'INSERT INTO public.questionnaire_results (id, postid, answers, user_id, created_at) VALUES ($1, $2, $3::jsonb, $4, $5)',
        [id, postId, JSON.stringify(surveyResult), userId, submittedAt]
    )

    if (userId) {
        await saveResponses(pool, id, userId, surveyResult, submittedAt)

        const surveyQuery = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [postId])
        if (surveyQuery.rows[0]) {
            await computeAnnotations(pool, userId, surveyQuery.rows[0].json)
        }

        // Trigger full score recomputation in background (do not await)
        computeAllScores(userId).catch(err =>
            logger.error('Score recomputation error after SRL submit:', err)
        )
    }

    logger.info(`Survey response submitted for ${postId}`)
    res.json({ id, postId })
}))

export default router
```

**Step 3: Rewrite `backend/routes/mood.js`**

Replace both handlers, removing redundant `userId` null-checks. The file is large; the key change is wrapping both route handlers with `asyncRoute` and removing `if (!userId)` guards. Replace the entire file:

```js
// Student mood routes
import { Router } from 'express'
import pool from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()
router.use(requireAuth)

// Helper: extract rating constructs from survey JSON
function extractConstructs(surveyJson) {
    const constructs = []
    if (surveyJson?.pages) {
        for (const page of surveyJson.pages) {
            for (const element of page.elements ?? []) {
                if (element.name && element.type === 'rating') {
                    constructs.push({ name: element.name, title: element.title })
                }
            }
        }
    }
    return constructs
}

// Get mood statistics
router.get('/', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { period, surveyId } = req.query

    if (!surveyId) return res.status(400).json({ error: 'surveyId required' })

    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) return res.status(404).json({ error: 'survey_not_found' })

    const constructs = extractConstructs(surveyResult.rows[0].json)

    let dateFilter = ''
    if (period === 'today')  dateFilter = "AND DATE(created_at) = CURRENT_DATE"
    if (period === '7days')  dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'"

    const { rows } = await pool.query(
        `SELECT id, answers, created_at FROM public.questionnaire_results
         WHERE postid = $1 AND user_id = $2 ${dateFilter} ORDER BY created_at ASC`,
        [surveyId, userId]
    )
    const results = rows.map(r => ({
        id: r.id, createdAt: r.created_at,
        data: typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers
    }))

    if (results.length === 0) {
        return res.json({
            period,
            constructs: constructs.map(c => ({ ...c, average: null, min: null, max: null, count: 0 })),
            hasData: false,
            totalResponses: 0
        })
    }

    const constructStats = constructs.map(construct => {
        const values = results
            .map(r => r.data[construct.name])
            .filter(v => v != null && !isNaN(Number(v)))
            .map(Number)
        if (values.length === 0) return { ...construct, average: null, min: null, max: null, count: 0 }
        const sum = values.reduce((a, b) => a + b, 0)
        return {
            ...construct,
            average: Math.round((sum / values.length) * 10) / 10,
            min: Math.min(...values),
            max: Math.max(...values),
            count: values.length
        }
    })

    res.json({ period, constructs: constructStats, hasData: true, totalResponses: results.length })
}))

// Get mood history (line graph data)
router.get('/history', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { surveyId, period } = req.query

    if (!surveyId) return res.status(400).json({ error: 'surveyId required' })

    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) return res.status(404).json({ error: 'survey_not_found' })

    const constructs = extractConstructs(surveyResult.rows[0].json)

    let dateFilter = ''
    if (period === 'today') dateFilter = "AND DATE(created_at) = CURRENT_DATE"

    const { rows } = await pool.query(
        `SELECT id, answers, created_at FROM public.questionnaire_results
         WHERE postid = $1 AND user_id = $2 ${dateFilter} ORDER BY created_at ASC`,
        [surveyId, userId]
    )

    const results = rows.map(r => {
        const data = typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers
        const date = new Date(r.created_at)
        return {
            id: r.id,
            date: date.toISOString().split('T')[0],
            time: date.toTimeString().split(' ')[0].substring(0, 5),
            timestamp: r.created_at,
            data
        }
    })

    let chartData = []
    const distinctDays = new Set(results.map(r => r.date))

    if (period === 'today') {
        chartData = results.map(r => {
            const point = { time: r.time, timestamp: r.timestamp }
            constructs.forEach(c => {
                const v = r.data[c.name]
                point[c.name] = (v != null && !isNaN(Number(v))) ? Number(v) : null
            })
            return point
        })
    } else if (period === '7days') {
        chartData = results.map(r => {
            const dt = new Date(r.timestamp)
            const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + r.time
            const point = { date: r.date, time: r.time, datetime: label, timestamp: r.timestamp }
            constructs.forEach(c => {
                const v = r.data[c.name]
                point[c.name] = (v != null && !isNaN(Number(v))) ? Number(v) : null
            })
            return point
        })
    } else {
        const dailyData = {}
        for (const r of results) {
            if (!dailyData[r.date]) {
                dailyData[r.date] = {}
                constructs.forEach(c => { dailyData[r.date][c.name] = [] })
            }
            constructs.forEach(c => {
                const v = r.data[c.name]
                if (v != null && !isNaN(Number(v))) dailyData[r.date][c.name].push(Number(v))
            })
        }
        chartData = Object.keys(dailyData).sort().map(date => {
            const dayData = { date }
            constructs.forEach(c => {
                const values = dailyData[date][c.name]
                dayData[c.name] = values.length > 0
                    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
                    : null
            })
            return dayData
        })
    }

    res.json({
        constructs: constructs.map(c => ({ name: c.name, title: c.title })),
        data: chartData,
        period: period || 'all',
        totalResponses: results.length,
        distinctDayCount: distinctDays.size
    })
}))

export default router
```

**Step 4: Rewrite `backend/routes/chat.js`**

The IDOR check (`pool.query` ownership check returning 403) must stay as an explicit guard — it is not an error, it is an access control decision. Validation guards (400s) also stay explicit. Everything else wraps in `asyncRoute`.

```js
// Chat routes
import { Router } from 'express'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import pool from '../config/database.js'
import { asyncRoute } from '../utils/errors.js'
import {
    sendMessage,
    generateInitialGreeting,
    getSessionHistory,
    getUserSessions,
    getOrCreateSession,
    resetSession
} from '../services/contextManagerService.js'

const router = Router()
router.use(requireAuth)

router.get('/session', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)
    res.json({ sessionId, isNew })
}))

router.get('/initial', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)

    if (!isNew) {
        const recentMessages = await getSessionHistory(sessionId, 10)
        if (recentMessages.length > 0) {
            return res.json({ greeting: null, messages: recentMessages, sessionId, hasExistingSession: true, success: true })
        }
    }

    const result = await generateInitialGreeting(userId)
    res.json({
        greeting: result.greeting,
        messages: null,
        sessionId: result.sessionId,
        hasExistingSession: false,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

router.post('/message', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { message } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' })
    }
    if (message.length > 5000) {
        return res.status(400).json({ error: 'message too long (max 5000 characters)' })
    }

    const result = await sendMessage(userId, message.trim())
    res.json({
        response: result.response,
        sessionId: result.sessionId,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

router.get('/history', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, limit = 20, before } = req.query

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })

    // Ownership check — IDOR guard: user may only read their own sessions
    const { rows: sessionCheck } = await pool.query(
        'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    )
    if (sessionCheck.length === 0) return res.status(403).json({ error: 'forbidden' })

    const parsedLimit = Math.min(parseInt(limit) || 20, 50)
    const messages = await getSessionHistory(sessionId, parsedLimit, before || null)
    res.json({ messages, hasMore: messages.length === parsedLimit })
}))

router.get('/sessions', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const sessions = await getUserSessions(userId)
    res.json({ sessions })
}))

router.post('/reset', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const result = await resetSession(userId)

    if (!result.success) return res.status(500).json({ error: 'reset_failed' })

    const greeting = await generateInitialGreeting(userId)
    res.json({ sessionId: result.newSessionId, greeting: greeting.greeting, success: true })
}))

export default router
```

**Step 5: Update `chat.test.js` — fix service error shape assertion**

The test at line 187–194 currently checks `res.status` is 500 when service throws. The body now comes from `asyncRoute`, so `res.body.error` will be `'DB_ERROR'` instead of `'server_error'`. Verify the test still passes (status 500 is preserved) and optionally add the body assertion:

```js
test('returns 500 when service throws', async () => {
    mockSendMessage.mockRejectedValue(new Error('LLM unavailable'))
    const res = await request(authApp).post('/api/chat/message').send({ message: 'Hello' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('DB_ERROR')   // asyncRoute error shape
})
```

**Step 6: Run the full backend test suite**

```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```
Expected: all tests pass.

**Step 7: Commit**

```bash
git add backend/routes/chat.js backend/routes/mood.js backend/routes/annotations.js backend/routes/results.js backend/tests/chat.test.js
git commit -m "refactor: migrate chat, mood, annotations, results routes to asyncRoute (FW-H2)

Removes raw try/catch from 4 route files. Errors now propagate to the central
Express error middleware via asyncRoute(). Explicit 4xx guards (400 validation,
403 IDOR ownership) remain as intentional early returns."
```

---

## Task 3: Compose hardening + production config — PM-C1/DS-C1

**Files:**
- Modify: `compose.yml`
- Create: `compose.prod.yml`

**Step 1: Add restart policy + fix postgres password in `compose.yml`**

Two edits:

1. Under the `backend:` service, add `restart: unless-stopped` after the `depends_on` block.
2. In the `postgres:` service environment, change:
   ```yaml
   - POSTGRES_PASSWORD=password
   ```
   to:
   ```yaml
   - POSTGRES_PASSWORD=${PGPASSWORD}
   ```

The result for the `backend` service block (verify the indentation matches the file):
```yaml
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      - SESSION_SECRET=${SESSION_SECRET}
      - PGHOST=postgres
      - PGPORT=5432
      - PGUSER=postgres
      - PGPASSWORD=${PGPASSWORD}
      - PGDATABASE=postgres
      - DEBUG_LLM=true
      - MOODLE_BASE_URL=http://host.docker.internal:8888/moodle501
      - MOODLE_TOKEN=${MOODLE_TOKEN:-}
      - NODE_OPTIONS=--dns-result-order=ipv4first
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
```

**Step 2: Create `compose.prod.yml`**

This Compose override file is layered on top of `compose.yml` via:
```bash
docker compose -f compose.yml -f compose.prod.yml up -d
```

```yaml
# Production overrides — use with: docker compose -f compose.yml -f compose.prod.yml up -d
# Requires: SESSION_SECRET, PGPASSWORD, MOODLE_TOKEN set in environment or .env

services:
  backend:
    environment:
      - NODE_ENV=production
      - DEBUG_LLM=false
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    volumes:
      - logs:/app/logs

  postgres:
    # Do not expose postgres port to host in production
    ports: []

volumes:
  logs:
    driver: local
```

**Step 3: Verify `GET /api/health` exists**

Check that `backend/server.js` or a route file defines `GET /api/health`. If not, add it to `backend/server.js` before the main router mount:

```js
// Health check — used by Docker and load balancers
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
```

**Step 4: Commit**

```bash
git add compose.yml compose.prod.yml backend/server.js
git commit -m "infra: add restart policy, fix postgres password, add production compose (PM-C1/DS-C1)

- backend service: restart: unless-stopped
- postgres service: POSTGRES_PASSWORD now reads from \${PGPASSWORD} (not hardcoded)
- compose.prod.yml: NODE_ENV=production, DEBUG_LLM=false, health check, log volume, no exposed postgres port"
```

---

## Task 4: sync-all background job + p-limit forum concurrency — P-C3/PM-H1

**Files:**
- Modify: `backend/routes/lms.js`
- Modify: `backend/services/moodleService.js`
- Modify: `backend/package.json`

**Step 1: Install p-limit**

```bash
cd backend
npm install p-limit
```

Verify it appears in `backend/package.json` dependencies (not devDependencies).

**Step 2: Add p-limit to `moodleService.js` forum discussion fetches**

Find the `fetchForumPosts` function (around line 291). The inner loop over `discussionsResp.discussions` makes one HTTP call per discussion sequentially. Replace it with concurrent fetches bounded to 5.

Add the import at the top of `moodleService.js` (after the existing imports):
```js
import pLimit from 'p-limit'
```

Replace the two nested `for` loops in `fetchForumPosts` (the inner `for (const discussion of ...)` loop) with:

```js
async function fetchForumPosts(moodleUserId, courses, sinceTimestamp) {
    const courseIds = courses.map(c => c.id)
    const forums = await moodleRequest('mod_forum_get_forums_by_courses', { courseids: courseIds })
    if (!Array.isArray(forums) || forums.length === 0) return []

    const posts = []
    const discussionLimit = pLimit(5)

    for (const forum of forums) {
        let discussionsResp
        try {
            discussionsResp = await moodleRequest('mod_forum_get_forum_discussions', {
                forumid: forum.id,
                page:    0,
                perpage: MAX_FORUM_DISCUSSIONS_PER_SYNC,
            })
        } catch (err) {
            logger.warn(`fetchForumPosts: skipping forum ${forum.id} — ${err.message}`)
            continue
        }

        const discussions = discussionsResp?.discussions ?? []
        const discussionResults = await Promise.all(
            discussions.map(discussion =>
                discussionLimit(async () => {
                    try {
                        const postsResp = await moodleRequest('mod_forum_get_discussion_posts', {
                            discussionid: discussion.id,
                        })
                        return (postsResp?.posts ?? []).filter(
                            post => post.userid === moodleUserId && post.created >= sinceTimestamp
                        ).map(post => ({ date: tsToDate(post.created), discussionid: discussion.id }))
                    } catch (err) {
                        logger.warn(`fetchForumPosts: skipping discussion ${discussion.id} — ${err.message}`)
                        return []
                    }
                })
            )
        )
        discussionResults.flat().forEach(p => posts.push(p))
    }
    return posts
}
```

**Step 3: Rewrite `POST /admin/sync-all` as a background job in `lms.js`**

Add the job store and background runner at the top of the file (after imports), and rewrite the two sync endpoints. Replace the entire `lms.js` content:

```js
// LMS Admin Routes
import { Router } from 'express'
import { randomUUID } from 'crypto'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { verifyConnection, syncUserFromMoodle } from '../services/moodleService.js'
import pLimit from 'p-limit'

const router = Router()
router.use(requireAdmin)

// =============================================================================
// IN-MEMORY JOB STORE
// =============================================================================
// Lost on server restart — admin can re-trigger sync-all if needed.

/** @type {Map<string, {status: string, progress: number, total: number, synced: number, skipped: Array, startedAt: string, completedAt: string|null, error: string|null}>} */
const syncJobs = new Map()

async function runSyncJob(jobId, users) {
    const limit = pLimit(5)
    const job = syncJobs.get(jobId)
    job.status = 'running'

    const skipped = []
    let synced = 0

    await Promise.all(
        users.map(user =>
            limit(async () => {
                try {
                    const result = await syncUserFromMoodle(pool, user.id, user.email)
                    if (result.skipped) {
                        skipped.push({ email: user.email, reason: result.reason })
                        logger.info(`sync-all[${jobId}]: skipped ${user.email} (${result.reason})`)
                    } else {
                        synced++
                        logger.info(`sync-all[${jobId}]: synced ${user.email} — ${result.synced} days`)
                    }
                } catch (err) {
                    logger.error(`sync-all[${jobId}]: error for ${user.email}: ${err.message}`)
                    skipped.push({ email: user.email, reason: err.message })
                }
                job.progress = synced + skipped.length
            })
        )
    )

    job.status = 'complete'
    job.synced = synced
    job.skipped = skipped
    job.completedAt = new Date().toISOString()
    logger.info(`sync-all[${jobId}]: complete — ${synced} synced, ${skipped.length} skipped`)
}

// =============================================================================
// CONNECTION STATUS
// =============================================================================

router.get('/admin/connection-status', asyncRoute(async (req, res) => {
    const moodleConfigured = !!(process.env.MOODLE_BASE_URL && process.env.MOODLE_TOKEN)

    if (!moodleConfigured) {
        return res.json({ connected: false, sitename: null, moodleConfigured: false })
    }

    try {
        const { sitename, username } = await verifyConnection()
        res.json({ connected: true, sitename, username, moodleConfigured: true })
    } catch (err) {
        logger.warn(`Moodle connection check failed: ${err.message}`)
        res.json({ connected: false, sitename: null, moodleConfigured: true, error: err.message })
    }
}))

// =============================================================================
// SYNC STATUS
// =============================================================================

router.get('/admin/sync-status', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
        SELECT
            u.id          AS user_id,
            u.name,
            u.email,
            MAX(ls.created_at) FILTER (WHERE ls.is_simulated = false)      AS last_sync,
            COUNT(ls.session_date) FILTER (WHERE ls.is_simulated = false)  AS real_count
        FROM public.users u
        LEFT JOIN public.lms_sessions ls ON ls.user_id = u.id
        WHERE u.role = 'student'
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name
    `)

    res.json(rows.map(r => ({
        userId:        r.user_id,
        name:          r.name,
        email:         r.email,
        hasMoodleData: parseInt(r.real_count || 0) > 0,
        lastSync:      r.last_sync ?? null,
    })))
}))

// =============================================================================
// BULK SYNC — BACKGROUND JOB
// =============================================================================

/**
 * POST /api/lms/admin/sync-all
 * Enqueues a background sync of all students. Returns a jobId immediately.
 * Poll GET /admin/sync-all/status/:jobId for progress.
 */
router.post('/admin/sync-all', asyncRoute(async (req, res) => {
    const { rows: users } = await pool.query(
        `SELECT id, name, email FROM public.users WHERE role = 'student' ORDER BY name`
    )

    const jobId = randomUUID()
    syncJobs.set(jobId, {
        status:      'pending',
        progress:    0,
        total:       users.length,
        synced:      0,
        skipped:     [],
        startedAt:   new Date().toISOString(),
        completedAt: null,
        error:       null,
    })

    // Fire-and-forget — do not await
    setImmediate(() => {
        runSyncJob(jobId, users).catch(err => {
            const job = syncJobs.get(jobId)
            if (job) {
                job.status = 'failed'
                job.error  = err.message
                job.completedAt = new Date().toISOString()
            }
            logger.error(`sync-all[${jobId}]: unexpected failure: ${err.message}`)
        })
    })

    logger.info(`sync-all[${jobId}]: queued for ${users.length} students`)
    res.status(202).json({ jobId, total: users.length, status: 'pending' })
}))

/**
 * GET /api/lms/admin/sync-all/status/:jobId
 * Poll for sync-all job progress.
 */
router.get('/admin/sync-all/status/:jobId', asyncRoute(async (req, res) => {
    const job = syncJobs.get(req.params.jobId)
    if (!job) throw Errors.NOT_FOUND('Sync job')
    res.json({ jobId: req.params.jobId, ...job })
}))

// =============================================================================
// SINGLE USER SYNC
// =============================================================================

router.post('/admin/sync/:userId', asyncRoute(async (req, res) => {
    const { userId } = req.params

    const { rows } = await pool.query(
        `SELECT id, email FROM public.users WHERE id = $1`,
        [userId]
    )
    if (rows.length === 0) throw Errors.NOT_FOUND('User')

    const result = await syncUserFromMoodle(pool, rows[0].id, rows[0].email)
    res.json(result)
}))

export default router
```

**Step 4: Run the full backend test suite**

```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```
Expected: all tests pass.

**Step 5: Commit**

```bash
git add backend/routes/lms.js backend/services/moodleService.js backend/package.json backend/package-lock.json
git commit -m "feat: sync-all background job + p-limit(5) forum concurrency (P-C3/PM-H1)

POST /api/lms/admin/sync-all now returns 202 {jobId} immediately.
New GET /admin/sync-all/status/:jobId polls progress from in-memory store.
5 user syncs run concurrently via p-limit. Forum discussion fetches within
each syncUserFromMoodle also use p-limit(5) instead of sequential iteration."
```

---

## Task 5: node-pg-migrate schema versioning — DB-C1

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/Dockerfile`
- Modify: `compose.yml`
- Modify: `.env.example`
- Create: `backend/migrations/` (15 SQL files)
- Keep: `postgres/initdb/` (retained for reference, no longer mounted)

**⚠️ Caution:** After this task, `docker compose up` no longer uses `postgres/initdb/`. Fresh environments create the schema via migrations on backend startup. Existing Docker volumes already have the schema — migrations detect this via the `pgmigrations` table and skip already-applied files.

**Step 1: Install node-pg-migrate**

```bash
cd backend
npm install node-pg-migrate
```

**Step 2: Add scripts to `backend/package.json`**

```json
"scripts": {
    "start": "node-pg-migrate up -m migrations --envPath ../.env && node server.js",
    "migrate": "node-pg-migrate up -m migrations --envPath ../.env",
    "migrate:down": "node-pg-migrate down -m migrations --envPath ../.env",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
},
```

The `--envPath ../.env` points to the root `.env` file (one level up from `backend/`). In Docker, environment variables come from the Compose environment block directly, so this is only used in local development outside Docker.

**Step 3: Add `DATABASE_URL` to `compose.yml`**

In the `backend` service `environment` block, add:
```yaml
- DATABASE_URL=postgres://${PGUSER:-postgres}:${PGPASSWORD}@postgres:5432/${PGDATABASE:-postgres}
```

**Step 4: Add `DATABASE_URL` to `.env.example`**

Add after the `PGDATABASE` line:
```
DATABASE_URL=postgres://postgres:password@localhost:5433/postgres
```

(Note: use port 5433 since the Docker Compose maps `5433:5432`.)

**Step 5: Update `backend/Dockerfile`**

Change the CMD to run migrations before starting the server:

```dockerfile
# Simple Node image to run the Express backend
FROM node:18-alpine
WORKDIR /app

# Install curl for production health check
RUN apk add --no-cache curl

# Install only runtime dependencies
COPY package.json ./
RUN npm install --only=production --no-audit --no-fund

# Copy application source
COPY . .

ENV PORT=8080
EXPOSE 8080
# Run migrations then start the app
CMD ["sh", "-c", "npm run migrate && node server.js"]
```

**Step 6: Create `backend/migrations/` directory and convert SQL files**

Create one `.sql` migration file per initdb file. node-pg-migrate executes `.sql` files as-is. File names must be sortable and unique; use timestamp-based prefixes.

Run:
```bash
mkdir -p backend/migrations
```

Then create each migration file by copying the content of the corresponding initdb file. The mapping is:

| initdb file | migration file |
|---|---|
| `postgres/initdb/000_base.sql` | `backend/migrations/1650000000001_base.sql` |
| `postgres/initdb/001_auth_and_sessions.sql` | `backend/migrations/1650000000002_auth-and-sessions.sql` |
| `postgres/initdb/002_sample_users.sql` | `backend/migrations/1650000000003_sample-users.sql` |
| `postgres/initdb/003_profiles_and_prompts.sql` | `backend/migrations/1650000000004_profiles-and-prompts.sql` |
| `postgres/initdb/004_srl_annotations.sql` | `backend/migrations/1650000000005_srl-annotations.sql` |
| `postgres/initdb/004b_sleep_data.sql` | `backend/migrations/1650000000006_sleep-data.sql` |
| `postgres/initdb/005_chatbot_schema.sql` | `backend/migrations/1650000000007_chatbot-schema.sql` |
| `postgres/initdb/006_test_student_data.sql` | `backend/migrations/1650000000008_test-student-data.sql` |
| `postgres/initdb/007_prompt_types.sql` | `backend/migrations/1650000000009_prompt-types.sql` |
| `postgres/initdb/008_screentime_social_data.sql` | `backend/migrations/1650000000010_screentime-social-data.sql` |
| `postgres/initdb/009_lms_data.sql` | `backend/migrations/1650000000011_lms-data.sql` |
| `postgres/initdb/010_concept_scores.sql` | `backend/migrations/1650000000012_concept-scores.sql` |
| `postgres/initdb/011_peer_clusters.sql` | `backend/migrations/1650000000013_peer-clusters.sql` |
| `postgres/initdb/012_onboarding.sql` | `backend/migrations/1650000000014_onboarding.sql` |
| `postgres/initdb/013_cluster_diagnostics.sql` | `backend/migrations/1650000000015_cluster-diagnostics.sql` |

Copy each file's SQL content verbatim. Do not add `BEGIN`/`COMMIT` — node-pg-migrate wraps each migration in a transaction automatically.

You can do this with a script:
```bash
cp postgres/initdb/000_base.sql backend/migrations/1650000000001_base.sql
cp postgres/initdb/001_auth_and_sessions.sql backend/migrations/1650000000002_auth-and-sessions.sql
cp postgres/initdb/002_sample_users.sql backend/migrations/1650000000003_sample-users.sql
cp postgres/initdb/003_profiles_and_prompts.sql backend/migrations/1650000000004_profiles-and-prompts.sql
cp postgres/initdb/004_srl_annotations.sql backend/migrations/1650000000005_srl-annotations.sql
cp postgres/initdb/004b_sleep_data.sql backend/migrations/1650000000006_sleep-data.sql
cp postgres/initdb/005_chatbot_schema.sql backend/migrations/1650000000007_chatbot-schema.sql
cp postgres/initdb/006_test_student_data.sql backend/migrations/1650000000008_test-student-data.sql
cp postgres/initdb/007_prompt_types.sql backend/migrations/1650000000009_prompt-types.sql
cp postgres/initdb/008_screentime_social_data.sql backend/migrations/1650000000010_screentime-social-data.sql
cp postgres/initdb/009_lms_data.sql backend/migrations/1650000000011_lms-data.sql
cp postgres/initdb/010_concept_scores.sql backend/migrations/1650000000012_concept-scores.sql
cp postgres/initdb/011_peer_clusters.sql backend/migrations/1650000000013_peer-clusters.sql
cp postgres/initdb/012_onboarding.sql backend/migrations/1650000000014_onboarding.sql
cp postgres/initdb/013_cluster_diagnostics.sql backend/migrations/1650000000015_cluster-diagnostics.sql
```

**Step 7: Remove initdb volume mount from `compose.yml`**

In the `postgres` service `volumes` block, remove the line:
```yaml
      - ./postgres/initdb:/docker-entrypoint-initdb.d
```

Keep the `pgdata` volume mount.

**Step 8: Dry-run migrations against a local database**

If you have the stack running locally:
```bash
cd backend
DATABASE_URL=postgres://postgres:password@localhost:5433/postgres npm run migrate -- --dry-run
```
Expected output: 15 migrations listed as "pending" (or "already applied" if the DB already has the tables).

If all 15 are listed as pending on a fresh database, run for real:
```bash
DATABASE_URL=postgres://postgres:password@localhost:5433/postgres npm run migrate
```
Expected: all 15 migrations applied, schema created.

**Step 9: Run the backend test suite**

```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```
Expected: all tests pass.

**Step 10: Commit**

```bash
git add backend/migrations/ backend/package.json backend/package-lock.json backend/Dockerfile compose.yml .env.example
git commit -m "feat: adopt node-pg-migrate for schema versioning (DB-C1)

Converts 15 postgres/initdb/ SQL files to numbered node-pg-migrate migrations.
Backend runs 'node-pg-migrate up' on startup before Express starts.
Fresh docker compose up creates the schema via migrations (initdb volume mount removed).
DATABASE_URL added to compose.yml backend environment and .env.example."
```

---

## Final Verification

After all 5 tasks are committed:

```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```
Expected: all tests pass.

Check git log:
```bash
git log --oneline -6
```
Expected: 5 new commits above the previous Sprint 1 work.
