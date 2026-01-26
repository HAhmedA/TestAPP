// Screen Time Data Simulator
// Generates realistic simulated screen time data based on student achievement profile
// Uses the unified simulated_profile (high_achiever/average/low_achiever) system
//
// Enhanced Features:
// - Anomaly days (occasional high screen time for high achievers, low for low achievers)
// - Weekend effects (more screen time on weekends)
// - Correlated metrics (high screen time correlates with late-night usage)
// - Day-to-day variance with noise
// - Session fragmentation patterns

import logger from '../../utils/logger.js';
import { computeJudgments, recomputeBaseline } from '../annotators/screenTimeAnnotationService.js';

// =============================================================================
// PROFILE-BASED SCREEN TIME PATTERNS
// =============================================================================

/**
 * Screen time patterns mapped to achievement profiles
 * Each pattern defines base metrics, variance ranges, and behavior modifiers
 */
const SCREEN_TIME_PATTERNS = {
    // High achiever: Low/moderate screen time, balanced usage
    high_achiever: {
        name: 'controlled',
        total_minutes: { base: 180, variance: 40 },         // ~3h ± 40min
        late_night_minutes: { base: 10, variance: 8 },      // Minimal late-night
        longest_session: { base: 35, variance: 10 },        // Short, focused sessions
        session_count: { base: 8, variance: 3 },            // Moderate sessions
        // Behavior modifiers
        anomaly_chance: 0.10,                               // 10% chance of high screen time day
        weekend_screen_increase: 60,                        // +1h on weekends
        recovery_factor: 0.8                                // Quick to return to normal
    },

    // Average achiever: Moderate screen time, some fragmentation
    average: {
        name: 'moderate',
        total_minutes: { base: 300, variance: 60 },         // ~5h ± 1h
        late_night_minutes: { base: 30, variance: 15 },     // Some late-night
        longest_session: { base: 55, variance: 20 },        // Moderate sessions
        session_count: { base: 12, variance: 4 },           // Variable sessions
        // Behavior modifiers
        anomaly_chance: 0.15,                               // 15% chance of anomaly
        weekend_screen_increase: 90,                        // +1.5h on weekends
        recovery_factor: 0.5                                // Slower to normalize
    },

    // Low achiever: High/excessive screen time, fragmented
    low_achiever: {
        name: 'excessive',
        total_minutes: { base: 450, variance: 80 },         // ~7.5h ± 80min
        late_night_minutes: { base: 60, variance: 25 },     // High late-night
        longest_session: { base: 100, variance: 30 },       // Long binge sessions
        session_count: { base: 18, variance: 5 },           // Many fragmented sessions
        // Behavior modifiers
        anomaly_chance: 0.08,                               // 8% chance of low screen time day
        weekend_screen_increase: 120,                       // +2h on weekends
        recovery_factor: 0.3                                // Patterns persist
    }
};

// Default pattern if profile not found
const DEFAULT_PROFILE = 'average';

// =============================================================================
// DATA GENERATION UTILITIES
// =============================================================================

/**
 * Add variance to a base value with noise
 */
function addVariance(base, variance) {
    // Use normal-ish distribution
    const offset = (Math.random() - 0.5) * 2 * variance;
    return Math.round(base + offset);
}

/**
 * Ensure value is within reasonable bounds
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Check if a date is a weekend
 */
function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Generate a single screen time session with enhanced realism
 * @param {Object} pattern - Screen time pattern configuration
 * @param {Date} sessionDate - Date for this session
 * @param {Object} options - Additional options for realism
 * @param {boolean} options.isWeekendDay - Whether this is a weekend day
 * @param {boolean} options.isAnomalyDay - Whether this is an anomaly day
 * @param {number} options.carryOverFactor - Impact from previous day (-1 to 1)
 * @param {string} options.profileType - Profile type for anomaly direction
 * @returns {Object} - Screen time session data
 */
function generateSession(pattern, sessionDate, options = {}) {
    const {
        isWeekendDay = false,
        isAnomalyDay = false,
        carryOverFactor = 0,
        profileType = 'average'
    } = options;

    // === APPLY MODIFIERS TO BASE VALUES ===

    // Weekend effects on screen time
    let totalBase = pattern.total_minutes.base;
    if (isWeekendDay) {
        totalBase += pattern.weekend_screen_increase || 0;
    }

    // Anomaly effects (direction depends on profile)
    let anomalyMultiplier = 1.0;
    if (isAnomalyDay) {
        if (profileType === 'high_achiever') {
            // High achievers have HIGH screen time as anomalies (rare binge day)
            anomalyMultiplier = 1.6; // 60% more screen time
        } else if (profileType === 'low_achiever') {
            // Low achievers have LOW screen time as anomalies (rare productive day)
            anomalyMultiplier = 0.6; // 40% less screen time
        } else {
            // Average: random direction
            anomalyMultiplier = Math.random() > 0.5 ? 1.4 : 0.7;
        }
    }

    // Carry-over from previous day (high screen time can lead to more)
    const carryOverAdjustment = carryOverFactor * 30; // up to ±30 minutes

    // === GENERATE CORE METRICS ===

    let baseTotal = totalBase;
    // Apply anomaly to total screen time
    if (anomalyMultiplier < 1) {
        baseTotal = baseTotal * anomalyMultiplier; // Less screen time
    } else if (anomalyMultiplier > 1) {
        baseTotal = Math.min(baseTotal * anomalyMultiplier, 720); // More but capped at 12h
    }

    const totalMinutes = Math.round(clamp(
        addVariance(baseTotal, pattern.total_minutes.variance) + carryOverAdjustment,
        0, 720
    ));

    // Generate session patterns (correlated with total screen time)
    const screenTimeRatio = totalMinutes / pattern.total_minutes.base;

    // More screen time = longer sessions and more late-night usage
    let lateNightBase = pattern.late_night_minutes.base * screenTimeRatio;
    let longestSessionBase = pattern.longest_session.base * Math.sqrt(screenTimeRatio);

    const lateNightMinutes = Math.round(clamp(
        addVariance(lateNightBase, pattern.late_night_minutes.variance),
        0, totalMinutes * 0.5 // Cap at 50% of total
    ));

    const longestSession = Math.round(clamp(
        addVariance(longestSessionBase, pattern.longest_session.variance),
        5, totalMinutes // At least 5 min, at most total time
    ));

    // Session count inversely related to longest session (fragmentation)
    let sessionCountBase = pattern.session_count.base;
    if (longestSession > 90) {
        sessionCountBase = sessionCountBase * 0.7; // Fewer sessions if long binges
    }

    const sessionCount = Math.round(clamp(
        addVariance(sessionCountBase, pattern.session_count.variance),
        1, 40
    ));

    // Baseline is same as total for now (will be computed from averages)
    const baselineMinutes = totalMinutes;

    return {
        session_date: sessionDate,
        total_screen_minutes: totalMinutes,
        baseline_screen_minutes: baselineMinutes,
        longest_continuous_session: longestSession,
        late_night_screen_minutes: lateNightMinutes,
        number_of_screen_sessions: sessionCount,
        is_simulated: true,
        // Return quality indicator for carry-over calculation
        _usageRatio: totalMinutes / pattern.total_minutes.base
    };
}

// =============================================================================
// MAIN SIMULATION FUNCTIONS
// =============================================================================

/**
 * Generate simulated screen time data for a user
 * Reads simulated_profile from student_profiles to determine pattern
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} days - Number of days of history to generate (default 7)
 * @param {string} profileOverride - Optional profile name to use
 * @returns {Array} - Array of generated session IDs
 */
async function generateScreenTimeData(pool, userId, days = 7, profileOverride = null) {
    logger.info(`Generating ${days} days of screen time data for user ${userId}`);

    // Determine profile: Override > DB > Default
    let profile = profileOverride;
    if (!profile) {
        profile = await getProfile(pool, userId);
    }
    if (!profile) {
        profile = DEFAULT_PROFILE;
        logger.warn(`No profile found for user ${userId}, using default: ${DEFAULT_PROFILE}`);
    }

    const pattern = SCREEN_TIME_PATTERNS[profile] || SCREEN_TIME_PATTERNS[DEFAULT_PROFILE];

    logger.info(`Using screen time pattern: ${pattern.name} (profile: ${profile})`);

    const sessionIds = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Track previous day's usage for carry-over effect
    let previousUsageRatio = 1.0;
    let anomalyDayCount = 0;

    // Generate sessions for each day (oldest first)
    for (let dayOffset = days - 1; dayOffset >= 0; dayOffset--) {
        const sessionDate = new Date(today);
        sessionDate.setDate(sessionDate.getDate() - dayOffset);

        // Determine if this is a weekend day
        const isWeekendDay = isWeekend(sessionDate);

        // Determine if this is an anomaly day
        const isAnomalyDay = Math.random() < (pattern.anomaly_chance || 0.1);
        if (isAnomalyDay) {
            anomalyDayCount++;
            logger.debug(`Day ${dayOffset}: Anomaly day for profile ${profile}`);
        }

        // Calculate carry-over from previous day
        const carryOverFactor = (previousUsageRatio - 1) * (pattern.recovery_factor || 0.5);

        const session = generateSession(pattern, sessionDate, {
            isWeekendDay,
            isAnomalyDay,
            carryOverFactor,
            profileType: profile
        });

        // Store usage ratio for next iteration's carry-over
        previousUsageRatio = session._usageRatio;

        // Insert session (without the internal _usageRatio field)
        const result = await pool.query(
            `INSERT INTO public.screen_time_sessions 
             (user_id, session_date, total_screen_minutes, baseline_screen_minutes,
              longest_continuous_session, late_night_screen_minutes, number_of_screen_sessions, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               total_screen_minutes = EXCLUDED.total_screen_minutes,
               baseline_screen_minutes = EXCLUDED.baseline_screen_minutes,
               longest_continuous_session = EXCLUDED.longest_continuous_session,
               late_night_screen_minutes = EXCLUDED.late_night_screen_minutes,
               number_of_screen_sessions = EXCLUDED.number_of_screen_sessions,
               is_simulated = EXCLUDED.is_simulated
             RETURNING id`,
            [userId, session.session_date, session.total_screen_minutes, session.baseline_screen_minutes,
                session.longest_continuous_session, session.late_night_screen_minutes,
                session.number_of_screen_sessions, session.is_simulated]
        );

        sessionIds.push(result.rows[0].id);
    }

    // Recompute baseline from generated data
    await recomputeBaseline(pool, userId, days);

    // Compute judgments for each session
    for (const sessionId of sessionIds) {
        await computeJudgments(pool, sessionId);
    }

    logger.info(`Generated ${sessionIds.length} screen time sessions for user ${userId} (${anomalyDayCount} anomaly days)`);
    return sessionIds;
}

/**
 * Get the simulated profile for a user (read-only)
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {string|null} - Profile name or null
 */
async function getProfile(pool, userId) {
    const { rows } = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles WHERE user_id = $1`,
        [userId]
    );
    return rows.length > 0 ? rows[0].simulated_profile : null;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Main function
    generateScreenTimeData,

    // Profile management
    getProfile,

    // Pattern configurations (for testing/extension)
    SCREEN_TIME_PATTERNS,
    DEFAULT_PROFILE,

    // Lower-level generators (for testing)
    generateSession,
    addVariance
};
