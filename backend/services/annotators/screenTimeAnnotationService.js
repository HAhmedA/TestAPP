// Screen Time Annotation Service
// Rule-based computation engine that generates human-readable screen time annotations
// Modeled after sleepJudgmentService.js

// =============================================================================
// THRESHOLD CONFIGURATION (Configurable, no magic numbers)
// =============================================================================

/**
 * Volume thresholds (as percentage of baseline)
 * < 70% = low, 70-110% = moderate, 110-140% = high, > 140% = excessive
 */
const VOLUME_THRESHOLDS = {
    low: 0.70,
    moderate: 1.10,
    high: 1.40
};

/**
 * Distribution thresholds (longest session in minutes)
 * Determines if usage is balanced or concentrated in long sessions
 */
const DISTRIBUTION_THRESHOLDS = {
    balanced: 45,       // < 45 min = balanced
    moderate: 90        // 45-90 = moderate, > 90 = extended
};

/**
 * Late-night thresholds (minutes after 10 PM)
 * Determines late-night screen exposure
 */
const LATE_NIGHT_THRESHOLDS = {
    minimal: 15,        // < 15 min = minimal
    some: 45            // 15-45 = some, > 45 = high
};

// =============================================================================
// JUDGMENT DOMAIN EVALUATORS
// =============================================================================

/**
 * Evaluate screen time volume relative to baseline
 * @param {Object} session - Screen time session data
 * @param {Object} baseline - User's baseline metrics
 * @returns {Object} - Judgment object
 */
function evaluateVolume(session, baseline) {
    const ratio = session.total_screen_minutes / baseline.avg_total_minutes;

    if (ratio < VOLUME_THRESHOLDS.low) {
        return {
            judgment_key: 'screen_time_low',
            severity: 'ok',
            explanation: 'Screen time was low',
            explanation_llm: `Screen time was low (${session.total_screen_minutes} minutes, only ${Math.round(ratio * 100)}% of the usual ${Math.round(baseline.avg_total_minutes)} minutes). This controlled usage suggests good digital habits and time management.`
        };
    }

    if (ratio < VOLUME_THRESHOLDS.moderate) {
        return {
            judgment_key: 'screen_time_moderate',
            severity: 'ok',
            explanation: 'Screen time was moderate',
            explanation_llm: `Screen time was moderate (${session.total_screen_minutes} minutes, ${Math.round(ratio * 100)}% of the usual ${Math.round(baseline.avg_total_minutes)} minutes). This balanced approach to screen usage is healthy.`
        };
    }

    if (ratio < VOLUME_THRESHOLDS.high) {
        return {
            judgment_key: 'screen_time_high',
            severity: 'warning',
            explanation: 'Screen time was high',
            explanation_llm: `Screen time was high (${session.total_screen_minutes} minutes, ${Math.round(ratio * 100)}% of the usual ${Math.round(baseline.avg_total_minutes)} minutes). Consider taking breaks and balancing screen time with other activities.`
        };
    }

    // ratio >= high threshold = excessive
    return {
        judgment_key: 'screen_time_excessive',
        severity: 'poor',
        explanation: 'Screen time was excessive',
        explanation_llm: `Screen time was excessive (${session.total_screen_minutes} minutes, ${Math.round(ratio * 100)}% of the usual ${Math.round(baseline.avg_total_minutes)} minutes). Extended screen exposure can affect sleep, focus, and wellbeing. Try setting screen time limits.`
    };
}

/**
 * Evaluate screen time distribution (session patterns)
 * @param {Object} session - Screen time session data
 * @returns {Object} - Judgment object
 */
function evaluateDistribution(session) {
    const longestSession = session.longest_continuous_session;

    if (longestSession < DISTRIBUTION_THRESHOLDS.balanced) {
        return {
            judgment_key: 'screen_usage_balanced',
            severity: 'ok',
            explanation: 'Screen usage was balanced',
            explanation_llm: `Screen usage was balanced with the longest session being ${longestSession} minutes. Short, focused sessions indicate good self-regulation and breaks between screen use.`
        };
    }

    if (longestSession <= DISTRIBUTION_THRESHOLDS.moderate) {
        return {
            judgment_key: 'screen_usage_moderate_sessions',
            severity: 'warning',
            explanation: 'Screen usage occurred in moderate sessions',
            explanation_llm: `Screen usage included a ${longestSession}-minute continuous session. While not concerning, remember to take regular breaks during extended screen time.`
        };
    }

    // > moderate threshold = extended
    return {
        judgment_key: 'screen_usage_extended',
        severity: 'poor',
        explanation: 'Screen usage occurred in long sessions',
        explanation_llm: `Screen usage included an extended ${longestSession}-minute continuous session. Long, uninterrupted screen time can lead to eye strain and reduced productivity. Consider the 20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds.`
    };
}

/**
 * Evaluate late-night screen use
 * @param {Object} session - Screen time session data
 * @returns {Object} - Judgment object
 */
function evaluateLateNight(session) {
    const lateNightMinutes = session.late_night_screen_minutes;

    if (lateNightMinutes < LATE_NIGHT_THRESHOLDS.minimal) {
        return {
            judgment_key: 'late_night_minimal',
            severity: 'ok',
            explanation: 'Minimal late-night screen use',
            explanation_llm: `Late-night screen use was minimal (${lateNightMinutes} minutes after 10 PM). Avoiding screens before bed supports better sleep quality and circadian rhythm.`
        };
    }

    if (lateNightMinutes <= LATE_NIGHT_THRESHOLDS.some) {
        return {
            judgment_key: 'late_night_some',
            severity: 'warning',
            explanation: 'Some late-night screen activity',
            explanation_llm: `There was ${lateNightMinutes} minutes of screen time after 10 PM. Late-night screen exposure can interfere with sleep onset. Consider reducing screen use in the hour before bed.`
        };
    }

    // > some threshold = high
    return {
        judgment_key: 'late_night_high',
        severity: 'poor',
        explanation: 'High late-night screen use',
        explanation_llm: `High late-night screen use (${lateNightMinutes} minutes after 10 PM) can significantly disrupt sleep quality. Blue light exposure suppresses melatonin production. Try using night mode and setting a screen curfew at least 1 hour before bed.`
    };
}

// =============================================================================
// MAIN COMPUTATION FUNCTIONS
// =============================================================================

/**
 * Compute and store all judgments for a screen time session
 * @param {Object} pool - Database connection pool
 * @param {string} sessionId - Screen time session ID
 * @returns {Array} - Array of judgment objects
 */
async function computeJudgments(pool, sessionId) {
    // Get the session
    const sessionResult = await pool.query(
        `SELECT * FROM public.screen_time_sessions WHERE id = $1`,
        [sessionId]
    );

    if (sessionResult.rows.length === 0) {
        throw new Error(`Screen time session ${sessionId} not found`);
    }

    const session = sessionResult.rows[0];
    const userId = session.user_id;

    // Get or create baseline
    let baseline = await getOrCreateBaseline(pool, userId);

    // Compute all judgments
    const judgments = [
        { domain: 'volume', ...evaluateVolume(session, baseline) },
        { domain: 'distribution', ...evaluateDistribution(session) },
        { domain: 'late_night', ...evaluateLateNight(session) }
    ];

    // Store judgments
    for (const judgment of judgments) {
        await pool.query(
            `INSERT INTO public.screen_time_judgments 
             (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (session_id, domain)
             DO UPDATE SET
               judgment_key = EXCLUDED.judgment_key,
               severity = EXCLUDED.severity,
               explanation = EXCLUDED.explanation,
               explanation_llm = EXCLUDED.explanation_llm,
               computed_at = NOW()`,
            [userId, sessionId, judgment.domain, judgment.judgment_key, judgment.severity, judgment.explanation, judgment.explanation_llm]
        );
    }

    return judgments;
}

/**
 * Get or create baseline for a user
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Object} - Baseline object
 */
async function getOrCreateBaseline(pool, userId) {
    const { rows } = await pool.query(
        `SELECT * FROM public.screen_time_baselines WHERE user_id = $1`,
        [userId]
    );

    if (rows.length > 0) {
        return rows[0];
    }

    // Create default baseline
    await pool.query(
        `INSERT INTO public.screen_time_baselines (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );

    const result = await pool.query(
        `SELECT * FROM public.screen_time_baselines WHERE user_id = $1`,
        [userId]
    );

    return result.rows[0];
}

/**
 * Recompute baseline from recent sessions
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} days - Number of days to include (default 7)
 */
async function recomputeBaseline(pool, userId, days = 7) {
    const { rows } = await pool.query(
        `SELECT 
           AVG(total_screen_minutes) as avg_total,
           AVG(longest_continuous_session) as avg_longest,
           AVG(late_night_screen_minutes) as avg_late_night,
           AVG(number_of_screen_sessions) as avg_sessions,
           COUNT(*) as sessions_count
         FROM public.screen_time_sessions
         WHERE user_id = $1 AND session_date >= CURRENT_DATE - INTERVAL '${days} days'`,
        [userId]
    );

    if (rows.length === 0 || rows[0].sessions_count === 0) {
        return; // Keep default baseline
    }

    const stats = rows[0];

    await pool.query(
        `INSERT INTO public.screen_time_baselines 
         (user_id, avg_total_minutes, avg_longest_session, avg_late_night_minutes, avg_session_count, sessions_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           avg_total_minutes = EXCLUDED.avg_total_minutes,
           avg_longest_session = EXCLUDED.avg_longest_session,
           avg_late_night_minutes = EXCLUDED.avg_late_night_minutes,
           avg_session_count = EXCLUDED.avg_session_count,
           sessions_count = EXCLUDED.sessions_count,
           computed_at = NOW()`,
        [userId, stats.avg_total, stats.avg_longest, stats.avg_late_night, stats.avg_sessions, stats.sessions_count]
    );
}

// =============================================================================
// CHATBOT INTEGRATION FUNCTIONS
// =============================================================================

/**
 * Get formatted screen time judgments for chatbot prompt
 * Similar to getJudgmentsForChatbot in sleepJudgmentService.js
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {string} - Formatted markdown for prompt assembly
 */
async function getJudgmentsForChatbot(pool, userId) {
    // Get recent judgments (last 7 days)
    const { rows: judgments } = await pool.query(
        `SELECT stj.*, sts.session_date
         FROM public.screen_time_judgments stj
         JOIN public.screen_time_sessions sts ON stj.session_id = sts.id
         WHERE stj.user_id = $1 AND sts.session_date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY sts.session_date DESC, stj.domain`,
        [userId]
    );

    if (judgments.length === 0) {
        return 'No screen time data available for this student.';
    }

    // Group by recency
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const last24h = judgments.filter(j => {
        const sessionDate = new Date(j.session_date);
        const diffDays = Math.floor((today - sessionDate) / (1000 * 60 * 60 * 24));
        return diffDays <= 1;
    });

    const last7d = judgments;

    let result = '## Screen Time Analysis\n\n';

    // Most recent day
    if (last24h.length > 0) {
        result += '### Yesterday:\n';
        // Group by unique session
        const recentSession = last24h.filter(j => j.session_date === last24h[0].session_date);
        recentSession.forEach(j => {
            result += `- ${j.explanation_llm}\n`;
        });
        result += '\n';
    }

    // Weekly summary (aggregate severity counts)
    const severityCounts = { ok: 0, warning: 0, poor: 0 };
    last7d.forEach(j => severityCounts[j.severity]++);

    const totalJudgments = last7d.length;
    const uniqueDays = new Set(last7d.map(j => j.session_date)).size;

    if (uniqueDays > 1) {
        result += `### Past 7 Days (${uniqueDays} days tracked):\n`;

        if (severityCounts.poor > 0) {
            const poorJudgments = last7d.filter(j => j.severity === 'poor');
            const poorDomains = [...new Set(poorJudgments.map(j => j.domain))];
            result += `- Concerns in: ${poorDomains.join(', ')}\n`;
        }

        if (severityCounts.warning > 0) {
            const warningJudgments = last7d.filter(j => j.severity === 'warning');
            const warningDomains = [...new Set(warningJudgments.map(j => j.domain))];
            result += `- Minor issues with: ${warningDomains.join(', ')}\n`;
        }

        if (severityCounts.ok > totalJudgments * 0.7) {
            result += `- Overall screen time habits are healthy\n`;
        } else if (severityCounts.poor > totalJudgments * 0.3) {
            result += `- Screen time patterns could use improvement\n`;
        }
    }

    return result;
}

/**
 * Check if a user has any screen time data
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function hasScreenTimeData(pool, userId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM public.screen_time_sessions WHERE user_id = $1`,
        [userId]
    );
    return parseInt(rows[0].count) > 0;
}

// =============================================================================
// SCORING INTEGRATION
// =============================================================================

/**
 * Get raw scores for scoring aggregation (0-100 per aspect)
 * Uses actual session data to calculate continuous scores
 * Lower screen time = higher score (inverted - less is better)
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Array<{domain: string, score: number}>>}
 */
async function getRawScoresForScoring(pool, userId) {
    const { rows } = await pool.query(
        `SELECT sts.id as session_id, sts.total_screen_minutes, sts.baseline_screen_minutes,
                sts.longest_continuous_session, sts.late_night_screen_minutes,
                sts.number_of_screen_sessions
         FROM public.screen_time_sessions sts
         WHERE sts.user_id = $1
         ORDER BY sts.session_date DESC
         LIMIT 1`,
        [userId]
    );

    if (rows.length === 0) return [];

    const session = rows[0];
    const baseline = session.baseline_screen_minutes || 300; // 5h default

    // Volume score: Inverted - at/below baseline = 100, above = decreasing
    // 100% of baseline = 100 points, 150% = 50 points, 200%+ = 0 points
    const volumeRatio = session.total_screen_minutes / baseline;
    let volumeScore;
    if (volumeRatio <= 1.0) {
        volumeScore = 100;
    } else {
        // Linear decrease from 100 to 0 as ratio goes from 1.0 to 2.0
        volumeScore = Math.max(0, 100 - (volumeRatio - 1) * 100);
    }

    // Distribution score: Shorter continuous sessions = better
    // 30 min or less = 100, 60 min = 80, 90 min = 60, 120+ = penalty
    const longestSession = session.longest_continuous_session;
    let distributionScore;
    if (longestSession <= 30) {
        distributionScore = 100;
    } else if (longestSession <= 120) {
        distributionScore = 100 - (longestSession - 30) * (40 / 90); // Scale 100->60
    } else {
        distributionScore = Math.max(0, 60 - (longestSession - 120) * 0.5);
    }

    // Late night score: Less late night = better
    // 0 min = 100, 30 min = 70, 60 min = 40, 90+ = low
    const lateNightMinutes = session.late_night_screen_minutes;
    const lateNightScore = Math.max(0, 100 - lateNightMinutes * 1.0);

    // Fetch judgments for labels
    const { rows: judgments } = await pool.query(
        `SELECT domain, explanation FROM public.screen_time_judgments WHERE session_id = $1`,
        [session.session_id]
    );
    const judgmentMap = {};
    judgments.forEach(j => judgmentMap[j.domain] = j.explanation);

    return [
        { domain: 'volume', score: Math.round(volumeScore * 100) / 100, label: judgmentMap['volume'] },
        { domain: 'distribution', score: Math.round(distributionScore * 100) / 100, label: judgmentMap['distribution'] },
        { domain: 'late_night', score: Math.round(lateNightScore * 100) / 100, label: judgmentMap['late_night'] }
    ];
}

// Keep old function for backwards compatibility
async function getSeveritiesForScoring(pool, userId) {
    const rawScores = await getRawScoresForScoring(pool, userId);
    return rawScores.map(r => ({
        domain: r.domain,
        severity: r.score >= 75 ? 'ok' : r.score >= 40 ? 'warning' : 'poor'
    }));
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Main computation
    computeJudgments,
    recomputeBaseline,
    getOrCreateBaseline,

    // Chatbot integration
    getJudgmentsForChatbot,
    hasScreenTimeData,

    // Scoring integration
    getSeveritiesForScoring,
    getRawScoresForScoring,

    // Individual evaluators (for testing)
    evaluateVolume,
    evaluateDistribution,
    evaluateLateNight,

    // Thresholds (for testing/configuration)
    VOLUME_THRESHOLDS,
    DISTRIBUTION_THRESHOLDS,
    LATE_NIGHT_THRESHOLDS
};


