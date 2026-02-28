// Score Query Service
// Single location for shared data-gathering queries used by multiple scoring services.
// Eliminates duplicate pool-size queries, user-data checks, and metric fetching.

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';

// Filter out simulated users from pool queries when SIMULATION_MODE='false'
const EXCLUDE_SIMULATED_USERS = process.env.SIMULATION_MODE === 'false'
    ? `AND user_id NOT IN (SELECT user_id FROM public.student_profiles WHERE simulated_profile IS NOT NULL)`
    : '';

// =============================================================================
// POOL SIZE QUERIES
// =============================================================================

/**
 * Get the number of distinct real users who have submitted data for each concept
 * in the last `days` days.
 *
 * @param {number} days - Look-back window (default 7)
 * @returns {Promise<Record<string, number>>} - { sleep: 12, srl: 8, lms: 15, screen_time: 11 }
 */
export async function getConceptPoolSizes(days = 7) {
    const { rows } = await pool.query(`
        SELECT 'sleep' as concept, COUNT(DISTINCT user_id) as user_count
        FROM public.sleep_sessions
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day') ${EXCLUDE_SIMULATED_USERS}
        UNION ALL
        SELECT 'screen_time', COUNT(DISTINCT user_id)
        FROM public.screen_time_sessions
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day') ${EXCLUDE_SIMULATED_USERS}
        UNION ALL
        SELECT 'lms', COUNT(DISTINCT user_id)
        FROM public.lms_sessions
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day') ${EXCLUDE_SIMULATED_USERS}
        UNION ALL
        SELECT 'srl', COUNT(DISTINCT user_id)
        FROM public.srl_annotations
        WHERE time_window = '7d' AND response_count > 0 ${EXCLUDE_SIMULATED_USERS}
    `, [days])
    const sizes = {}
    for (const r of rows) {
        sizes[r.concept] = parseInt(r.user_count)
    }
    return sizes
}

// =============================================================================
// USER DATA PRESENCE QUERIES
// =============================================================================

/**
 * Check which concepts a user has personally submitted data for.
 *
 * @param {string} userId
 * @returns {Promise<Set<string>>} - Set of concept IDs the user has data for
 */
export async function getUserConceptDataSet(userId) {
    const { rows } = await pool.query(`
        (SELECT 'sleep' as concept FROM public.sleep_sessions WHERE user_id = $1 LIMIT 1)
        UNION
        (SELECT 'screen_time' FROM public.screen_time_sessions WHERE user_id = $1 LIMIT 1)
        UNION
        (SELECT 'lms' FROM public.lms_sessions WHERE user_id = $1 LIMIT 1)
        UNION
        (SELECT 'srl' FROM public.srl_annotations WHERE user_id = $1 AND response_count > 0 LIMIT 1)
    `, [userId])
    return new Set(rows.map(r => r.concept))
}

// =============================================================================
// ALL-USER METRIC QUERIES (shared by peerStatsService and clusterPeerService)
// =============================================================================

/**
 * Get aggregated metrics for ALL users for a given concept.
 * Returns { [userId]: { dim1: val, dim2: val, ... } }
 *
 * @param {string} conceptId - 'lms' | 'sleep' | 'screen_time' | 'srl'
 * @param {number} days - Look-back window (default 7)
 * @returns {Promise<Object>}
 */
export async function getAllUserMetrics(conceptId, days = 7) {
    switch (conceptId) {
        case 'lms':         return getLMSMetrics(days)
        case 'sleep':       return getSleepMetrics(days)
        case 'screen_time': return getScreenTimeMetrics(days)
        case 'srl':         return getSRLMetrics()
        default:
            logger.warn(`scoreQueryService: unknown concept ${conceptId}`)
            return {}
    }
}

// ---- LMS ----
// participation_score replaces active_percent (action_mix dimension).
// active_percent was always 100% with module REST APIs (reading/watching unavailable),
// giving zero variance and making it useless for PGMoE clustering.
// participation_score rewards breadth of LMS tool usage:
//   quiz capped at 3 attempts → 34 pts  |  assignments capped at 2 → 33 pts  |  forum capped at 2 → 33 pts
async function getLMSMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               SUM(total_active_minutes) as total_active_minutes,
               SUM(number_of_sessions) as number_of_sessions,
               COUNT(DISTINCT session_date) as days_active,
               CASE WHEN SUM(number_of_sessions) > 0
                    THEN SUM(total_active_minutes)::float / SUM(number_of_sessions)
                    ELSE 0 END as avg_session_duration,
               LEAST(SUM(exercise_practice_events), 3) / 3.0 * 34.0
               + LEAST(SUM(assignment_work_events), 2) / 2.0 * 33.0
               + LEAST(SUM(forum_posts), 2) / 2.0 * 33.0
               AS participation_score
        FROM public.lms_sessions
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `, [days])
    const metrics = {}
    for (const r of rows) {
        metrics[r.user_id] = {
            total_active_minutes: parseFloat(r.total_active_minutes)  || 0,
            number_of_sessions:   parseFloat(r.number_of_sessions)    || 0,
            days_active:          parseFloat(r.days_active)            || 0,
            participation_score:  parseFloat(r.participation_score)   || 0,
            avg_session_duration: parseFloat(r.avg_session_duration)  || 0,
        }
    }
    return metrics
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
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `, [days])
    const metrics = {}
    for (const r of rows) {
        metrics[r.user_id] = {
            sleep_minutes:   parseFloat(r.avg_sleep_minutes) || 0,
            awakenings:      parseFloat(r.avg_awakenings)    || 0,
            awake_minutes:   parseFloat(r.avg_awake_minutes) || 0,
            bedtime_stddev:  parseFloat(r.bedtime_stddev)    || 0
        }
    }
    return metrics
}

// ---- Screen Time ----
async function getScreenTimeMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_screen_minutes) as avg_screen_minutes,
               AVG(longest_continuous_session) as avg_longest_session,
               AVG(late_night_screen_minutes) as avg_late_night
        FROM public.screen_time_sessions
        WHERE session_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
        ${EXCLUDE_SIMULATED_USERS}
        GROUP BY user_id
    `, [days])
    const metrics = {}
    for (const r of rows) {
        metrics[r.user_id] = {
            screen_minutes:   parseFloat(r.avg_screen_minutes)  || 0,
            longest_session:  parseFloat(r.avg_longest_session) || 0,
            late_night:       parseFloat(r.avg_late_night)      || 0
        }
    }
    return metrics
}

// ---- SRL ----
async function getSRLMetrics() {
    const { rows } = await pool.query(`
        SELECT user_id, concept_key, avg_score, is_inverted
        FROM public.srl_annotations
        WHERE time_window = '7d' AND response_count > 0
        ${EXCLUDE_SIMULATED_USERS}
        ORDER BY user_id, concept_key
    `)
    const metrics = {}
    for (const r of rows) {
        if (!metrics[r.user_id]) metrics[r.user_id] = {}
        metrics[r.user_id][r.concept_key] = {
            score:      parseFloat(r.avg_score) || 0,
            isInverted: r.is_inverted
        }
    }
    return metrics
}
