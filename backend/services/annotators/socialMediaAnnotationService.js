// Social Media Judgment Service
// Rule-based computation engine that generates human-readable social media judgments
// Modeled after sleepJudgmentService.js

// =============================================================================
// THRESHOLD CONFIGURATION
// =============================================================================

/**
 * Volume thresholds (minutes per day)
 */
const VOLUME_THRESHOLDS = {
    low: 30,        // < 30 min/day = low
    moderate: 90,   // 30-90 min = moderate
    high: 180       // 90-180 min = high, > 180 = excessive
};

/**
 * Frequency thresholds (checking behavior)
 * Determines improved/worsening focus based on interruption frequency
 */
const FREQUENCY_THRESHOLDS = {
    infrequent: 5,  // ≤ 5 sessions = infrequent
    moderate: 15    // 6-15 = moderate, > 15 = frequent
};

/**
 * Session style thresholds (average session length in minutes)
 * Determines if usage is purposeful (long/controlled) or fragmented (short bursts)
 */
const SESSION_STYLE_THRESHOLDS = {
    controlled: 10,  // avg < 10 min = short bursts/controlled
    moderate: 25     // 10-25 min = moderate, > 25 = long sessions
};

// =============================================================================
// JUDGMENT DOMAIN EVALUATORS
// =============================================================================

/**
 * Evaluate social media volume
 * @param {Object} session - Social media session data
 * @returns {Object} - Judgment object
 */
function evaluateVolume(session) {
    const minutes = session.total_social_minutes;

    if (minutes < VOLUME_THRESHOLDS.low) {
        return {
            judgment_key: 'social_low',
            severity: 'ok',
            explanation: 'Social media use was low',
            explanation_llm: `Social media use was low (${minutes} minutes). Minimal social media usage allows more time for study, rest, and face-to-face interactions.`
        };
    }

    if (minutes < VOLUME_THRESHOLDS.moderate) {
        return {
            judgment_key: 'social_moderate',
            severity: 'ok',
            explanation: 'Social media use was moderate',
            explanation_llm: `Social media use was moderate (${minutes} minutes). This level of engagement suggests a healthy balance between digital social connection and other responsibilities.`
        };
    }

    if (minutes < VOLUME_THRESHOLDS.high) {
        return {
            judgment_key: 'social_high',
            severity: 'warning',
            explanation: 'Social media use was high',
            explanation_llm: `Social media use was high (${minutes} minutes). Spending significant time on social platforms can reduce productivity and increase mental fatigue.`
        };
    }

    // >= high threshold = excessive
    return {
        judgment_key: 'social_excessive',
        severity: 'poor',
        explanation: 'Social media use was excessive',
        explanation_llm: `Social media use was excessive (${minutes} minutes, which is over 3 hours). This level of usage is often associated with reduced academic performance, sleep disruption, and increased anxiety.`
    };
}

/**
 * Evaluate checking frequency (focus impact)
 * @param {Object} session - Social media session data
 * @returns {Object} - Judgment object
 */
function evaluateFrequency(session) {
    const sessions = session.number_of_social_sessions;

    if (sessions <= FREQUENCY_THRESHOLDS.infrequent) {
        return {
            judgment_key: 'checking_infrequent',
            severity: 'ok',
            explanation: 'Infrequent social media checking',
            explanation_llm: `Social media checking was infrequent (${sessions} times). Fewer interruptions help maintain deep focus and sustained attention on tasks.`
        };
    }

    if (sessions <= FREQUENCY_THRESHOLDS.moderate) {
        return {
            judgment_key: 'checking_moderate',
            severity: 'warning',
            explanation: 'Moderate social media checking',
            explanation_llm: `Social media checking was moderate (${sessions} times). Frequent context switching between work and social media can increase cognitive load.`
        };
    }

    // > moderate threshold = frequent
    return {
        judgment_key: 'checking_frequent',
        severity: 'poor',
        explanation: 'Frequent social media checking',
        explanation_llm: `Social media checking was frequent (${sessions} times). High frequency of checking suggests a pattern of constant connectivity that fragments attention and prevents deep work.`
    };
}

/**
 * Evaluate session style (checking vs scrolling)
 * @param {Object} session - Social media session data
 * @returns {Object} - Judgment object
 */
function evaluateSessionStyle(session) {
    const avgLength = session.average_session_length;

    if (avgLength < SESSION_STYLE_THRESHOLDS.controlled) {
        return {
            judgment_key: 'sessions_controlled',
            severity: 'ok',
            explanation: 'Social media used in short bursts',
            explanation_llm: `Social media use primarily occurred in short bursts (avg ${Math.round(avgLength)} min).`
        };
    }

    if (avgLength <= SESSION_STYLE_THRESHOLDS.moderate) {
        return {
            judgment_key: 'sessions_moderate',
            severity: 'ok',
            explanation: 'Social media sessions were moderate length',
            explanation_llm: `Social media sessions were of moderate length (avg ${Math.round(avgLength)} min).`
        };
    }

    // > moderate threshold = long
    return {
        judgment_key: 'sessions_long',
        severity: 'warning',
        explanation: 'Long social media sessions',
        explanation_llm: `Social media engagement involved long sessions (avg ${Math.round(avgLength)} min). This pattern is typical of passive consumption or "scrolling" which can lead to time blindness.`
    };
}

// =============================================================================
// MAIN COMPUTATION FUNCTIONS
// =============================================================================

/**
 * Compute and store all judgments for a social media session
 * @param {Object} pool - Database connection pool
 * @param {string} sessionId - Social media session ID
 * @returns {Array} - Array of judgment objects
 */
async function computeJudgments(pool, sessionId) {
    // Get the session
    const sessionResult = await pool.query(
        `SELECT * FROM public.social_media_sessions WHERE id = $1`,
        [sessionId]
    );

    if (sessionResult.rows.length === 0) {
        throw new Error(`Social media session ${sessionId} not found`);
    }

    const session = sessionResult.rows[0];
    const userId = session.user_id;

    // Get or create baseline (needed for consistency, even if not used in all rules)
    let baseline = await getOrCreateBaseline(pool, userId);

    // Compute all judgments
    const judgments = [
        { domain: 'volume', ...evaluateVolume(session) },
        { domain: 'frequency', ...evaluateFrequency(session) },
        { domain: 'session_style', ...evaluateSessionStyle(session) }
    ];

    // Store judgments
    for (const judgment of judgments) {
        await pool.query(
            `INSERT INTO public.social_media_judgments 
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
        `SELECT * FROM public.social_media_baselines WHERE user_id = $1`,
        [userId]
    );

    if (rows.length > 0) {
        return rows[0];
    }

    // Create default baseline
    await pool.query(
        `INSERT INTO public.social_media_baselines (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );

    const result = await pool.query(
        `SELECT * FROM public.social_media_baselines WHERE user_id = $1`,
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
           AVG(total_social_minutes) as avg_total,
           AVG(number_of_social_sessions) as avg_sessions,
           AVG(average_session_length) as avg_length,
           AVG(late_night_social_minutes) as avg_late_night,
           COUNT(*) as sessions_count
         FROM public.social_media_sessions
         WHERE user_id = $1 AND session_date >= CURRENT_DATE - INTERVAL '${days} days'`,
        [userId]
    );

    if (rows.length === 0 || rows[0].sessions_count === 0) {
        return; // Keep default baseline
    }

    const stats = rows[0];

    await pool.query(
        `INSERT INTO public.social_media_baselines 
         (user_id, avg_total_minutes, avg_session_count, avg_session_length, avg_late_night_minutes, sessions_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           avg_total_minutes = EXCLUDED.avg_total_minutes,
           avg_session_count = EXCLUDED.avg_session_count,
           avg_session_length = EXCLUDED.avg_session_length,
           avg_late_night_minutes = EXCLUDED.avg_late_night_minutes,
           sessions_count = EXCLUDED.sessions_count,
           computed_at = NOW()`,
        [userId, stats.avg_total, stats.avg_sessions, stats.avg_length, stats.avg_late_night, stats.sessions_count]
    );
}

// =============================================================================
// CHATBOT INTEGRATION FUNCTIONS
// =============================================================================

/**
 * Get formatted social media judgments for chatbot prompt
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {string} - Formatted markdown for prompt assembly
 */
async function getJudgmentsForChatbot(pool, userId) {
    // Get recent judgments (last 7 days)
    const { rows: judgments } = await pool.query(
        `SELECT smj.*, sms.session_date
         FROM public.social_media_judgments smj
         JOIN public.social_media_sessions sms ON smj.session_id = sms.id
         WHERE smj.user_id = $1 AND sms.session_date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY sms.session_date DESC, smj.domain`,
        [userId]
    );

    if (judgments.length === 0) {
        return 'No social media data available for this student.';
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

    let result = '## Social Media Analysis\n\n';

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
            result += `- Problem areas: ${poorDomains.join(', ')}\n`;
        }

        if (severityCounts.warning > 0) {
            const warningJudgments = last7d.filter(j => j.severity === 'warning');
            const warningDomains = [...new Set(warningJudgments.map(j => j.domain))];
            result += `- Minor concerns: ${warningDomains.join(', ')}\n`;
        }

        if (severityCounts.ok > totalJudgments * 0.7) {
            result += `- Social media usage is largely under control\n`;
        } else if (severityCounts.poor > totalJudgments * 0.3) {
            result += `- Social media habits are interfering with wellbeing\n`;
        }
    }

    return result;
}

/**
 * Check if a user has any social media data
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function hasSocialMediaData(pool, userId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM public.social_media_sessions WHERE user_id = $1`,
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
 * Lower social media = higher score (inverted - less is better)
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Array<{domain: string, score: number}>>}
 */
async function getRawScoresForScoring(pool, userId) {
    const { rows } = await pool.query(
        `SELECT sms.id as session_id, sms.total_social_minutes, 
                COALESCE(smb.avg_total_minutes, 60) as baseline_social_minutes,
                sms.number_of_social_sessions as number_of_checks, 
                sms.average_session_length as avg_session_length
         FROM public.social_media_sessions sms
         LEFT JOIN public.social_media_baselines smb ON sms.user_id = smb.user_id
         WHERE sms.user_id = $1
         ORDER BY sms.session_date DESC
         LIMIT 1`,
        [userId]
    );

    if (rows.length === 0) return [];

    const session = rows[0];
    const baseline = session.baseline_social_minutes; // Already defaulted in query

    // Volume score: Inverted - at/below baseline = 100, above = decreasing
    const volumeRatio = session.total_social_minutes / baseline;
    let volumeScore;
    if (volumeRatio <= 1.0) {
        volumeScore = 100;
    } else {
        volumeScore = Math.max(0, 100 - (volumeRatio - 1) * 100);
    }

    // Frequency score: Fewer checks = better
    // 5 or fewer = 100, 10 = 75, 20 = 50, 30+ = low
    const checks = session.number_of_checks;
    let frequencyScore;
    if (checks <= 5) {
        frequencyScore = 100;
    } else if (checks <= 30) {
        frequencyScore = 100 - (checks - 5) * (60 / 25); // Scale from 100 to 40
    } else {
        frequencyScore = Math.max(0, 40 - (checks - 30) * 2);
    }

    // Session style score: Shorter average sessions = more mindful
    // 5 min avg = 100, 10 min = 80, 20 min = 50, 30+ = low
    const avgSession = session.avg_session_length;
    let sessionStyleScore;
    if (avgSession <= 5) {
        sessionStyleScore = 100;
    } else if (avgSession <= 30) {
        sessionStyleScore = 100 - (avgSession - 5) * (60 / 25);
    } else {
        sessionStyleScore = Math.max(0, 40 - (avgSession - 30) * 2);
    }

    // Fetch judgments for labels
    const { rows: judgments } = await pool.query(
        `SELECT domain, explanation FROM public.social_media_judgments WHERE session_id = $1`,
        [session.session_id]
    );
    const judgmentMap = {};
    judgments.forEach(j => judgmentMap[j.domain] = j.explanation);

    return [
        { domain: 'volume', score: Math.round(volumeScore * 100) / 100, label: judgmentMap['volume'] },
        { domain: 'frequency', score: Math.round(frequencyScore * 100) / 100, label: judgmentMap['frequency'] },
        { domain: 'session_style', score: Math.round(sessionStyleScore * 100) / 100, label: judgmentMap['session_style'] }
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
    hasSocialMediaData,

    // Scoring integration
    getSeveritiesForScoring,
    getRawScoresForScoring,

    // Individual evaluators (for testing)
    evaluateVolume,
    evaluateFrequency,
    evaluateSessionStyle,

    // Thresholds (for testing/configuration)
    VOLUME_THRESHOLDS,
    FREQUENCY_THRESHOLDS,
    SESSION_STYLE_THRESHOLDS
};


