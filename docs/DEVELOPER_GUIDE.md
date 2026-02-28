# Developer Guide

Reference document for contributors to the student wellbeing dashboard.

---

## 1. Architecture Overview

```
surveyjs-react-client-main/
├── backend/              # Node.js ESM (import/export), Express, pg
│   ├── config/           # Database pool, concept metadata, env validation
│   ├── routes/           # Express route files, aggregated in routes/index.js
│   ├── services/         # Business logic layer
│   │   ├── annotators/   # Rule-based judgment generators (sleep, lms, srl, screen_time)
│   │   ├── scoring/      # PGMoE clustering pipeline
│   │   └── simulators/   # Data simulators for new users
│   ├── utils/            # Shared utilities (errors, logger, withTransaction, stats)
│   └── scripts/          # One-off admin scripts (Moodle setup, etc.)
├── src/                  # React + TypeScript frontend
│   ├── api/              # Typed API client layer (src/api/client.ts)
│   ├── components/       # Reusable UI components
│   ├── pages/            # Route-level page components
│   ├── redux/            # Redux slices and store
│   └── routes/           # React Router routes + NavBar (src/routes/index.tsx)
├── docs/                 # Architecture and developer documentation
└── docker-compose.yml    # PostgreSQL + app stack
```

**Key technology choices:**
- **Backend**: Node.js ESM (all files use `.js` with `import/export` — no CommonJS `require`)
- **Frontend**: React 18 + TypeScript, Redux Toolkit for global state
- **Database**: PostgreSQL via `pg` pool (no ORM)
- **Clustering**: PGMoE (Parsimonious Gaussian Mixture of Experts) — custom implementation

---

## 2. Design Patterns

### Service Layer
All business logic lives in `backend/services/`. Routes call services; services call the database. Services never import from routes.

- `backend/services/annotators/` — one annotator per concept (sleep, lms, srl, screen_time)
- `backend/services/scoring/clusterPeerService.js` — orchestrates the PGMoE pipeline
- `backend/services/moodleService.js` — Moodle REST API adapter

### Repository / Data Access Layer
Raw SQL query functions are separated from business logic:

- `backend/services/scoring/scoreQueryService.js` — reads raw metrics from the DB for clustering
- `backend/services/scoring/clusterStorageService.js` — writes cluster results and user assignments

### Factory Pattern
`backend/utils/errors.js` exports an `Errors` object whose methods construct typed `AppError` instances:

```js
throw Errors.NOT_FOUND('User not found');          // 404
throw Errors.MOODLE_API_ERROR('Quiz fetch failed'); // 502
```

Never construct error objects inline — always use the factory so HTTP status codes stay consistent.

### Strategy Pattern
`backend/services/scoring/scoringStrategies.js` selects the correct annotation service for a concept at runtime. Adding a new concept means registering its strategy here.

### Middleware Wrapper
`asyncRoute(fn)` in `backend/utils/errors.js` wraps async Express handlers to forward thrown errors to the central error middleware:

```js
router.get('/endpoint', asyncRoute(async (req, res) => {
    // throw AppError here — no try/catch needed
}));
```

### Singleton DB Pool
`backend/config/database.js` exports a single `pg.Pool` instance. Import it wherever database access is needed — never create a new pool.

### Orchestrator Pattern
`backend/services/simulationOrchestratorService.js` coordinates all per-concept simulators when a new user registers. It is the single entry point for simulation; individual simulators (`moodleEventSimulator.js`, sleep simulator, etc.) should not be called directly by routes.

---

## 3. Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Backend service files | camelCase | `clusterPeerService.js` |
| Backend utility files | camelCase | `withTransaction.js` |
| Frontend components | PascalCase | `AdminStudentViewer.tsx` |
| Frontend pages | PascalCase | `HomeDetails.tsx` |
| Redux slices | camelCase file, PascalCase state | `auth.ts` → `state.auth` |
| Constants | SCREAMING_SNAKE_CASE | `SCORE_THRESHOLDS`, `MIN_CLUSTER_USERS` |
| CSS classes | kebab-case, component-prefixed | `sleep-handle`, `admin-lms-table` |
| DB tables | snake_case | `lms_sessions`, `peer_clusters` |
| DB columns | snake_case | `session_date`, `cluster_index` |

---

## 4. Extending the App

### Adding a New Concept

1. **Register metadata** — add an entry to `backend/config/concepts.js`:
   ```js
   my_concept: {
       id: 'my_concept',
       displayName: 'My Concept',
       table: 'my_concept_sessions',
       dimensions: ['dim_a', 'dim_b']
   }
   ```
2. **Add a simulator** — create `backend/services/simulators/myConceptSimulator.js` and register it in `backend/services/simulators/index.js`. Wire it into `simulationOrchestratorService.js`.
3. **Add an annotator** — create `backend/services/annotators/myConceptAnnotationService.js` following the existing pattern (evaluate → compose → store).
4. **Register scoring dimensions** — add a `my_concept` entry to `DIMENSION_DEFS` in `backend/services/scoring/clusterPeerService.js`.
5. **Add SQL queries** — add a `my_concept` case to `getAllUserMetrics()` in `backend/services/scoring/scoreQueryService.js`.
6. **Register the scoring strategy** — add a case to `backend/services/scoring/scoringStrategies.js`.

### Adding a New API Route

1. Create a route file `backend/routes/myConcept.js`:
   ```js
   import { Router } from 'express';
   import { asyncRoute } from '../utils/errors.js';

   const router = Router();
   router.get('/my-endpoint', asyncRoute(async (req, res) => {
       res.json({ ok: true });
   }));
   export default router;
   ```
2. Register it in `backend/routes/index.js`:
   ```js
   import myConceptRouter from './myConcept.js';
   router.use('/my-concept', myConceptRouter);
   ```

### Adding a New Redux Slice

1. Create `src/redux/mySlice.ts` using `createSlice` from Redux Toolkit.
2. Export the reducer as default and export individual actions.
3. Add the reducer to `src/redux/store.ts` (or equivalent root reducer).
4. Access state via `useReduxSelector(state => state.mySlice)` and dispatch with `useReduxDispatch()`.

---

## 5. Error Handling Conventions

All backend errors should be thrown as `AppError` instances via the `Errors.*()` factory:

```js
import { Errors } from '../utils/errors.js';

// In a service:
if (!user) throw Errors.NOT_FOUND('User not found');
if (!moodleConfigured) throw Errors.MOODLE_NOT_CONFIGURED();
```

All route handlers must be wrapped with `asyncRoute()` so thrown errors reach the central Express error middleware. Raw `try/catch` in routes should be avoided unless you need partial error recovery.

---

## 6. Database Conventions

- **Always import the singleton pool** from `backend/config/database.js` — never create a new `pg.Pool`.
- **Parameterize every query** — never interpolate user input or dynamic values into SQL strings directly. Use `$1`, `$2`, etc. placeholders.
  - ✅ `WHERE user_id = $1` with `[userId]`
  - ✅ `CURRENT_DATE - ($2 * INTERVAL '1 day')` with `[userId, days]`
  - ❌ `` `INTERVAL '${days} days'` `` — SQL injection risk
- **Use `withTransaction()` for multi-step writes** (`backend/utils/withTransaction.js`):
  ```js
  import { withTransaction } from '../utils/withTransaction.js';
  await withTransaction(pool, async (client) => {
      await client.query('INSERT INTO table_a ...', []);
      await client.query('INSERT INTO table_b ...', []);  // rolls back both if this fails
  });
  ```
- **Accept an optional `client` parameter** in storage functions that may be called from a parent transaction (see `clusterStorageService.js` for the pattern).

---

## 7. Testing

- **Backend unit/integration tests**: Jest (`cd backend && npm test`)
  - Test files live alongside source files or in `backend/__tests__/`
  - Services should be tested with a real test database or mocked pool
- **Frontend component tests**: React Testing Library
  - Run with `npm test` from the root
- **Before merging**: all existing tests must pass; new services should include at least one smoke test covering the happy path.

---

## 8. Moodle LMS Integration

The platform can ingest real Moodle data via the Moodle REST API in addition to simulation.

### Key Files

| File | Role |
|---|---|
| `backend/services/moodleService.js` | REST API adapter — all HTTP calls to Moodle live here |
| `backend/services/moodleEventSimulator.js` | Generates synthetic Moodle-shaped data for test accounts; uses the same `aggregateToDaily()` pipeline as the real service |
| `backend/routes/lms.js` | Admin sync routes (`GET/POST /api/lms/admin/*`, protected by `requireAdmin`) |
| `backend/scripts/moodleSetup.js` | One-off setup: creates Moodle test users + course via REST |
| `backend/scripts/moodleActivitySetup.js` | One-off setup: submits quiz, assignment, forum activity for test users |

### Data Flow

```
Moodle REST API
  ↓  moodleService.js
  ↓  fetchQuizAttempts() + fetchAssignmentSubmissions() + fetchForumPosts()
  ↓  aggregateToDaily() → per-day totals
  ↓  INSERT/UPSERT → lms_sessions
  ↓  scoreQueryService.getLMSMetrics() → getLMSMetrics()
  ↓  clusterPeerService.computeClusterScores('lms')
  ↓  concept_scores + user_cluster_assignments
```

Simulation uses the same path from `aggregateToDaily()` downwards — ensuring simulated and real data are scored identically.

### LMS Scoring Dimensions

The LMS concept uses these four dimensions for PGMoE clustering:

| Dimension | Metric | Formula / Column |
|---|---|---|
| `volume` | `total_active_minutes` | `SUM(total_active_minutes)` |
| `consistency` | `days_active` | `COUNT(DISTINCT session_date)` |
| `participation_variety` | `participation_score` | `LEAST(quiz,3)/3×34 + LEAST(assign,2)/2×33 + LEAST(forum,2)/2×33` |
| `session_quality` | `avg_session_duration` | `SUM(active) / SUM(sessions)` |

> **Note:** `participation_variety` replaced the old `action_mix` / `active_percent` dimension (which was always 100% via REST APIs and provided zero variance for clustering). Any `aspect_breakdown` rows predating this change contain `action_mix` keys; new rows use `participation_variety`.

### Moodle API Limitations

- `reading_minutes` and `watching_minutes` are always `0` — the Moodle module REST APIs (`mod_quiz`, `mod_assign`, `mod_forum`) do not expose reading/video events. Only the event log does, and it is not accessible to external tokens.
- Assignment submissions: the sync filters out **draft** submissions (`status !== 'submitted'`). Call `mod_assign_submit_for_grading` after `mod_assign_save_submission` to transition drafts to submitted.
- Forum post fetching is **sequential per thread** (one HTTP call per discussion). Syncing many students with large forums will be slow — this is a known architectural limitation (see P-C3 in the code review report).

### Environment Variables

```bash
MOODLE_BASE_URL=http://your-moodle-host/moodle  # e.g. http://localhost:8888/moodle501
MOODLE_TOKEN=your-webservice-token
```

Both are optional at startup. If absent, the app starts normally but all `/api/lms` routes return `503 Moodle not configured`. The scoring pipeline runs on simulation data only.

### Cold Start Behaviour

`MIN_CLUSTER_USERS = 10` (defined in `clusterPeerService.js`). Until 10 users have LMS data, `computeClusterScores('lms')` returns `{ coldStart: true }`. The frontend renders a "not enough data" placeholder for the LMS gauge.
