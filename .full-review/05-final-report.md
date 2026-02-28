# Comprehensive Code Review Report

## Review Target

**Branch:** `feature/chatbot` vs `main`
**Application:** Student Wellbeing Dashboard (React + Node.js/Express ESM + PostgreSQL)
**Review Date:** 2026-02-28
**Phases Completed:** Code Quality, Architecture, Security, Performance, Testing, Documentation, Framework Best Practices, CI/CD & DevOps

---

## Executive Summary

The `feature/chatbot` branch delivers substantial new functionality — a PGMoE scoring pipeline, Moodle LMS integration, an AI chatbot layer, and a cluster diagnostics admin panel. The core algorithmic work is well-structured and the ESM backend architecture is clean and consistent. However, the branch has **significant security, operational, and testing gaps** that make it unsuitable for production deployment in its current state.

The most urgent issues are: (1) an unauthenticated admin access endpoint reachable in production, (2) real credentials committed to version control, (3) a completely absent backend CI pipeline, (4) no production deployment infrastructure, and (5) a nightly scoring cron that will fail entirely at ~200 users. These are not minor polish items — they are blocking issues for any production rollout.

---

## Findings by Priority

### P0 — Critical Issues (Must Fix Before Any Production Deployment)

---

**[SEC-01] Unauthenticated Admin Access via `legacy-login`**
*Source: Security (Phase 2) · Auth (Phase 1) · Testing (Phase 3)*
`backend/routes/auth.js:72–83`

`POST /api/auth/legacy-login` with `{"role":"admin"}` (no credentials) grants a full admin session. No `NODE_ENV` guard. All admin operations — student PII enumeration, system prompt modification, bulk Moodle sync — are reachable. CVSS 9.8. The endpoint has 0% test coverage and is not documented anywhere.

**Fix:** Remove the endpoint, or add `if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'not_found' })` as the first line.

---

**[DC-C1] Real Credentials Committed to Version Control**
*Source: CI/CD (Phase 4)*
`compose.yml:21,25,29` · `.env.example:38`

`SESSION_SECRET=dev-secret`, `PGPASSWORD=password`, and `MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e` are in git history permanently. The Moodle token allows anyone with repo access to authenticate against the Moodle instance.

**Fix (immediate):** Rotate the Moodle token. Replace all values in `compose.yml` with `${VAR}` references. Replace `.env.example` token with a placeholder string.

---

**[CQ-C1 / SEC-02] SQL Template Literal Injection Pattern (Latent)**
*Source: Code Quality (Phase 1) · Security (Phase 2) · Framework (Phase 4)*
`scoreQueryService.js:28,32,36,116,142,166` · `sleepAnnotationService.js:313` · `screenTimeAnnotationService.js:255`

`INTERVAL '${days} days'` interpolates `days` directly. Currently not user-reachable (all call sites pass hardcoded `7`), but one HTTP query parameter addition makes it exploitable. The safe pattern (`$2 * INTERVAL '1 day'`) already exists in `lmsAnnotationService.js:301` but is not consistently applied. CVSS 8.6 (adjusted to 6.5 for current exploitability).

**Fix:** Parameterize all INTERVAL expressions: `WHERE session_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')`.

---

**[SEC-03] Rate Limiter Bypass via Legacy Auth Aliases**
*Source: Security (Phase 2)*
`backend/routes/index.js:23–25`

`/api/login` calls `login` without `authLimiter` (10 req/15 min). Only the general `apiLimiter` (100 req/15 min) applies — sufficient for credential stuffing. Input validation via `express-validator` is also bypassed on the alias. CVSS 7.5.

**Fix:** Remove legacy aliases, or apply `authLimiter` + `express-validator` validation to each.

---

**[P-C1] O(N²) Silhouette Score in Nightly Cron**
*Source: Performance (Phase 2)*
`backend/services/scoring/pgmoeAlgorithm.js:599–642`

`computeSilhouetteScore` is O(N²) and runs 4× per user (once per concept) in the nightly job. At 200 users: ~15 minutes; at 500 users: multiple hours. Cron runs permanently overlap. The silhouette metric is diagnostic-only (append-only audit table) and does not affect score correctness.

**Fix:** Decouple silhouette/Davies-Bouldin computation from the user scoring path. Run as a separate low-priority background job, or cap to a random sample of `min(N, 100)`.

---

**[P-C2] Nightly Cron Is Fully Sequential Across All Users × Concepts**
*Source: Performance (Phase 2)*
`backend/services/cronService.js:50–58` · `scoreComputationService.js:83–88`

PGMoE clustering is cohort-level computation. Running 4 model fits per user sequentially means 4N fits total instead of 4. At 50 users: 2.5 minutes. With P-C1 compounding, failure is certain before 200 users.

**Architectural fix:** Run PGMoE once per concept across all users, then fan out assignment writes in parallel.

---

**[P-C3] 108 Sequential HTTP Calls per Moodle Sync**
*Source: Performance (Phase 2)*
`backend/services/moodleService.js:291–334`

One HTTP call per forum discussion thread, capped at 50 per forum. Worst case (50 students × 108 calls × 200ms): 18 minutes for `sync-all`. The admin HTTP connection remains open for the full duration.

**Fix:** `Promise.all` with `p-limit(5)` for discussion fetches. Enqueue `sync-all` as a background job; return a job ID immediately.

---

**[P-C4 / SEC-09] `storeUserAssignment` Silently Swallows Errors**
*Source: Performance (Phase 2) · Security (Phase 2) · Framework (Phase 4)*
`backend/services/scoring/clusterStorageService.js:62–79`

Inside a `withTransaction` block, `storeClusterResults` commits but `storeUserAssignment` fails silently. Users see real scores with stale dial values (defaulting to `dialMin=0, dialCenter=50, dialMax=100`) indefinitely with no error indicator. No test covers the failure path.

**Fix:** Remove the try/catch when `externalClient` is provided. Let the error propagate to `withTransaction` for rollback.

---

**[CI-C1] Backend Test Suite Never Runs in CI**
*Source: Testing (Phase 3) · CI/CD (Phase 4)*
`.github/workflows/build-node.js.yml`

The only CI workflow runs React frontend tests only. `backend/package.json` and its Jest suite are never invoked. The 70% line coverage threshold in `backend/jest.config.js` has never enforced anything. No backend change has automated test validation.

**Fix:** Add a `backend` job to the CI workflow (see template below).

---

**[DS-C1] No Production Deployment Configuration**
*Source: CI/CD (Phase 4)*

No `fly.toml`, `Procfile`, `railway.json`, Kubernetes manifests, or deployment workflow. The only runnable artifact is `compose.yml`, which bakes in dev secrets, `DEBUG_LLM=true`, and a localhost Moodle URL. There is no documented procedure for shipping a production release.

---

**[DB-C1] No Migration Runner — Schema Changes Require Data Destruction**
*Source: CI/CD (Phase 4)*
`postgres/initdb/`

Init scripts only execute on an empty Docker volume. Adding a new SQL file after initial setup requires either manual `ALTER TABLE` or a volume wipe that destroys all data. No migration history, no node-pg-migrate, no Flyway.

**Fix:** Adopt `node-pg-migrate`. Convert the 14 init SQL files to numbered migrations.

---

**[PM-C1] No Restart Policy; Single Node.js Process for HTTP + Cron**
*Source: CI/CD (Phase 4)*
`compose.yml` · `backend/Dockerfile`

A single unhandled exception kills the Node process permanently. No `restart: unless-stopped` in Compose. No PM2 or process manager. The O(N²) nightly cron shares the event loop with HTTP request handling.

**Fix:** Add `restart: unless-stopped` to the Compose backend service. Separate the cron into a worker process.

---

**[EM-C1] Weak Credentials Only Warn in Production — Never Block**
*Source: Security (Phase 2) · CI/CD (Phase 4)*
`backend/config/envValidation.js` · `backend/config/database.js:9` · `backend/server.js:66`

`PGPASSWORD=password` and missing `SESSION_SECRET` are `warnings[]` not `missing[]`. `database.js` silently uses `'password'` as a fallback. A misconfigured production deployment starts successfully with exploitable defaults.

**Fix:** Move to `missing[]` so `validateEnv()` throws at startup in `NODE_ENV=production`.

---

**[FW-C1] CommonJS `require()` in ESM-Only Backend Package**
*Source: Framework (Phase 4)*
`backend/services/annotators/index.js`

This barrel index uses `require()` and `module.exports` inside a `"type": "module"` package. Currently dead code (no file imports from this barrel — services are imported directly), but any future barrel import would crash the process with `ReferenceError: require is not defined`.

**Fix:** Convert to ESM or delete the file.

---

**[DOC-01] Three Architecture Docs Contradict the Live Scoring Model**
*Source: Documentation (Phase 3)*
`docs/annotation_pipeline.md:47` · `docs/peer_comparison_scoring_system.md:80,173–174,374`

Three docs still describe the removed `action_mix` / `active_percent` LMS dimension. The live code uses `participation_variety` / `participation_score`. Existing `concept_scores.aspect_breakdown` rows contain `action_mix` keys; new rows contain `participation_variety`. Frontend tooltip lookup silently falls through for old keys.

**Fix:** Update all three files to reflect the current dimension and formula.

---

**[CRIT-T1] No Regression Test for `legacy-login` Auth Bypass**
*Source: Testing (Phase 3)*

The security hole (SEC-01) has 0% test coverage. No test documents or catches the vulnerability being re-introduced.

**Fix:** Add a test that POSTs `{"role":"admin"}` to `/api/auth/legacy-login` and asserts the response is **not** `200`. This test documents the expected secure behavior and will fail (correctly) until the fix is deployed.

---

**[CRIT-T2] No IDOR Test for Chat Session History**
*Source: Testing (Phase 3)*

`GET /api/chat/history?sessionId=UUID` verifies auth but not session ownership. No test verifies that user A cannot read user B's session by supplying B's `sessionId`.

---

### P1 — High Priority (Fix Before Next Release)

| ID | Category | Finding | File |
|---|---|---|---|
| AR-H1 | Architecture | `router.handle()` anti-pattern on legacy admin shims | `admin.js:248–256` |
| SEC-04 | Security | Hardcoded DB password fallback `'password'` (CVSS 7.3) | `database.js:9` |
| SEC-05 | Security | Hardcoded session secret fallback `'dev-secret'` (CVSS 7.5) | `server.js:66` |
| SEC-06 | Security | Verbose error details leaked to clients in production (CVSS 5.3) | `annotations.js:27` |
| SEC-07 | Security | Admin cluster-members exposes full student PII, unbounded (CVSS 6.5) | `admin.js:208–245` |
| SEC-08 | Security | IDOR on `GET /api/chat/history` — no session ownership check (CVSS 5.4) | `chat.js:132–156` |
| P-H1 | Performance | 4 sequential DB queries per `/api/scores` page load | `routes/scores.js:36–149` |
| P-H2 | Performance | `cluster_run_diagnostics` has no retention — unbounded growth | `clusterStorageService.js:94–118` |
| P-H3 | Performance | Admin cluster-members fetched on every mount, no pagination | `admin.js:208–245` |
| CQ-H2 | Code Quality | Duplicated cluster info query block (25 lines, 2 locations) | `scores.js:63–87`, `admin.js:127–151` |
| CQ-H3 | Code Quality | Duplicated LMS upsert SQL (25-column INSERT, 2 locations) | `moodleService.js`, `moodleEventSimulator.js` |
| CQ-H4 | Code Quality | `computeClusterScores` / `computeSRLClusterScores` ~80% duplicate | `clusterPeerService.js:131–422` |
| FW-H2 | Framework | Raw `try/catch` in `mood.js`, `chat.js`, `annotations.js`, `results.js` — not `asyncRoute()` | 4 route files |
| HIGH-T1 | Testing | Entire scoring pipeline has 0% test coverage | `clusterPeerService.js`, `conceptScoreService.js`, `scoreComputationService.js`, `clusterStorageService.js` |
| HIGH-T2 | Testing | `storeUserAssignment` failure path not tested (silent data loss undocumented) | `clusterStorageService.js:62–79` |
| HIGH-T3 | Testing | Nightly cron has 0% coverage; excluded from coverage config | `cronService.js` |
| HIGH-T4 | Testing | All 4 LMS admin routes have 0% coverage | `routes/lms.js` |
| HIGH-T5 | Testing | Survey submission route has 0% coverage | `routes/results.js` |
| DOC-02 | Docs | Only 1 of ~30 endpoints has a Swagger annotation | `config/swagger.js` |
| DOC-03 | Docs | `legacy-login` undocumented with no deprecation notice | `auth.js:71–83` |
| DOC-04 | Docs | Moodle LMS integration absent from README and Developer Guide | `README.md`, `docs/DEVELOPER_GUIDE.md` |
| CI-H1 | CI/CD | CI triggers only on `main`; `feature/chatbot` has zero automated checks | `.github/workflows/` |
| CI-H2 | CI/CD | No `npm audit` anywhere; 5 survey packages at `"latest"` | `package.json` |
| DC-H1 | CI/CD | `COPY . .` in Dockerfile includes test credentials and setup scripts | `backend/Dockerfile` |
| DC-H2 | CI/CD | No dev/prod Compose split; `DEBUG_LLM=true` baked into only config | `compose.yml` |
| EM-H1 | CI/CD | `NODE_ENV` not validated — if unset, production runs in dev mode | `envValidation.js` |
| MO-H1 | CI/CD | Logs written inside container — destroyed on replacement | `backend/utils/logger.js` |
| MO-H2 | CI/CD | No error tracking (Sentry) or APM | `server.js` |
| IR-H1 | CI/CD | No runbooks, no rollback procedure, no backup-restore documentation | — |
| PM-H1 | CI/CD | `sync-all` is a synchronous HTTP handler with no timeout (up to 18 min) | `routes/lms.js` |

---

### P2 — Medium Priority (Plan for Next Sprint)

| ID | Category | Finding |
|---|---|---|
| CQ-M1 | Code Quality | Redundant `userId` null-checks after `requireAuth` in `chat.js` (6 instances) |
| CQ-M2 | Code Quality | Silent error swallowing in `storeUserAssignment` without `externalClient` |
| CQ-M3 | Code Quality | `parseInt` without NaN guard in `chat.js:147` |
| CQ-M4 | Code Quality | Near-identical `getRawScoresForScoring` pattern repeated in 4 annotation services |
| CQ-M5 | Code Quality | `getOrCreateBaseline` 3-step pattern repeated in 3 annotation services |
| CQ-M6 | Code Quality | Hardcoded default DB password in `database.js:9` (also P0 in production context) |
| CQ-M7 | Code Quality | `days_active_in_period` missing from both LMS upsert `ON CONFLICT DO UPDATE` |
| CQ-M8 | Code Quality | Raw `fetch()` used in `Home.tsx` and `AdminClusterDiagnosticsPanel.tsx` vs `api` client |
| CQ-M9 | Code Quality | O(N²) silhouette undocumented scaling comment |
| CQ-M10 | Code Quality | Sequential forum discussion HTTP requests (also P0 at scale) |
| CQ-M11 | Code Quality | `ScoreBoard.tsx` deeply nested inline rendering (~100 lines) |
| AR-M1 | Architecture | Dependency inversion: annotation services dynamically import scoring pipeline |
| AR-M3 | Architecture | No UUID validation on admin route parameters `studentId`/`userId` |
| AR-M4 | Architecture | Score response shape duplicated between student and admin routes |
| AR-M7 | Architecture | Module-level singleton pool import blocks unit testing of scoring services |
| AR-M8 | Architecture | `clusterPeerService.js` re-exports algorithm internals for "backwards compatibility" |
| AR-L3 | Architecture | `lms_sessions` missing from cron active-user query (LMS-only users never rescored) |
| SEC-10 | Security | Helmet CSP not tuned for LLM API and Moodle `connectSrc` |
| SEC-11 | Security | 5 SurveyJS packages at `"latest"` — supply chain risk |
| SEC-12 | Security | Moodle `wstoken` in URL query strings logged in proxy/APM |
| P-M1 | Performance | DB pool has no `max`/`idleTimeout`/`connectionTimeout` config |
| P-M2 | Performance | N+1 queries in `GET /api/admin/prompts` |
| P-M4 | Performance | 6–8 DB round-trips per chat message; duplicate session touch |
| P-M5 | Performance | `computeCompositeScore` re-sorts all users per call (O(N log N) per user) |
| P-M6 | Performance | `getOrCreateBaseline` uses 3 sequential queries (race condition + extra round-trip) |
| MEDIUM-T1 | Testing | Auth tests missing: register, logout, input validation |
| MEDIUM-T2 | Testing | `annotations.js` and `mood.js` routes have 0% coverage |
| MEDIUM-T3 | Testing | Silhouette and Davies-Bouldin functions untested |
| MEDIUM-T4 | Testing | `stats.js` `percentile()` has 0% coverage |
| MEDIUM-T5 | Testing | No `npm audit` in any automated context |
| DOC-05 | Docs | Dead `lmsDataSimulator.js` neither removed nor marked deprecated |
| DOC-06 | Docs | `chat.js` deviates from documented `asyncRoute()` pattern without explanation |
| DOC-07 | Docs | README states "PostgreSQL 18" (version does not exist) |
| DOC-08 | Docs | No CHANGELOG; `participation_variety` rename is a silent breaking change on `aspect_breakdown` |
| DOC-09 | Docs | `.env.example` contains real Moodle token value |
| DOC-10 | Docs | Cold-start behavior (MIN_CLUSTER_USERS=10) undocumented in all user-facing docs |
| DOC-11 | Docs | Admin endpoint response schemas undocumented |
| FW-M1 | Framework | `ConceptScore` interface defined 4 times with diverging fields |
| FW-M3 | Framework | `router.handle()` anti-pattern on admin legacy shim routes |
| FW-M4 | Framework | `express-validator` only used in `auth.js`; no validation on sleep/screen-time/profile |
| FW-M5 | Framework | Dual HTTP clients (axios + fetch) with separate credential and error handling |
| FW-M6 | Framework | Deprecated `onKeyPress` in `Chatbot.tsx` |
| FW-M7 | Framework | TypeScript `any` in Redux state shapes, thunk params, survey JSON traversal |
| CI-M1 | CI/CD | No TypeScript type-check or ESLint step in CI |
| CI-M2 | CI/CD | No `engines` field enforcing Node version |
| DC-M1–M3 | CI/CD | Postgres unpinned patch version; no health checks; nginx missing `proxy_read_timeout` |
| EM-M1 | CI/CD | `CORS_ORIGINS` and `SIMULATION_MODE` missing from `.env.example` |
| DB-M1 | CI/CD | Application connects as PostgreSQL superuser |
| DB-M2 | CI/CD | No database backup strategy documented or automated |

---

### P3 — Low Priority (Track in Backlog)

| ID | Category | Finding |
|---|---|---|
| CQ-L1 | Code Quality | Internal `actionMix` variable names not updated after `participation_variety` rename |
| CQ-L2/AR-L1 | Code Quality | `dbPool` parameter accepted but ignored in `computeClusterScores` |
| CQ-L3 | Code Quality | Unused `React` import in `src/routes/index.tsx` |
| CQ-L4 | Code Quality | `setTimeout` retry in `Home.tsx` with no unmount cleanup or `.catch()` |
| CQ-L5 | Code Quality | Long ternary chains for category mapping in `clusterPeerService.js` |
| CQ-L6 | Code Quality | `AdminClusterDiagnosticsPanel` monolithic render + duplicated `ordinal` helper |
| CQ-L7 | Code Quality | Stale `lmsDataSimulator.js` exported but never called |
| CQ-L8/AR-L2 | Code Quality | `cluster_run_diagnostics` grows at ~400 rows/day with no retention policy |
| AR-L4 | Architecture | Fire-and-forget `computeAllScores` after sync gives no failure feedback to user |
| AR-L6 | Architecture | Inline styles in `AdminClusterDiagnosticsPanel` inconsistent with CSS-class pattern |
| AR-L7 | Architecture | `uuid_generate_v4()` without extension guarantee in migration 013 (use `gen_random_uuid()`) |
| SEC-13 | Security | `trust proxy` set to `1` — `X-Forwarded-For` spoofable without real reverse proxy |
| SEC-14 | Security | 30-day session cookie lifetime excessive for sensitive student data |
| SEC-15 | Security | Swagger UI accessible unauthenticated in production |
| SEC-16 | Security | No explicit request body size limit (`express.json()` defaults to 100KB) |
| P-L2 | Performance | `setTimeout` retry in `Home.tsx` with no cleanup |
| P-L4 | Performance | `selectOptimalModel` fits 12 models every time with no intra-day cache |
| P-L6 | Performance | No partial index on `is_simulated` — full scans when `SIMULATION_MODE=false` |
| LOW-T1 | Testing | `App.test.tsx` is vestigial — tests reference UI text that no longer exists |
| LOW-T2 | Testing | Integration test mocks don't match real SQL result shapes; 500-path assertions omit body |
| LOW-T3 | Testing | No test isolation strategy for future parallel Jest execution |
| DOC-12–15 | Docs | Stale simulation diagram; thin route comments; incomplete error factory table |
| FW-L2 | Framework | `tsconfig.json` `target: "es5"` redundant with CRA/Babel |
| FW-L3 | Framework | `@types/react-router-dom@^5.3.3` installed for React Router v6 |
| FW-L4 | Framework | `useEffect` dependency suppression should use `useCallback` |
| FW-L5 | Framework | `EXCLUDE_SIMULATED_USERS` frozen at module load — test isolation edge case |

---

## Findings by Category

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Code Quality | 1 | 4 | 11 | 8 | **24** |
| Architecture | 1 | 1 | 6 | 7 | **15** |
| Security | 3 | 4 | 5 | 4 | **16** |
| Performance | 4 | 3 | 5 | 3 | **15** |
| Testing | 2 | 5 | 5 | 3 | **15** |
| Documentation | 1 | 3 | 7 | 4 | **15** |
| Framework & Language | 1 | 3 | 7 | 4 | **15** |
| CI/CD & DevOps | 6 | 9 | 8 | 0 | **23** |
| **Total** | **19** | **32** | **54** | **33** | **138** |

*Note: Several findings appear in multiple categories (e.g., SQL injection flagged in Code Quality, Security, and Framework); the table counts each source-phase finding independently. Unique root issues: approximately 17 Critical, 28 High, 42 Medium, 28 Low.*

---

## Recommended Action Plan

### Sprint 0 — Before Any Deployment (1–2 days)

1. **[DC-C1] Rotate the Moodle token immediately.** Replace all hardcoded secrets in `compose.yml` with `${ENV_VAR}` references. Replace `.env.example` Moodle token with a placeholder.
2. **[SEC-01] Remove or gate `legacy-login`.** Add `NODE_ENV` guard as a one-line fix; removal is preferred.
3. **[SEC-03] Remove or rate-limit legacy auth aliases** in `routes/index.js:23–25`.
4. **[DOC-01] Fix three stale documentation files** — update `action_mix` → `participation_variety` in `annotation_pipeline.md` and `peer_comparison_scoring_system.md`. Medium effort.
5. **[DOC-09] Fix `.env.example` Moodle token** — replace with placeholder string.

### Sprint 1 — Fix Before Next Release (1–2 weeks)

6. **[P-C4/SEC-09] Fix `storeUserAssignment` error propagation.** Remove try/catch when `externalClient` provided. Add unit test for the failure path. Small change, high correctness impact.
7. **[CQ-C1/SEC-02] Parameterize all INTERVAL template literals** in `scoreQueryService.js` and annotation services.
8. **[CI-C1] Add backend CI job** (see minimum pipeline in `04-best-practices.md`). Backend tests, `npm audit`, coverage reporting.
9. **[CI-H1] Expand CI trigger** to `feature/**` and `pull_request`.
10. **[EM-C1] Move weak-credential checks to `missing[]`** in `envValidation.js` so startup fails in production.
11. **[SEC-08] Add IDOR ownership check** on `GET /api/chat/history` (5-line SQL addition).
12. **[CRIT-T1/CRIT-T2] Add regression tests** for `legacy-login` auth bypass and chat history IDOR.
13. **[HIGH-T1/T2/T3] Begin scoring pipeline test coverage:** `conceptScoreService`, `clusterStorageService` failure path, `cronService` basic flow. These are the highest business-risk coverage gaps.
14. **[DOC-04] Add Moodle LMS Integration section** to README and Developer Guide.
15. **[DOC-08] Create `CHANGELOG.md`** documenting `participation_variety` rename as a breaking change.

### Sprint 2 — Architectural Work (2–4 weeks)

16. **[P-C1/P-C2] Redesign nightly cron scoring pipeline.** Run PGMoE once per concept across all users (4 fits total instead of 4N). Decouple silhouette computation to a separate background task. This is the most impactful performance fix.
17. **[P-C3/PM-H1] Convert `sync-all` to a background job.** Return job ID immediately; poll for completion. Apply `p-limit(5)` concurrency to per-user forum requests.
18. **[DB-C1] Adopt a migration runner** (`node-pg-migrate`). Convert `postgres/initdb/` scripts to numbered migrations.
19. **[PM-C1] Separate the cron into a worker process.** Add `restart: unless-stopped` to Compose.
20. **[DS-C1] Create a production deployment configuration.** Define `compose.prod.yml` with proper secret references, health checks, and log volume mounts.
21. **[FW-H2] Migrate `chat.js`, `mood.js`, `annotations.js`, `results.js`** to use `asyncRoute()`.

### Ongoing Backlog

- Resolve `ConceptScore` interface duplication (FW-M1) — import from canonical `models/scores.ts`
- Add `express-validator` to all data-submission routes (FW-M4)
- Remove axios; consolidate on `api/client.ts` (FW-M5)
- Add retention policy on `cluster_run_diagnostics` (delete rows older than 90 days)
- Add `lms_sessions` to cron active-user UNION query (AR-L3) — users with LMS-only data are never rescored
- Pin survey-* packages to specific versions; add `npm audit` to CI
- Remove `lmsDataSimulator.js` dead code (CQ-L7)
- Fix `App.test.tsx` to match current UI
- Add documentation checklist to PR template

---

## Minimum CI Pipeline (Add Immediately)

```yaml
# .github/workflows/ci.yml — replace build-node.js.yml
name: CI
on:
  push:
    branches: [ "main", "feature/**" ]
  pull_request:

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm audit --audit-level=high
      - run: CI=true npm test -- --watchAll=false
      - run: npm run build

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm audit --audit-level=high
        working-directory: backend
      - run: npm test -- --coverage
        working-directory: backend
        env:
          NODE_ENV: test
          PGPASSWORD: test
          SESSION_SECRET: test-secret-for-ci
```

---

## Review Metadata

- **Review date:** 2026-02-28
- **Branch:** `feature/chatbot` (eb21911)
- **Phases completed:** Code Quality, Architecture, Security, Performance, Testing, Documentation, Framework Best Practices, CI/CD & DevOps
- **Flags applied:** None
- **Output files:**
  - `.full-review/00-scope.md`
  - `.full-review/01-quality-architecture.md`
  - `.full-review/02-security-performance.md`
  - `.full-review/03-testing-documentation.md`
  - `.full-review/04-best-practices.md`
  - `.full-review/05-final-report.md`
