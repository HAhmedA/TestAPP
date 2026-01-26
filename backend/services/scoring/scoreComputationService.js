// Score Computation Service
// Orchestrates score computation for all concepts
// Uses raw numeric scores from each annotation service for granular scoring

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { computeAndStoreRawScore, getAllScoresForChatbot } from './conceptScoreService.js';

// Import raw score adapters from each annotation service
import { getRawScoresForScoring as getSleepRawScores } from '../annotators/sleepAnnotationService.js';
import { getRawScoresForScoring as getScreenTimeRawScores } from '../annotators/screenTimeAnnotationService.js';
import { getRawScoresForScoring as getSocialMediaRawScores } from '../annotators/socialMediaAnnotationService.js';
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
async function computeConceptScore(userId, conceptId) {
    let rawScores = [];

    try {
        switch (conceptId) {
            case 'sleep':
                rawScores = await getSleepRawScores(pool, userId);
                break;
            case 'screen_time':
                rawScores = await getScreenTimeRawScores(pool, userId);
                break;
            case 'social_media':
                rawScores = await getSocialMediaRawScores(pool, userId);
                break;
            case 'lms':
                rawScores = await getLMSRawScores(pool, userId);
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
async function computeAllScores(userId) {
    logger.info(`Computing all concept scores for user ${userId}`);

    const concepts = ['sleep', 'screen_time', 'social_media', 'lms', 'srl'];
    const results = {};

    for (const conceptId of concepts) {
        const result = await computeConceptScore(userId, conceptId);
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
    getScoresForChatbot
};
