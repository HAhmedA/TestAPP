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
const mockPool = { query: jest.fn() }

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: mockPool
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
    computeAndStoreRawScore: mockComputeAndStoreRawScore,
    getAllScoresForChatbot:   jest.fn()
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
    mockLogInfo.mockReset()
    mockPool.query.mockReset()
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
        expect(mockGetSleepRawScores).toHaveBeenCalledTimes(1)
        expect(mockGetSleepRawScores).toHaveBeenCalledWith(mockPool, 'user-1')
    })

    test('returns null and logs error when annotation service throws', async () => {
        mockGetSleepRawScores.mockRejectedValue(new Error('DB connection lost'))

        const result = await computeConceptScore('user-1', 'sleep')

        expect(result).toBeNull()
        expect(mockLogError).toHaveBeenCalledWith(
            expect.stringContaining('Error computing sleep score: DB connection lost')
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
        expect(mockGetSleepRawScores).toHaveBeenCalledTimes(1)
        expect(mockGetScreenTimeRawScores).toHaveBeenCalledTimes(1)
        expect(mockGetLMSRawScores).toHaveBeenCalledTimes(1)
        expect(mockGetSRLRawScores).toHaveBeenCalledTimes(1)
        expect(mockComputeAndStoreRawScore).toHaveBeenCalledTimes(4)
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
