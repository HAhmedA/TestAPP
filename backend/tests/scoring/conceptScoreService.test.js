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
