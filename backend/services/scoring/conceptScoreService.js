// Concept Score Service
// Main scoring unit that aggregates aspect judgments into single concept scores
// Generic and concept-agnostic - works for any domain with severity-based judgments

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { severityToScore, EqualWeightStrategy } from './scoringStrategies.js';

// Default strategy (can be swapped for custom strategies later)
const DEFAULT_STRATEGY = new EqualWeightStrategy();

// =============================================================================
// CORE SCORING FUNCTIONS
// =============================================================================

/**
 * Compute a single concept score from aspect severities
 * 
 * @param {Array<{domain: string, severity: string}>} aspects - Array of aspects with severity
 * @param {Object} strategy - Scoring strategy (default: EqualWeightStrategy)
 * @returns {Object} - { score: number, breakdown: Object }
 */
function computeScore(aspects, strategy = DEFAULT_STRATEGY) {
    if (!aspects || aspects.length === 0) {
        return { score: 0, breakdown: {} };
    }

    // Get weights from strategy
    const weights = strategy.getWeights(aspects);

    // Compute weighted sum
    let weightedSum = 0;
    const breakdown = {};

    for (let i = 0; i < aspects.length; i++) {
        const aspect = aspects[i];
        const numericScore = severityToScore(aspect.severity);
        const weight = weights[i];

        weightedSum += numericScore * weight;
        breakdown[aspect.domain] = {
            severity: aspect.severity,
            score: numericScore,
            weight: weight,
            contribution: numericScore * weight
        };
    }

    // Scale to 0-100
    const finalScore = Math.round(weightedSum * 100);

    return { score: finalScore, breakdown };
}

/**
 * Calculate trend by comparing today's score to 7-day average
 * 
 * @param {number} todayScore - Today's score (0-100)
 * @param {number|null} avg7d - 7-day average score (0-100)
 * @returns {string} - 'improving', 'declining', or 'stable'
 */
function calculateTrend(todayScore, avg7d) {
    if (avg7d === null || avg7d === undefined) {
        return 'stable'; // Not enough data
    }

    const difference = todayScore - avg7d;
    const threshold = 10; // 10 point change is significant

    if (difference >= threshold) {
        return 'improving';
    } else if (difference <= -threshold) {
        return 'declining';
    }
    return 'stable';
}

/**
 * Get 7-day average score for a concept
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @returns {Promise<number|null>} - Average score or null if no history
 */
async function get7DayAverage(userId, conceptId) {
    const { rows } = await pool.query(
        `SELECT AVG(score) as avg_score
         FROM public.concept_score_history
         WHERE user_id = $1 
           AND concept_id = $2 
           AND score_date >= CURRENT_DATE - INTERVAL '7 days'
           AND score_date < CURRENT_DATE`,
        [userId, conceptId]
    );

    return rows[0]?.avg_score ? parseFloat(rows[0].avg_score) : null;
}

/**
 * Store concept score in database
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {number} score - Score (0-100)
 * @param {string} trend - Trend ('improving', 'declining', 'stable')
 * @param {Object} breakdown - Aspect breakdown for debugging
 * @param {number|null} avg7d - 7-day average
 */
async function storeScore(userId, conceptId, score, trend, breakdown, avg7d) {
    // Upsert current score
    await pool.query(
        `INSERT INTO public.concept_scores 
         (user_id, concept_id, score, trend, aspect_breakdown, avg_7d, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, concept_id) DO UPDATE SET
           score = EXCLUDED.score,
           trend = EXCLUDED.trend,
           aspect_breakdown = EXCLUDED.aspect_breakdown,
           avg_7d = EXCLUDED.avg_7d,
           computed_at = NOW()`,
        [userId, conceptId, score, trend, JSON.stringify(breakdown), avg7d]
    );

    // Also store in history (for future trend calculations)
    await pool.query(
        `INSERT INTO public.concept_score_history 
         (user_id, concept_id, score, score_date, computed_at)
         VALUES ($1, $2, $3, CURRENT_DATE, NOW())
         ON CONFLICT (user_id, concept_id, score_date) DO UPDATE SET
           score = EXCLUDED.score,
           computed_at = NOW()`,
        [userId, conceptId, score]
    );

    logger.info(`Stored ${conceptId} score: ${score}/100 (${trend}) for user ${userId}`);
}

/**
 * Compute and store a concept score (legacy - uses severity mapping)
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {Array<{domain: string, severity: string}>} aspects - Aspect severities
 * @param {Object} strategy - Scoring strategy (optional)
 * @returns {Promise<{score: number, trend: string, breakdown: Object}>}
 */
async function computeAndStoreScore(userId, conceptId, aspects, strategy = DEFAULT_STRATEGY) {
    // Compute score
    const { score, breakdown } = computeScore(aspects, strategy);

    // Get 7-day average for trend
    const avg7d = await get7DayAverage(userId, conceptId);

    // Calculate trend
    const trend = calculateTrend(score, avg7d);

    // Store in database
    await storeScore(userId, conceptId, score, trend, breakdown, avg7d);

    return { score, trend, breakdown, avg7d };
}

/**
 * Compute and store a concept score from raw 0-100 scores (NEW - preserves granularity)
 * Simply averages the aspect scores to get the final score
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {Array<{domain: string, score: number}>} rawScores - Array of domain/score pairs (0-100)
 * @returns {Promise<{score: number, trend: string, breakdown: Object}>}
 */
async function computeAndStoreRawScore(userId, conceptId, rawScores) {
    if (!rawScores || rawScores.length === 0) {
        return { score: 0, trend: 'stable', breakdown: {} };
    }

    // Compute average of all raw scores
    const total = rawScores.reduce((sum, r) => sum + r.score, 0);
    const score = Math.round((total / rawScores.length) * 100) / 100;

    // Build breakdown for debugging
    const breakdown = {};
    for (const r of rawScores) {
        breakdown[r.domain] = {
            score: r.score,
            weight: 1 / rawScores.length,
            contribution: r.score / rawScores.length,
            label: r.label
        };
    }

    // Get 7-day average for trend
    const avg7d = await get7DayAverage(userId, conceptId);

    // Calculate trend
    const trend = calculateTrend(score, avg7d);

    // Store in database
    await storeScore(userId, conceptId, score, trend, breakdown, avg7d);

    return { score, trend, breakdown, avg7d };
}

// =============================================================================
// CHATBOT OUTPUT FUNCTIONS
// =============================================================================

/**
 * Format a single concept score for chatbot consumption
 * 
 * @param {string} conceptId - Concept ID
 * @param {number} score - Score (0-100)
 * @param {string} trend - Trend
 * @returns {string} - Formatted string
 */
function formatScoreForChatbot(conceptId, score, trend) {
    const conceptNames = {
        sleep: 'Sleep quality',
        srl: 'Self-Regulated Learning',
        lms: 'LMS Engagement',
        screen_time: 'Screen Time habits',
        social_media: 'Social Media habits'
    };

    const trendDescriptions = {
        improving: 'improving from last week',
        declining: 'declining from last week',
        stable: 'stable'
    };

    const name = conceptNames[conceptId] || conceptId;
    const trendDesc = trendDescriptions[trend] || trend;

    return `${name}: ${score}/100 (${trendDesc})`;
}

/**
 * Get all concept scores for a user, formatted for chatbot
 * 
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted markdown string
 */
async function getAllScoresForChatbot(userId) {
    const { rows } = await pool.query(
        `SELECT concept_id, score, trend 
         FROM public.concept_scores 
         WHERE user_id = $1
         ORDER BY concept_id`,
        [userId]
    );

    if (rows.length === 0) {
        return 'No data summaries available yet.';
    }

    let result = '## Student Data Summary\n\n';

    for (const row of rows) {
        result += `- ${formatScoreForChatbot(row.concept_id, row.score, row.trend)}\n`;
    }

    return result;
}

/**
 * Get a single concept score for chatbot
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @returns {Promise<string>} - Formatted string
 */
async function getScoreForChatbot(userId, conceptId) {
    const { rows } = await pool.query(
        `SELECT score, trend FROM public.concept_scores 
         WHERE user_id = $1 AND concept_id = $2`,
        [userId, conceptId]
    );

    if (rows.length === 0) {
        return `No ${conceptId} data available.`;
    }

    return formatScoreForChatbot(conceptId, rows[0].score, rows[0].trend);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Core scoring
    computeScore,
    computeAndStoreScore,
    computeAndStoreRawScore,
    calculateTrend,
    get7DayAverage,

    // Chatbot output
    getAllScoresForChatbot,
    getScoreForChatbot,
    formatScoreForChatbot,

    // Storage
    storeScore
};

