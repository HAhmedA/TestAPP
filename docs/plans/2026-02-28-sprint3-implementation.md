# Sprint 3 — Scoring Pipeline Test Coverage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add test coverage for the 4 scoring pipeline services that currently have 0% coverage: `clusterStorageService`, `conceptScoreService`, `scoreComputationService`, and `clusterPeerService`.

**Architecture:** Tests live in a new `backend/tests/scoring/` subdirectory. All 4 files follow the `jest.unstable_mockModule` ESM mocking pattern already established in `backend/tests/chat.test.js` — no real database required and no infrastructure changes needed.

**Tech Stack:** Jest (ESM via `NODE_OPTIONS='--experimental-vm-modules'`), `jest.unstable_mockModule`, existing `supertest`-free unit test style.

---

## Context you need to know

### Test runner commands
Run just the new tests:
```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/ --no-coverage
```

Run a single file:
```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/clusterStorageService.test.js --no-coverage
```

Run all 110+ tests (regression check):
```bash
cd backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

### ESM mocking pattern
Because the backend uses `"type": "module"`, regular `jest.mock()` does not work. Use `jest.unstable_mockModule()` instead. Mocks must be declared **before** the module under test is imported, and the import must use `await import(...)` (dynamic import), not a top-level `import` statement.

Pattern from `backend/tests/chat.test.js`:
```js
import { jest } from '@jest/globals'

const mockQuery = jest.fn()

jest.unstable_mockModule('../config/database.js', () => ({
    default: { query: mockQuery }
}))

// Dynamic import AFTER mocks
const { myFunction } = await import('../services/myService.js')
```

### Mock paths
All paths in `jest.unstable_mockModule` are **relative to the test file**. The new test files live at `backend/tests/scoring/`, so:

| Module | Path in mock |
|---|---|
| `backend/config/database.js` | `'../../config/database.js'` |
| `backend/utils/logger.js` | `'../../utils/logger.js'` |
| `backend/utils/withTransaction.js` | `'../../utils/withTransaction.js'` |
| `backend/utils/stats.js` | `'../../utils/stats.js'` |
| `backend/services/scoring/pgmoeAlgorithm.js` | `'../../services/scoring/pgmoeAlgorithm.js'` |
| `backend/services/scoring/clusterStorageService.js` | `'../../services/scoring/clusterStorageService.js'` |
| `backend/services/scoring/scoreQueryService.js` | `'../../services/scoring/scoreQueryService.js'` |
| `backend/services/scoring/conceptScoreService.js` | `'../../services/scoring/conceptScoreService.js'` |
| `backend/services/annotators/sleepAnnotationService.js` | `'../../services/annotators/sleepAnnotationService.js'` |
| `backend/services/annotators/screenTimeAnnotationService.js` | `'../../services/annotators/screenTimeAnnotationService.js'` |
| `backend/services/annotators/lmsAnnotationService.js` | `'../../services/annotators/lmsAnnotationService.js'` |
| `backend/services/annotators/srlAnnotationService.js` | `'../../services/annotators/srlAnnotationService.js'` |

### What `withTransaction` does
`withTransaction(pool, fn)` opens a DB client, calls `fn(client)`, commits on success, rolls back on error. In tests, mock it to call the callback with a mock client:
```js
mockWithTransaction.mockImplementation(async (_pool, fn) => {
    await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
})
```

---

## Task 1: clusterStorageService tests

**Files:**
- Create: `backend/tests/scoring/clusterStorageService.test.js`

**What to test:**
1. `storeUserAssignment` with `externalClient` — writes to client and errors propagate (Sprint 1 fix validation)
2. `storeUserAssignment` standalone — errors are swallowed and logged
3. `storeClusterResults` with `externalClient` — calls `externalClient.query`
4. `storeClusterResults` standalone — uses `withTransaction`

**Step 1: Create the directory**

```bash
mkdir -p /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend/tests/scoring
```

**Step 2: Write the test file**

Create `backend/tests/scoring/clusterStorageService.test.js` with this exact content:

```js
/**
 * Unit tests for clusterStorageService.js
 * Validates the Sprint 1 fix: storeUserAssignment must propagate errors
 * when externalClient is provided (so withTransaction can rollback).
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockQuery       = jest.fn()
const mockWithTransaction = jest.fn()
const mockGenerateClusterLabels = jest.fn()
const mockPercentile  = jest.fn()
const mockLogError    = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../utils/withTransaction.js', () => ({
    withTransaction: mockWithTransaction
}))
jest.unstable_mockModule('../../services/scoring/pgmoeAlgorithm.js', () => ({
    generateClusterLabels: mockGenerateClusterLabels,
    fitPGMoE: jest.fn(),
    selectOptimalModel: jest.fn(),
    computeSilhouetteScore: jest.fn(),
    computeDaviesBouldinIndex: jest.fn(),
    centerNormalize: jest.fn()
}))
jest.unstable_mockModule('../../utils/stats.js', () => ({
    percentile: mockPercentile
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { error: mockLogError, info: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { storeUserAssignment, storeClusterResults } =
    await import('../../services/scoring/clusterStorageService.js')

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    mockQuery.mockReset()
    mockWithTransaction.mockReset()
    mockLogError.mockReset()
    mockGenerateClusterLabels.mockReset()
    mockPercentile.mockReset()
})

// ══════════════════════════════════════════════════════════════════════════════
// storeUserAssignment
// ══════════════════════════════════════════════════════════════════════════════

describe('storeUserAssignment — with externalClient', () => {
    test('calls client.query with correct params', async () => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) }
        await storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5, mockClient)

        expect(mockClient.query).toHaveBeenCalledTimes(1)
        const [sql, params] = mockClient.query.mock.calls[0]
        expect(sql).toContain('INSERT INTO public.user_cluster_assignments')
        expect(params).toEqual(['user-1', 'sleep', 0, 'Low', 25.5])
    })

    test('propagates errors so withTransaction can rollback', async () => {
        const mockClient = { query: jest.fn().mockRejectedValue(new Error('DB timeout')) }
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5, mockClient))
            .rejects.toThrow('DB timeout')
    })
})

describe('storeUserAssignment — standalone (no externalClient)', () => {
    test('resolves and calls pool.query on success', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5))
            .resolves.toBeUndefined()
        expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    test('swallows errors and logs them — does not throw', async () => {
        mockQuery.mockRejectedValue(new Error('Connection refused'))
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5))
            .resolves.toBeUndefined()
        expect(mockLogError).toHaveBeenCalledWith(
            expect.stringContaining('Error storing user cluster assignment')
        )
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// storeClusterResults
// ══════════════════════════════════════════════════════════════════════════════

const sampleComposites = [
    { userId: 'u1', composite: 70, cluster: 0 },
    { userId: 'u2', composite: 30, cluster: 1 },
]
const sampleClusterRemap  = { 0: 1, 1: 0 }
const sampleClusterMeans  = [{ cluster: 1, mean: 30 }, { cluster: 0, mean: 70 }]
const sampleModel         = { means: [[0.5, 0.5], [0.3, 0.3]] }

describe('storeClusterResults — with externalClient', () => {
    test('calls client.query (DELETE stale + INSERT per cluster)', async () => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) }
        mockGenerateClusterLabels.mockReturnValue(['Low', 'High'])
        mockPercentile.mockReturnValue(50)

        await storeClusterResults('sleep', sampleComposites, sampleClusterRemap,
            sampleClusterMeans, 2, sampleModel, mockClient)

        expect(mockClient.query).toHaveBeenCalled()
        // First call is the DELETE stale clusters statement
        const [firstSql] = mockClient.query.mock.calls[0]
        expect(firstSql).toContain('DELETE FROM public.peer_clusters')
    })
})

describe('storeClusterResults — standalone', () => {
    test('delegates to withTransaction', async () => {
        mockWithTransaction.mockImplementation(async (_pool, fn) => {
            await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
        })
        mockGenerateClusterLabels.mockReturnValue(['Low', 'High'])
        mockPercentile.mockReturnValue(50)

        await storeClusterResults('sleep', sampleComposites, sampleClusterRemap,
            sampleClusterMeans, 2, sampleModel)

        expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    })
})
```

**Step 3: Run the test file**

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/clusterStorageService.test.js --no-coverage
```

Expected: 6 tests, all pass.

**Step 4: Commit**

```bash
git add backend/tests/scoring/clusterStorageService.test.js
git commit -m "test: add unit tests for clusterStorageService (HIGH-T2)

Validates that storeUserAssignment propagates errors when externalClient
is provided (Sprint 1 fix) and swallows errors in standalone mode."
```

---

## Task 2: conceptScoreService tests

**Files:**
- Create: `backend/tests/scoring/conceptScoreService.test.js`

**What to test:**
1. `calculateTrend` — pure function, all 4 branches
2. `computeAndStoreRawScore` — empty input, normal path with DB calls

**Step 1: Write the test file**

Create `backend/tests/scoring/conceptScoreService.test.js`:

```js
/**
 * Unit tests for conceptScoreService.js
 * Covers calculateTrend (pure) and computeAndStoreRawScore (DB-touching).
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockQuery          = jest.fn()
const mockWithTransaction = jest.fn()
const mockLogInfo        = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../utils/withTransaction.js', () => ({
    withTransaction: mockWithTransaction
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { calculateTrend, computeAndStoreRawScore } =
    await import('../../services/scoring/conceptScoreService.js')

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    mockQuery.mockReset()
    mockWithTransaction.mockReset()
})

// ══════════════════════════════════════════════════════════════════════════════
// calculateTrend — pure function, no mocks needed
// ══════════════════════════════════════════════════════════════════════════════

describe('calculateTrend', () => {
    test('returns stable when no history (null)', () => {
        expect(calculateTrend(75, null)).toBe('stable')
    })

    test('returns stable when no history (undefined)', () => {
        expect(calculateTrend(75, undefined)).toBe('stable')
    })

    test('returns improving when today exceeds yesterday by more than 5', () => {
        expect(calculateTrend(80, 70)).toBe('improving')  // diff = 10
    })

    test('returns declining when today is below yesterday by more than 5', () => {
        expect(calculateTrend(60, 70)).toBe('declining')  // diff = -10
    })

    test('returns stable when difference is exactly 5 (boundary)', () => {
        expect(calculateTrend(80, 75)).toBe('stable')   // diff = 5, not > 5
        expect(calculateTrend(70, 75)).toBe('stable')   // diff = -5, not < -5
    })

    test('returns stable when difference is within the threshold', () => {
        expect(calculateTrend(77, 75)).toBe('stable')   // diff = 2
        expect(calculateTrend(73, 75)).toBe('stable')   // diff = -2
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// computeAndStoreRawScore
// ══════════════════════════════════════════════════════════════════════════════

describe('computeAndStoreRawScore', () => {
    test('returns zero score for empty rawScores without touching DB', async () => {
        const result = await computeAndStoreRawScore('user-1', 'sleep', [])
        expect(result).toEqual({ score: 0, trend: 'stable', breakdown: {} })
        expect(mockQuery).not.toHaveBeenCalled()
        expect(mockWithTransaction).not.toHaveBeenCalled()
    })

    test('computes average score from rawScores (numericScore field)', async () => {
        // getYesterdayScore: no history → trend will be 'stable'
        mockQuery.mockResolvedValue({ rows: [] })
        // storeScore uses withTransaction
        mockWithTransaction.mockImplementation(async (_pool, fn) => {
            await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
        })

        const rawScores = [
            { domain: 'duration',    numericScore: 80 },
            { domain: 'continuity',  numericScore: 60 }
        ]
        const result = await computeAndStoreRawScore('user-1', 'sleep', rawScores)

        expect(result.score).toBeCloseTo(70, 1)   // (80 + 60) / 2 = 70
        expect(result.trend).toBe('stable')        // no yesterday score
        expect(result.breakdown).toHaveProperty('duration')
        expect(result.breakdown).toHaveProperty('continuity')
        expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    })

    test('returns improving trend when score improved by more than 5 from yesterday', async () => {
        // getYesterdayScore: yesterday was 60
        mockQuery.mockResolvedValue({ rows: [{ score: '60.00' }] })
        mockWithTransaction.mockImplementation(async (_pool, fn) => {
            await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
        })

        const rawScores = [{ domain: 'duration', numericScore: 80 }]
        const result = await computeAndStoreRawScore('user-1', 'sleep', rawScores)

        expect(result.score).toBeCloseTo(80, 1)
        expect(result.trend).toBe('improving')
    })
})
```

**Step 2: Run the test file**

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/conceptScoreService.test.js --no-coverage
```

Expected: 9 tests, all pass.

**Step 3: Commit**

```bash
git add backend/tests/scoring/conceptScoreService.test.js
git commit -m "test: add unit tests for conceptScoreService (HIGH-T1 partial)

Tests calculateTrend (all branches) and computeAndStoreRawScore
including the DB-touching path with mocked pool and withTransaction."
```

---

## Task 3: scoreComputationService tests

**Files:**
- Create: `backend/tests/scoring/scoreComputationService.test.js`

**What to test:**
1. `computeConceptScore` — 5 cases: unknown concept, empty data, cold start, happy path, service throws
2. `computeAllScores` — all 4 concepts called; one failing doesn't block others

**Step 1: Write the test file**

Create `backend/tests/scoring/scoreComputationService.test.js`:

```js
/**
 * Unit tests for scoreComputationService.js
 * Tests computeConceptScore and computeAllScores orchestration.
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockGetSleepRawScores      = jest.fn()
const mockGetScreenTimeRawScores = jest.fn()
const mockGetLMSRawScores        = jest.fn()
const mockGetSRLRawScores        = jest.fn()
const mockComputeAndStoreRawScore = jest.fn()
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: jest.fn() }
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, debug: jest.fn(), warn: jest.fn() }
}))
jest.unstable_mockModule('../../services/annotators/sleepAnnotationService.js', () => ({
    getRawScoresForScoring: mockGetSleepRawScores
}))
jest.unstable_mockModule('../../services/annotators/screenTimeAnnotationService.js', () => ({
    getRawScoresForScoring: mockGetScreenTimeRawScores
}))
jest.unstable_mockModule('../../services/annotators/lmsAnnotationService.js', () => ({
    getRawScoresForScoring: mockGetLMSRawScores
}))
jest.unstable_mockModule('../../services/annotators/srlAnnotationService.js', () => ({
    getRawScoresForScoring: mockGetSRLRawScores
}))
jest.unstable_mockModule('../../services/scoring/conceptScoreService.js', () => ({
    computeAndStoreRawScore:  mockComputeAndStoreRawScore,
    getAllScoresForChatbot:    jest.fn().mockResolvedValue('')
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { computeConceptScore, computeAllScores } =
    await import('../../services/scoring/scoreComputationService.js')

// ── Shared fixture ──────────────────────────────────────────────────────────────
const HAPPY_RAW_SCORES = [{ domain: 'duration', numericScore: 75 }]
const HAPPY_RESULT     = { score: 75, trend: 'stable', breakdown: {} }

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    mockGetSleepRawScores.mockReset()
    mockGetScreenTimeRawScores.mockReset()
    mockGetLMSRawScores.mockReset()
    mockGetSRLRawScores.mockReset()
    mockComputeAndStoreRawScore.mockReset()
    mockLogError.mockReset()
})

// ══════════════════════════════════════════════════════════════════════════════
// computeConceptScore
// ══════════════════════════════════════════════════════════════════════════════

describe('computeConceptScore', () => {
    test('returns null for an unknown conceptId', async () => {
        const result = await computeConceptScore('user-1', 'unknown_concept')
        expect(result).toBeNull()
        expect(mockComputeAndStoreRawScore).not.toHaveBeenCalled()
    })

    test('returns null when annotation service returns no data', async () => {
        mockGetSleepRawScores.mockResolvedValue([])
        const result = await computeConceptScore('user-1', 'sleep')
        expect(result).toBeNull()
        expect(mockComputeAndStoreRawScore).not.toHaveBeenCalled()
    })

    test('returns { coldStart: true } when annotation service signals cold start', async () => {
        mockGetSleepRawScores.mockResolvedValue([{ coldStart: true }])
        const result = await computeConceptScore('user-1', 'sleep')
        expect(result).toEqual({ coldStart: true })
        expect(mockComputeAndStoreRawScore).not.toHaveBeenCalled()
    })

    test('calls computeAndStoreRawScore and returns its result on happy path', async () => {
        mockGetSleepRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockComputeAndStoreRawScore.mockResolvedValue(HAPPY_RESULT)

        const result = await computeConceptScore('user-1', 'sleep')

        expect(result).toEqual(HAPPY_RESULT)
        expect(mockComputeAndStoreRawScore).toHaveBeenCalledWith('user-1', 'sleep', HAPPY_RAW_SCORES)
    })

    test('returns null and logs error when annotation service throws', async () => {
        mockGetSleepRawScores.mockRejectedValue(new Error('DB connection lost'))

        const result = await computeConceptScore('user-1', 'sleep')

        expect(result).toBeNull()
        expect(mockLogError).toHaveBeenCalledWith(
            expect.stringContaining('Error computing sleep score')
        )
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// computeAllScores
// ══════════════════════════════════════════════════════════════════════════════

describe('computeAllScores', () => {
    test('calls annotation services for all 4 concepts and returns all results', async () => {
        mockGetSleepRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetScreenTimeRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetLMSRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetSRLRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockComputeAndStoreRawScore.mockResolvedValue(HAPPY_RESULT)

        const results = await computeAllScores('user-1')

        expect(Object.keys(results)).toHaveLength(4)
        expect(results).toHaveProperty('sleep')
        expect(results).toHaveProperty('screen_time')
        expect(results).toHaveProperty('lms')
        expect(results).toHaveProperty('srl')
    })

    test('one failing concept does not prevent the others from running', async () => {
        // sleep throws — the other 3 succeed
        mockGetSleepRawScores.mockRejectedValue(new Error('Sleep service down'))
        mockGetScreenTimeRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetLMSRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetSRLRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockComputeAndStoreRawScore.mockResolvedValue(HAPPY_RESULT)

        const results = await computeAllScores('user-1')

        // sleep failed → null → excluded from results
        expect(results).not.toHaveProperty('sleep')
        // the other 3 ran successfully
        expect(results).toHaveProperty('screen_time')
        expect(results).toHaveProperty('lms')
        expect(results).toHaveProperty('srl')
    })

    test('cold start concept is included in results (truthy value)', async () => {
        mockGetSleepRawScores.mockResolvedValue([{ coldStart: true }])
        mockGetScreenTimeRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetLMSRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockGetSRLRawScores.mockResolvedValue(HAPPY_RAW_SCORES)
        mockComputeAndStoreRawScore.mockResolvedValue(HAPPY_RESULT)

        const results = await computeAllScores('user-1')

        // { coldStart: true } is truthy so it IS included
        expect(results).toHaveProperty('sleep')
        expect(results.sleep).toEqual({ coldStart: true })
    })
})
```

**Step 2: Run the test file**

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/scoreComputationService.test.js --no-coverage
```

Expected: 8 tests, all pass.

**Step 3: Commit**

```bash
git add backend/tests/scoring/scoreComputationService.test.js
git commit -m "test: add unit tests for scoreComputationService (HIGH-T1 partial)

Tests computeConceptScore (5 cases) and computeAllScores orchestration
including cold start and partial-failure isolation across concepts."
```

---

## Task 4: clusterPeerService tests

**Files:**
- Create: `backend/tests/scoring/clusterPeerService.test.js`

**What to test:**
1. Cold start (< MIN_CLUSTER_USERS = 10) → `{ coldStart: true }`
2. User not in metrics → `null`
3. Unknown conceptId → `null`
4. Normal path → calls PGMoE algorithm and stores results
5. `storeDiagnostics` failure does not propagate (fire-and-forget)
6. Diagnostic sampling cap: N ≤ 100 → all N passed; N > 100 → only 100 passed (Sprint 2 P-C1 fix validation)

**Step 1: Write the test file**

Create `backend/tests/scoring/clusterPeerService.test.js`:

```js
/**
 * Unit tests for clusterPeerService.js
 * Covers cold start, normal PGMoE path, and the diagnostic sampling cap (P-C1).
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockGetAllUserMetrics         = jest.fn()
const mockCenterNormalize           = jest.fn()
const mockSelectOptimalModel        = jest.fn()
const mockGenerateClusterLabels     = jest.fn()
const mockComputeSilhouetteScore    = jest.fn()
const mockComputeDaviesBouldinIndex = jest.fn()
const mockStoreClusterResults       = jest.fn()
const mockStoreUserAssignment       = jest.fn()
const mockStoreDiagnostics          = jest.fn()
const mockWithTransaction           = jest.fn()
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: jest.fn() }
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, debug: jest.fn(), warn: jest.fn() }
}))
jest.unstable_mockModule('../../services/scoring/scoreQueryService.js', () => ({
    getAllUserMetrics: mockGetAllUserMetrics
}))
jest.unstable_mockModule('../../services/scoring/pgmoeAlgorithm.js', () => ({
    centerNormalize:           mockCenterNormalize,
    fitPGMoE:                  jest.fn(),
    selectOptimalModel:        mockSelectOptimalModel,
    generateClusterLabels:     mockGenerateClusterLabels,
    computeSilhouetteScore:    mockComputeSilhouetteScore,
    computeDaviesBouldinIndex: mockComputeDaviesBouldinIndex
}))
jest.unstable_mockModule('../../services/scoring/clusterStorageService.js', () => ({
    storeClusterResults:  mockStoreClusterResults,
    storeUserAssignment:  mockStoreUserAssignment,
    storeDiagnostics:     mockStoreDiagnostics
}))
jest.unstable_mockModule('../../utils/withTransaction.js', () => ({
    withTransaction: mockWithTransaction
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { computeClusterScores } = await import('../../services/scoring/clusterPeerService.js')

// ── Helper: build N-user metrics map ───────────────────────────────────────────
// Always includes TARGET_USER so the function doesn't bail out early.
const TARGET_USER = 'target-user'

function makeMetrics(n) {
    const metrics = {}
    for (let i = 0; i < n - 1; i++) {
        metrics[`user-${i}`] = {
            total_active_minutes: 60 + i * 2,
            days_active: 5,
            participation_score: 50 + i,
            avg_session_duration: 30
        }
    }
    metrics[TARGET_USER] = {
        total_active_minutes: 120,
        days_active: 7,
        participation_score: 75,
        avg_session_duration: 45
    }
    return metrics
}

// ── Helper: build mock model ────────────────────────────────────────────────────
function makeModel(n, k = 2) {
    return {
        assignments: Array.from({ length: n }, (_, i) => i % k),
        means: Array.from({ length: k }, (_, i) => [0.5 + i * 0.2, 0.5, 0.4, 0.3])
    }
}

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks()
    // Default: withTransaction calls the callback with a mock client
    mockWithTransaction.mockImplementation(async (_pool, fn) => {
        await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
    })
    // Default: storage calls resolve
    mockStoreClusterResults.mockResolvedValue(undefined)
    mockStoreUserAssignment.mockResolvedValue(undefined)
    mockStoreDiagnostics.mockResolvedValue(undefined)
    // Default: diagnostic functions return sensible values
    mockComputeSilhouetteScore.mockReturnValue(0.55)
    mockComputeDaviesBouldinIndex.mockReturnValue(0.72)
    mockGenerateClusterLabels.mockReturnValue(['Low Engagement', 'High Engagement'])
})

// ══════════════════════════════════════════════════════════════════════════════
// Cold start / early-exit paths
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — cold start', () => {
    test('returns { coldStart: true } when cohort has fewer than 10 users', async () => {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(5))

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(result).toEqual({ coldStart: true })
        expect(mockSelectOptimalModel).not.toHaveBeenCalled()
    })

    test('returns null when target user has no metrics data', async () => {
        // 15 users, but none of them is TARGET_USER
        const metrics = makeMetrics(15)
        delete metrics[TARGET_USER]
        mockGetAllUserMetrics.mockResolvedValue(metrics)

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(result).toBeNull()
        expect(mockSelectOptimalModel).not.toHaveBeenCalled()
    })

    test('returns null for an unknown conceptId', async () => {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(15))

        const result = await computeClusterScores(null, 'unknown_concept', TARGET_USER)

        expect(result).toBeNull()
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Normal path
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — normal path (lms, 15 users)', () => {
    const N = 15

    function setupNormalMocks() {
        const metrics = makeMetrics(N)
        mockGetAllUserMetrics.mockResolvedValue(metrics)
        const centered = Array.from({ length: N }, () => [0.1, 0.2, -0.1, 0.3])
        mockCenterNormalize.mockReturnValue({ centered })
        mockSelectOptimalModel.mockReturnValue({
            k: 2,
            covType: 'spherical',
            model: makeModel(N, 2),
            diagnostics: { selected: { k: 2, covType: 'spherical' }, candidates: [] }
        })
    }

    test('calls PGMoE algorithm and returns a valid cluster result', async () => {
        setupNormalMocks()

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(mockSelectOptimalModel).toHaveBeenCalledTimes(1)
        expect(mockWithTransaction).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            clusterLabel:    expect.any(String),
            clusterIndex:    expect.any(Number),
            percentileScore: expect.any(Number),
            compositeScore:  expect.any(Number),
            dialMin:         expect.any(Number),
            dialCenter:      expect.any(Number),
            dialMax:         expect.any(Number),
            userCount:       expect.any(Number),
            domains:         expect.any(Array)
        })
    })

    test('domains array contains the 4 lms dimension keys', async () => {
        setupNormalMocks()

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        const domainNames = result.domains.map(d => d.domain)
        expect(domainNames).toEqual(
            expect.arrayContaining(['volume', 'consistency', 'participation_variety', 'session_quality'])
        )
    })

    test('storeDiagnostics failure does not propagate to caller (fire-and-forget)', async () => {
        setupNormalMocks()
        // storeDiagnostics rejects — should be silently caught by .catch()
        mockStoreDiagnostics.mockRejectedValue(new Error('Diagnostics table unavailable'))

        // Must resolve, not reject
        await expect(computeClusterScores(null, 'lms', TARGET_USER))
            .resolves.toMatchObject({ clusterLabel: expect.any(String) })
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Diagnostic sampling cap — Sprint 2 P-C1 fix validation
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — diagnostic sampling cap (P-C1)', () => {
    function setupSamplingMocks(n) {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(n))
        const centered = Array.from({ length: n }, () => [0.1, 0.2, -0.1, 0.3])
        mockCenterNormalize.mockReturnValue({ centered })
        mockSelectOptimalModel.mockReturnValue({
            k: 2,
            covType: 'spherical',
            model: makeModel(n, 2),
            diagnostics: { selected: { k: 2, covType: 'spherical' }, candidates: [] }
        })
    }

    test('passes all N points to silhouette when N <= 100', async () => {
        const N = 50
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        const [calledCentered] = mockComputeSilhouetteScore.mock.calls[0]
        expect(calledCentered).toHaveLength(N)
    })

    test('passes exactly 100 samples to silhouette when N > 100', async () => {
        const N = 150
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        const [calledCentered] = mockComputeSilhouetteScore.mock.calls[0]
        expect(calledCentered).toHaveLength(100)
    })

    test('nUsers in storeDiagnostics reflects the real cohort size (not the sample)', async () => {
        const N = 150
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        // storeDiagnostics is called with the fire-and-forget .catch() pattern.
        // We need to wait a tick for the promise chain to run before checking.
        await new Promise(resolve => setImmediate(resolve))

        expect(mockStoreDiagnostics).toHaveBeenCalledWith(
            'lms',
            expect.objectContaining({ nUsers: N })  // real count, not 100
        )
    })
})
```

**Step 2: Run the test file**

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/scoring/clusterPeerService.test.js --no-coverage
```

Expected: 9 tests, all pass.

**Step 3: Run the full test suite (regression check)**

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all existing 110 tests still pass, plus the 9 new ones (≥ 119 total).

**Step 4: Commit**

```bash
git add backend/tests/scoring/clusterPeerService.test.js
git commit -m "test: add unit tests for clusterPeerService (HIGH-T1)

Tests cold start, normal PGMoE path, fire-and-forget storeDiagnostics,
and the Sprint 2 P-C1 diagnostic sampling cap (N<=100 passes all;
N>100 passes exactly 100 samples; nUsers always reflects real count)."
```

---

## Final Verification

After all 4 tasks are committed:

```bash
cd /Users/heshama/Desktop/Code/surveyjs-react-client-main/backend
NODE_OPTIONS='--experimental-vm-modules' npx jest --coverage
```

Check that `services/scoring/` coverage has increased significantly from 0%. The 70% line threshold in `jest.config.js` should now be met for the scoring services.

Verify the git log:
```bash
git log --oneline -5
```

Expected: 4 new commits above the Sprint 2 work.
