// Simulation Orchestrator Service
// Central coordinator for all data simulators (SRL, Sleep, etc.)
// Ensures student profile consistency across all data sources

import logger from '../utils/logger.js';
import {
    generateSleepData,
    generateSRLData,
    generateScreenTimeData,
    generateSocialMediaData,
    generateLMSData
} from './simulators/index.js';
import { computeAllScores } from './scoring/index.js';

// =============================================================================
// PROFILE MANAGEMENT
// =============================================================================

/**
 * Get or assign a simulated profile for a user
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {string} - Profile name (high_achiever/average/low_achiever)
 */
async function getOrAssignProfile(pool, userId) {
    // Check if profile exists
    const { rows } = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles WHERE user_id = $1`,
        [userId]
    );

    if (rows.length > 0 && rows[0].simulated_profile) {
        return rows[0].simulated_profile;
    }

    // Cyclic Profile Assignment (High -> Average -> Low)
    // We check the most recently assigned profile globally to ensure rotation for testing
    const lastProfileResult = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles 
         WHERE simulated_profile IS NOT NULL 
         ORDER BY updated_at DESC LIMIT 1`
    );

    let profile = 'high_achiever'; // Default start

    if (lastProfileResult.rows.length > 0) {
        const lastProfile = lastProfileResult.rows[0].simulated_profile;
        switch (lastProfile) {
            case 'high_achiever':
                profile = 'average';
                break;
            case 'average':
                profile = 'low_achiever';
                break;
            case 'low_achiever':
                profile = 'high_achiever';
                break;
            default:
                profile = 'high_achiever';
        }
    }

    // Upsert profile
    await pool.query(
        `INSERT INTO public.student_profiles (user_id, simulated_profile)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           simulated_profile = COALESCE(student_profiles.simulated_profile, EXCLUDED.simulated_profile),
           updated_at = NOW()`,
        [userId, profile]
    );

    logger.info(`Orchestrator assigned profile '${profile}' to user ${userId}`);
    return profile;
}

// =============================================================================
// MAIN ORCHESTRATION
// =============================================================================

/**
 * Generate comprehensive student data for a new user
 * Called during registration or manual reset
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 */
async function generateStudentData(pool, userId) {
    logger.info(`Starting data simulation for user ${userId}`);

    try {
        // 1. Assign Profile (Single Source of Truth)
        const profile = await getOrAssignProfile(pool, userId);
        logger.info(`Simulation profile: ${profile}`);

        // 2. Run Simulators (Parallel execution)
        // We pass the profile explicitly where possible to avoid redundant DB lookups
        await Promise.all([
            // Sleep Simulator (Pass profile directly)
            generateSleepData(pool, userId, 7, profile)
                .then(() => logger.info(`Sleep simulation complete for ${userId}`))
                .catch(err => logger.error(`Sleep simulation failed: ${err.message}`)),

            // SRL Simulator (We pass the profile explicitly)
            generateSRLData(pool, userId, profile)
                .then(() => logger.info(`SRL simulation complete for ${userId}`))
                .catch(err => logger.error(`SRL simulation failed: ${err.message}`)),

            // Screen Time THEN Social Media (Correlation dependency)
            generateScreenTimeData(pool, userId, 7, profile)
                .then(() => {
                    logger.info(`Screen time simulation complete for ${userId}`);
                    return generateSocialMediaData(pool, userId, 7, profile);
                })
                .then(() => logger.info(`Social media simulation complete for ${userId}`))
                .catch(err => logger.error(`Screen/Social simulation failed: ${err.message}`)),

            // LMS Data Simulator
            generateLMSData(pool, userId, 7, profile)
                .then(() => logger.info(`LMS simulation complete for ${userId}`))
                .catch(err => logger.error(`LMS simulation failed: ${err.message}`))
        ]);

        // 3. Compute Concept Scores (after all data is generated)
        await computeAllScores(userId);
        logger.info(`Concept scores computed for user ${userId}`);

        logger.info(`All data simulation complete for user ${userId}`);
        return profile;

    } catch (err) {
        logger.error(`Orchestrator simulation error: ${err.message}`);
        throw err;
    }
}

export {
    generateStudentData,
    getOrAssignProfile
};

