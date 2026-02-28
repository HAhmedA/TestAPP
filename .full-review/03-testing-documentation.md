# Phase 3: Testing & Documentation Review

## Test Coverage Findings

### Executive Summary

The project has **15 passing backend test suites with 106 tests** and a global line coverage of **41.07%** — well below the project's own stated 70% threshold in `jest.config.js`. There is no CI/CD pipeline, no E2E tests, no frontend component tests (beyond a vestigial smoke test), and no performance or load tests. Several security-critical code paths have zero coverage.

---

### Critical

#### CRIT-T1 — `legacy-login` Has Zero Test Coverage (SEC-01 Regression Risk)
**File:** `backend/routes/auth.js:72–83`

No test verifies that `/api/auth/legacy-login` grants admin access with `{"role":"admin"}` and no credentials. Coverage shows 0% on lines 72–83. The security hole is entirely invisible to the test suite — no test documents the vulnerability, no test would catch its removal being reverted.

**Recommended test (regression documentation):**
```js
describe('POST /api/auth/legacy-login — SEC-01 regression', () => {
    test('should NOT grant admin with no credentials (currently fails — endpoint must be removed)', async () => {
        const res = await request(buildApp())
            .post('/api/auth/legacy-login')
            .send({ role: 'admin' })
        expect(res.status).not.toBe(200) // must be 404 or 403 in production
    })
})
```

---

#### CRIT-T2 — IDOR on Chat History Has No Ownership Test (SEC-08 Regression Risk)
**File:** `backend/routes/chat.js:132–156`

`chat.test.js` tests the `/history` route for 401 (unauthenticated) and 400 (missing sessionId). **No test verifies that user A cannot read user B's session by supplying B's sessionId.** The mock returns whatever the test tells it, making the ownership gap invisible.

**Recommended test:**
```js
test('user A cannot read user B session by guessing sessionId', async () => {
    const res = await request(buildUserAApp())
        .get('/api/chat/history?sessionId=session-owned-by-user-B')
    expect(res.status).toBe(403) // currently returns 200 — fix must ship with this test
})
```

---

### High

#### HIGH-T1 — Entire Scoring Pipeline Has 0% Coverage
**Files:** `clusterPeerService.js`, `conceptScoreService.js`, `scoreComputationService.js`, `clusterStorageService.js` — all 0% statements, branches, and lines.

These files implement the core business logic: PGMoE cluster fitting, composite score computation, trend detection, and DB persistence. Silent regressions on any parameter or algorithm change are undetectable. `computeCompositeScore` and `calculateTrend` are pure enough to unit-test without a DB.

**Estimated effort:** 4 hours for a reasonable unit-test suite covering score computation, trend detection, and composite scoring.

---

#### HIGH-T2 — `storeUserAssignment` Failure Path Not Tested (P-C4/SEC-09)
**File:** `backend/services/scoring/clusterStorageService.js:62–79`

No test covers the catch block. A DB failure silently returns `undefined` to the caller. The test that should exist must document the current (problematic) behavior so that the fix is verifiable.

---

#### HIGH-T3 — Nightly Cron (`cronService.js`) Has 0% Coverage and Is Excluded from Coverage Report
**File:** `backend/services/cronService.js`

`recomputeAllActiveUserScores()` iterates all active users sequentially, silently continues on per-user errors, and has no timeout. None of these behaviors are tested or even included in `collectCoverageFrom` in `jest.config.js`.

---

#### HIGH-T4 — All LMS Admin Routes Have 0% Coverage
**File:** `backend/routes/lms.js`

All four LMS admin routes (connection-status, sync-status, sync-all, sync/:userId) are untested. Missing coverage: `requireAdmin` enforcement, unauthenticated access, Moodle env absent (graceful `connected: false`), sync of unknown userId (404), sync-all partial-failure behavior.

---

#### HIGH-T5 — Survey Submission Route Has 0% Coverage
**File:** `backend/routes/results.js`

`POST /api/results/post` — the primary data-ingestion endpoint — is entirely untested. The background fire-and-forget `computeAllScores().catch()` on line 39 means errors that should surface are masked. No test for: DB insert failure, anonymous submission, or nonexistent survey.

---

### Medium

#### MEDIUM-T1 — Auth Tests Missing: Register, Logout, Input Validation
**File:** `backend/tests/integration/routes/auth.test.js`

Only covers `POST /api/auth/login` and `GET /api/auth/me`. Missing: `POST /api/auth/register` (email conflict → 409, short password → 400, successful → 201 + simulation triggered), `POST /api/auth/logout` (session destroyed), and input validation via `express-validator`.

---

#### MEDIUM-T2 — Annotations, Mood, and Scores Routes Partially Untested
| Route | Coverage | Notable Gap |
|---|---|---|
| `annotations.js` | 0% | GET `/`, GET `/chatbot`, DB error path |
| `mood.js` | 0% | Aggregation logic, `${dateFilter}` SQL injection surface from `period` param |
| `scores.js` | ~70% stmts / low branch | Cold-start path, invalid `conceptId` |

The `mood.js` `${dateFilter}` template literal is a secondary SQL injection surface — the `period` query parameter controls which raw SQL string is appended. This is untested and undiscovered in Phase 2.

---

#### MEDIUM-T3 — Silhouette and Davies-Bouldin Functions Untested
**File:** `backend/services/scoring/pgmoeAlgorithm.js:600–690`

These are the O(N²) and O(N·K·D) functions identified as P-C1. 0% coverage means no correctness validation and no benchmark baseline for the performance regression identified.

---

#### MEDIUM-T4 — `stats.js` `percentile()` Has 0% Coverage
**File:** `backend/utils/stats.js`

Used to compute P5, P50, and P95 cluster bounds throughout `clusterPeerService.js` and `clusterStorageService.js`. An off-by-one edge case silently distorts all cluster dial bounds. Easy to unit-test (pure function, no DB).

---

#### MEDIUM-T5 — No `npm audit` in Any Automated Context
SEC-11 (5 packages pinned to `"latest"`) has no automated supply-chain check. No CI pipeline runs `npm audit --audit-level=high`. The 70% coverage threshold in `jest.config.js` is a dead letter — it only fails local runs, not any CI gate.

---

### Low

#### LOW-T1 — Frontend Test Is Vestigial and Likely Broken
**File:** `src/App.test.tsx`

Two tests assert on `My Surveys` header text and `Product Feedback Survey` survey names — neither exists in the current codebase after the home page restructure (`9c84ecd`). These tests almost certainly fail against the current UI. Zero component tests exist for: `RequireAuth`, `RequireAdmin`, `Chatbot`, `ScoreGauge`, `ScoreBoard`, `OnboardingModal`, `AdminStudentViewer`.

---

#### LOW-T2 — Mocks Hide Real Behavior; Assertions Omit Body Structure
Several integration tests set mock return values that do not match production SQL result shapes. 500-path assertions check status code only, not `res.body.error` — any unhandled exception would satisfy them even if the wrong error code were returned.

---

#### LOW-T3 — No Test Isolation Between Suites for Future Parallel Execution
ESM module state is loaded once per suite. `mockQuery.mockReset()` in `beforeEach` provides within-suite isolation, but the pattern is fragile if Jest is ever configured for parallel worker execution.

---

### Test Pyramid Assessment

```
      [E2E]         0 tests  ← missing entirely
     [Integration]  ~66 tests ← backend routes, no real DB
    [Unit]          ~40 tests ← algorithms, utils, config
```

The pyramid is hollow at the service layer. Integration tests mock the DB entirely — SQL typos and schema mismatches are only caught at runtime.

---

### CI/CD Gap

**No CI/CD configuration exists anywhere in the repository.** Minimum required additions:
1. GitHub Actions workflow: `cd backend && npm test` on every push/PR
2. `npm audit --audit-level=high` for both `backend/` and root
3. Coverage upload (e.g., Codecov) enforcing the existing 70% threshold as a PR gate
4. Frontend test step (even just `--passWithNoTests` to prevent future test regressions from being silently skipped)

---

## Documentation Findings

### Executive Summary

The codebase has **above-average inline documentation** for its service layer (scoring algorithms, Moodle integration, annotation services) but has **significant gaps at the API and architecture documentation layer**: only 1 of 30+ endpoints has a Swagger annotation, three architecture documents actively contradict the live code, and there is no changelog or migration guide anywhere in the repository.

| Category | Grade |
|---|---|
| Inline documentation | B |
| API documentation | D |
| Architecture documentation | B– (3 docs stale post-rename) |
| README completeness | B (Moodle integration absent, version error) |
| Accuracy | D+ (3 docs actively contradict live code) |
| Changelog / migration guides | F |

---

### Critical

#### DOC-01 — `action_mix` / `active_percent` in Three Docs Contradicts Live Code
**Files:** `docs/annotation_pipeline.md:47`, `docs/peer_comparison_scoring_system.md:80,173–174`

The LMS scoring dimension was renamed from `action_mix` (metric: `active_percent`) to `participation_variety` (metric: `participation_score`). The implementation is correct in `clusterPeerService.js:51`, `scoreQueryService.js:97–101`, and `lmsAnnotationService.js:152–163`. But three documentation files still describe the old, removed dimension.

`docs/peer_comparison_scoring_system.md` line 173 reproduces this verbatim from the old code:
```javascript
action_mix: { metric: 'active_percent', inverted: false },
```
when the live code reads `participation_variety: { metric: 'participation_score', inverted: false }`.

A developer reading these docs will attempt to work with a metric that no longer exists in the query output.

**Fix:** Update all three files to reflect `participation_variety` / `participation_score` with the breadth formula: `LEAST(quiz,3)/3×34 + LEAST(assign,2)/2×33 + LEAST(forum,2)/2×33`.

---

### High

#### DOC-02 — Only 1 of 30+ Endpoints Has Swagger Annotation
**File:** `backend/config/swagger.js`

Swagger/OpenAPI is configured and served at `/api-docs` (exposed unauthenticated — see SEC-15). Only `POST /api/auth/login` has a `@swagger` JSDoc annotation. All routes in `scores.js`, `admin.js`, `lms.js`, `chat.js`, `sleep.js`, `screen-time.js` are absent from the spec. The `/api-docs` endpoint is publicly accessible but serves a nearly empty spec.

---

#### DOC-03 — `legacy-login` Is Undocumented with No Deprecation Notice
**File:** `backend/routes/auth.js:71–83`

The `/api/auth/legacy-login` endpoint (also accessible via `/api/login`) has no Swagger annotation, no deprecation warning, no explanation of why it exists, and no link to the security audit. The only comment is `// Legacy endpoints (backwards compatible)`.

**Recommended inline addition:**
```javascript
/**
 * @deprecated SEC-01: Grants admin session with no credentials for demo purposes.
 * MUST NOT be deployed without NODE_ENV guard. See SECURITY_AUDIT.md#SEC-01.
 */
```

---

#### DOC-04 — Moodle LMS Integration Is Absent from README and Developer Guide
**Files:** `README.md`, `docs/DEVELOPER_GUIDE.md`

The Moodle integration is the most complex subsystem introduced on this branch (7 public functions, 4 admin routes, a Docker redirect workaround, 13 manually-added Moodle web service functions, known limitations). The README still describes LMS as "Simulated learning management system engagement data (active minutes, session quality, action mix)" — the old simulation-only design.

Missing documentation: env var configuration, admin sync workflow, known limitations (`reading_minutes`/`watching_minutes` always 0, draft vs. submitted assignments, `last_sync` display caveat), cold-start threshold, Docker `nodeHttpGet()` redirect workaround.

---

### Medium

#### DOC-05 — Dead `lmsDataSimulator.js` Neither Removed Nor Marked Deprecated
**Files:** `backend/services/simulators/lmsDataSimulator.js`, `backend/services/simulators/index.js`

Exported from `simulators/index.js` but never called by `simulationOrchestratorService.js` (which imports from `moodleEventSimulator.js`). Looks identical in structure to the three active simulators — a developer cannot tell it is dead code. Also listed as the active LMS simulator in `docs/simulated_data_documentation.md:14`.

---

#### DOC-06 — `chat.js` Diverges from Documented `asyncRoute()` Pattern Without Explanation
**Files:** `backend/routes/chat.js`, `docs/DEVELOPER_GUIDE.md` Section 2

The Developer Guide states raw `try/catch` should be avoided. All other route files use `asyncRoute()`. `chat.js` uses raw `try/catch` in every handler with a non-standard error shape (`{ error: 'server_error' }` vs the standard `{ error: 'DB_ERROR', message, details }`). Not documented anywhere.

---

#### DOC-07 — README References "PostgreSQL 18" (Version Does Not Exist)
**File:** `README.md:62,81`

Both the architecture diagram and technology stack table reference "PostgreSQL 18". Current stable is PostgreSQL 16/17. This is almost certainly a copy-paste error.

---

#### DOC-08 — No CHANGELOG; `participation_variety` Rename Is a Silent Breaking Change

The `action_mix` → `participation_variety` rename is a **breaking change** for any downstream tool reading the `aspect_breakdown` JSON field in `concept_scores`. Existing rows in the database will still contain `action_mix` domain entries. There is no CHANGELOG, no migration SQL, no note explaining that old rows use the old key.

---

#### DOC-09 — `.env.example` Contains a Hardcoded Moodle Token Value
**File:** `.env.example:38`

```
MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e
```

Example files are often indexed by public code search engines. This value should be replaced with a placeholder string. The file also omits `SIMULATION_MODE`, which controls PGMoE cohort composition.

---

#### DOC-10 — Cold-Start Behavior Undocumented in All User-Facing Docs

The `coldStart: true` mechanism (triggered when fewer than `MIN_CLUSTER_USERS = 10` users have data) displays "Building your profile" on the dashboard. This behavior is correctly implemented but documented nowhere in `docs/` or the README. First-time deployers will have no explanation for why all four concepts show the placeholder.

---

#### DOC-11 — Admin Endpoint Response Schemas Not Documented

`GET /api/admin/cluster-members` and `GET /api/admin/cluster-diagnostics` return complex JSON structures with no documented schema. The diagnostics endpoint returns `silhouetteScore` and `daviesBouldinIndex` with no guidance on what constitutes acceptable vs. concerning values (silhouette >0 = better than random, >0.5 = well-separated; Davies-Bouldin <1.0 = well-separated).

---

### Low

#### DOC-12 — Simulation Diagram Shows Old LMS Simulator
**File:** `docs/simulation_documentation.md`

The mermaid flow diagram shows `LMSSim[LMS Simulator]` — should now show `MoodleSimulator[Moodle Event Simulator]`.

#### DOC-13 — Route Files Have Thin Inline Comments on Non-Obvious Logic
**Files:** `backend/routes/scores.js`, `backend/routes/admin.js`

Three non-obvious behaviors in `scores.js` (cold-start detection, multi-query assembly, fallback to `previous_aspect_breakdown`) have no explanatory comments. `admin.js` has no comments above route definitions.

#### DOC-14 — Domain Tooltip Example in Docs Still References `action_mix`
**File:** `docs/peer_comparison_scoring_system.md:374`

References "Action Mix (LMS): Ratio of active vs passive learning…" — domain no longer exists.

#### DOC-15 — Developer Guide Error Factories Table Is Incomplete
**File:** `docs/DEVELOPER_GUIDE.md` Section 5

`UNKNOWN_CONCEPT` (400) and `MOODLE_API_ERROR` (502) — both added on this branch — are absent from the error factory reference table.

---

## Critical Issues for Phase 4 Context

1. **No CI/CD at all** — Best practices and DevOps review should treat the complete absence of automation as the primary finding.
2. **DOC-01 (stale docs) + DOC-08 (no changelog)** — The `participation_variety` rename shipped without a documentation pass. This is a process gap, not just a documentation gap.
3. **DOC-09 (hardcoded token in .env.example)** — Should be treated as a secret leak if the file is in version control and the token was ever valid.
4. **MEDIUM-T2 (mood.js `${dateFilter}` SQL interpolation)** — The `period` query parameter from user input may be appended as raw SQL. This was not caught in Phase 2 and should be re-examined as a potential user-reachable SQL injection.
5. **LOW-T1 (App.test.tsx is broken)** — If any PR gate runs frontend tests, it will fail. If no gate runs them, they are silently broken and provide false confidence.
