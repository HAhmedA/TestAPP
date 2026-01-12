// SRL Annotation Service
// Computes statistics, trends, and generates annotation text for each SRL concept

// Minimum responses required to show trends
const MIN_RESPONSES_24H = 3;  // At least 3 responses for 24h
const MIN_DISTINCT_DAYS_7D = 3;  // At least 3 different days for 7d

// Concepts that are inverted (high score = bad outcome)
const INVERTED_CONCEPTS = ['anxiety'];

// Short display names for UI (concept_key -> short name)
const CONCEPT_SHORT_NAMES = {
    efficiency: 'Efficiency',
    importance: 'Importance',
    tracking: 'Tracking',
    clarity: 'Clarity',
    effort: 'Effort',
    focus: 'Focus',
    help_seeking: 'Help Seeking',
    community: 'Community',
    timeliness: 'Timeliness',
    motivation: 'Motivation',
    anxiety: 'Anxiety',
    enjoyment: 'Enjoyment',
    learning_from_feedback: 'Learning from Feedback',
    self_assessment: 'Self Assessment'
};

// Trend descriptions for annotation text
const TREND_DESCRIPTIONS = {
    improving: 'improving',
    declining: 'declining',
    stable_high: 'consistently high',
    stable_avg: 'stable',
    stable_low: 'consistently low'
};

// Trend descriptions for inverted concepts (e.g., anxiety)
const TREND_DESCRIPTIONS_INVERTED = {
    improving: 'decreasing (which is good)',
    declining: 'increasing (which needs attention)',
    stable_high: 'consistently high (needs attention)',
    stable_avg: 'moderate',
    stable_low: 'consistently low (which is good)'
};

/**
 * Calculate the average of an array of numbers
 */
function average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Classify stable level based on average score
 * @param {number} avgScore - Average score (1-5)
 * @returns {string} - 'stable_high', 'stable_avg', or 'stable_low'
 */
function classifyStableLevel(avgScore) {
    if (avgScore >= 4.0) return 'stable_high';
    if (avgScore >= 2.5) return 'stable_avg';
    return 'stable_low';
}

/**
 * Calculate trend from a series of scores
 * Compares earlier half vs recent half of scores
 * 
 * @param {number[]} scores - Array of scores in chronological order
 * @param {boolean} isInverted - If true, improving means scores going DOWN
 * @returns {string} - 'improving', 'declining', 'stable_high', 'stable_avg', 'stable_low'
 */
function calculateTrend(scores, isInverted = false) {
    if (scores.length === 0) {
        return 'stable_avg';
    }

    if (scores.length === 1) {
        return classifyStableLevel(scores[0]);
    }

    // Split into earlier and recent halves
    const midpoint = Math.floor(scores.length / 2);
    const earlierScores = scores.slice(0, midpoint || 1);
    const recentScores = scores.slice(midpoint);

    const earlierAvg = average(earlierScores);
    const recentAvg = average(recentScores);

    // Threshold for detecting change (configurable)
    const threshold = 0.5;
    const change = recentAvg - earlierAvg;

    // For inverted concepts (like anxiety), improvement means going DOWN
    if (isInverted) {
        if (change < -threshold) {
            return 'improving';  // Score decreased = good
        } else if (change > threshold) {
            return 'declining';  // Score increased = bad
        }
    } else {
        if (change > threshold) {
            return 'improving';  // Score increased = good
        } else if (change < -threshold) {
            return 'declining';  // Score decreased = bad
        }
    }

    // Stable - classify by level
    return classifyStableLevel(recentAvg);
}

/**
 * Generate annotation text for UI display (short concept name)
 */
function generateAnnotationText(conceptKey, trend, avg, timeWindow, isInverted) {
    const shortName = CONCEPT_SHORT_NAMES[conceptKey] || conceptKey;
    const period = timeWindow === '24h' ? 'today' : 'over the past 7 days';
    const trendDescriptions = isInverted ? TREND_DESCRIPTIONS_INVERTED : TREND_DESCRIPTIONS;
    const trendText = trendDescriptions[trend] || trend;

    return `Your ${shortName} has been ${trendText} ${period}, with an average of ${avg.toFixed(1)} out of 5.`;
}

/**
 * Generate annotation text for LLM/chatbot (full question title)
 */
function generateAnnotationTextLLM(conceptKey, fullTitle, trend, avg, min, max, count, timeWindow, isInverted) {
    const period = timeWindow === '24h' ? 'in the last 24 hours' : 'over the past 7 days';
    const trendDescriptions = isInverted ? TREND_DESCRIPTIONS_INVERTED : TREND_DESCRIPTIONS;
    const trendText = trendDescriptions[trend] || trend;

    // Clean up the full title (remove trailing colon if present)
    const cleanTitle = fullTitle.replace(/:$/, '');

    return `Regarding "${cleanTitle}": The student's responses have been ${trendText} ${period}. ` +
        `Statistics: average ${avg.toFixed(1)}, min ${min}, max ${max} (based on ${count} response${count !== 1 ? 's' : ''}).`;
}

/**
 * Compute all annotations for a user
 * Called after each questionnaire submission
 * 
 * @param {object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {object} surveyStructure - Survey JSON structure with element titles
 */
async function computeAnnotations(pool, userId, surveyStructure) {
    // Extract concept info from survey structure
    const conceptInfo = {};
    if (surveyStructure?.pages) {
        surveyStructure.pages.forEach(page => {
            if (page.elements) {
                page.elements.forEach(element => {
                    if (element.name && element.type === 'rating') {
                        conceptInfo[element.name] = {
                            key: element.name,
                            title: element.title || element.name,
                            isInverted: INVERTED_CONCEPTS.includes(element.name)
                        };
                    }
                });
            }
        });
    }

    const timeWindows = ['24h', '7d'];
    const annotations = [];

    for (const timeWindow of timeWindows) {
        const interval = timeWindow === '24h' ? '24 hours' : '7 days';

        // Get all responses for this user in the time window
        const { rows: responses } = await pool.query(
            `SELECT concept_key, score, submitted_at, DATE(submitted_at) as response_date
       FROM public.srl_responses 
       WHERE user_id = $1 AND submitted_at >= NOW() - INTERVAL '${interval}'
       ORDER BY concept_key, submitted_at ASC`,
            [userId]
        );

        // Group by concept and track distinct dates per concept
        const byConceptKey = {};
        const distinctDatesByConceptKey = {};
        responses.forEach(r => {
            if (!byConceptKey[r.concept_key]) {
                byConceptKey[r.concept_key] = [];
                distinctDatesByConceptKey[r.concept_key] = new Set();
            }
            byConceptKey[r.concept_key].push(r.score);
            // Track distinct dates per concept for 7-day threshold
            if (r.response_date) {
                distinctDatesByConceptKey[r.concept_key].add(r.response_date.toISOString().split('T')[0]);
            }
        });

        // Compute annotation for each concept
        for (const conceptKey of Object.keys(conceptInfo)) {
            const scores = byConceptKey[conceptKey] || [];
            const distinctDates = distinctDatesByConceptKey[conceptKey] || new Set();
            const info = conceptInfo[conceptKey];
            const isInverted = info.isInverted;

            // Per-concept threshold check
            const conceptResponseCount = scores.length;
            const conceptDistinctDayCount = distinctDates.size;
            const hasSufficientData = timeWindow === '24h'
                ? conceptResponseCount >= MIN_RESPONSES_24H
                : conceptDistinctDayCount >= MIN_DISTINCT_DAYS_7D;

            let avg = 0, min = 0, max = 0, count = 0, trend = 'stable_avg';

            if (scores.length > 0) {
                avg = average(scores);
                min = Math.min(...scores);
                max = Math.max(...scores);
                count = scores.length;
                trend = calculateTrend(scores, isInverted);
            }

            const annotationText = generateAnnotationText(conceptKey, trend, avg, timeWindow, isInverted);
            const annotationTextLLM = generateAnnotationTextLLM(
                conceptKey, info.title, trend, avg, min, max, count, timeWindow, isInverted
            );

            annotations.push({
                userId,
                conceptKey,
                timeWindow,
                avgScore: avg,
                minScore: min,
                maxScore: max,
                responseCount: count,
                trend,
                isInverted,
                annotationText,
                annotationTextLLM,
                hasSufficientData,
                distinctDayCount: timeWindow === '7d' ? conceptDistinctDayCount : null
            });
        }
    }

    // Upsert all annotations
    for (const a of annotations) {
        await pool.query(
            `INSERT INTO public.srl_annotations 
        (user_id, concept_key, time_window, avg_score, min_score, max_score, 
         response_count, trend, is_inverted, has_sufficient_data, distinct_day_count,
         annotation_text, annotation_text_llm, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (user_id, concept_key, time_window) 
       DO UPDATE SET 
         avg_score = EXCLUDED.avg_score,
         min_score = EXCLUDED.min_score,
         max_score = EXCLUDED.max_score,
         response_count = EXCLUDED.response_count,
         trend = EXCLUDED.trend,
         is_inverted = EXCLUDED.is_inverted,
         has_sufficient_data = EXCLUDED.has_sufficient_data,
         distinct_day_count = EXCLUDED.distinct_day_count,
         annotation_text = EXCLUDED.annotation_text,
         annotation_text_llm = EXCLUDED.annotation_text_llm,
         computed_at = NOW()`,
            [a.userId, a.conceptKey, a.timeWindow, a.avgScore, a.minScore, a.maxScore,
            a.responseCount, a.trend, a.isInverted, a.hasSufficientData, a.distinctDayCount,
            a.annotationText, a.annotationTextLLM]
        );
    }

    return annotations;
}

/**
 * Extract and save individual SRL responses from questionnaire submission
 * 
 * @param {object} pool - Database connection pool
 * @param {string} questionnaireId - Questionnaire result ID
 * @param {string} userId - User ID
 * @param {object} answers - JSONB answers object
 * @param {Date} submittedAt - Submission timestamp
 */
async function saveResponses(pool, questionnaireId, userId, answers, submittedAt) {
    const conceptKeys = Object.keys(CONCEPT_SHORT_NAMES);

    for (const key of conceptKeys) {
        const score = answers[key];
        if (score !== undefined && score !== null) {
            const numScore = Number(score);
            if (!isNaN(numScore) && numScore >= 1 && numScore <= 5) {
                await pool.query(
                    `INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (questionnaire_id, concept_key) 
           DO UPDATE SET score = EXCLUDED.score, submitted_at = EXCLUDED.submitted_at`,
                    [userId, questionnaireId, key, numScore, submittedAt]
                );
            }
        }
    }
}

/**
 * Get annotations for a user (for chatbot/display)
 * 
 * @param {object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string} timeWindow - '24h' or '7d' (optional, returns both if not specified)
 * @param {boolean} forLLM - If true, returns LLM-formatted text
 */
async function getAnnotations(pool, userId, timeWindow = null, forLLM = false) {
    let query = `SELECT * FROM public.srl_annotations WHERE user_id = $1`;
    const params = [userId];

    if (timeWindow) {
        query += ` AND time_window = $2`;
        params.push(timeWindow);
    }

    query += ` ORDER BY concept_key, time_window`;

    const { rows } = await pool.query(query, params);

    return rows.map(row => ({
        conceptKey: row.concept_key,
        timeWindow: row.time_window,
        avgScore: parseFloat(row.avg_score) || 0,
        minScore: row.min_score,
        maxScore: row.max_score,
        responseCount: row.response_count,
        trend: row.trend,
        isInverted: row.is_inverted,
        hasSufficientData: row.has_sufficient_data,
        distinctDayCount: row.distinct_day_count,
        text: forLLM ? row.annotation_text_llm : row.annotation_text,
        computedAt: row.computed_at
    }));
}

/**
 * Format annotations for chatbot prompt
 * Returns a formatted string with all annotations for the Prompt Assembler
 */
async function getAnnotationsForChatbot(pool, userId) {
    const annotations = await getAnnotations(pool, userId, null, true);

    if (annotations.length === 0) {
        return 'No questionnaire data available for this student.';
    }

    // Group by time window
    const by24h = annotations.filter(a => a.timeWindow === '24h');
    const by7d = annotations.filter(a => a.timeWindow === '7d');

    let result = '## Student Self-Regulated Learning Status\n\n';

    if (by24h.length > 0) {
        result += '### Last 24 Hours:\n';
        by24h.forEach(a => {
            result += `- ${a.text}\n`;
        });
        result += '\n';
    }

    if (by7d.length > 0) {
        result += '### Past 7 Days:\n';
        by7d.forEach(a => {
            result += `- ${a.text}\n`;
        });
    }

    return result;
}

export {
    calculateTrend,
    computeAnnotations,
    saveResponses,
    getAnnotations,
    getAnnotationsForChatbot,
    INVERTED_CONCEPTS,
    CONCEPT_SHORT_NAMES
};
