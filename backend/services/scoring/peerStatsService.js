// Peer Stats Service
// Z-score based peer comparison (fallback/supplementary to PGMoE clustering)
// Computes population mean/stddev per metric dimension, then categorizes each user
//
// Categories (all green shades — positive framing):
//   requires_improvement  (Z < -0.5)
//   good                  (−0.5 ≤ Z ≤ 0.5)
//   very_good             (Z > 0.5)

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';

// When SIMULATION_MODE is explicitly set to 'false', exclude all data from test accounts
// (users with a simulated_profile) so they don't pollute real-user clustering.
const EXCLUDE_SIMULATED_USERS = process.env.SIMULATION_MODE === 'false'
    ? `AND user_id NOT IN (SELECT user_id FROM public.student_profiles WHERE simulated_profile IS NOT NULL)`
    : ''

// =============================================================================
// CATEGORY MAPPING
// =============================================================================

const CATEGORY_MAP = {
    requires_improvement: { label: 'Could Improve', numericScore: 25 },
    good: { label: 'Good', numericScore: 50 },
    very_good: { label: 'Very Good', numericScore: 85 }
};

/**
 * Map a Z-score to one of 3 categories
 * @param {number} z - Z-score (already sign-corrected for inverted metrics)
 * @returns {string} - category key
 */
function zScoreToCategory(z) {
    if (z > 0.5) return 'very_good';
    if (z >= -0.5) return 'good';
    return 'requires_improvement';
}

/**
 * Compute mean and stddev for an array of numbers
 */
function computeStats(values) {
    if (!values || values.length === 0) return { mean: 0, stddev: 0 };
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { mean, stddev: Math.sqrt(variance) };
}

/**
 * Compute Z-score, returning 0 if stddev is 0
 */
function zScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
}

// =============================================================================
// CONCEPT-SPECIFIC METRIC QUERIES
// =============================================================================

/**
 * Get aggregated metrics for ALL users for a given concept
 * Returns { [userId]: { dim1: val, dim2: val, ... } }
 */
async function getAllUserMetrics(conceptId, days = 7) {
    switch (conceptId) {
        case 'lms': return getLMSMetrics(days);
        case 'sleep': return getSleepMetrics(days);
        case 'screen_time': return getScreenTimeMetrics(days);
        case 'srl': return getSRLMetrics();
        default:
            logger.warn(`peerStatsService: unknown concept ${conceptId}`);
            return {};
    }
}

// ---- LMS ----
async function getLMSMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               SUM(total_active_minutes) as total_active_minutes,
               SUM(number_of_sessions) as number_of_sessions,
               COUNT(DISTINCT session_date) as days_active,
               SUM(reading_minutes) + SUM(watching_minutes) as passive_minutes,
               SUM(total_active_minutes) as total_minutes,
               CASE WHEN SUM(number_of_sessions) > 0
                    THEN SUM(total_active_minutes)::float / SUM(number_of_sessions)
                    ELSE 0 END as avg_session_duration
        FROM public.lms_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `);

    const metrics = {};
    for (const r of rows) {
        const totalMin = parseFloat(r.total_minutes) || 0;
        const passiveMin = parseFloat(r.passive_minutes) || 0;
        const activePercent = totalMin > 0 ? ((totalMin - passiveMin) / totalMin) * 100 : 0;

        metrics[r.user_id] = {
            total_active_minutes: parseFloat(r.total_active_minutes) || 0,
            number_of_sessions: parseFloat(r.number_of_sessions) || 0,
            days_active: parseFloat(r.days_active) || 0,
            active_percent: activePercent,
            avg_session_duration: parseFloat(r.avg_session_duration) || 0
        };
    }
    return metrics;
}

// ---- Sleep ----
async function getSleepMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_sleep_minutes) as avg_sleep_minutes,
               AVG(awakenings_count) as avg_awakenings,
               AVG(awake_minutes) as avg_awake_minutes,
               STDDEV_POP(EXTRACT(HOUR FROM bedtime) + EXTRACT(MINUTE FROM bedtime) / 60.0) as bedtime_stddev
        FROM public.sleep_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `);

    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            sleep_minutes: parseFloat(r.avg_sleep_minutes) || 0,
            awakenings: parseFloat(r.avg_awakenings) || 0,
            awake_minutes: parseFloat(r.avg_awake_minutes) || 0,
            bedtime_stddev: parseFloat(r.bedtime_stddev) || 0
        };
    }
    return metrics;
}

// ---- Screen Time ----
async function getScreenTimeMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_screen_minutes) as avg_screen_minutes,
               AVG(longest_continuous_session) as avg_longest_session,
               AVG(late_night_screen_minutes) as avg_late_night
        FROM public.screen_time_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `);

    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            screen_minutes: parseFloat(r.avg_screen_minutes) || 0,
            longest_session: parseFloat(r.avg_longest_session) || 0,
            late_night: parseFloat(r.avg_late_night) || 0
        };
    }
    return metrics;
}

// ---- SRL ----
async function getSRLMetrics() {
    const { rows } = await pool.query(`
        SELECT user_id, concept_key, avg_score, is_inverted
        FROM public.srl_annotations
        WHERE time_window = '7d' AND response_count > 0
        ${EXCLUDE_SIMULATED_USERS}
        ORDER BY user_id, concept_key
    `);

    // Group by user, each concept is a dimension
    const metrics = {};
    for (const r of rows) {
        if (!metrics[r.user_id]) metrics[r.user_id] = {};
        metrics[r.user_id][r.concept_key] = {
            score: parseFloat(r.avg_score) || 0,
            isInverted: r.is_inverted
        };
    }
    return metrics;
}

// =============================================================================
// DIMENSION DEFINITIONS (which metrics map to which domains, and inversion)
// =============================================================================

// For non-SRL concepts: { dimensionKey: { metric, inverted } }
// "inverted" means lower values are better (screen time, awakenings, etc.)
const DIMENSION_DEFS = {
    lms: {
        volume: { metric: 'total_active_minutes', inverted: false },
        consistency: { metric: 'days_active', inverted: false },
        action_mix: { metric: 'active_percent', inverted: false },
        session_quality: { metric: 'avg_session_duration', inverted: false }
    },
    sleep: {
        duration: { metric: 'sleep_minutes', inverted: false },
        continuity: { metric: 'awakenings', inverted: true },  // fewer = better
        timing: { metric: 'bedtime_stddev', inverted: true }   // lower variance = more consistent
    },
    screen_time: {
        volume: { metric: 'screen_minutes', inverted: true },  // less = better
        distribution: { metric: 'longest_session', inverted: true },  // shorter = better
        pre_sleep: { metric: 'late_night', inverted: true }   // less = better
    }
};

// =============================================================================
// MAIN PUBLIC API
// =============================================================================

/**
 * Compute peer-comparison Z-scores and categories for a user in a given concept
 *
 * @param {Object} dbPool - Database pool (unused, we use the imported pool)
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Array<{domain, category, categoryLabel, zScore}>}
 */
async function computePeerZScores(dbPool, conceptId, userId, days = 7) {
    const allMetrics = await getAllUserMetrics(conceptId, days);

    if (!allMetrics[userId]) {
        logger.debug(`peerStatsService: no ${conceptId} data for user ${userId}`);
        return [];
    }

    // SRL is special — variable number of dimensions per user
    if (conceptId === 'srl') {
        return computeSRLZScores(allMetrics, userId);
    }

    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return [];

    const userMetrics = allMetrics[userId];
    const results = [];

    for (const [domain, def] of Object.entries(dims)) {
        // Collect this metric across all users
        const allValues = Object.values(allMetrics).map(m => m[def.metric]).filter(v => v != null);
        const { mean, stddev } = computeStats(allValues);

        let z = zScore(userMetrics[def.metric], mean, stddev);

        // For inverted metrics (less is better), negate so higher Z = better
        if (def.inverted) z = -z;

        const category = zScoreToCategory(z);

        results.push({
            domain,
            category,
            categoryLabel: CATEGORY_MAP[category].label,
            numericScore: CATEGORY_MAP[category].numericScore,
            zScore: Math.round(z * 100) / 100
        });
    }

    return results;
}

/**
 * SRL-specific Z-score computation (14 concept dimensions)
 */
function computeSRLZScores(allMetrics, userId) {
    const userDims = allMetrics[userId];
    if (!userDims) return [];

    const results = [];

    // For each concept the user has
    for (const [conceptKey, userData] of Object.entries(userDims)) {
        // Collect this concept's scores across all users who have it
        const allScores = [];
        for (const [uid, dims] of Object.entries(allMetrics)) {
            if (dims[conceptKey]) {
                allScores.push(dims[conceptKey].score);
            }
        }

        const { mean, stddev } = computeStats(allScores);
        let z = zScore(userData.score, mean, stddev);

        // For inverted SRL concepts (e.g., anxiety), negate so higher Z = better
        if (userData.isInverted) z = -z;

        const category = zScoreToCategory(z);

        results.push({
            domain: conceptKey,
            category,
            categoryLabel: CATEGORY_MAP[category].label,
            numericScore: CATEGORY_MAP[category].numericScore,
            zScore: Math.round(z * 100) / 100
        });
    }

    return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computePeerZScores,
    zScoreToCategory,
    CATEGORY_MAP,
    computeStats,
    zScore
};
