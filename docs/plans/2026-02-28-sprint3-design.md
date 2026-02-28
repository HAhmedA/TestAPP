# Sprint 3 Design — Scoring Pipeline Test Coverage

**Date:** 2026-02-28
**Branch:** `feature/chatbot`
**Source:** Code review report `.full-review/05-final-report.md` — HIGH-T1, HIGH-T2

---

## Scope

Add test coverage for the four scoring pipeline services that currently have 0% test coverage. The cron service and route-level coverage are out of scope for this sprint.

---

## Services Under Test

| Service | File | What it does |
|---|---|---|
| `clusterStorageService` | `backend/services/scoring/clusterStorageService.js` | Writes cluster results, per-cluster percentile stats, and user assignments to the DB |
| `conceptScoreService` | `backend/services/scoring/conceptScoreService.js` | Converts raw cluster assignment + percentile position into a dial score |
| `scoreComputationService` | `backend/services/scoring/scoreComputationService.js` | Orchestrates `computeClusterScores` for all 4 concepts for a given user |
| `clusterPeerService` | `backend/services/scoring/clusterPeerService.js` | Runs the full PGMoE pipeline: fetch metrics → fit model → store results |

---

## Test File Locations

```
backend/tests/scoring/
  clusterStorageService.test.js
  conceptScoreService.test.js
  scoreComputationService.test.js
  clusterPeerService.test.js
```

---

## Mocking Strategy

All tests use `jest.unstable_mockModule` — the ESM mocking pattern already established in `backend/tests/chat.test.js`. This requires no infrastructure changes and works in CI without a database.

Key mocks per test file:

| Test file | Mocks |
|---|---|
| `clusterStorageService.test.js` | `database.js` pool |
| `conceptScoreService.test.js` | `database.js` pool |
| `scoreComputationService.test.js` | `clusterPeerService.js` (mock `computeClusterScores`) |
| `clusterPeerService.test.js` | `database.js` pool, `pgmoeAlgorithm.js`, `clusterStorageService.js`, `scoreQueryService.js` |

---

## Test Cases Per Service

### 1. `clusterStorageService`

- **Happy path** — `storeClusterResults` writes cluster rows + per-cluster percentile rows; calls succeed
- **Error propagates with `externalClient`** — when called inside a transaction (`externalClient` provided), a query error is re-thrown so `withTransaction` can roll back (Sprint 1 fix validation)
- **Error swallowed without `externalClient`** — standalone call logs the error but does not re-throw (preserves existing non-transactional behaviour)

### 2. `conceptScoreService`

- **Cold start** — no cluster data in DB returns null/default score object
- **Percentile boundary — P5** — user at the bottom of the cluster gets correct dial min
- **Percentile boundary — P95** — user at the top gets correct dial max
- **Normal percentile** — mid-range user gets an interpolated dial value

### 3. `scoreComputationService`

- **Happy path** — `computeAllScores(userId)` calls `computeClusterScores` for all 4 concepts (`sleep`, `screen_time`, `lms`, `srl`)
- **One concept fails** — error in one concept does not prevent the other 3 from completing; error is logged
- **Cold start for a concept** — `{ coldStart: true }` returned by a concept is handled gracefully (no crash, other concepts still run)

### 4. `clusterPeerService`

- **Cold start** — fewer than `MIN_CLUSTER_USERS = 10` users in the cohort; `computeClusterScores` returns `{ coldStart: true }` without calling PGMoE
- **Normal path** — `computeClusterScores` fetches metrics, calls PGMoE, calls `storeClusterResults`, returns successfully
- **Diagnostic sampling cap** — when cohort N > 100, only 100 sampled points are passed to `computeSilhouetteScore` / `computeDaviesBouldinIndex` (Sprint 2 P-C1 fix validation)
- **storeDiagnostics fire-and-forget** — a failure in `storeDiagnostics` does not propagate to the caller

---

## Execution Order

1. `clusterStorageService` — no upstream dependencies; tests the storage layer in isolation
2. `conceptScoreService` — no upstream dependencies; pure computation
3. `scoreComputationService` — mocks `clusterPeerService`; tests orchestration logic
4. `clusterPeerService` — mocks everything; tests the full pipeline wiring

---

## Out of Scope

- `cronService.js` — deferred; requires mocking node-cron timers and the full scoring pipeline together
- Route-level coverage (LMS admin routes, results route, mood/annotations routes)
- Frontend component tests
