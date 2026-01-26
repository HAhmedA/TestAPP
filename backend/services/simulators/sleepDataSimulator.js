// Sleep Data Simulator
// Generates realistic simulated sleep data based on student achievement profile
// Uses the unified simulated_profile (high_achiever/average/low_achiever) system
//
// Enhanced Features:
// - Anomaly nights (occasional terrible nights for high achievers, good nights for low achievers)
// - Weekend effects (late nights, later wake times)
// - Correlated metrics (poor sleep affects multiple dimensions together)
// - Day-to-day carry-over (bad night can influence next night)

import logger from '../../utils/logger.js';
import { computeJudgments, recomputeBaseline } from '../annotators/sleepAnnotationService.js';

// =============================================================================
// PROFILE-BASED SLEEP PATTERNS
// =============================================================================

/**
 * Sleep patterns mapped to achievement profiles
 * Each pattern defines base metrics, variance ranges, and behavior modifiers
 */
const SLEEP_PATTERNS = {
    // High achiever: Good, consistent sleep
    high_achiever: {
        name: 'normal',
        total_sleep: { base: 450, variance: 30 },      // ~7.5h ± 30min
        time_in_bed: { base: 480, variance: 20 },      // ~8h
        bedtime_hour: { base: 23.0, variance: 0.5 },   // 11:00 PM ± 30min
        wake_hour: { base: 7.0, variance: 0.5 },       // 7:00 AM ± 30min
        awakenings: { base: 1, variance: 1 },          // Minimal awakenings
        awake_minutes: { base: 5, variance: 5 },       // Brief awakenings
        // Behavior modifiers
        anomaly_chance: 0.10,                          // 10% chance of a bad night
        weekend_bedtime_shift: 1.0,                    // 1 hour later on weekends
        weekend_wake_shift: 1.5,                       // 1.5 hours later wake
        recovery_factor: 0.8                           // Quick to recover from bad nights
    },

    // Average achiever: Variable, sometimes irregular
    average: {
        name: 'irregular',
        total_sleep: { base: 400, variance: 60 },      // ~6.7h ± 1h
        time_in_bed: { base: 460, variance: 40 },
        bedtime_hour: { base: 23.5, variance: 1.5 },   // Later, more variable
        wake_hour: { base: 7.5, variance: 1.0 },
        awakenings: { base: 3, variance: 2 },          // Some disruption
        awake_minutes: { base: 15, variance: 10 },
        // Behavior modifiers
        anomaly_chance: 0.15,                          // 15% chance of unusually bad/good night
        weekend_bedtime_shift: 1.5,                    // Much later on weekends
        weekend_wake_shift: 2.0,
        recovery_factor: 0.5                           // Slower to recover
    },

    // Low achiever: Poor sleep habits
    low_achiever: {
        name: 'poor',
        total_sleep: { base: 330, variance: 60 },      // ~5.5h ± 1h (short)
        time_in_bed: { base: 420, variance: 60 },
        bedtime_hour: { base: 1.0, variance: 2.0 },    // Very late (1:00 AM)
        wake_hour: { base: 8.0, variance: 1.5 },       // Inconsistent wake
        awakenings: { base: 5, variance: 3 },          // Fragmented
        awake_minutes: { base: 30, variance: 15 },     // Long awake periods
        // Behavior modifiers
        anomaly_chance: 0.08,                          // 8% chance of a good night
        weekend_bedtime_shift: 2.5,                    // Extreme weekend shift
        weekend_wake_shift: 3.0,
        recovery_factor: 0.3                           // Bad nights compound
    }
};

// Default pattern if profile not found
const DEFAULT_PROFILE = 'average';

// =============================================================================
// DATA GENERATION UTILITIES
// =============================================================================

/**
 * Add variance to a base value (normal-ish distribution via Box-Muller)
 */
function addVariance(base, variance) {
    // Simple uniform random for now, good enough for simulation
    const offset = (Math.random() - 0.5) * 2 * variance;
    return Math.round(base + offset);
}

/**
 * Add variance to decimal hour, handling day wraparound
 */
function addHourVariance(baseHour, variance) {
    let hour = baseHour + (Math.random() - 0.5) * 2 * variance;
    // Normalize to 0-24 range
    while (hour < 0) hour += 24;
    while (hour >= 24) hour -= 24;
    return hour;
}

/**
 * Generate a timestamp from a date and decimal hour
 */
function createTimestamp(date, decimalHour) {
    const result = new Date(date);
    const hours = Math.floor(decimalHour);
    const minutes = Math.round((decimalHour - hours) * 60);
    result.setHours(hours, minutes, 0, 0);
    return result;
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
 * Generate a single sleep session with enhanced realism
 * @param {Object} pattern - Sleep pattern configuration
 * @param {Date} sessionDate - Date for this session
 * @param {Object} options - Additional options for realism
 * @param {boolean} options.isWeekendNight - Whether this is a weekend night
 * @param {boolean} options.isAnomalyNight - Whether this is an anomaly night
 * @param {number} options.carryOverFactor - Impact from previous night (-1 to 1)
 * @param {string} options.profileType - Profile type for anomaly direction
 * @returns {Object} - Sleep session data
 */
function generateSession(pattern, sessionDate, options = {}) {
    const {
        isWeekendNight = false,
        isAnomalyNight = false,
        carryOverFactor = 0,
        profileType = 'average'
    } = options;

    // === APPLY MODIFIERS TO BASE VALUES ===

    // Weekend effects on timing
    let bedtimeBase = pattern.bedtime_hour.base;
    let wakeBase = pattern.wake_hour.base;
    if (isWeekendNight) {
        bedtimeBase += pattern.weekend_bedtime_shift || 0;
        wakeBase += pattern.weekend_wake_shift || 0;
    }

    // Anomaly effects (direction depends on profile)
    let anomalyMultiplier = 1.0;
    if (isAnomalyNight) {
        if (profileType === 'high_achiever') {
            // High achievers have BAD nights as anomalies
            anomalyMultiplier = 0.7; // 30% worse sleep
        } else if (profileType === 'low_achiever') {
            // Low achievers have GOOD nights as anomalies
            anomalyMultiplier = 1.4; // 40% better sleep
        } else {
            // Average: random direction
            anomalyMultiplier = Math.random() > 0.5 ? 1.3 : 0.7;
        }
    }

    // Carry-over from previous night (bad nights can compound)
    const carryOverAdjustment = carryOverFactor * 20; // up to ±20 minutes

    // === GENERATE CORE METRICS ===

    let baseSleep = pattern.total_sleep.base;
    // Apply anomaly to sleep duration
    if (anomalyMultiplier < 1) {
        baseSleep = baseSleep * anomalyMultiplier; // Worse sleep
    } else if (anomalyMultiplier > 1) {
        baseSleep = Math.min(baseSleep * anomalyMultiplier, 540); // Better but capped at 9h
    }

    const totalSleep = Math.round(clamp(
        addVariance(baseSleep, pattern.total_sleep.variance) + carryOverAdjustment,
        180, 600
    ));
    const timeInBed = Math.round(clamp(
        addVariance(pattern.time_in_bed.base, pattern.time_in_bed.variance),
        totalSleep, 720
    ));

    // Generate timing with weekend adjustments
    let bedtimeHour = addHourVariance(bedtimeBase, pattern.bedtime_hour.variance);
    let wakeHour = addHourVariance(wakeBase, pattern.wake_hour.variance);

    // Create timestamps
    const bedtime = createTimestamp(new Date(sessionDate), bedtimeHour);
    if (bedtimeHour > 12) {
        bedtime.setDate(bedtime.getDate() - 1);
    }
    const wakeTime = createTimestamp(new Date(sessionDate), wakeHour);

    // === GENERATE INTERRUPTIONS (inversely correlated with quality) ===

    let awakeningsBase = pattern.awakenings.base;
    let awakeMinutesBase = pattern.awake_minutes.base;

    if (anomalyMultiplier < 1) {
        // Bad night = more awakenings
        awakeningsBase = awakeningsBase / anomalyMultiplier;
        awakeMinutesBase = awakeMinutesBase / anomalyMultiplier;
    } else if (anomalyMultiplier > 1) {
        // Good night = fewer awakenings
        awakeningsBase = awakeningsBase * 0.8;
        awakeMinutesBase = awakeMinutesBase * 0.7;
    }

    const awakenings = clamp(addVariance(awakeningsBase, pattern.awakenings.variance), 0, 15);
    const awakeMinutes = clamp(addVariance(awakeMinutesBase, pattern.awake_minutes.variance), 0, 60);

    return {
        session_date: sessionDate,
        bedtime: bedtime,
        wake_time: wakeTime,
        total_sleep_minutes: totalSleep,
        time_in_bed_minutes: timeInBed,
        awakenings_count: awakenings,
        awake_minutes: awakeMinutes,
        is_simulated: true,
        // Return quality indicator for carry-over calculation
        _qualityScore: totalSleep / pattern.total_sleep.base
    };
}

// =============================================================================
// MAIN SIMULATION FUNCTIONS
// =============================================================================

/**
 * Generate simulated sleep data for a user
 * Reads simulated_profile from student_profiles to determine pattern
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} days - Number of days of history to generate (default 7)
 * @param {string} profileOverride - Optional profile name to use
 * @returns {Array} - Array of generated session IDs
 */
async function generateSleepData(pool, userId, days = 7, profileOverride = null) {
    logger.info(`Generating ${days} days of sleep data for user ${userId}`);

    // Determine profile: Override > DB > Default
    let profile = profileOverride;
    if (!profile) {
        profile = await getProfile(pool, userId);
    }
    if (!profile) {
        profile = DEFAULT_PROFILE;
        logger.warn(`No profile found for user ${userId}, using default: ${DEFAULT_PROFILE}`);
    }

    const pattern = SLEEP_PATTERNS[profile] || SLEEP_PATTERNS[DEFAULT_PROFILE];

    logger.info(`Using sleep pattern: ${pattern.name} (profile: ${profile})`);

    const sessionIds = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Track previous night's quality for carry-over effect
    let previousQualityScore = 1.0;
    let anomalyNightCount = 0;

    // Generate sessions for each day (oldest first)
    for (let dayOffset = days - 1; dayOffset >= 0; dayOffset--) {
        const sessionDate = new Date(today);
        sessionDate.setDate(sessionDate.getDate() - dayOffset);

        // Determine if this is a weekend night (Friday or Saturday evening)
        const dayOfWeek = sessionDate.getDay();
        const isWeekendNight = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday

        // Determine if this is an anomaly night
        const isAnomalyNight = Math.random() < (pattern.anomaly_chance || 0.1);
        if (isAnomalyNight) {
            anomalyNightCount++;
            logger.debug(`Day ${dayOffset}: Anomaly night for profile ${profile}`);
        }

        // Calculate carry-over from previous night
        // If previous night was poor (qualityScore < 1), it may affect tonight
        // Recovery factor determines how quickly the effect fades
        const carryOverFactor = (previousQualityScore - 1) * (pattern.recovery_factor || 0.5);

        const session = generateSession(pattern, sessionDate, {
            isWeekendNight,
            isAnomalyNight,
            carryOverFactor,
            profileType: profile
        });

        // Store quality for next iteration's carry-over
        previousQualityScore = session._qualityScore;

        // Insert session (without the internal _qualityScore field)
        const result = await pool.query(
            `INSERT INTO public.sleep_sessions 
             (user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes,
              awakenings_count, awake_minutes, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               bedtime = EXCLUDED.bedtime,
               wake_time = EXCLUDED.wake_time,
               total_sleep_minutes = EXCLUDED.total_sleep_minutes,
               time_in_bed_minutes = EXCLUDED.time_in_bed_minutes,
               awakenings_count = EXCLUDED.awakenings_count,
               awake_minutes = EXCLUDED.awake_minutes,
               is_simulated = EXCLUDED.is_simulated
             RETURNING id`,
            [userId, session.session_date, session.bedtime, session.wake_time,
                session.total_sleep_minutes, session.time_in_bed_minutes,
                session.awakenings_count, session.awake_minutes, session.is_simulated]
        );

        sessionIds.push(result.rows[0].id);
    }

    // Recompute baseline from generated data
    await recomputeBaseline(pool, userId, days);

    // Compute judgments for each session
    for (const sessionId of sessionIds) {
        await computeJudgments(pool, sessionId);
    }

    logger.info(`Generated ${sessionIds.length} sleep sessions for user ${userId} (${anomalyNightCount} anomaly nights)`);
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

// REMOVED getOrAssignProfile as logic is moved to Orchestrator

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Main function
    generateSleepData,

    // Profile management
    getProfile,

    // Pattern configurations (for testing/extension)
    SLEEP_PATTERNS,
    DEFAULT_PROFILE,

    // Lower-level generators (for testing)
    generateSession,
    addVariance
};
