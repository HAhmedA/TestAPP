# Phase 1: Code Quality & Architecture Review

## Code Quality Findings

### Critical

#### CQ-C1 — SQL Injection via String Interpolation
**Files:** `backend/services/scoring/scoreQueryService.js` (lines 9–11, 28, 32, 36, 40, 116–117, 143, 166, 188), `sleepAnnotationService.js:313`, `screenTimeAnnotationService.js:255`, `srlAnnotationService.js:297`

The `days` parameter and `EXCLUDE_SIMULATED_USERS` constant are interpolated directly into SQL via template literals rather than parameterized placeholders:

```js
WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days' ${EXCLUDE_SIMULATED_USERS}
```

While `days` currently originates from internal callers and `EXCLUDE_SIMULATED_USERS` is a startup constant, the pattern is fragile and could become a live SQL injection vector if any call site passes untrusted input. `lmsAnnotationService.js:301` already uses the correct parameterized form (`$2 * INTERVAL '1 day'`) — all other occurrences should mirror this.

**Fix:**
```js
WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
```

---

### High

#### CQ-H1 — `ConceptScore` Interface Defined in Three Separate Files
**Files:** `src/models/scores.ts:13–31`, `src/components/ScoreBoard.tsx:6–31`, `src/pages/Home.tsx:15–39`

The canonical definition exists but is not imported by the two components that re-declare it. The copies diverge: `Home.tsx` lacks `previousBreakdown`; `ScoreBoard.tsx` has `dialMin?` optional while `scores.ts` has it required.

**Fix:** Import from canonical location:
```tsx
import { ConceptScore } from '../models/scores'
```

#### CQ-H2 — Duplicated Cluster Info Query Block
**Files:** `backend/routes/scores.js:63–87`, `backend/routes/admin.js:127–151`

Identical 25-line query + mapping block for `user_cluster_assignments`. Any change must be applied in two places.

**Fix:** Extract `getClusterInfoForUser(userId)` into `scoreQueryService.js`.

#### CQ-H3 — Duplicated LMS Session Upsert SQL
**Files:** `backend/services/moodleService.js:449–475`, `backend/services/moodleEventSimulator.js:160–184`

Verbatim copy of the 25-column `INSERT … ON CONFLICT` upsert. Schema changes require lockstep updates.

**Fix:** Extract `upsertLmsSessions(client, userId, rows, isSimulated)` shared helper.

#### CQ-H4 — `computeClusterScores` / `computeSRLClusterScores` ~80% Duplicate
**File:** `backend/services/scoring/clusterPeerService.js:131–422`

Two functions share the same pipeline (normalize → select model → diagnostics → composites → order → remap → percentile → store → build domain results). Only feature-matrix construction and composite score calculation differ.

**Fix:** Refactor into a shared `runClusterPipeline(metrics, userId, conceptId, buildFeatureRow, computeComposite)` with strategy callbacks.

#### CQ-H5 — Swallowed Errors in Chat Routes
**File:** `backend/routes/chat.js` (all handlers)

Every handler uses manual `try/catch` logging only `error.message` (no stack trace) and returning a generic `server_error`. All other routes use `asyncRoute()` from `utils/errors.js` for consistent error propagation and full stack traces.

**Fix:** Migrate all chat handlers to `asyncRoute()`.

---

### Medium

#### CQ-M1 — Redundant `userId` Null-Checks After `requireAuth` Middleware
**File:** `backend/routes/chat.js:27–29, 47–49, 97–99, 136–138, 167–169, 185–187`

`router.use(requireAuth)` already guarantees `req.session.user` is populated. The six inline re-checks are dead code.

**Fix:** Remove redundant checks; access `req.session.user.id` directly.

#### CQ-M2 — Silent Error Swallowing in `storeUserAssignment`
**File:** `backend/services/scoring/clusterStorageService.js:62–79`

When no `externalClient` is provided, errors are caught and logged but never propagated. Callers cannot detect a failed persistence.

**Fix:** Re-throw or return a success boolean.

#### CQ-M3 — `parseInt` Without NaN Guard
**File:** `backend/routes/chat.js:147`

`Math.min(parseInt(limit), 50)` passes `NaN` to the SQL LIMIT if `limit` is non-numeric.

**Fix:** `const parsedLimit = parseInt(limit) || 20`

#### CQ-M4 — Duplicated `getRawScoresForScoring` Pattern
**Files:** All four annotation services (~lines 469–500 each)

Near-identical: call `computeClusterScores` → check null/coldStart → fetch DB labels → map results. Variance is only the concept ID and label query.

**Fix:** Shared `buildRawScoresForScoring(pool, conceptId, userId, fetchLabels)` factory.

#### CQ-M5 — Duplicated `getOrCreateBaseline` Pattern
**Files:** `sleepAnnotationService.js:269–292`, `screenTimeAnnotationService.js:216–239`, `lmsAnnotationService.js:372–396`

Three-step pattern (query → insert-if-missing → re-query) repeated with only table/defaults differing.

**Fix:** Generic `getOrCreate(pool, table, userId, defaults)` helper.

#### CQ-M6 — Hardcoded Default DB Password
**File:** `backend/config/database.js:9`

`password: process.env.PGPASSWORD || 'password'` — the fallback `'password'` is used even in production.

**Fix:** Fail to start in `NODE_ENV=production` if `PGPASSWORD` is unset (already warned in `envValidation.js`; should block pool creation).

#### CQ-M7 — `days_active_in_period` Not Updated in Upsert Conflict Clause
**Files:** `moodleService.js:449–467`, `moodleEventSimulator.js:160–178`

Column is in the INSERT but omitted from the `ON CONFLICT DO UPDATE SET` clause, so re-syncing the same date leaves it stale.

**Fix:** Add `days_active_in_period = EXCLUDED.days_active_in_period` to the UPDATE list.

#### CQ-M8 — Inconsistent `fetch()` vs. API Client on Frontend
**Files:** `src/pages/Home.tsx:75`, `src/components/AdminClusterDiagnosticsPanel.tsx:121, 137`

Some components use raw `fetch()` with manually managed credentials; others use the typed API client.

**Fix:** Create `src/api/admin.ts` with typed wrappers, consolidate on `api.get()` / `api.post()`.

#### CQ-M9 — O(N²) Silhouette Score Computation
**File:** `backend/services/scoring/pgmoeAlgorithm.js:599–642`

Acceptable for the current cohort (<50 users) but undocumented. If cohort grows, this becomes a bottleneck.

**Fix:** Add a scaling comment; consider sampling-based approximation if cohort exceeds ~200 users.

#### CQ-M10 — Sequential Forum Discussion HTTP Requests
**File:** `backend/services/moodleService.js:291–334`

One HTTP request per discussion, up to 50 per forum. With multiple forums, sync can make 100+ sequential requests.

**Fix:** Use `Promise.all` with a concurrency limiter (e.g., `p-limit(5)`).

#### CQ-M11 — `ScoreBoard.tsx` Deeply Nested Inline Rendering (~100 lines)
**File:** `src/components/ScoreBoard.tsx:192–290`

The expanded detail section has deep nesting, inline styles, and an IIFE, making it hard to read.

**Fix:** Extract `<ScoreBreakdownPanel score={score} />`.

---

### Low

#### CQ-L1 — `ActionMix` Variable Names Not Updated After Dimension Rename
**File:** `backend/services/annotators/lmsAnnotationService.js:234, 254, 337, 488`

Internal variables still named `actionMix` after rename to `participation_variety`.

#### CQ-L2 — `dbPool` Parameter Accepted but Ignored in `computeClusterScores`
**File:** `backend/services/scoring/clusterPeerService.js:131`

#### CQ-L3 — Unused `React` Import
**File:** `src/routes/index.tsx:1`

#### CQ-L4 — Missing Cleanup for Score Retry Timer
**File:** `src/pages/Home.tsx:97–99` — no `.catch()` and no cleanup on unmount.

#### CQ-L5 — Long Ternary Chains for Category Mapping
**File:** `backend/services/scoring/clusterPeerService.js:266–267, 401–402`

#### CQ-L6 — `AdminClusterDiagnosticsPanel` Monolithic Render + Duplicated `ordinal`
**File:** `src/components/AdminClusterDiagnosticsPanel.tsx:92–98` duplicates `ScoreBoard.tsx:51–60`

#### CQ-L7 — Stale `lmsDataSimulator.js` Dead Code
Still exported from `simulators/index.js` but no longer called.

#### CQ-L8 — Missing Retention Policy on `cluster_run_diagnostics`
Table grows unboundedly at ~4 rows/night.

---

## Architecture Findings

### Critical

#### AR-C1 — SQL Injection via String Interpolation *(same as CQ-C1)*
Both reviewers flagged this independently. See CQ-C1 above.

---

### High

#### AR-H1 — Broken Legacy Route Delegation in `admin.js`
**File:** `backend/routes/admin.js:248–256`

`router.handle(req, res)` is an undocumented Express Router internal requiring a `next` argument. Without it, these legacy routes (`GET /system-prompt`, `PUT /system-prompt`) will throw a TypeError or silently fail at runtime.

**Fix:**
```js
router.get('/system-prompt', asyncRoute(async (req, res) => {
    req.query.type = 'system'
    // call handler logic directly
}))
```

---

### Medium

#### AR-M1 — Annotation Services Calling Up Into Scoring Pipeline (Dependency Inversion)
**Files:** All four annotation services use dynamic `import()` to load `clusterPeerService.js`

Dynamic imports avoid a circular-reference crash at ESM load time, but they indicate the wrong dependency direction: annotators (low-level) calling scoring orchestration (high-level). The correct flow is: scoring pipeline calls annotators for labels, not the reverse.

**Fix:** Long-term refactor — have the scoring pipeline pull annotation labels, not have annotators trigger cluster computation.

#### AR-M2 — Chat Routes Use Ad-Hoc Error Handling (Same as CQ-H5)
All other routes use `asyncRoute()` with `Errors.*` factories. Chat diverges.

#### AR-M3 — No UUID Validation on Admin Route Parameters
**Files:** `backend/routes/admin.js:103, 175`, `backend/routes/lms.js:121`

Raw `req.params.studentId` / `req.params.userId` passed to queries without shape validation.

**Fix:** Add `param('studentId').isUUID()` validation consistent with `auth.js`.

#### AR-M4 — Score Response Shape Duplicated Between Student and Admin Routes
**Files:** `backend/routes/scores.js:40–149`, `backend/routes/admin.js:103–172`

Same three-query pattern + response mapping with slight drift (admin missing `previousBreakdown` and `coldStart`).

**Fix:** Extract `buildScoreResponse(userId)` service function.

#### AR-M5 — Frontend Type Definitions Duplicated (Same as CQ-H1)
See CQ-H1 above.

#### AR-M6 — `legacy-login` Allows Unauthenticated Role Assumption Without Env Guard
**File:** `backend/routes/auth.js:72–83`

With no email/password, this endpoint creates an admin session for `demo-user` with no real authentication and no `NODE_ENV` guard.

**Fix:** Gate behind `process.env.NODE_ENV !== 'production'`.

#### AR-M7 — Module-Level Singleton Pool Import Blocks Unit Testing
Most services import `pool` at module level rather than accepting it as a parameter. Annotation services correctly accept `pool` as a parameter — the scoring services don't.

**Fix:** Accept `pool` as a parameter with module-level import as default, consistent with annotation services.

#### AR-M8 — `clusterPeerService.js` Re-exports Algorithm Internals
**File:** `backend/services/scoring/clusterPeerService.js:428–439`

Re-exports `fitPGMoE`, `selectOptimalModel`, `generateClusterLabels`, etc. from inner modules "for backwards compatibility," leaking algorithm internals through the orchestration layer.

**Fix:** Remove re-exports; consumers should import directly from `pgmoeAlgorithm.js` or `stats.js`.

---

### Low

#### AR-L1 — `dbPool` Parameter Not Used (Same as CQ-L2)

#### AR-L2 — `cluster_run_diagnostics` Unbounded Growth (Same as CQ-L8)

#### AR-L3 — Missing `lms_sessions` in Cron Active-User Query
**File:** `backend/services/cronService.js:26–37`

Union of active users omits `lms_sessions`. Users with only LMS data will never have scores recomputed nightly.

**Fix:** Add `UNION SELECT user_id FROM public.lms_sessions WHERE is_simulated = false AND session_date >= CURRENT_DATE - INTERVAL '30 days'`.

#### AR-L4 — Fire-and-Forget `computeAllScores` After Sync
**Files:** `moodleService.js:500–502`, `moodleEventSimulator.js:203–205`

Acceptable UX trade-off, but failed score computation is invisible to the user. Consider a `last_score_error` indicator.

#### AR-L5 — Mixed Frontend API Call Patterns (Same as CQ-M8)

#### AR-L6 — Inline Styles in `AdminClusterDiagnosticsPanel`
**File:** `src/components/AdminClusterDiagnosticsPanel.tsx` — inconsistent with CSS-class pattern elsewhere.

#### AR-L7 — `uuid_generate_v4()` Without Extension Guarantee in Migration
**File:** `postgres/initdb/013_cluster_diagnostics.sql:4`

**Fix:** Use `gen_random_uuid()` (PG 13+ built-in) or add `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` to the migration.

---

## Critical Issues for Phase 2 Context

1. **SQL injection pattern** (`scoreQueryService.js` + annotation services) — Security phase should verify this cannot be reached with user-controlled input via any HTTP path.
2. **`legacy-login` unauthenticated admin session** — Security phase should assess full exploit path and whether any admin operations are reachable via `demo-user` ID.
3. **Legacy auth aliases in `routes/index.js`** bypass `authLimiter` — Security phase should assess brute-force exposure.
4. **`storeUserAssignment` silently swallows errors** — Performance/reliability phase should assess whether silent cluster-assignment failure creates stale scores visible to users.
5. **Sequential Moodle forum HTTP calls** — Performance phase should quantify worst-case sync latency with 50+ discussions.
