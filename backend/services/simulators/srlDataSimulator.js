// SRL Data Simulator
// Generates realistic simulated questionnaire responses based on student achievement profile
// Used to seed new users with history for the "high_achiever/average/low_achiever" profiles
// 
// Enhanced Features:
// - Anomaly days (occasional "bad days" for high achievers, "good days" for low achievers)
// - Per-concept individual biases (each student has natural strengths and weaknesses)
// - Temporal patterns (start-of-week motivation, end-of-week fatigue)
// - Gradual trends (slight improvement or decline over time)

import { randomUUID } from 'crypto';
import logger from '../../utils/logger.js';
import {
    computeAnnotations,
    CONCEPT_SHORT_NAMES
} from '../annotators/srlAnnotationService.js';

// =============================================================================
// PROFILE-BASED SRL PATTERNS
// =============================================================================

const SRL_PATTERNS = {
    // High achiever: High ratings (4-5), Low Anxiety (1-2)
    high_achiever: {
        name: 'Effective Self-Regulation',
        base_rating: { min: 4, max: 5 },
        anxiety_rating: { min: 1, max: 2 },
        consistency: 0.85,          // 85% chance to stay in optimal range
        anomaly_chance: 0.12,       // 12% chance of a "bad day"
        anomaly_shift: -2,          // On bad days, scores drop by ~2 points
        weekend_effect: -0.3,       // Slightly lower on weekends (relaxing)
        trend_per_week: 0.05        // Slight improvement over time
    },

    // Average achiever: Mid ratings (2-4), Mid Anxiety (2-4)
    average: {
        name: 'Inconsistent Self-Regulation',
        base_rating: { min: 2, max: 4 },
        anxiety_rating: { min: 2, max: 4 },
        consistency: 0.65,          // More variable
        anomaly_chance: 0.18,       // 18% chance of anomaly day
        anomaly_shift: 0,           // Anomalies go either direction (random ±2)
        weekend_effect: -0.5,       // Noticeable weekend dip
        trend_per_week: 0           // No consistent trend
    },

    // Low achiever: Low ratings (1-3), High Anxiety (3-5)
    low_achiever: {
        name: 'Limited Self-Regulation',
        base_rating: { min: 1, max: 3 },
        anxiety_rating: { min: 3, max: 5 },
        consistency: 0.70,          // Fairly consistent (in a bad way)
        anomaly_chance: 0.10,       // 10% chance of a "good day"
        anomaly_shift: 2,           // On good days, scores improve by ~2
        weekend_effect: -0.8,       // Bigger weekend effect (distraction)
        trend_per_week: -0.03       // Slight decline over time
    }
};

const DEFAULT_PROFILE = 'average';

// Concept groupings for generating correlated biases
const CONCEPT_GROUPS = {
    planning: ['goal_setting', 'planning', 'task_strategies'],
    monitoring: ['self_observation', 'self_judgement', 'self_reaction'],
    motivation: ['self_efficacy', 'intrinsic_motivation', 'extrinsic_motivation'],
    cognition: ['elaboration', 'critical_thinking', 'metacognitive_regulation'],
    affect: ['anxiety', 'effort_regulation']
};

// =============================================================================
// GENERATION UTILITIES
// =============================================================================

/**
 * Generate a random integer between min and max (inclusive)
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Clamp value to 1-5 range (Likert scale)
 */
function clampScore(score) {
    return Math.max(1, Math.min(5, Math.round(score)));
}

/**
 * Generate per-user concept biases (strengths and weaknesses)
 * This creates a stable "personality" for each user's SRL profile
 * Returns an object mapping concept keys to bias values (-1 to +1)
 */
function generateConceptBiases() {
    const biases = {};

    // First, assign group-level biases (correlated within groups)
    const groupBiases = {};
    for (const group of Object.keys(CONCEPT_GROUPS)) {
        // Each group gets a random bias between -0.8 and +0.8
        groupBiases[group] = (Math.random() - 0.5) * 1.6;
    }

    // Then assign individual concept biases with correlation to group
    for (const [group, concepts] of Object.entries(CONCEPT_GROUPS)) {
        for (const concept of concepts) {
            // Individual bias = group bias + individual variation
            const individualVariation = (Math.random() - 0.5) * 0.8;
            biases[concept] = groupBiases[group] * 0.6 + individualVariation;
        }
    }

    return biases;
}

/**
 * Check if a given date is a weekend
 */
function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

/**
 * Calculate week number from start of simulation
 */
function getWeekNumber(dayIndex, totalDays) {
    return Math.floor(dayIndex / 7);
}

/**
 * Generate a score based on profile pattern with enhanced realism
 * 
 * @param {Object} pattern - Profile pattern configuration
 * @param {string} conceptKey - The SRL concept being scored
 * @param {number} conceptBias - Per-user bias for this concept (-1 to +1)
 * @param {boolean} isAnomalyDay - Whether this is an anomaly day
 * @param {boolean} isWeekendDay - Whether this is a weekend
 * @param {number} weekNumber - Week number for trend calculation
 */
function generateScore(pattern, conceptKey, conceptBias, isAnomalyDay, isWeekendDay, weekNumber) {
    const isAnxiety = conceptKey === 'anxiety';
    const range = isAnxiety ? pattern.anxiety_rating : pattern.base_rating;

    // Start with base score in the middle of the range
    let baseScore = (range.min + range.max) / 2;

    // Apply per-concept bias (makes some concepts naturally stronger/weaker)
    // For anxiety, invert the bias effect
    const biasEffect = isAnxiety ? -conceptBias : conceptBias;
    baseScore += biasEffect * 0.8;

    // Apply weekend effect
    if (isWeekendDay) {
        baseScore += pattern.weekend_effect;
        // Anxiety typically increases slightly on weekends for struggling students
        if (isAnxiety && pattern.name === 'Limited Self-Regulation') {
            baseScore += 0.5;
        }
    }

    // Apply trend over time
    baseScore += weekNumber * pattern.trend_per_week;

    // Apply anomaly day effect
    if (isAnomalyDay) {
        if (pattern.anomaly_shift === 0) {
            // Average students: anomalies go either direction
            baseScore += (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random());
        } else {
            // High/Low achievers: anomalies in the specified direction
            const anomalyMagnitude = pattern.anomaly_shift * (0.8 + Math.random() * 0.4);
            baseScore += isAnxiety ? -anomalyMagnitude : anomalyMagnitude;
        }
    }

    // Apply normal daily variance (consistency check)
    const isConsistent = Math.random() < pattern.consistency;
    if (!isConsistent) {
        // Add extra noise on inconsistent days
        baseScore += (Math.random() - 0.5) * 2;
    }

    // Add small random noise to every score (±0.5)
    baseScore += (Math.random() - 0.5);

    // Ensure score stays within the pattern's typical range (soft constraint)
    // But allow occasional extreme values
    if (Math.random() < 0.9) {
        // 90% of the time, nudge back towards range
        if (baseScore < range.min) baseScore = range.min + Math.random() * 0.5;
        if (baseScore > range.max) baseScore = range.max - Math.random() * 0.5;
    }

    return clampScore(baseScore);
}

/**
 * Generate a full set of answers for a single questionnaire with enhanced realism
 */
function generateAnswers(profile, conceptBiases, date, dayIndex, totalDays) {
    const pattern = SRL_PATTERNS[profile] || SRL_PATTERNS[DEFAULT_PROFILE];
    const answers = {};

    // Determine day characteristics
    const isAnomalyDay = Math.random() < pattern.anomaly_chance;
    const isWeekendDay = isWeekend(date);
    const weekNumber = getWeekNumber(dayIndex, totalDays);

    if (isAnomalyDay) {
        logger.debug(`Day ${dayIndex}: Anomaly day for profile ${profile}`);
    }

    Object.keys(CONCEPT_SHORT_NAMES).forEach(key => {
        const bias = conceptBiases[key] || 0;
        answers[key] = generateScore(pattern, key, bias, isAnomalyDay, isWeekendDay, weekNumber);
    });

    return answers;
}

// =============================================================================
// MAIN SIMULATION FUNCTION
// =============================================================================

/**
 * Generate simulated SRL data for a user
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string} profile - Profile name (high_achiever, average, low_achiever)
 * @param {number} days - Number of days of history (default 14)
 * @returns {Promise<void>}
 */
async function generateSRLData(pool, userId, profile, days = 14) {
    logger.info(`Generating ${days} days of SRL data for user ${userId} with profile '${profile}'`);

    // Get survey ID (assume the first active survey is the SRL one)
    const surveyRes = await pool.query('SELECT id FROM public.surveys LIMIT 1');
    if (surveyRes.rows.length === 0) {
        logger.warn('No survey found, skipping SRL simulation');
        return;
    }
    const surveyId = surveyRes.rows[0].id;

    // Generate stable per-user concept biases (strengths/weaknesses)
    // This creates a consistent "personality" for this user's SRL profile
    const conceptBiases = generateConceptBiases();
    logger.debug(`Generated concept biases for user ${userId}:`, conceptBiases);

    // Define missed day probabilities by profile
    // High achievers rarely miss, low achievers miss more often
    const missedDayProbability = {
        high_achiever: 0.05,  // 5% chance to miss a day
        average: 0.15,        // 15% chance to miss a day
        low_achiever: 0.25    // 25% chance to miss a day
    };
    const missChance = missedDayProbability[profile] || 0.15;

    // Generate data for past days
    const today = new Date();
    let responsesGenerated = 0;

    for (let i = days; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        // Check if this day should be "missed" (no submission)
        // But ensure at least some days have data (first and last few days always have data)
        const isProtectedDay = i === 0 || i === days || i === days - 1;
        if (!isProtectedDay && Math.random() < missChance) {
            logger.debug(`Day ${i}: User missed questionnaire submission`);
            continue;
        }

        // Add random time variation (9 AM - 9 PM)
        date.setHours(9 + randomInt(0, 12), randomInt(0, 59), 0, 0);

        const dayIndex = days - i; // 0 for oldest day, `days` for today
        const answers = generateAnswers(profile, conceptBiases, date, dayIndex, days);
        const questionnaireId = randomUUID();

        // 1. Insert questionnaire_results
        await pool.query(
            `INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
             VALUES ($1, $2, $3, $4, $5)`,
            [questionnaireId, surveyId, userId, date, JSON.stringify(answers)]
        );

        // 2. Insert individual SRL responses (scoring)
        for (const [key, score] of Object.entries(answers)) {
            await pool.query(
                `INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (questionnaire_id, concept_key) DO NOTHING`,
                [userId, questionnaireId, key, score, date]
            );
        }

        responsesGenerated++;
    }

    // 3. Compute annotations (derived insights)
    const mockSurveyStructure = {
        pages: [{
            elements: Object.keys(CONCEPT_SHORT_NAMES).map(key => ({
                name: key,
                type: 'rating',
                title: CONCEPT_SHORT_NAMES[key]
            }))
        }]
    };

    await computeAnnotations(pool, userId, mockSurveyStructure);

    logger.info(`Generated ${responsesGenerated} SRL responses for user ${userId} (${days - responsesGenerated} days missed)`);
}

export {
    generateSRLData,
    SRL_PATTERNS,
    generateConceptBiases
};

