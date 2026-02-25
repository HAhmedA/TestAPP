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
 * Pre-sleep thresholds (screen time before bed)
 * Determines pre-sleep screen exposure
 */
const PRE_SLEEP_THRESHOLDS = {
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
 * Evaluate pre-sleep screen use
 * @param {Object} session - Screen time session data
 * @returns {Object} - Judgment object
 */
function evaluatePreSleep(session) {
    const preSleepMinutes = session.late_night_screen_minutes;

    if (preSleepMinutes < PRE_SLEEP_THRESHOLDS.minimal) {
        return {
            judgment_key: 'pre_sleep_minimal',
            severity: 'ok',
            explanation: 'Minimal pre-sleep screen use',
            explanation_llm: `Pre-sleep screen use was minimal (${preSleepMinutes} minutes before bed). Avoiding screens before bed supports better sleep quality and circadian rhythm.`
        };
    }

    if (preSleepMinutes <= PRE_SLEEP_THRESHOLDS.some) {
        return {
            judgment_key: 'pre_sleep_some',
            severity: 'warning',
            explanation: 'Some pre-sleep screen activity',
            explanation_llm: `There was ${preSleepMinutes} minutes of screen time before bed. Pre-sleep screen exposure can interfere with sleep onset. Consider reducing screen use in the hour before bed.`
        };
    }

    // > some threshold = high
    return {
        judgment_key: 'pre_sleep_high',
        severity: 'poor',
        explanation: 'High pre-sleep screen use',
        explanation_llm: `High pre-sleep screen use (${preSleepMinutes} minutes before bed) can significantly disrupt sleep quality. Blue light exposure suppresses melatonin production. Try using night mode and setting a screen curfew at least 1 hour before bed.`
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
        { domain: 'pre_sleep', ...evaluatePreSleep(session) }
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
         (user_id, avg_total_minutes, avg_longest_session, avg_late_night_minutes, sessions_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           avg_total_minutes = EXCLUDED.avg_total_minutes,
           avg_longest_session = EXCLUDED.avg_longest_session,
           avg_late_night_minutes = EXCLUDED.avg_late_night_minutes,
           sessions_count = EXCLUDED.sessions_count,
           computed_at = NOW()`,
        [userId, stats.avg_total, stats.avg_longest, stats.avg_late_night, stats.sessions_count]
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
/**
 * Get formatted screen time analysis for chatbot prompt.
 * Cluster-aware, baseline-free: factual description + peer context (internal only)
 * + today-vs-yesterday comparison.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted markdown for prompt assembly
 */
async function getJudgmentsForChatbot(pool, userId) {
    // Fetch last 8 days of screen time sessions
    const { rows: sessions } = await pool.query(
        `SELECT session_date,
                total_screen_minutes, longest_continuous_session, late_night_screen_minutes
         FROM public.screen_time_sessions
         WHERE user_id = $1
         ORDER BY session_date DESC
         LIMIT 8`,
        [userId]
    );

    if (sessions.length === 0) {
        return 'No screen time data available for this student.';
    }

    // Fetch peer cluster context (if available)
    const { rows: clusterRows } = await pool.query(
        `SELECT uca.percentile_position, pc.p5, pc.p50, pc.p95
         FROM public.user_cluster_assignments uca
         JOIN public.peer_clusters pc
           ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
         WHERE uca.user_id = $1 AND uca.concept_id = 'screen_time'`,
        [userId]
    );

    const recent = sessions[0];
    const previous = sessions[1] || null;

    const toMin = (m) => m != null ? `${Math.round(m)} min` : 'N/A';
    const toHours = (m) => m != null ? `${(m / 60).toFixed(1)}h` : 'N/A';

    let result = '## Screen Time Analysis\n\n';

    // Internal peer context block (for LLM calibration only)
    if (clusterRows.length > 0) {
        const c = clusterRows[0];
        const pct = c.percentile_position != null ? Math.round(parseFloat(c.percentile_position)) : null;
        result += `[Internal context — do not share with student]\n`;
        result += `Peer context: Typical daily screen time for students with similar usage patterns is `;
        result += `${toHours(c.p5)}–${toHours(c.p95)}, median ${toHours(c.p50)}. `;
        if (pct != null) {
            result += `Student is at the ${pct}th percentile (lower = less screen time = better for this metric).\n\n`;
        } else {
            result += '\n\n';
        }
    }

    // Most recent day
    result += `### Yesterday (${recent.session_date}):\n`;
    result += `- Total screen time: ${toHours(recent.total_screen_minutes)}`;
    if (previous) {
        const diff = recent.total_screen_minutes - previous.total_screen_minutes;
        result += ` (${diff > 0 ? '+' : ''}${toHours(Math.abs(diff))} vs. day before: ${toHours(previous.total_screen_minutes)})`;
    }
    result += '\n';
    result += `- Longest continuous session: ${toMin(recent.longest_continuous_session)}`;
    if (previous) {
        const diff = recent.longest_continuous_session - previous.longest_continuous_session;
        result += ` (${diff > 0 ? 'longer' : 'shorter'} than previous: ${toMin(previous.longest_continuous_session)})`;
    }
    result += '\n';
    result += `- Screen time before sleep: ${toMin(recent.late_night_screen_minutes)}`;
    if (previous) {
        const diff = recent.late_night_screen_minutes - previous.late_night_screen_minutes;
        result += ` (${diff > 0 ? 'more' : 'less'} than previous night: ${toMin(previous.late_night_screen_minutes)})`;
    }
    result += '\n';

    // Weekly trend
    if (sessions.length > 1) {
        const avgTotal = sessions.reduce((s, r) => s + (r.total_screen_minutes || 0), 0) / sessions.length;
        const avgPreSleep = sessions.reduce((s, r) => s + (r.late_night_screen_minutes || 0), 0) / sessions.length;
        result += `\n### Past ${sessions.length} days:\n`;
        result += `- Average screen time: ${toHours(avgTotal)}/day\n`;
        result += `- Average pre-sleep usage: ${toMin(avgPreSleep)}/night\n`;
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
 * Get cluster-based scores for scoring aggregation
 * Uses PGMoE clustering + percentile scoring instead of Z-scores
 */
async function getRawScoresForScoring(pool, userId) {
    const { computeClusterScores } = await import('../scoring/clusterPeerService.js');
    const clusterResult = await computeClusterScores(pool, 'screen_time', userId);

    if (!clusterResult) return [];
    if (clusterResult.coldStart) return [{ coldStart: true }];
    if (!clusterResult.domains) return [];

    // Fetch judgment labels for the most recent session
    const { rows } = await pool.query(
        `SELECT stj.domain, stj.explanation
         FROM public.screen_time_judgments stj
         JOIN public.screen_time_sessions sts ON stj.session_id = sts.id
         WHERE stj.user_id = $1
         ORDER BY sts.session_date DESC LIMIT 3`,
        [userId]
    );
    const judgmentMap = {};
    rows.forEach(j => judgmentMap[j.domain] = j.explanation);

    return clusterResult.domains.map(r => ({
        ...r,
        label: judgmentMap[r.domain] || r.categoryLabel,
        clusterLabel: clusterResult.clusterLabel,
        dialMin: clusterResult.dialMin,
        dialCenter: clusterResult.dialCenter,
        dialMax: clusterResult.dialMax
    }));
}

// Keep old function for backwards compatibility
async function getSeveritiesForScoring(pool, userId) {
    const rawScores = await getRawScoresForScoring(pool, userId);
    return rawScores.map(r => ({
        domain: r.domain,
        severity: r.category === 'very_good' ? 'ok' : r.category === 'good' ? 'warning' : 'poor'
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
    evaluatePreSleep,

    // Thresholds (for testing/configuration)
    VOLUME_THRESHOLDS,
    DISTRIBUTION_THRESHOLDS,
    PRE_SLEEP_THRESHOLDS
};


