# Phase 2: Security & Performance Review

## Security Findings

### Critical

#### SEC-01 — Unauthenticated Admin Session via `legacy-login` Endpoint
**CVSS:** 9.8 | **CWE:** CWE-287 (Improper Authentication)
**File:** `backend/routes/auth.js:72–83`

`/api/auth/legacy-login` creates an authenticated admin session with zero credentials. Calling it with `{"role":"admin"}` (no email/password) sets `req.session.user = { id: 'demo-user', role: 'admin' }`. No `NODE_ENV` guard, no IP allowlist, reachable in production.

**Full exploit chain:** Any internet-accessible attacker can gain admin access and then enumerate all student PII, view/modify system prompts (prompt injection), trigger bulk Moodle sync, and read all cluster assignments via a single unauthenticated POST.

**Fix:** Remove the endpoint entirely, or gate with `if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'not_found' })`.

---

#### SEC-02 — SQL Injection via String Interpolation
**CVSS:** 8.6 (adjusted 6.5 — currently not user-reachable) | **CWE:** CWE-89
**Files:** `scoreQueryService.js:28,32,36,116,142,166`, `sleepAnnotationService.js:313`, `screenTimeAnnotationService.js:255`, `srlAnnotationService.js:297`

Template literals interpolate `days` and the `EXCLUDE_SIMULATED_USERS` raw SQL fragment directly into queries. All `days` values are currently hardcoded to `7` at call sites — not user-controlled. However, one code change (e.g., adding `?days=` query param) creates an immediately exploitable SQL injection. `lmsAnnotationService.js:301` already uses the correct parameterized form.

**Fix:** `WHERE session_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')`, passing `days` as a bound parameter.

---

#### SEC-03 — Rate Limiter Bypass via Legacy Auth Aliases
**CVSS:** 7.5 | **CWE:** CWE-307
**File:** `backend/routes/index.js:23–25`

`/api/login`, `/api/logout`, `/api/me` call the same handlers as `/api/auth/*` but bypass `authLimiter` (10 req/15 min) and `express-validator`. Only the general `apiLimiter` (100 req/15 min) applies — sufficient for credential stuffing or brute-force.

**Fix:** Remove legacy aliases, or apply `authLimiter` + validation to each one.

---

### High

#### SEC-04 — Hardcoded Default Database Password
**CVSS:** 7.3 | **CWE:** CWE-798
**File:** `backend/config/database.js:9`

`password: process.env.PGPASSWORD || 'password'` — `envValidation.js` emits a *warning* but does not block startup when `PGPASSWORD` is absent. A deployment with a missing env var silently uses `'password'`.

**Fix:** Fail pool creation (not just warn) in `NODE_ENV=production` if `PGPASSWORD` is unset or weak.

---

#### SEC-05 — Hardcoded Fallback Session Secret
**CVSS:** 7.5 | **CWE:** CWE-798
**File:** `backend/server.js:66`

`secret: process.env.SESSION_SECRET || 'dev-secret'` — with a known secret, an attacker can forge arbitrary session cookies for any user including admin. `envValidation.js` only catches the literal string `'dev-secret'`, not a missing `SESSION_SECRET`.

**Fix:** `if (isProduction && !sessionSecret) throw new Error('SESSION_SECRET is required in production')`.

---

#### SEC-06 — Verbose Error Details Leaked to Clients
**CVSS:** 5.3 | **CWE:** CWE-209
**File:** `backend/routes/annotations.js:27`

`res.status(500).json({ error: 'db_error', details: String(e) })` exposes database connection strings, table names, column names, and SQL errors to clients. The global error handler correctly hides this in production, but this inline handler bypasses it.

**Fix:** `...(process.env.NODE_ENV !== 'production' && { details: String(e) })`.

---

#### SEC-07 — Admin Cluster-Members Endpoint Exposes Student PII
**CVSS:** 6.5 | **CWE:** CWE-200
**File:** `backend/routes/admin.js:208–245`

Returns full email, name, scores, trend data, and cluster assignments for all students in a single response with no pagination. Combined with SEC-01, this enables complete PII exfiltration in one request.

**Fix:** Mask emails (return only local part), add pagination, add audit logging for admin data access.

---

### Medium

#### SEC-08 — IDOR on Chat Session History
**CVSS:** 5.4 | **CWE:** CWE-639
**File:** `backend/routes/chat.js:132–156`

`GET /api/chat/history?sessionId=UUID` verifies the user is authenticated but does not verify the requested `sessionId` belongs to the authenticated user. Attacker can enumerate session IDs to read other students' private chat conversations.

**Fix:** Add `SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2` ownership check before returning history.

---

#### SEC-09 — `storeUserAssignment` Silently Swallows Errors
**CVSS:** 4.0 | **CWE:** CWE-754
**File:** `backend/services/scoring/clusterStorageService.js:62–79`

Errors are logged but not re-thrown. Inside a transaction (`clusterPeerService.js:261`), `storeClusterResults` can succeed while `storeUserAssignment` fails silently, leaving peer_clusters updated but user_cluster_assignments stale. Users see real scores but with incorrect peer-context dials indefinitely.

**Fix:** `if (externalClient) throw err` — propagate failures to the transaction wrapper for rollback.

---

#### SEC-10 — Missing CSP Directive Tuning
**CVSS:** 4.3 | **CWE:** CWE-1021
**File:** `backend/server.js:27`

`helmet()` uses default CSP configuration. An application communicating with an external LLM API and Moodle instance should restrict `connectSrc` and `scriptSrc` explicitly.

**Fix:** Configure `contentSecurityPolicy.directives` with `connectSrc: ["'self'", LLM_BASE_URL, MOODLE_BASE_URL]` and `frameAncestors: ["'none'"]`.

---

#### SEC-11 — Five Survey Packages Pinned to `"latest"`
**CVSS:** 5.3 | **CWE:** CWE-1395
**File:** `package.json:24–28`

`survey-core`, `survey-react-ui`, `survey-analytics`, `survey-creator-core`, `survey-creator-react` are all `"latest"`. Every `npm install` pulls whatever is current — breaking changes and supply-chain compromise are pulled automatically.

**Fix:** Pin to specific version ranges; add `npm audit` to CI/CD.

---

#### SEC-12 — Moodle Token in URL Query String
**CVSS:** 5.0 | **CWE:** CWE-598
**File:** `backend/services/moodleService.js:126–141`

`wstoken=...` appears in every Moodle REST call URL. Tokens are recorded in proxy logs, APM tools, and web server access logs. This is Moodle's design — cannot be changed on the client side — but requires log redaction and short token rotation.

**Fix:** Redact `wstoken` in all log configurations; rotate the token regularly; document as accepted risk.

---

### Low

#### SEC-13 — `trust proxy` Set to `1` Without Validation
`backend/server.js:35` — In deployments without a reverse proxy, `X-Forwarded-For` can be spoofed, bypassing IP-based rate limiting.

#### SEC-14 — 30-Day Session Cookie Lifetime
`backend/server.js:73` — Excessive for a student wellbeing app handling sensitive data. A stolen cookie has a 30-day exploitation window.

#### SEC-15 — Swagger UI Exposed Without Authentication
`backend/server.js:87` — Reveals full API surface to unauthenticated users. Disable in production.

#### SEC-16 — No Explicit Request Body Size Limit
`backend/server.js:55` — Default Express 100KB limit is larger than required for this application; should be reduced to `'50kb'`.

---

## Performance Findings

### Critical

#### P-C1 — O(N²) Silhouette Score Computation in Nightly Cron
**File:** `backend/services/scoring/pgmoeAlgorithm.js:599–642`

`computeSilhouetteScore` is O(N²) and runs 4× per user (once per concept) inside the nightly sequential cron. Total complexity: O(U × 4 × N²) where U = active users, N = cohort size.

- 50 users: ~1 second (invisible)
- 200 users: ~15 minutes (nightly job may not finish before next trigger)
- 500 users: **multiple hours** — cron runs are permanently overlapping

The silhouette metric is only used for the append-only `cluster_run_diagnostics` audit table (fire-and-forget path). It does not affect score correctness.

**Fix:** Move silhouette/Davies-Bouldin calculations to a separate low-priority background job decoupled from the user scoring path. Or cap to a random sample of `min(N, 100)` points.

---

#### P-C2 — Nightly Cron Is Fully Sequential Across All Users and All Concepts
**Files:** `backend/services/cronService.js:50–58`, `backend/services/scoring/scoreComputationService.js:83–88`

`computeAllScores(userId)` iterates 4 concepts sequentially for each user, and the cron iterates all active users sequentially. At 50 users each taking ~3s (12 EM fits), the nightly job takes 2.5 minutes. With P-C1 compounding this, failure is guaranteed before reaching 200 users.

**Architectural fix:** The clustering is cohort-level computation — run PGMoE once per concept across all users, then fan out assignment writes in parallel. This reduces 4N model fits to 4 model fits total.

---

#### P-C3 — Sequential Moodle Forum HTTP Requests
**File:** `backend/services/moodleService.js:291–334`

One HTTP call per discussion thread, capped at 50 per forum. With 2 forums: up to 108 HTTP calls per user sync. The admin `sync-all` runs users sequentially.

**Worst case:** 50 students × 108 calls × 200ms = **18 minutes** for bulk sync. The Express HTTP connection from the admin client remains open for the full duration.

**Fix:** `Promise.all` with `p-limit(5)` for discussion post fetches; run user syncs in parallel with bounded concurrency (3–5) in `sync-all`.

---

#### P-C4 — `storeUserAssignment` Silently Swallows Errors — Stale Dials Shown to Users
*(Same root cause as SEC-09)*

When `storeUserAssignment` fails inside a `withTransaction` block, `storeClusterResults` has already committed the peer_clusters rows. The user's `user_cluster_assignments` row is stale. The scores route falls back to `dialMin=0, dialCenter=50, dialMax=100` — generic placeholder values — displayed silently with no error indicator. This can persist indefinitely through nightly re-failures.

**Fix:** Remove the try/catch from `storeUserAssignment`; let errors propagate and roll back the entire transaction.

---

### High

#### P-H1 — 4 Sequential DB Queries Per `/api/scores` Request
**File:** `backend/routes/scores.js:36–149`

Three sequential queries (concept_scores, score_history, cluster_assignments JOIN peer_clusters) before the parallelized pool-size check. ~23ms minimum DB time per page load, saturating the default pool under concurrent requests.

**Fix:** Merge queries 1–3 into a single LEFT JOIN query; total DB round-trips drop from 4 to 2.

---

#### P-H2 — `cluster_run_diagnostics` Table Has No Retention Policy
**Files:** `postgres/initdb/013_cluster_diagnostics.sql`, `clusterStorageService.js:94–118`

Append-only, no ON CONFLICT. At 50 students × 4 concepts × 2 triggers/day = 400 rows/day → **146,000 rows/year**. The `DISTINCT ON` admin query uses the index correctly but the table will reach millions of rows.

**Fix:** Add nightly `DELETE FROM cluster_run_diagnostics WHERE computed_at < NOW() - INTERVAL '90 days'`.

---

#### P-H3 — `/api/admin/cluster-members` Fetched on Every Admin Mount, No Pagination
**Files:** `backend/routes/admin.js:208–245`, `src/components/AdminClusterDiagnosticsPanel.tsx`

Returns all students' emails, scores, and cluster data unbounded. `useEffect` fires on mount unconditionally — even when the panel is collapsed. At 100 students × 4 concepts, this is 400 JSONB rows (~200–400KB) on every admin page load.

**Fix:** Lazy-load on panel expand; add server-side pagination (`?concept_id=lms&limit=50&offset=0`).

---

### Medium

#### P-M1 — No DB Pool Configuration (Connection Pool Will Exhaust Under Load)
**File:** `backend/config/database.js`

`pg.Pool` created with no `max`, `min`, `idleTimeoutMillis`, or `connectionTimeoutMillis`. Default `max: 10` is insufficient given concurrent scoring runs, session store connections, and chat endpoints (4–6 queries per message).

**Fix:** `max: parseInt(process.env.DB_POOL_MAX || '20')`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`.

---

#### P-M2 — N+1 Loop in `/api/admin/prompts`
**File:** `backend/routes/admin.js:44–64`

Sequential `SELECT LIMIT 1` per prompt type. Replace with single `DISTINCT ON (prompt_type) ... ORDER BY prompt_type, updated_at DESC`.

---

#### P-M3 — INTERVAL SQL String Interpolation (Performance Angle)
*(Same as SEC-02 for performance)* — `days` parameter not validated as integer before interpolation; accidental `NaN` or float would cause a PostgreSQL parse error mid-query rather than a clean validation failure.

---

#### P-M4 — 3+ Sequential DB Queries Per Chat Message
**File:** `backend/services/contextManagerService.js:26–64`

`getOrCreateSession` = 3 queries (expire → find → touch). Then `saveMessage` (INSERT + UPDATE), `assemblePrompt` (multiple queries), LLM call, another `saveMessage`, and a second `last_activity_at` UPDATE. The session touch fires **twice** per message. With 10 concurrent chatters: 6–8 DB round-trips before LLM latency begins.

**Fix:** Cache active session ID server-side; remove duplicate `last_activity_at` update; combine saveMessage + invalidateSummary in one transaction.

---

#### P-M5 — `computeCompositeScore` Re-Sorts All Users Per Call
**File:** `backend/services/scoring/clusterPeerService.js:87–111`

O(N log N) sort runs for every user × every call (called 2× per user in `composites` build), even though P5/P95 ranges are identical for all users. Precompute ranges once and pass them as an argument.

---

#### P-M6 — `getOrCreateBaseline` Issues 3 Sequential DB Queries
**Files:** `lmsAnnotationService.js:372–396`, `sleepAnnotationService.js:269–292`

SELECT → INSERT ON CONFLICT DO NOTHING → SELECT pattern. Race condition under concurrent requests and an extra round-trip. Replace with a single `INSERT ... ON CONFLICT ... RETURNING *` + CTE fallback SELECT.

---

### Low

| ID | Issue | File |
|----|-------|------|
| P-L1 | `ConceptScore` interface defined in 3 files — type drift risk | `Home.tsx`, `ScoreBoard.tsx` |
| P-L2 | `setTimeout` retry in `Home.tsx` with no unmount cleanup | `src/pages/Home.tsx:97–99` |
| P-L3 | Second LLM call for follow-up prompts when XML not embedded | `contextManagerService.js:394` |
| P-L4 | `selectOptimalModel` fits 12 models every time; no intra-day cache | `pgmoeAlgorithm.js:429–518` |
| P-L5 | Dynamic `import()` in hot annotation path — obfuscates dep graph | annotation services |
| P-L6 | No partial index on `is_simulated` — full scan when SIMULATION_MODE=false | `scoreQueryService.js:117` |

---

### Scalability Architecture Notes

**S-1:** Single-process Node.js — CPU-bound EM loops share event loop with HTTP handlers. The nightly cron must be moved to a separate worker/container to prevent scoring work from blocking request serving.

**S-2:** Rate limiter is IP-based — in a university environment (shared campus NAT), one chatty student can exhaust the global rate limit for all students on the same IP. Use session/user-ID-based limiting on authenticated routes.

**S-3:** `computeAllScores` fires fire-and-forget on every data submission event (sleep, screen-time, SRL, Moodle sync, simulation). A user submitting all three forms triggers 3 parallel PGMoE runs against the same unchanged cohort data. Add per-user debouncing (30s minimum interval) or a job queue.

---

## Critical Issues for Phase 3 Context

1. **SEC-01 (unauthenticated admin)** — Testing phase should verify there are no other zero-auth endpoints; document the legacy-login removal test case.
2. **SEC-08 (IDOR on chat history)** — Chat endpoints have no ownership tests. Test coverage gap is likely systemic.
3. **P-C1/P-C2 (nightly cron scalability)** — No performance or load tests exist for the scoring pipeline. Critical path with no regression safety net.
4. **P-C4 / SEC-09 (silent storeUserAssignment failure)** — No test verifies that a failed assignment write is visible to callers. The bug is undetectable without explicit negative tests.
5. **SEC-11 (survey packages at "latest")** — Documentation should capture the pinned-version policy decision.
