# Phase 4B: CI/CD & DevOps Practices Review

**Branch:** `feature/chatbot`
**Date:** 2026-02-28
**Reviewer role:** DevOps Engineer

---

## Executive Summary

The project has a Docker-Compose stack that works correctly for local development and includes several positive foundations: multi-stage Dockerfiles, a PostgreSQL health check, a named data volume, Winston-based logging, and a well-structured `envValidation.js`. However, the pipeline has **critical gaps** that make it unsuitable for any production deployment path: secrets are committed in plaintext to `compose.yml`, the CI workflow tests only the React frontend (the Express backend is not tested in CI at all), there is no deployment target, no process manager, no observability tooling beyond local log files, and no migration runner — meaning a new database environment has no safe mechanism for incremental schema changes.

---

## 1. CI/CD Pipeline

### Finding CI-01 — Severity: Critical

**The CI workflow tests only the React frontend; the Express backend is never tested in CI.**

The single workflow at `.github/workflows/build-node.js.yml` runs:

```yaml
- run: npm install
- run: npm run build --if-present
- run: CI=true npm test -- --watchAll=false
```

These commands run against the root `package.json`, which is the Create React App frontend. The backend at `backend/` has its own `package.json` and Jest config (`backend/jest.config.js`), but no CI step changes into that directory, installs backend dependencies, or runs `npm test` there.

Operational risk: Any regression in the scoring pipeline, auth routes, Moodle sync, or cron job logic can only be caught by a developer running `cd backend && npm test` manually before pushing. Given that the backend contains ~531-line service files such as `moodleService.js` and a custom PGMoE clustering implementation, the surface area for undetected regressions is large.

Recommendation: Add a second CI job (or step) that runs:

```yaml
- name: Backend CI
  working-directory: backend
  run: |
    npm install
    npm test
```

This should run on every push to any branch, not only `main`.

---

### Finding CI-02 — Severity: High

**The CI workflow triggers only on `main`, not on pull requests to `feature/*` branches.**

```yaml
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
```

The active branch is `feature/chatbot`. No CI run is triggered when commits are pushed to this branch. All active development happens without automated validation.

Recommendation: Add `feature/**` and `develop` to the trigger list, or use a wildcard:

```yaml
on:
  push:
  pull_request:
    branches: [ "main" ]
```

---

### Finding CI-03 — Severity: High

**No `npm audit` step exists anywhere — five survey packages are pinned to `"latest"`.**

From `package.json`:

```json
"survey-analytics": "latest",
"survey-core":      "latest",
"survey-creator-core": "latest",
"survey-creator-react": "latest",
"survey-react-ui": "latest"
```

There is no `npm audit` call in the CI workflow, in any Makefile, or in any pre-commit hook. The combination of floating `latest` versions and zero automated audit means a malicious or vulnerable package update is silently pulled in on every `npm install`.

Recommendation: Pin all five packages to an exact version or at minimum a `^` range. Add `npm audit --audit-level=high` as a CI step that fails the build on high-severity findings.

---

### Finding CI-04 — Severity: Medium

**No linting or type-checking step in CI.**

The frontend is TypeScript and the backend is plain ESM JavaScript. The CI workflow does not run `tsc --noEmit` for the frontend or any linter (`eslint`) for either package. Type errors and lint violations are only caught if developers run tools locally.

Recommendation: Add `npx tsc --noEmit` for the frontend and `eslint` (once configured) for the backend as CI steps.

---

### Finding CI-05 — Severity: Medium

**Node.js version is pinned to 18.x in CI but not enforced in Dockerfiles or `package.json`.**

The CI matrix pins Node 18:

```yaml
node-version: [18.x]
# Pin to Node 18 to match CRA/react-scripts compatibility
```

However:
- `backend/Dockerfile` uses `FROM node:18-alpine` — consistent.
- `frontend/Dockerfile` uses `FROM node:18-alpine AS build` — consistent.
- Neither `package.json` has an `engines` field specifying the required Node version.

There is no `nvmrc` or `.node-version` file. If a developer runs a different Node version locally, there is no automated warning.

Recommendation: Add `"engines": { "node": ">=18.0.0 <19.0.0" }` to both `package.json` files and create a `.nvmrc` file with `18` at the project root.

---

## 2. Docker / Compose Configuration

### Finding DC-01 — Severity: Critical

**`compose.yml` hardcodes three secrets in plaintext.**

```yaml
backend:
  environment:
    - SESSION_SECRET=dev-secret
    - PGPASSWORD=password
    - MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e

postgres:
  environment:
    - POSTGRES_PASSWORD=password
```

All three values — including a real Moodle API token — are committed to version control. Anyone with read access to the repository has the Moodle token. The session secret and DB password, even if only "dev defaults", are shipped as production defaults in a file that is never overridden in a production context (there is no `compose.prod.yml` or environment-based override file).

The same real token appears in `.env.example`:

```
MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e
```

This is the actual token used against `http://localhost:8888/moodle501`. `.env.example` is a documentation file — it should contain only placeholder values, not real credentials.

Recommendation:
1. Rotate the `MOODLE_TOKEN` immediately.
2. Replace all hardcoded values in `compose.yml` with `${VAR}` interpolation using a `.env` file that is gitignored.
3. Replace the real token in `.env.example` with `your-moodle-web-service-token-here`.
4. For production, use Docker secrets or a secrets manager (Vault, AWS Secrets Manager, etc.).

---

### Finding DC-02 — Severity: High

**`compose.yml` is simultaneously used for development and has no production-safe counterpart.**

The file sets `DEBUG_LLM=true` and `MOODLE_BASE_URL=http://host.docker.internal:8888/moodle501` — both are development-specific values. There is no `compose.prod.yml` override, no `compose.override.yml`, and no environment-flag mechanism. Deploying this file to production would expose the debug LLM flag and point at a localhost Moodle instance.

Recommendation: Split into `compose.yml` (shared base) and `compose.prod.yml` / `compose.dev.yml` overrides. Use `docker compose -f compose.yml -f compose.prod.yml up` in production.

---

### Finding DC-03 — Severity: Medium

**PostgreSQL is pinned to version `18` (major version only), not a patch version.**

```yaml
postgres:
  image: postgres:18
```

Using a major version tag means the image is automatically pulled to the latest patch (e.g., 18.1 → 18.2) whenever a developer or CI runner pulls. A PostgreSQL patch release has broken backward compatibility before in edge cases.

Recommendation: Pin to a specific patch version, e.g., `postgres:18.2-alpine`. Review quarterly and update deliberately.

---

### Finding DC-04 — Severity: Medium

**Web and backend containers have no health checks configured.**

The `postgres` service has a correct health check:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
  interval: 5s
  timeout: 5s
  retries: 10
```

But neither the `web` (nginx) nor the `backend` (Express) services have health checks. The backend exposes `GET /health` which returns `{ status: "ok" }`, but this is not wired into the Compose health check. In a real deployment with any orchestration layer (Compose scale, ECS, Kubernetes), unhealthy instances will receive traffic.

Recommendation:

```yaml
backend:
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s
```

---

### Finding DC-05 — Severity: Low

**nginx proxy does not have a timeout for the backend.**

`nginx.conf` proxies `/api/` to `backend:8080` without any proxy timeout configuration. If a Moodle sync or nightly cron computation takes more than nginx's default 60-second proxy timeout, the client receives a 504 Gateway Timeout while the operation continues running in the backend — with no indication to the caller.

Recommendation: Add `proxy_read_timeout 300s;` to the `/api/` location block and ensure the client handles 504 gracefully for long-running sync operations.

---

### Finding DC-06 — Severity: Low

**The named volume `pgdata` mounts at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.**

```yaml
volumes:
  - pgdata:/var/lib/postgresql
```

The Postgres 18 image stores data in `/var/lib/postgresql/data`. Mounting at the parent directory works (data is still inside the mount), but it also captures `/var/lib/postgresql/data/pg_wal`, `/var/lib/postgresql/data/pg_log`, etc. under the same volume, which is fine for persistence. However the comment in `compose.yml` says "mounts at `/var/lib/postgresql` per 18+ images" — this is technically correct but it would be clearer and more conventional to mount at `/var/lib/postgresql/data`.

---

## 3. Deployment Strategy

### Finding DS-01 — Severity: Critical

**There is no production deployment configuration of any kind.**

The repository contains no:
- `fly.toml` (Fly.io)
- `railway.json` or `railway.toml` (Railway)
- `heroku.yml` or `Procfile` (Heroku)
- Kubernetes manifests (`k8s/`, `helm/`)
- Terraform or Pulumi infrastructure code
- GitHub Actions deployment workflow

The only runnable artifact is the `compose.yml` for local development. "Deploying to production" has no defined procedure.

Operational risk: If an emergency patch is needed, there is no known-good deployment path. Any deployment would require improvised, undocumented steps under pressure.

Recommendation: Choose a deployment target (Fly.io, Railway, or a VPS with Docker) and commit its configuration. At minimum, create a `docs/deployment.md` that documents: where the app runs, how to deploy a new version, and how to roll back.

---

### Finding DS-02 — Severity: High

**`backend/Dockerfile` copies all source files including potential secrets.**

```dockerfile
COPY package.json ./
RUN npm install --only=production --no-audit --no-fund
COPY . .
```

The `COPY . .` instruction copies everything in the `backend/` directory into the image. The `backend/.dockerignore` file exists and excludes `.env` correctly, but it does not exclude:
- `backend/logs/` — log files with potentially sensitive query results and user data
- `backend/scripts/` — admin scripts that include Moodle setup credentials and test passwords
- `backend/tests/` — test fixtures that are unnecessary in a production image

Recommendation: Add the following to `backend/.dockerignore`:

```
logs/
scripts/
tests/
*.test.js
```

---

## 4. Environment Management

### Finding EM-01 — Severity: Critical

**`envValidation.js` warns on `PGPASSWORD=password` in production but does not block startup.**

From `backend/config/envValidation.js` (lines 52–54):

```js
if (process.env.PGPASSWORD === 'password') {
    warnings.push('PGPASSWORD: Using weak password "password" in production is not recommended')
}
```

The weak DB password is only placed in `warnings`, not in `missing`. This means a production deployment with `PGPASSWORD=password` will start successfully, log a warning that may go unread, and operate with the default password.

By contrast, `SESSION_SECRET=dev-secret` correctly fails startup in production (it is placed in `missing`). The `PGPASSWORD` check should be treated identically.

Operational risk: A production database running with password `password` is exploitable by any actor with network access to port 5432.

Recommendation: Move the `PGPASSWORD=password` check from `warnings` to `missing` so it causes a hard startup failure in production.

---

### Finding EM-02 — Severity: High

**`database.js` hardcodes `'password'` as the default fallback for `PGPASSWORD`.**

```js
password: process.env.PGPASSWORD || 'password',
```

Even if `envValidation.js` is tightened, the fallback in `database.js` means any environment that fails to set `PGPASSWORD` will silently attempt to connect with `'password'`. This is independent of the validation layer.

Recommendation: Remove the fallback: `password: process.env.PGPASSWORD`. A missing value should cause a connection error immediately, not silently use an insecure default.

---

### Finding EM-03 — Severity: High

**`NODE_ENV` is not in `REQUIRED_PRODUCTION_ENV` and defaults to `undefined`.**

`NODE_ENV` is listed in `.env.example` but is not validated by `envValidation.js`. The server logic `const isProduction = process.env.NODE_ENV === 'production'` means that if `NODE_ENV` is not set (e.g., in a Docker environment where it was forgotten), `isProduction` is `false` — and the app will run in development mode: `dev-secret` is allowed as session secret, error details are leaked in API responses, cookies are not marked `secure`, and Swagger UI is fully accessible.

Recommendation: Add `NODE_ENV` to `REQUIRED_PRODUCTION_ENV` validation, or apply a safe default: `const isProduction = process.env.NODE_ENV !== 'development'`.

---

### Finding EM-04 — Severity: Medium

**`.env.example` is not complete — several env vars used in the codebase are undocumented.**

Variables present in the codebase but absent from `.env.example`:

| Variable | Used In |
|---|---|
| `CORS_ORIGINS` | `server.js` |
| `SIMULATION_MODE` | `envValidation.js` RECOMMENDED_ENV (documented) but not in `.env.example` |
| `DEBUG_LLM` | `compose.yml` only |

`CORS_ORIGINS` is particularly important: its absence means a developer deploying without it will only allow `http://localhost:3000`, silently breaking all API calls from a non-localhost frontend.

---

## 5. Monitoring and Observability

### Finding MO-01 — Severity: High

**Logging is file-only in a containerised context — logs inside a container are ephemeral.**

`logger.js` writes to `backend/logs/app.log`, `error.log`, and `chat.log` using Winston file transports with 5 MB rotation. Inside Docker, these files are written to the container's filesystem. They are not mounted to a host volume in `compose.yml`. When a container is replaced (restart, re-deploy), all accumulated log files are permanently lost.

Additionally, the console transport uses `colorize()` which adds ANSI escape codes — unsuitable for log aggregation systems (e.g., CloudWatch, Loki, Datadog) that consume stdout.

Operational risk: When diagnosing a production incident, the logs for the period before the incident will not be available.

Recommendation:
1. In a containerised deployment, rely on stdout/stderr and use a log aggregation sidecar or platform logging (e.g., Docker `json-file` driver with a fluentd forwarder, or direct stdout to CloudWatch Logs).
2. Remove `colorize()` from the production console transport and output structured JSON to stdout.
3. If file logging is retained, mount `backend/logs/` as a named volume in `compose.yml`.

---

### Finding MO-02 — Severity: High

**No error tracking or APM integration exists.**

There is no Sentry, Rollbar, Datadog APM, or equivalent. The global Express error handler (`server.js` lines 90–96) logs to Winston and returns a JSON response, but no error is reported to an external system. Similarly, the cron job error path (lines 54–56 of `cronService.js`) only logs locally:

```js
logger.error(`Cron: Score recomputation failed for user ${user_id}: ${err.message}`)
```

Operational risk: Silent errors in the nightly cron or in production requests produce no alert. Operators have no way to know a failure has occurred without manually reading log files.

Recommendation: Integrate Sentry (free tier is sufficient for a research project). Add `@sentry/node` to backend dependencies, initialize it before route mounting, and replace the global error handler with a Sentry-aware version. Cron failures should also call `Sentry.captureException(err)`.

---

### Finding MO-03 — Severity: Medium

**HTTP access logging is incomplete.**

`server.js` logs only `${req.method} ${req.path}` — no status code, response time, or content length:

```js
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})
```

A `logger.stream` compatible with Morgan is exported from `logger.js` but Morgan is never actually installed or used (`morgan` is absent from `backend/package.json`).

Recommendation: Install `morgan` and add `app.use(morgan('combined', { stream: logger.stream }))`. This provides status codes and response times for every request, enabling performance regression detection.

---

### Finding MO-04 — Severity: Low

**No health check endpoint for the database connection.**

The `GET /health` endpoint returns `{ status: "ok" }` without verifying the database is reachable:

```js
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() })
})
```

A load balancer health check passing while the DB is down will route traffic to an instance that will fail all data-dependent requests.

Recommendation: Add a lightweight `SELECT 1` query to the health check and return a `503` if it fails.

---

## 6. Incident Response

### Finding IR-01 — Severity: High

**No runbooks, rollback procedures, or operational documentation exist.**

The `docs/` directory contains feature documentation (annotation pipeline, scoring system, chatbot flows, simulation) but nothing on:
- How to restart the application
- How to roll back a failed deployment
- How to restore a database from backup
- What to do when the nightly cron fails
- How to disable the Moodle sync if Moodle is unavailable
- What the `coldStart: true` state means operationally and how to resolve it

Operational risk: Any incident response — including a developer oncall who did not build the feature — requires reading through source code to understand what to do.

Recommendation: Create `docs/operations.md` covering at minimum: startup/shutdown procedures, how to trigger a manual score recompute, how to check cron job status, and how to disable Moodle sync via environment variable.

---

### Finding IR-02 — Severity: High

**Cron job failures are logged but generate no alert.**

When the nightly scoring cron fails (network error, DB connection timeout, or scoring exception), the error is written to `backend/logs/error.log` and to stdout. No alert is sent — no email, no webhook, no Sentry event.

If the cron fails silently for several days, user scores become stale without anyone knowing. The first sign of the problem is a user reporting incorrect scores.

Additionally, `cronService.js` counts per-user errors but does not escalate if `errorCount > 0` at the end of the run:

```js
logger.info(`Cron: Nightly recomputation complete. ✓ ${successCount} succeeded, ✗ ${errorCount} failed.`)
```

Recommendation: After the loop, if `errorCount > 0`, emit an `logger.error()` event (which Sentry would capture) or call a configured webhook. At minimum, consider failing the cron if more than a threshold percentage of users fail recomputation.

---

## 7. Database Management

### Finding DB-01 — Severity: Critical

**There is no migration runner — schema changes rely on Docker re-initialisation, which destroys data.**

The `postgres/initdb/` directory contains 14 SQL files named `000_base.sql` through `013_cluster_diagnostics.sql`. These are PostgreSQL `docker-entrypoint-initdb.d` scripts: they run **only when the data directory is empty** (first container start). After that, they are never re-executed.

Practically: if a developer adds a new file (e.g., `014_new_table.sql`), the only way for an existing installation to pick it up is to destroy the named volume and recreate it — which deletes all production data.

There is no migration framework (Flyway, Liquibase, node-pg-migrate, db-migrate). There is no migration history table. There is no way to apply incremental schema changes to a running instance.

Operational risk: Any schema change in production requires a manual `ALTER TABLE` applied by a developer with database access, or a destructive volume wipe. Neither is safe or auditable.

Recommendation: Adopt `node-pg-migrate` or `db-migrate`. Convert the existing `postgres/initdb/` files to numbered migration files. Add a migration step to the startup sequence (`await db.migrate.latest()` before `startCronJobs()`).

---

### Finding DB-02 — Severity: High

**No database backup strategy is defined or documented.**

There is no `pg_dump` script, no cron job for backups, no cloud snapshot configuration, and no mention of backup procedures in any documentation. The `pgdata` named volume holds all user data, survey responses, session records, and scoring history. Losing this volume (container host failure, accidental `docker volume rm`) means total data loss.

Recommendation: Add a nightly backup cron or a `pg_dump` container that runs on a schedule and ships the dump to object storage (S3, Backblaze B2). At minimum, document a manual backup procedure in `docs/operations.md`.

---

### Finding DB-03 — Severity: Medium

**Default database name, user, and password are all `postgres`/`postgres`/`password`.**

The `postgres` superuser account is used for the application database connection. The app should connect with a least-privilege user that has access only to the `postgres` database and cannot drop tables or create extensions.

Recommendation: Create an application-specific user (`survey_app`) with `GRANT` permissions on only the required tables, and configure the pool to use that user.

---

## 8. Secret Management

### Finding SM-01 — Severity: Critical

**A real Moodle API token is committed to version control in two files.**

File 1 — `compose.yml` (line 29):
```yaml
- MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e
```

File 2 — `.env.example` (line 38):
```
MOODLE_TOKEN=c4acddbfba05950afcae5c334c74bc8e
```

This token authenticates against the Moodle REST API with `moodle_mobile_app` service permissions. Anyone with repository access can use it to read and potentially write to the Moodle instance.

Operational risk: Token cannot be safely revoked without potentially breaking deployed instances. It is permanently in git history even if the file is edited.

Recommendation:
1. Revoke the token in the Moodle admin UI immediately.
2. Generate a new token and store it only in a secrets manager or a gitignored `.env` file.
3. Replace the value in `.env.example` with `MOODLE_TOKEN=your-moodle-web-service-token-here`.
4. Remove the `MOODLE_TOKEN` line from `compose.yml` and replace with `${MOODLE_TOKEN}` referencing a `.env` file.
5. Consider running `git filter-repo` or `BFG Repo Cleaner` to purge the token from git history if the repository is or will ever be public.

---

### Finding SM-02 — Severity: High

**All secrets flow through environment variables in `compose.yml` — no secrets manager integration.**

The current approach (env vars in Compose) is acceptable for a local dev setup but provides no secrets rotation, no audit log, and no least-privilege access. For a production deployment, secrets should be injected via:
- Docker secrets (Swarm)
- Platform-native secrets (Fly.io secrets, Railway variables, AWS Secrets Manager)
- A Vault sidecar

Recommendation: Choose a deployment platform and use its native secret injection mechanism rather than committing values to Compose files.

---

## 9. Node.js Process Management

### Finding PM-01 — Severity: Critical

**There is no process manager for production — the backend starts with `node server.js` and has no restart policy.**

`backend/package.json`:
```json
"start": "node server.js"
```

`backend/Dockerfile`:
```dockerfile
CMD ["npm", "start"]
```

There is no PM2, no nodemon (appropriately absent in production), no cluster mode, and no Docker restart policy. A single unhandled exception or OOM kill will terminate the process permanently until a human manually restarts the container.

The `compose.yml` has no `restart` policy on the `backend` service. Docker does not automatically restart containers on crash by default.

Operational risk: Any uncaught exception causes permanent downtime until manual intervention.

Recommendation:
1. Add `restart: unless-stopped` to the `backend` service in `compose.yml`.
2. For production, either use PM2 inside the container (`pm2-runtime server.js`) or rely on the orchestration layer (Docker Swarm, ECS, Kubernetes) restart policy.

---

### Finding PM-02 — Severity: High

**Nightly cron and HTTP request handling share a single Node.js process with no resource isolation.**

The nightly `recomputeAllActiveUserScores()` cron runs sequentially through all active users in the same event loop as HTTP request handling. Each `computeAllScores(user_id)` call triggers the PGMoE clustering pipeline which is computationally intensive (O(N²) distance calculations for silhouette scoring per the prior review).

During a large cron run, HTTP request latencies will spike. There is no mechanism to detect this, limit cron concurrency, or offload the work to a worker thread.

Operational risk: A cron run with 50+ active users could make the API unresponsive for minutes at midnight.

Recommendation:
1. Isolate the cron in a `worker_threads` Worker or a separate Node.js process.
2. Add a concurrency limit — process at most N users per cron batch.
3. Schedule the cron at a low-traffic time (already midnight — acceptable) but monitor cron duration.

---

### Finding PM-03 — Severity: Medium

**The `POST /api/lms/admin/sync-all` endpoint is a long-running synchronous HTTP handler with no timeout.**

The sync-all handler loops over all students and calls `syncUserFromMoodle()` sequentially. For 20 students, this is 20 × (up to ~8 Moodle API calls each) = ~160 HTTP calls, each potentially taking 1–5 seconds. The total operation can take several minutes, during which the HTTP connection is held open.

There is no request timeout, no `AbortController`, and no async job queue. If nginx's `proxy_read_timeout` (default 60s) expires, the client receives a 504 but the sync continues running in the backend silently.

Recommendation: Convert the bulk sync to an async job: accept the request, return a job ID immediately (`202 Accepted`), and process in the background. Expose a `GET /api/lms/admin/sync-status/:jobId` endpoint for polling.

---

## Summary Table

| ID | Area | Finding | Severity |
|----|------|---------|----------|
| CI-01 | CI/CD | Backend never tested in CI | Critical |
| DC-01 | Docker | Hardcoded secrets in `compose.yml` | Critical |
| DS-01 | Deployment | No production deployment config | Critical |
| DB-01 | Database | No migration runner | Critical |
| SM-01 | Secrets | Real Moodle token committed to git | Critical |
| PM-01 | Process | No restart policy on backend container | Critical |
| EM-01 | Env | Weak DB password only warns, does not block | Critical |
| CI-02 | CI/CD | CI triggers only on `main`, not feature branches | High |
| CI-03 | CI/CD | No `npm audit` step, 5 packages at `latest` | High |
| DC-02 | Docker | No dev/prod Compose split | High |
| DS-02 | Deployment | `COPY . .` includes logs and admin scripts | High |
| EM-02 | Env | `database.js` fallback `'password'` | High |
| EM-03 | Env | `NODE_ENV` not validated | High |
| MO-01 | Observability | Container log files are ephemeral | High |
| MO-02 | Observability | No error tracking (Sentry) | High |
| IR-01 | Incident | No runbooks or operational docs | High |
| IR-02 | Incident | Cron failures produce no alert | High |
| DB-02 | Database | No backup strategy | High |
| SM-02 | Secrets | No secrets manager integration | High |
| PM-02 | Process | Cron and HTTP share one process | High |
| PM-03 | Process | `sync-all` is long-running synchronous HTTP handler | High |
| CI-04 | CI/CD | No linting or type-check in CI | Medium |
| CI-05 | CI/CD | Node version not in `engines` field | Medium |
| DC-03 | Docker | Postgres major-tag only, no patch pin | Medium |
| DC-04 | Docker | No health checks on web/backend services | Medium |
| EM-04 | Env | `.env.example` missing several vars | Medium |
| MO-03 | Observability | Incomplete HTTP access logging | Medium |
| DB-03 | Database | App uses postgres superuser account | Medium |
| DC-05 | Docker | nginx missing proxy timeout for backend | Low |
| DC-06 | Docker | Volume mount path convention (minor) | Low |
| MO-04 | Observability | Health endpoint doesn't check DB | Low |

---

## Minimum CI Pipeline Recommendation

Given the codebase, the following GitHub Actions workflow would provide the most safety with the least effort:

```yaml
name: CI

on: [push, pull_request]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
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
      - run: npm test
        working-directory: backend
        env:
          NODE_ENV: test
```

This pipeline: runs on every push (not just `main`), validates both packages, checks for known vulnerabilities, enforces TypeScript types on the frontend, and runs the existing Jest test suite for the backend.
