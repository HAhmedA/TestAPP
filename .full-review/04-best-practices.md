# Phase 4: Best Practices & Standards

## Framework & Language Findings

### Executive Summary

The backend is cleanly ESM-only (`"type": "module"`) with consistent `import`/`export` — except one critical outlier. The frontend uses React 18 functional components, Redux Toolkit, and TypeScript, but has meaningful type-safety gaps and one deprecated API. The `mood.js` `${dateFilter}` SQL injection concern from Phase 3 was investigated and **confirmed safe** (pure string-constant whitelist; user input never flows into the SQL fragment directly).

---

### Critical

#### FW-C1 — CommonJS Module in ESM-Only Package
**File:** `backend/services/annotators/index.js`

This barrel index file uses `require()` and `module.exports` inside a package declared `"type": "module"`. Node.js will throw `ReferenceError: require is not defined in ES module scope` if this file is ever imported. All four services it re-exports are valid ESM files; the index itself was never converted.

Currently no other file imports from `services/annotators/index.js` (each service is imported directly), so this is latent dead code. But any future barrel import would crash the process.

**Fix:** Replace the entire file with ESM or delete it:
```js
export { computeJudgments, composeSentences } from './lmsAnnotationService.js'
export { computeAnnotations } from './sleepAnnotationService.js'
// etc.
```

---

### High

#### FW-H1 — SQL Template Literal Interpolation Pattern (Latent Injection)
**Files:** `scoreQueryService.js:28,32,36,116,142,166`, `sleepAnnotationService.js:313`, `screenTimeAnnotationService.js:255`

`INTERVAL '${days} days'` interpolates `days` directly. All call sites currently pass hardcoded `7` — not user-controlled — but the pattern is one refactor away from an exploitable injection. `lmsAnnotationService.js:301` already uses the safe form (`$2 * INTERVAL '1 day'`).

**Fix:** `WHERE session_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')` with `days` as a bound parameter. (Confirmed: `mood.js` `${dateFilter}` is safe — whitelist only.)

#### FW-H2 — `asyncRoute()` Not Used in `mood.js`, `chat.js`, `annotations.js`, `results.js`
**Files:** `backend/routes/mood.js`, `chat.js`, `annotations.js`, `results.js`

Four route files use raw `try/catch` with non-standard error shape (`{ error: 'db_error', details: String(e) }`). This leaks stack traces in production and bypasses the global error handler. All other route files use `asyncRoute()`.

**Fix:** Migrate all handlers to `asyncRoute()` + `Errors.*` factories.

#### FW-H3 — `storeUserAssignment` Silently Swallows Errors Inside Transaction
**File:** `backend/services/scoring/clusterStorageService.js:62–79` *(confirmed again)*

The try/catch prevents `withTransaction`'s rollback from firing. Cluster results persist; user assignment is silently lost. Fix: remove the try/catch when `externalClient` is provided.

---

### Medium

#### FW-M1 — `ConceptScore` Interface Defined in 4 Separate Files with Diverging Fields
**Files:** `src/models/scores.ts` (canonical), `src/api/scores.ts`, `src/pages/Home.tsx`, `src/components/ScoreBoard.tsx`

`api/scores.ts` is missing `clusterIndex`, `totalClusters`, `percentilePosition`, `clusterUserCount`, `previousBreakdown`. TypeScript cannot enforce the contract between components using different local copies.

**Fix:** Import `ConceptScore` from `src/models/scores.ts` in all files; delete local redefinitions.

#### FW-M2 — `days_active_in_period` Missing from Both LMS Upsert `ON CONFLICT DO UPDATE`
**Files:** `moodleEventSimulator.js:159–179`, `moodleService.js:449–467`

Column appears in INSERT but not in the UPDATE clause. Re-syncing the same date leaves it stale.

**Fix:** Add `days_active_in_period = EXCLUDED.days_active_in_period` to both conflict clauses.

#### FW-M3 — `router.handle()` Anti-Pattern for Legacy Shim Routes
**File:** `backend/routes/admin.js:248–256`

`router.handle(req, res)` is an undocumented Express internal. Can cause infinite loops or double-response errors.

**Fix:** Extract shared handler logic into a named function and call it directly.

#### FW-M4 — `express-validator` Only Used in `auth.js`
All other routes accepting user input (sleep, screen-time, chat, profile, mood) use ad-hoc manual checks or no validation. `screen-time.js` does not validate that `totalMinutes`, `longestSession`, `preSleepMinutes` are non-negative integers.

**Fix:** Apply `express-validator` consistently across all data-submission routes.

#### FW-M5 — Dual HTTP Clients: Axios (Redux slices) + Fetch (`api/client.ts`)
Redux slices (`auth.ts`, `surveys.ts`, `results.ts`, `profile.ts`) use axios with `axios.defaults.withCredentials = true`. All newer API modules use the fetch-based `api` client. Two credential-handling configs must be kept in sync; `ApiError` is not used for Redux calls.

**Fix:** Migrate remaining Redux slices from axios to the `api` client; remove axios dependency.

#### FW-M6 — Deprecated `onKeyPress` Event Handler
**File:** `src/components/Chatbot.tsx:506`

`onKeyPress` was deprecated in React 17. The handler already checks `e.key === 'Enter'`, so it is compatible with `onKeyDown`.

**Fix:** `onKeyDown={handleKeyPress}`

#### FW-M7 — TypeScript `any` Spread Across State, Thunks, and Survey JSON
| File | Usage |
|---|---|
| `src/models/survey.ts:4` | `json: any` — survey JSON schema untyped |
| `src/redux/surveys.ts:8,53` | `error: any`, `json: any` in thunk parameter |
| `src/redux/profile.ts:32` | `profileData: any` |
| `src/pages/Run.tsx:26,28` | `page: any`, `element: any` in JSON traversal |
| `src/App.tsx:44` | `store.dispatch<any>(me())` |

**Fix priorities:** Define `SurveyJson` type; define `ProfileData` interface; use `AppDispatch` for the dispatch type.

---

### Low

#### FW-L1 — 5 SurveyJS Packages at `"latest"` *(confirmed again)*
All five `survey-*` packages must share the same version. Pin to a specific version range and lock with `package-lock.json`.

#### FW-L2 — `tsconfig.json` `target: "es5"` Is Redundant with CRA/Babel
CRA uses Babel for browser downleveling; the TypeScript `target` is bypassed. Setting `target: "es2020"` or higher enables modern syntax in TS output and stops TypeScript from lowering optional chaining and nullish coalescing.

#### FW-L3 — `@types/react-router-dom@^5.3.3` Installed for React Router v6
React Router v6 ships its own type definitions. The v5 `@types` packages contradict the installed library version. Remove `@types/react-router` and `@types/react-router-dom`.

#### FW-L4 — `useEffect` Dependency Suppression in `Chatbot.tsx` Should Use `useCallback`
`// eslint-disable-next-line react-hooks/exhaustive-deps` suppresses a real dependency on `prefetchGreeting`. The correct fix is `useCallback` so the stable reference can safely be included in the array.

#### FW-L5 — `EXCLUDE_SIMULATED_USERS` Evaluated at Module Load — Frozen for Test Isolation
**File:** `scoreQueryService.js:9–11`

Evaluated once at import time. Tests toggling `SIMULATION_MODE` between cases get a frozen constant. Document as a test caveat or convert to a runtime function call.

---

## CI/CD & DevOps Findings

### Executive Summary

The application has a single GitHub Actions workflow that only tests the React frontend. The backend test suite, coverage threshold, and `npm audit` are never enforced in CI. Production deployment configuration does not exist. Secrets are committed to version control in both `compose.yml` and `.env.example`. No migration runner, no backup strategy, no restart policy, and no production process manager are in place.

---

### Critical

#### DC-C1 — Real Credentials Committed to `compose.yml` and `.env.example`
**Files:** `compose.yml:21,25,29`, `.env.example:38`

```yaml
SESSION_SECRET=dev-secret
PGPASSWORD=password
MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e
```

The real Moodle token value is permanently in git history across both files. Anyone with repository read access can authenticate against the Moodle instance. `dev-secret` and `password` as literal defaults also enable session forgery and DB access if these Compose defaults are used in production.

**Fix (immediate):** Rotate the Moodle token. Replace all hardcoded values in `compose.yml` with `${ENV_VAR}` references. Replace `.env.example` token with a placeholder. Use a `.env` file outside version control for local dev secrets.

#### CI-C1 — Backend Test Suite Never Runs in CI
**File:** `.github/workflows/build-node.js.yml`

The workflow runs `npm install && npm build && npm test` from the root — the React frontend only. `backend/package.json` and its Jest suite are never invoked. The 70% coverage threshold in `backend/jest.config.js` is enforced nowhere.

**Fix:** Add a `backend` CI job (see minimum pipeline below).

#### DS-C1 — No Production Deployment Configuration
No `fly.toml`, `Procfile`, `railway.json`, Kubernetes manifests, or deployment workflow. The only runnable artifact is `compose.yml`, which is a development-only configuration and is not safe for production use (bakes in dev secrets, debug settings, localhost Moodle URL).

#### DB-C1 — No Migration Runner — Schema Changes Require Data Destruction
`postgres/initdb/` scripts execute only on an empty volume. Once `pgdata` exists, adding `014_new_column.sql` requires either a manual `ALTER TABLE` or a volume wipe. There is no migration history table, no node-pg-migrate, no Flyway, no Liquibase.

**Fix:** Adopt `node-pg-migrate` or similar. Convert `initdb/` files to numbered migrations.

#### PM-C1 — No Restart Policy; No Process Manager; Single Node.js Process
`backend/Dockerfile` runs `node` directly with no restart policy in `compose.yml`. A single unhandled exception kills the process permanently until a manual restart. The nightly O(N²) cron runs in the same event loop as HTTP request handling.

**Fix:** Add `restart: unless-stopped` to the backend Compose service. Use PM2 in cluster mode or a separate worker process for the cron.

#### EM-C1 — Weak DB Password and Session Secret Only Warn, Never Block
`envValidation.js` adds these to `warnings[]` not `missing[]`. `database.js` silently falls back to `'password'`. A production deployment with a missing `PGPASSWORD` env var uses the default DB password silently.

**Fix:** Move weak/missing production credentials to `missing[]` so `validateEnv()` throws at startup.

---

### High

#### CI-H1 — CI Triggers Only on `main`; `feature/chatbot` Has Zero Automated Checks
**File:** `.github/workflows/build-node.js.yml:3–5`

```yaml
on:
  push:
    branches: [ "main" ]
```

The active development branch receives no automated feedback. Bugs introduced on `feature/chatbot` are only caught when merged to `main`.

**Fix:** `branches: [ "main", "feature/**" ]` or `on: [push, pull_request]`.

#### CI-H2 — No `npm audit` in CI; Five Packages at `"latest"`
No automated vulnerability scanning. Supply-chain compromise via `survey-*` packages would be pulled in silently.

#### DC-H1 — `COPY . .` in `backend/Dockerfile` Includes Test Credentials and Scripts
`backend/scripts/` contains Moodle test setup scripts with student credentials. `backend/tests/` is included in the production image. These should be excluded via `.dockerignore`.

#### DC-H2 — No Dev/Prod Compose Split
`DEBUG_LLM=true` and a localhost Moodle URL are baked into the only Compose file. A production deployment using this file exposes debug logging and an incorrect Moodle URL.

**Fix:** `compose.yml` (dev defaults) + `compose.prod.yml` (overrides) pattern.

#### EM-H1 — `NODE_ENV` Not Validated at Startup
If `NODE_ENV` is unset, `isProduction = false` disables secure cookies, allows `dev-secret`, exposes Swagger UI, and leaks error details. `envValidation.js` does not check for `NODE_ENV` presence.

#### MO-H1 — Logs Written Inside Container; Destroyed on Container Replacement
Winston writes to `backend/logs/error.log` and `backend/logs/combined.log`. These paths are inside the container filesystem with no volume mount. Container replacement or `docker compose down` destroys all logs permanently.

**Fix:** Mount `backend/logs/` as a named volume, or switch to stdout-only logging and collect via a log aggregator.

#### MO-H2 — No Error Tracking (Sentry) or APM
Cron failures and uncaught exceptions disappear into local log files with no alert. The cron loop logs per-user errors but does not surface them to any monitoring system.

#### IR-H1 — No Runbooks or Operational Documentation
No documented restart procedure, rollback plan, backup-restore procedure, cron-failure response, or database recovery steps.

#### PM-H1 — `sync-all` Is a Synchronous HTTP Handler with No Timeout
`POST /api/lms/admin/sync-all` makes sequential Moodle API calls for all users with no HTTP timeout, no abort signal, and no background job. The admin client's connection must remain open for the full duration (up to 18 minutes at 50 users per P-C3).

**Fix:** Enqueue sync work to a background job; return a job ID immediately; poll for completion.

---

### Medium

#### CI-M1 — No TypeScript Type-Check or ESLint in CI
The existing frontend CI step runs `react-scripts test` but not `tsc --noEmit` or `eslint`. Type errors only surface during `npm run build`.

#### CI-M2 — No `engines` Field Enforcing Node Version
Neither `package.json` specifies `"engines": { "node": ">=18" }`. Developers running Node 16 or 20 may encounter silent behavior differences.

#### DC-M1 — PostgreSQL Pinned to Major Version Only
`compose.yml` uses `postgres:16-alpine` without a patch version. A minor PostgreSQL upgrade could silently change behavior.

#### DC-M2 — No Health Checks on Backend or Frontend Containers
`compose.yml` has no `healthcheck:` on the web or backend services. Docker does not know the app is actually serving traffic before routing requests to it.

#### DC-M3 — nginx Missing `proxy_read_timeout`
Long-running requests (Moodle sync, LLM streaming) will be cut off by nginx's default 60-second read timeout with no error surfaced to the client.

#### EM-M1 — `CORS_ORIGINS` and `SIMULATION_MODE` Missing from `.env.example`
Both variables affect production behavior but are absent from the environment documentation file.

#### DB-M1 — Application Connects as PostgreSQL Superuser (`postgres`)
All queries run with superuser privileges. A SQL injection or connection compromise grants unrestricted DB access.

**Fix:** Create a `wellbeing_app` role with only `SELECT/INSERT/UPDATE/DELETE` on relevant tables.

#### DB-M2 — No Backup Strategy Documented or Automated
`pgdata` named volume has no `pg_dump` cron, no snapshot policy, and no restore procedure.

---

### Minimum Recommended CI Pipeline

```yaml
# .github/workflows/ci.yml
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
