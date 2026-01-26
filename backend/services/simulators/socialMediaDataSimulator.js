// Social Media Data Simulator
// Generates realistic simulated social media data based on student achievement profile
// Uses the unified simulated_profile (high_achiever/average/low_achiever) system
//
// Enhanced Features:
// - Correlation with screen time (social media is a subset of screen time)
// - Anomaly days (occasional heavy usage for high achievers, light for low achievers)
// - Weekend effects (more social media on weekends)
// - Session fragmentation patterns (checking behavior)
// - Day-to-day variance with noise

import logger from '../../utils/logger.js';
import { computeJudgments, recomputeBaseline } from '../annotators/socialMediaAnnotationService.js';

// =============================================================================
// PROFILE-BASED SOCIAL MEDIA PATTERNS
// =============================================================================

/**
 * Social media patterns mapped to achievement profiles
 * Each pattern defines base metrics, variance ranges, and behavior modifiers
 */
const SOCIAL_MEDIA_PATTERNS = {
    // High achiever: Low social media, infrequent checking, controlled
    high_achiever: {
        name: 'controlled',
        total_minutes: { base: 25, variance: 10 },          // ~25 min ± 10min
        session_count: { base: 4, variance: 2 },            // Infrequent checks
        avg_session_length: { base: 6, variance: 2 },       // Short, controlled
        late_night_minutes: { base: 5, variance: 3 },       // Minimal late-night
        percent_of_screen: { base: 15, variance: 5 },       // Low % of screen time
        // Behavior modifiers
        anomaly_chance: 0.10,                               // 10% chance of heavy usage day
        weekend_increase: 15,                               // +15 min on weekends
        recovery_factor: 0.8                                // Quick to return to normal
    },

    // Average achiever: Moderate social media, moderate checking
    average: {
        name: 'moderate',
        total_minutes: { base: 60, variance: 25 },          // ~1h ± 25min
        session_count: { base: 10, variance: 4 },           // Moderate checks
        avg_session_length: { base: 15, variance: 5 },      // Medium sessions
        late_night_minutes: { base: 15, variance: 8 },      // Some late-night
        percent_of_screen: { base: 25, variance: 8 },
        // Behavior modifiers
        anomaly_chance: 0.15,                               // 15% chance of anomaly
        weekend_increase: 30,                               // +30 min on weekends
        recovery_factor: 0.5                                // Slower to normalize
    },

    // Low achiever: High/excessive social media, frequent checking
    low_achiever: {
        name: 'excessive',
        total_minutes: { base: 150, variance: 45 },         // ~2.5h ± 45min
        session_count: { base: 20, variance: 6 },           // Frequent checking
        avg_session_length: { base: 30, variance: 10 },     // Long scrolling sessions
        late_night_minutes: { base: 40, variance: 15 },     // High late-night
        percent_of_screen: { base: 40, variance: 10 },
        // Behavior modifiers
        anomaly_chance: 0.08,                               // 8% chance of light usage day
        weekend_increase: 50,                               // +50 min on weekends
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
 * Generate a single social media session with enhanced realism
 * @param {Object} pattern - Social media pattern configuration
 * @param {Date} sessionDate - Date for this session
 * @param {Object} options - Additional options for realism
 * @param {boolean} options.isWeekendDay - Whether this is a weekend day
 * @param {boolean} options.isAnomalyDay - Whether this is an anomaly day
 * @param {number} options.carryOverFactor - Impact from previous day (-1 to 1)
 * @param {string} options.profileType - Profile type for anomaly direction
 * @param {number} options.screenTimeMinutes - Total screen time for correlation
 * @returns {Object} - Social media session data
 */
function generateSession(pattern, sessionDate, options = {}) {
    const {
        isWeekendDay = false,
        isAnomalyDay = false,
        carryOverFactor = 0,
        profileType = 'average',
        screenTimeMinutes = 300
    } = options;

    // === APPLY MODIFIERS TO BASE VALUES ===

    // Weekend effects on social media usage
    let totalBase = pattern.total_minutes.base;
    if (isWeekendDay) {
        totalBase += pattern.weekend_increase || 0;
    }

    // Anomaly effects (direction depends on profile)
    let anomalyMultiplier = 1.0;
    if (isAnomalyDay) {
        if (profileType === 'high_achiever') {
            // High achievers have HIGH social media as anomalies (rare scrolling binge)
            anomalyMultiplier = 1.8; // 80% more usage
        } else if (profileType === 'low_achiever') {
            // Low achievers have LOW social media as anomalies (rare focused day)
            anomalyMultiplier = 0.5; // 50% less usage
        } else {
            // Average: random direction
            anomalyMultiplier = Math.random() > 0.5 ? 1.5 : 0.6;
        }
    }

    // Carry-over from previous day
    const carryOverAdjustment = carryOverFactor * 15; // up to ±15 minutes

    // === GENERATE CORE METRICS ===

    let baseTotal = totalBase;
    // Apply anomaly to total social media time
    if (anomalyMultiplier < 1) {
        baseTotal = baseTotal * anomalyMultiplier; // Less usage
    } else if (anomalyMultiplier > 1) {
        baseTotal = Math.min(baseTotal * anomalyMultiplier, 360); // More but capped at 6h
    }

    const totalMinutes = Math.round(clamp(
        addVariance(baseTotal, pattern.total_minutes.variance) + carryOverAdjustment,
        0, 360
    ));

    // Generate session patterns (correlated with total usage)
    const usageRatio = totalMinutes / pattern.total_minutes.base;

    // More social media = more checking sessions and longer sessions
    let sessionCountBase = pattern.session_count.base * Math.sqrt(usageRatio);
    let avgSessionBase = pattern.avg_session_length.base * Math.sqrt(usageRatio);
    let lateNightBase = pattern.late_night_minutes.base * usageRatio;

    const sessionCount = Math.round(clamp(
        addVariance(sessionCountBase, pattern.session_count.variance),
        1, 50 // At least 1 session, max 50
    ));

    // Average session length = total / sessions (with some variance)
    let calculatedAvgSession = sessionCount > 0 ? totalMinutes / sessionCount : 10;
    const avgSessionLength = Math.round(clamp(
        addVariance(avgSessionBase, pattern.avg_session_length.variance),
        1, totalMinutes // At least 1 min, at most total time
    ));

    const lateNightMinutes = Math.round(clamp(
        addVariance(lateNightBase, pattern.late_night_minutes.variance),
        0, totalMinutes * 0.6 // Cap at 60% of total
    ));

    // Calculate percent of screen time (ensure screen time is at least social media time)
    const effectiveScreenTime = Math.max(screenTimeMinutes, totalMinutes);
    const percentOfScreen = effectiveScreenTime > 0
        ? clamp((totalMinutes / effectiveScreenTime) * 100, 0, 100)
        : pattern.percent_of_screen.base;

    return {
        session_date: sessionDate,
        total_social_minutes: totalMinutes,
        number_of_social_sessions: sessionCount,
        average_session_length: avgSessionLength,
        late_night_social_minutes: lateNightMinutes,
        percent_of_screen_time: Math.round(percentOfScreen * 100) / 100, // Round to 2 decimals
        is_simulated: true,
        // Return usage indicator for carry-over calculation
        _usageRatio: totalMinutes / pattern.total_minutes.base
    };
}

// =============================================================================
// MAIN SIMULATION FUNCTIONS
// =============================================================================

/**
 * Generate simulated social media data for a user
 * Reads simulated_profile from student_profiles to determine pattern
 * IMPORTANT: Should be called after screen time data is generated for correlation
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} days - Number of days of history to generate (default 7)
 * @param {string} profileOverride - Optional profile name to use
 * @returns {Array} - Array of generated session IDs
 */
async function generateSocialMediaData(pool, userId, days = 7, profileOverride = null) {
    logger.info(`Generating ${days} days of social media data for user ${userId}`);

    // Determine profile: Override > DB > Default
    let profile = profileOverride;
    if (!profile) {
        profile = await getProfile(pool, userId);
    }
    if (!profile) {
        profile = DEFAULT_PROFILE;
        logger.warn(`No profile found for user ${userId}, using default: ${DEFAULT_PROFILE}`);
    }

    const pattern = SOCIAL_MEDIA_PATTERNS[profile] || SOCIAL_MEDIA_PATTERNS[DEFAULT_PROFILE];

    logger.info(`Using social media pattern: ${pattern.name} (profile: ${profile})`);

    const sessionIds = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get screen time data for correlation
    const screenTimeData = await pool.query(
        `SELECT session_date, total_screen_minutes 
         FROM public.screen_time_sessions 
         WHERE user_id = $1 AND session_date >= $2
         ORDER BY session_date`,
        [userId, new Date(today.getTime() - days * 24 * 60 * 60 * 1000)]
    );

    const screenTimeByDate = {};
    screenTimeData.rows.forEach(row => {
        const dateKey = new Date(row.session_date).toISOString().split('T')[0];
        screenTimeByDate[dateKey] = row.total_screen_minutes;
    });

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

        // Get screen time for this date (for correlation)
        const dateKey = sessionDate.toISOString().split('T')[0];
        const screenTimeMinutes = screenTimeByDate[dateKey] || pattern.total_minutes.base * 5; // Default multiplier

        const session = generateSession(pattern, sessionDate, {
            isWeekendDay,
            isAnomalyDay,
            carryOverFactor,
            profileType: profile,
            screenTimeMinutes
        });

        // Store usage ratio for next iteration's carry-over
        previousUsageRatio = session._usageRatio;

        // Insert session (without the internal _usageRatio field)
        const result = await pool.query(
            `INSERT INTO public.social_media_sessions 
             (user_id, session_date, total_social_minutes, number_of_social_sessions,
              average_session_length, late_night_social_minutes, percent_of_screen_time, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               total_social_minutes = EXCLUDED.total_social_minutes,
               number_of_social_sessions = EXCLUDED.number_of_social_sessions,
               average_session_length = EXCLUDED.average_session_length,
               late_night_social_minutes = EXCLUDED.late_night_social_minutes,
               percent_of_screen_time = EXCLUDED.percent_of_screen_time,
               is_simulated = EXCLUDED.is_simulated
             RETURNING id`,
            [userId, session.session_date, session.total_social_minutes, session.number_of_social_sessions,
                session.average_session_length, session.late_night_social_minutes,
                session.percent_of_screen_time, session.is_simulated]
        );

        sessionIds.push(result.rows[0].id);
    }

    // Recompute baseline from generated data
    await recomputeBaseline(pool, userId, days);

    // Compute judgments for each session
    for (const sessionId of sessionIds) {
        await computeJudgments(pool, sessionId);
    }

    logger.info(`Generated ${sessionIds.length} social media sessions for user ${userId} (${anomalyDayCount} anomaly days)`);
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
    generateSocialMediaData,

    // Profile management
    getProfile,

    // Pattern configurations (for testing/extension)
    SOCIAL_MEDIA_PATTERNS,
    DEFAULT_PROFILE,

    // Lower-level generators (for testing)
    generateSession,
    addVariance
};
