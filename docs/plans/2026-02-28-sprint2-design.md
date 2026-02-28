# Sprint 2 Design — Architectural & Infrastructure Hardening

**Date:** 2026-02-28
**Branch:** `feature/chatbot`
**Source:** Code review report `.full-review/05-final-report.md`

---

## Scope

Five items from the Sprint 2 review plan. P-C2 (cohort-level PGMoE refactor) is **out of scope by product decision** — the 4N per-user PGMoE fits are intentional for per-user cluster granularity.

---

## 1. P-C1 — Cap Silhouette Computation to O(100²)

**Problem:** `computeSilhouetteScore` and `computeDaviesBouldinIndex` are O(N²). They run 4× per user inside the per-user scoring path (`clusterPeerService.js`). These metrics are diagnostic-only (stored in `cluster_run_diagnostics`) and do not affect score correctness.

**Decision:** Sample `Math.min(N, 100)` random users before computing silhouette/Davies-Bouldin. This caps cost at ~10K comparisons regardless of cohort size while keeping diagnostics statistically meaningful.

**Change surface:**
- `backend/services/scoring/clusterPeerService.js` — add sampling before both diagnostic calls inside `computeClusterScores`.

---

## 2. P-C3/PM-H1 — sync-all as Background Job + p-limit Concurrency

**Problem:** `POST /api/lms/admin/sync-all` holds an HTTP connection open for up to 18 minutes (sequential per-user sync × sequential per-discussion forum fetches). Worst case: 50 students × 108 HTTP calls × 200ms = ~18 min.

**Decision:** In-memory job store (simple `Map`) — no external dependencies; lost on restart (admin can re-trigger).

**Design:**

```
POST /api/lms/admin/sync-all
  → create jobId (UUID)
  → insert into jobStore: { status: 'pending', ... }
  → setImmediate(() => runSyncJob(jobId, users))
  → return 202 { jobId }

GET /api/lms/admin/sync-all/status/:jobId
  → return jobStore.get(jobId) or 404

Background: runSyncJob(jobId, users)
  → p-limit(5) across user syncs
  → update jobStore progress per user
  → set status: 'complete' | 'failed' when done
```

**Concurrency:** `p-limit(5)` for concurrent user syncs. `p-limit(5)` also applied inside `moodleService.js` for the per-discussion forum post fetches.

**Change surface:**
- `backend/routes/lms.js` — replace sync-all handler; add status endpoint
- `backend/services/moodleService.js` — add p-limit to discussion fetch loop
- `backend/package.json` — add `p-limit` dependency

---

## 3. PM-C1/DS-C1 — Compose Hardening + Production Config

**Problem:** (a) No `restart: unless-stopped` policy — a crash kills the backend permanently. (b) `POSTGRES_PASSWORD=password` is still hardcoded in the postgres service. (c) No production Compose file — only config bakes in `DEBUG_LLM=true` and no health check.

**Changes to `compose.yml`:**
- Add `restart: unless-stopped` to `backend` service
- Change `POSTGRES_PASSWORD: password` → `POSTGRES_PASSWORD: ${PGPASSWORD}` in `postgres` service

**New `compose.prod.yml` (override file):**
```
backend:
  environment:
    - NODE_ENV=production
    - DEBUG_LLM=false
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/api/health"]
    interval: 30s
    timeout: 10s
    retries: 3
  volumes:
    - logs:/app/logs

volumes:
  logs:
```

Usage: `docker compose -f compose.yml -f compose.prod.yml up -d`

**Change surface:**
- `compose.yml` (two edits)
- New `compose.prod.yml`

---

## 4. FW-H2 — asyncRoute Migration for 4 Route Files

**Problem:** `chat.js`, `mood.js`, `annotations.js`, `results.js` use raw `try/catch` instead of the `asyncRoute()` pattern defined in `backend/utils/errors.js`. Unhandled errors bypass the central Express error middleware.

**Decision:** Wrap all async route handlers with `asyncRoute()`. The IDOR ownership check in `chat.js` (direct `pool.query()`) stays as an explicit check inside the `asyncRoute` wrapper — it returns a 403 intentionally rather than throwing.

**Pattern change:**
```js
// Before
router.get('/endpoint', async (req, res) => {
    try { ... } catch (err) { res.status(500).json({ error: 'server_error' }) }
})

// After
router.get('/endpoint', asyncRoute(async (req, res) => {
    // throw AppError here — no try/catch needed
    // manual 4xx checks still explicit
}))
```

**Change surface:**
- `backend/routes/chat.js`
- `backend/routes/mood.js`
- `backend/routes/annotations.js`
- `backend/routes/results.js`

---

## 5. DB-C1 — node-pg-migrate Schema Versioning

**Problem:** The 14 `postgres/initdb/` SQL files only execute on an empty Docker volume. Schema changes after initial setup require either manual `ALTER TABLE` or a full volume wipe (data destruction). No migration history.

**Decision:** Full conversion — replace initdb files with numbered `node-pg-migrate` migrations. Backend runs `migrate up` on startup before Express starts. This is the single schema source of truth.

**Setup:**
```
backend/
  migrations/
    1650000000000_base.js
    1650000001000_auth-and-sessions.js
    ... (14 total)
  package.json  ← add: "migrate": "node-pg-migrate up"
```

**Startup sequence:**
```
[Docker compose up]
  → postgres starts (empty volume, no initdb)
  → backend starts
  → npm run migrate  (creates schema from migrations/)
  → node server.js   (Express starts)
```

**`DATABASE_URL`:** node-pg-migrate reads from `DATABASE_URL` env var. Format: `postgres://user:password@host:port/db`. Added to `.env.example`. In `compose.yml`, derived from existing `PG*` vars.

**Volume mount:** `./postgres/initdb:/docker-entrypoint-initdb.d` removed from `compose.yml`.

**`postgres/initdb/` directory:** Kept in repo for reference but no longer mounted.

**Change surface:**
- New `backend/migrations/` (14 files)
- `backend/package.json` — install `node-pg-migrate`, add `migrate` script
- `backend/Dockerfile` — run migrate before starting server
- `compose.yml` — add `DATABASE_URL`, remove initdb volume mount
- `.env.example` — add `DATABASE_URL`

---

## Execution Order

1. P-C1 (silhouette cap) — smallest change, no new deps, immediate perf improvement
2. FW-H2 (asyncRoute) — mechanical, low risk
3. PM-C1/DS-C1 (compose) — infrastructure, fast
4. P-C3/PM-H1 (sync-all background) — new dependency (p-limit), moderate complexity
5. DB-C1 (migrations) — most invasive, must be last to avoid breaking other steps
