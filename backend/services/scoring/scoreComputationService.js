// Score Computation Service
// Orchestrates score computation for all concepts
// Uses raw numeric scores from each annotation service for granular scoring

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { computeAndStoreRawScore, getAllScoresForChatbot } from './conceptScoreService.js';
import { CONCEPT_IDS } from '../../config/concepts.js';
import { batchComputeClusterScores } from './clusterPeerService.js';

// Import raw score adapters from each annotation service
import { getRawScoresForScoring as getSleepRawScores } from '../annotators/sleepAnnotationService.js';
import { getRawScoresForScoring as getScreenTimeRawScores } from '../annotators/screenTimeAnnotationService.js';
import { getRawScoresForScoring as getLMSRawScores } from '../annotators/lmsAnnotationService.js';
import { getRawScoresForScoring as getSRLRawScores } from '../annotators/srlAnnotationService.js';

// =============================================================================
// SCORE COMPUTATION
// =============================================================================

/**
 * Compute and store score for a single concept
 * Uses raw 0-100 scores from each annotation service
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @returns {Promise<{score: number, trend: string}|null>}
 */
async function computeConceptScore(userId, conceptId, lmsDays = 7) {
    let rawScores = [];

    try {
        switch (conceptId) {
            case 'sleep':
                rawScores = await getSleepRawScores(pool, userId);
                break;
            case 'screen_time':
                rawScores = await getScreenTimeRawScores(pool, userId);
                break;
            case 'lms':
                rawScores = await getLMSRawScores(pool, userId, lmsDays);
                break;
            case 'srl':
                rawScores = await getSRLRawScores(pool, userId);
                break;
            default:
                logger.warn(`Unknown concept: ${conceptId}`);
                return null;
        }

        if (rawScores.length === 0) {
            logger.debug(`No raw score data for ${conceptId} (user: ${userId})`);
            return null;
        }

        // Cold start: not enough users in the pool yet for meaningful clustering.
        if (rawScores.length === 1 && rawScores[0].coldStart) {
            logger.info(`Cold start for ${conceptId} (user: ${userId}) — skipping score storage`);
            return { coldStart: true };
        }

        const result = await computeAndStoreRawScore(userId, conceptId, rawScores);
        return result;

    } catch (err) {
        logger.error(`Error computing ${conceptId} score: ${err.message}`);
        return null;
    }
}

/**
 * Compute and store scores for all concepts
 * Called after data simulation or when scores need refresh
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Object with all computed scores
 */
async function computeAllScores(userId, lmsDays = 7) {
    logger.info(`Computing all concept scores for user ${userId}`);

    const concepts = CONCEPT_IDS;
    const results = {};

    for (const conceptId of concepts) {
        const result = await computeConceptScore(userId, conceptId, lmsDays);
        if (result) {
            results[conceptId] = result;
        }
    }

    logger.info(`Completed score computation for user ${userId}`, {
        scoresComputed: Object.keys(results).length
    });

    return results;
}

/**
 * Batch-score all users for the LMS concept in a single PGMoE run.
 * Call after a bulk CSV import so every imported student is scored against
 * the same complete, stable pool.
 * Uses null (all-time window) so no student is excluded by a date cutoff.
 *
 * @returns {Promise<{coldStart?: boolean, usersScored: number}>}
 */
async function batchScoreLMSCohort() {
    logger.info('batchScoreLMSCohort: scoring all users (all-time window)');
    const result = await batchComputeClusterScores('lms', null);

    // Write concept_scores for each user using the domain results already computed
    // during the batch run — no need to re-run PGMoE per user.
    if (!result.coldStart && result.userResults?.length > 0) {
        for (const { userId, domains } of result.userResults) {
            await computeAndStoreRawScore(userId, 'lms', domains).catch(err =>
                logger.error(`batchScoreLMSCohort: concept_scores write failed for ${userId}: ${err.message}`)
            );
        }
        logger.info(`batchScoreLMSCohort: concept_scores written for ${result.userResults.length} users`);
    }

    logger.info(`batchScoreLMSCohort complete: ${result?.usersScored ?? 0} users scored`);
    return result;
}

/**
 * Get formatted scores for chatbot prompt
 * This replaces the individual getJudgmentsForChatbot calls
 *
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted markdown
 */
async function getScoresForChatbot(userId) {
    return getAllScoresForChatbot(userId);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computeConceptScore,
    computeAllScores,
    batchScoreLMSCohort,
    getScoresForChatbot
};
