// LMS Data Simulator
// Generates realistic simulated LMS data based on student achievement profile
// Uses the unified simulated_profile (high_achiever/average/low_achiever) system
// Each subject (subject_1 to subject_4) is simulated independently but coherently

import logger from '../../utils/logger.js';
import { computeJudgments } from '../annotators/lmsAnnotationService.js';

// =============================================================================
// PROFILE-BASED LMS PATTERNS
// =============================================================================

const LMS_PATTERNS = {
    high_achiever: {
        total_active_minutes: { base: 80, variance: 20 },   // High engagement
        sessions_per_week: { base: 6, variance: 1 },        // Consistent
        avg_session_length: { base: 45, variance: 15 },     // Focused sessions
        action_mix: {
            passive_ratio: { base: 0.40, variance: 0.10 },  // Balanced (40% passive)
            practice_events: { base: 5, variance: 2 },      // High practice
            discussion_posts: { base: 3, variance: 2 }      // High participation
        }
    },
    average: {
        total_active_minutes: { base: 50, variance: 20 },   // Moderate engagement
        sessions_per_week: { base: 4, variance: 1 },        // Mixed consistency
        avg_session_length: { base: 30, variance: 15 },     // Moderate length
        action_mix: {
            passive_ratio: { base: 0.70, variance: 0.15 },  // Mostly passive
            practice_events: { base: 2, variance: 2 },      // Moderate practice
            discussion_posts: { base: 1, variance: 1 }      // Low/Moderate participation
        }
    },
    low_achiever: {
        total_active_minutes: { base: 20, variance: 15 },   // Low engagement
        sessions_per_week: { base: 2, variance: 1 },        // Inconsistent
        avg_session_length: { base: 15, variance: 10 },     // Short/Fragmented
        action_mix: {
            passive_ratio: { base: 0.90, variance: 0.10 },  // Very passive
            practice_events: { base: 0, variance: 1 },      // Low/No practice
            discussion_posts: { base: 0, variance: 0 }      // No participation
        }
    }
};

const DEFAULT_PROFILE = 'average';

// =============================================================================
// DATA GENERATION UTILITIES
// =============================================================================

function addVariance(base, variance) {
    const offset = (Math.random() - 0.5) * 2 * variance;
    return Math.max(0, Math.round(base + offset));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// =============================================================================
// MAIN SIMULATION FUNCTIONS
// =============================================================================

/**
 * Generate simulated LMS data for a user across all 4 subjects
 */
async function generateLMSData(pool, userId, days = 7, profileOverride = null) {
    logger.info(`Generating ${days} days of LMS data for user ${userId}`);

    // Clear existing data for this period to avoid conflicts (implicit in migration but good practice)
    // Actually migration wiped it, but for multiple runs we need cleanup? 
    // The simulator usually uses ON CONFLICT DO NOTHING, but now we've changed the PK.
    // Let's ensure we are clean.
    // await pool.query('DELETE FROM public.lms_sessions WHERE user_id = $1', [userId]); 
    // ^ No, that wipes history. Let's trust ON CONFLICT or just let it roll.

    // Determine profile
    let profile = profileOverride;
    if (!profile) {
        profile = await getProfile(pool, userId);
    }
    if (!profile) {
        profile = DEFAULT_PROFILE;
    }

    const pattern = LMS_PATTERNS[profile] || LMS_PATTERNS[DEFAULT_PROFILE];
    logger.info(`Using LMS pattern: ${profile}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // =========================================================================
    // GENERATE LMS ACTIVITY (Single Stream)
    // =========================================================================

    // Determine which days are active based on frequency
    const daysIndices = Array.from({ length: days }, (_, i) => i);
    // Shuffle indices
    for (let i = daysIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [daysIndices[i], daysIndices[j]] = [daysIndices[j], daysIndices[i]];
    }

    const targetActiveDays = clamp(addVariance(pattern.sessions_per_week.base, pattern.sessions_per_week.variance), 0, days);
    const activeDatesSet = new Set(daysIndices.slice(0, targetActiveDays));

    // Generate daily data
    for (let dayOffset = days - 1; dayOffset >= 0; dayOffset--) {
        // Is this day active?
        if (!activeDatesSet.has(dayOffset)) {
            continue;
        }

        const sessionDate = new Date(today);
        sessionDate.setDate(sessionDate.getDate() - dayOffset);

        // Generate daily metrics
        const dailyModifier = Math.random() * 0.5 + 0.75; // Daily fluctuation

        const totalMin = Math.round(addVariance(pattern.total_active_minutes.base, pattern.total_active_minutes.variance) * dailyModifier);
        const numSessions = Math.max(1, Math.round(totalMin / (pattern.avg_session_length.base || 20))); // approx sessions

        // Distribute minutes into actions
        const passiveRatio = clamp(pattern.action_mix.passive_ratio.base + (Math.random() * 0.1 - 0.05), 0, 1);
        const passiveMin = Math.round(totalMin * passiveRatio);
        // activeMin is implicit rest

        // Split passive into reading/watching
        const readingMin = Math.round(passiveMin * (0.4 + Math.random() * 0.4)); // 40-80% reading
        const watchingMin = passiveMin - readingMin;

        // Events
        const practiceEvents = addVariance(pattern.action_mix.practice_events.base, pattern.action_mix.practice_events.variance);
        const assignmentEvents = Math.round(practiceEvents * 0.5); // Assume some assignment work

        // Discussion
        let forumPosts = 0;
        if (Math.random() < 0.3) { // 30% chance of posting on an active day
            forumPosts = addVariance(pattern.action_mix.discussion_posts.base, pattern.action_mix.discussion_posts.variance);
        }
        const forumViews = forumPosts * 3 + Math.round(Math.random() * 5);

        // Insert into DB
        await pool.query(
            `INSERT INTO public.lms_sessions 
                (user_id, session_date, total_active_minutes, total_events, 
                number_of_sessions, longest_session_minutes, days_active_in_period,
                reading_minutes, watching_minutes, exercise_practice_events, 
                assignment_work_events, forum_views, forum_posts, is_simulated)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (user_id, session_date) DO UPDATE SET
                total_active_minutes = EXCLUDED.total_active_minutes,
                total_events = EXCLUDED.total_events,
                number_of_sessions = EXCLUDED.number_of_sessions,
                longest_session_minutes = EXCLUDED.longest_session_minutes,
                reading_minutes = EXCLUDED.reading_minutes,
                watching_minutes = EXCLUDED.watching_minutes,
                exercise_practice_events = EXCLUDED.exercise_practice_events,
                assignment_work_events = EXCLUDED.assignment_work_events,
                forum_views = EXCLUDED.forum_views,
                forum_posts = EXCLUDED.forum_posts,
                is_simulated = EXCLUDED.is_simulated`,
            [userId, sessionDate, totalMin,
                practiceEvents + assignmentEvents + forumViews + forumPosts + 5, // total_events approx
                numSessions, Math.round(totalMin / numSessions * 1.2), // longest slightly > avg
                1, // days_active_in_period (always 1 for a daily record)
                readingMin, watchingMin, practiceEvents, assignmentEvents, forumViews, forumPosts, true]
        );
    }

    // Compute Baseline (simple initial set)
    // We store weekly baseline capacity
    await pool.query(
        `INSERT INTO public.lms_baselines (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO NOTHING`,
        [userId, pattern.total_active_minutes.base * 7, pattern.sessions_per_week.base, 7]
    );

    // Compute Judgments for LMS activity
    await computeJudgments(pool, userId, 7);
}

async function getProfile(pool, userId) {
    const { rows } = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles WHERE user_id = $1`,
        [userId]
    );
    return rows.length > 0 ? rows[0].simulated_profile : null;
}

export {
    generateLMSData
};
