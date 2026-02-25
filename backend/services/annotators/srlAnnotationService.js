// SRL Annotation Service
// Computes statistics, trends, and generates annotation text for each SRL concept

// Minimum responses required to show trends

const MIN_DISTINCT_DAYS_7D = 3;  // At least 3 different days for 7d

// Concepts that are inverted (high score = bad outcome)
const INVERTED_CONCEPTS = ['anxiety'];

// Short display names for UI (concept_key -> short name)
const CONCEPT_SHORT_NAMES = {
    efficiency: 'Efficiency',
    importance: 'Perceived Importance',
    tracking: 'Progress Tracking',
    clarity: 'Task Clarity',
    effort: 'Effort',
    focus: 'Focus',
    help_seeking: 'Help Seeking',
    community: 'Peer Learning',
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
    fluctuating: 'fluctuating',
    stable_high: 'consistently high',
    stable_avg: 'stable',
    stable_low: 'consistently low'
};

// Trend descriptions for inverted concepts (e.g., anxiety)
const TREND_DESCRIPTIONS_INVERTED = {
    improving: 'decreasing (which is good)',
    declining: 'increasing (which needs attention)',
    fluctuating: 'fluctuating',
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
 * Also detects fluctuating patterns when data oscillates significantly
 * 
 * @param {number[]} scores - Array of scores in chronological order
 * @param {boolean} isInverted - If true, improving means scores going DOWN
 * @returns {string} - 'improving', 'declining', 'fluctuating', 'stable_high', 'stable_avg', 'stable_low'
 */
function calculateTrend(scores, isInverted = false) {
    if (scores.length === 0) {
        return 'stable_avg';
    }

    if (scores.length === 1) {
        return classifyStableLevel(scores[0]);
    }

    // Check for fluctuating pattern before other calculations
    // Fluctuating = significant direction changes AND high variance
    if (scores.length >= 3) {
        // Count direction changes
        let directionChanges = 0;
        for (let i = 1; i < scores.length - 1; i++) {
            const prevDelta = scores[i] - scores[i - 1];
            const nextDelta = scores[i + 1] - scores[i];
            // A direction change occurs when we go up then down, or down then up
            if ((prevDelta > 0 && nextDelta < 0) || (prevDelta < 0 && nextDelta > 0)) {
                directionChanges++;
            }
        }

        // Calculate variance to ensure the fluctuation is significant
        const avg = average(scores);
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
        const range = Math.max(...scores) - Math.min(...scores);

        // If there's at least one direction change and the range is >= 2 (significant oscillation)
        // OR if variance is high relative to the possible range (0.5 threshold for 1-5 scale)
        if (directionChanges >= 1 && range >= 2) {
            return 'fluctuating';
        }
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
 * Generate a complex/nuanced description combining Trend and Latest vs Comparison
 * 
 * @param {string} trend - 'improving', 'declining', 'fluctuating', 'stable_high', etc.
 * @param {number|null} latestScore - Most recent score
 * @param {number|null} previousAvg - Average of previous scores (excluding latest)
 * @param {boolean} isInverted - True if high score is bad (e.g. anxiety)
 */
function generateComplexDescription(trend, latestScore, previousAvg, isInverted) {
    // Fallback if we don't have comparative data
    const trendDescriptions = isInverted ? TREND_DESCRIPTIONS_INVERTED : TREND_DESCRIPTIONS;
    const baseTrendText = trendDescriptions[trend] || trend;

    if (latestScore === null || previousAvg === null) {
        return `Your responses have been ${baseTrendText}.`;
    }

    const diff = latestScore - previousAvg;
    const threshold = 0.5; // Significance threshold

    // Determine direction of today's score vs average
    let direction = "consistent";
    if (diff > threshold) direction = "higher";
    if (diff < -threshold) direction = "lower";

    // Helper to determine if a specific direction is "Good" or "Bad" for this concept
    const isHigherGood = !isInverted;
    const isDirectionGood = (direction === "higher" && isHigherGood) || (direction === "lower" && !isHigherGood);

    // MATRIX LOGIC
    // 1. IMPROVING TREND
    if (trend === 'improving') {
        if (direction === "consistent") {
            return `You are on an improving trend, with today's score consistent with that progress.`;
        }
        if (isDirectionGood) {
            // Trend is improving AND today is even better
            return `You are on an upward trend, and today is another strong day (${latestScore} vs avg ${previousAvg.toFixed(1)}).`;
        } else {
            // Trend is improving BUT today is worse (Complexity!)
            return `You have been improving overall, despite a slight dip today (${latestScore} vs avg ${previousAvg.toFixed(1)}).`;
        }
    }

    // 2. DECLINING TREND
    if (trend === 'declining') {
        if (direction === "consistent") {
            return `You are seeing a declining trend, and today continues that pattern.`;
        }
        if (isDirectionGood) {
            // Trend is declining BUT today is better (Complexity!)
            return `You have been declining recently, but today shows a positive uptick (${latestScore} vs avg ${previousAvg.toFixed(1)}).`;
        } else {
            // Trend is declining AND today is even worse
            return `You are on a downward trend, and today confirms that struggle (${latestScore} vs avg ${previousAvg.toFixed(1)}).`;
        }
    }

    // 3. FLUCTUATING TREND
    if (trend === 'fluctuating') {
        if (direction === "consistent") return `Your responses have been fluctuating, though today is near your average.`;
        const dirText = direction === "higher" ? "higher" : "lower";
        return `Your responses have been fluctuating, and today is ${dirText} than usual (${latestScore} vs ${previousAvg.toFixed(1)}).`;
    }

    // 4. STABLE TRENDS
    if (trend.startsWith('stable')) {
        if (direction === "consistent") {
            return `Your responses have been ${baseTrendText}, and today matches your average.`;
        }
        // Stable but today is an outlier
        const dirText = direction === "higher" ? "higher" : "lower";
        return `Normally ${baseTrendText}, but today is ${dirText} than your average (${latestScore} vs ${previousAvg.toFixed(1)}).`;
    }

    // Default fallback
    return `Your responses have been ${baseTrendText}.`;
}

/**
 * Generate annotation text for UI display (short concept name)
 */
function generateAnnotationText(conceptKey, trend, avg, timeWindow, isInverted, latestScore = null, previousAvg = null) {
    const shortName = CONCEPT_SHORT_NAMES[conceptKey] || conceptKey;
    const desc = generateComplexDescription(trend, latestScore, previousAvg, isInverted);
    return desc;
}

/**
 * Generate annotation text for LLM/chatbot (full question title)
 * Handles different scenarios based on data sufficiency and comparison:
 * - Single response: Just show current value
 * - Multiple responses but insufficient for trend: Show average without trend
 * - Sufficient data: Full trend analysis + Latest vs Previous comparison
 */
function generateAnnotationTextLLM(conceptKey, fullTitle, trend, avg, min, max, count, timeWindow, isInverted, hasSufficientData = false, distinctDayCount = null, latestScore = null, previousAvg = null) {
    // Clean up the full title (remove trailing colon if present)
    // Use short name if available to save tokens
    const displayTitle = CONCEPT_SHORT_NAMES[conceptKey] || fullTitle;
    const cleanTitle = displayTitle.replace(/:$/, '');

    // Single response - just show the current value
    if (count === 1) {
        return `Regarding "${cleanTitle}": The student's most recent response is ${avg.toFixed(1)} out of 5.`;
    }

    // Multiple responses but insufficient data for trend analysis
    if (!hasSufficientData) {
        const period = 'recently';
        return `Regarding "${cleanTitle}": The student has responded ${count} times ${period}, ` +
            `averaging ${avg.toFixed(1)} out of 5 (range: ${min}-${max}). ` +
            `(More data needed for trend analysis)`;
    }

    // Sufficient data - Use Nuanced Description
    const complexDesc = generateComplexDescription(trend, latestScore, previousAvg, isInverted);

    return `Regarding "${cleanTitle}": ${complexDesc} ` +
        `Statistics: overall average ${avg.toFixed(1)}, min ${min}, max ${max} (based on ${count} responses over 7 days).`;
}

/**
 * Compute all annotations for a user
 * Called after each questionnaire submission
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

    const timeWindows = ['7d'];
    const annotations = [];

    for (const timeWindow of timeWindows) {
        const interval = '7 days';

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
            const hasSufficientData = conceptDistinctDayCount >= MIN_DISTINCT_DAYS_7D;

            let avg = 0, min = 0, max = 0, count = 0, trend = 'stable_avg';
            let latestScore = null, previousAvg = null;

            if (scores.length > 0) {
                avg = average(scores);
                min = Math.min(...scores);
                max = Math.max(...scores);
                count = scores.length;
                trend = calculateTrend(scores, isInverted);

                // LATEST vs BASELINE Calculation
                latestScore = scores[scores.length - 1]; // Last element is latest (sorted ASC)

                if (scores.length > 1) {
                    const previousScores = scores.slice(0, scores.length - 1);
                    previousAvg = average(previousScores);
                } else {
                    // Only 1 score exist, so previous avg is undefined/null
                    previousAvg = null;
                }
            }

            const annotationText = generateAnnotationText(conceptKey, trend, avg, timeWindow, isInverted, latestScore, previousAvg);
            const annotationTextLLM = generateAnnotationTextLLM(
                conceptKey, info.title, trend, avg, min, max, count, timeWindow, isInverted,
                hasSufficientData, timeWindow === '7d' ? conceptDistinctDayCount : null,
                latestScore, previousAvg
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
 * 
 * Logic:
 * - Only includes annotations that have actual response data (responseCount > 0)
 * - Shows 24h section if there are responses in the last 24 hours
 * - Shows 7d section ONLY if there are responses from more than 1 distinct day
 *   (to avoid duplication when all data is from today)
 */
/**
 * Get formatted SRL analysis for chatbot prompt.
 * Includes peer context block (internal only) for LLM calibration.
 * Factually describes the student's self-reported learning patterns.
 */
async function getAnnotationsForChatbot(pool, userId) {
    const annotations = await getAnnotations(pool, userId, null, true);

    // Filter out annotations with no actual data (responseCount === 0)
    const validAnnotations = annotations.filter(a => a.responseCount > 0);

    if (validAnnotations.length === 0) {
        return 'No questionnaire data available for this student.';
    }

    // Fetch SRL peer cluster context (if available)
    const { rows: clusterRows } = await pool.query(
        `SELECT uca.percentile_position, pc.p5, pc.p50, pc.p95
         FROM public.user_cluster_assignments uca
         JOIN public.peer_clusters pc
           ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
         WHERE uca.user_id = $1 AND uca.concept_id = 'srl'`,
        [userId]
    );

    let result = '## Student Self-Regulated Learning Status\n\n';

    // Internal peer context block (for LLM calibration only)
    if (clusterRows.length > 0) {
        const c = clusterRows[0];
        const pct = c.percentile_position != null ? Math.round(parseFloat(c.percentile_position)) : null;
        result += `[Internal context — do not share with student]\n`;
        result += `Peer context: Student is at the ${pct != null ? pct + 'th' : 'unknown'} percentile `;
        result += `among students with similar SRL patterns (scale 0–100, higher = stronger self-regulation).\n\n`;
    }

    // Show 7-day data (primary window)
    const by7d = validAnnotations.filter(a => a.timeWindow === '7d');
    if (by7d.length > 0) {
        result += '### Past 7 Days:\n';
        by7d.forEach(a => {
            result += `- ${a.text}\n`;
        });
    }

    return result;
}

/**
 * Check if a user has any actual SRL data (responseCount > 0)
 * Used to determine whether to call LLM or return a hardcoded prompt
 * 
 * @param {object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user has SRL data
 */
async function hasSRLData(pool, userId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM public.srl_responses WHERE user_id = $1`,
        [userId]
    );
    return parseInt(rows[0].count) > 0;
}

// =============================================================================
// SCORING INTEGRATION
// =============================================================================

/**
 * Get cluster-based scores for scoring aggregation
 * Uses PGMoE clustering + percentile scoring instead of Z-scores
 */
async function getRawScoresForScoring(pool, userId) {
    const { computeClusterScores } = await import('../scoring/clusterPeerService.js');
    const clusterResult = await computeClusterScores(pool, 'srl', userId);

    if (!clusterResult) return [];
    if (clusterResult.coldStart) return [{ coldStart: true }];
    if (!clusterResult.domains) return [];

    // Fetch annotation labels
    const { rows } = await pool.query(
        `SELECT concept_key, annotation_text
         FROM public.srl_annotations
         WHERE user_id = $1 AND time_window = '7d' AND response_count > 0
         ORDER BY concept_key`,
        [userId]
    );
    const labelMap = {};
    rows.forEach(r => labelMap[r.concept_key] = r.annotation_text);

    return clusterResult.domains.map(r => ({
        ...r,
        label: labelMap[r.domain] || r.categoryLabel,
        clusterLabel: clusterResult.clusterLabel,
        dialMin: clusterResult.dialMin,
        dialCenter: clusterResult.dialCenter,
        dialMax: clusterResult.dialMax
    }));
}

// Keep old function for backwards compatibility, but mark deprecated
async function getSeveritiesForScoring(pool, userId) {
    console.warn('getSeveritiesForScoring is deprecated, use getRawScoresForScoring');
    const rawScores = await getRawScoresForScoring(pool, userId);
    return rawScores.map(r => ({
        domain: r.domain,
        severity: r.category === 'very_good' ? 'ok' : r.category === 'good' ? 'warning' : 'poor'
    }));
}

export {
    calculateTrend,
    computeAnnotations,
    saveResponses,
    getAnnotations,
    getAnnotationsForChatbot,
    hasSRLData,
    getSeveritiesForScoring,
    getRawScoresForScoring,
    INVERTED_CONCEPTS,
    CONCEPT_SHORT_NAMES
};


