// LMS Annotation Service
// Rule-based computation engine that generates human-readable LMS judgments
// Modeled after existing judgment services but evaluates per subject independently

// =============================================================================
// THRESHOLD CONFIGURATION
// =============================================================================

/**
 * LMS Evaluation Thresholds
 * Configurable values for all judgment rules
 */
const THRESHOLDS = {
    volume: {
        low: 0.70,     // < 70% of baseline
        high: 1.10     // > 110% of baseline
    },
    distribution: {
        condensed_sessions: 2,         // <= 2 sessions
        condensed_longest_min: 60,     // >= 60 min longest session
        spread_sessions_min: 3,        // >= 3 sessions
        spread_sessions_max: 5,        // <= 5 sessions
        spread_longest_max: 60,        // < 60 min
        fragmented_sessions_min: 6,    // > 5 sessions
        fragmented_avg_max: 10         // < 10 avg minutes
    },
    consistency: {
        consistent_days: 5,            // >= 5 days active
        somewhat_consistent_min: 3,    // 3-4 days active
        inconsistent_max: 2            // <= 2 days active
    },
    action_mix: {
        passive_ratio: 0.85,             // > 85% passive
        practice_min_active: 1,          // >= 1 active events
        balanced_passive_min: 0.50,      // 50%
        balanced_passive_max: 0.75       // 75%
    },
    practice_intensity: {
        low_max: 0,                      // 0 events
        moderate_min: 1,                 // 1-3 events
        moderate_max: 3,
        high_min: 4                      // >= 4 events
    },
    discussion: {
        low_max: 0,                      // 0 posts
        moderate_min: 1,                 // 1-2 posts
        moderate_max: 2,
        high_min: 3                      // >= 3 posts
    },
    session_quality: {
        focused_avg_min: 25,             // >= 25 min avg
        focused_longest_min: 45,         // >= 45 min longest
        short_total_max: 45,             // if total active < 45 min (implicit check in rules)
        short_avg_max: 10,               // < 10 min avg
        interrupted_avg_max: 10,         // < 10 min avg
        interrupted_sessions_min: 5      // >= 5 sessions
    }
};

// =============================================================================
// DOMAIN EVALUATORS
// =============================================================================

/**
 * DOMAIN 1: LMS Activity Volume (Per Subject)
 */
function evaluateActivityVolume(metrics, baseline) {
    if (baseline.baseline_active_minutes === 0) return { key: 'volume_low', label: 'LMS activity was low' };

    const ratio = metrics.total_active_minutes / baseline.baseline_active_minutes;

    if (ratio < THRESHOLDS.volume.low) {
        return {
            key: 'volume_low',
            label: 'LMS activity was low',
            variation: 'LMS activities are sparse'
        };
    }
    if (ratio <= THRESHOLDS.volume.high) {
        return {
            key: 'volume_moderate',
            label: 'LMS activity was moderate',
            variation: 'Limited engagement with this subject'
        };
    }
    return {
        key: 'volume_high',
        label: 'LMS activity was high',
        variation: 'Substantial LMS activity'
    };
}

/**
 * DOMAIN 2: Activity Distribution (Condensed vs Spread)
 */
function evaluateDistribution(metrics) {
    const sessions = metrics.number_of_sessions;
    const longest = metrics.longest_session_minutes;
    const avg = sessions > 0 ? metrics.total_active_minutes / sessions : 0;

    if (sessions <= THRESHOLDS.distribution.condensed_sessions && longest >= THRESHOLDS.distribution.condensed_longest_min) {
        return {
            key: 'dist_condensed',
            label: 'LMS activity was condensed',
            variation: 'Work occurred in one main block'
        };
    }
    if (sessions >= THRESHOLDS.distribution.spread_sessions_min && sessions <= THRESHOLDS.distribution.spread_sessions_max && longest < THRESHOLDS.distribution.spread_longest_max) {
        return {
            key: 'dist_spread',
            label: 'LMS activity was spread out',
            variation: 'Engagement was evenly distributed'
        };
    }
    if (sessions > THRESHOLDS.distribution.spread_sessions_max && avg < THRESHOLDS.distribution.fragmented_avg_max) {
        return {
            key: 'dist_fragmented',
            label: 'LMS activity was fragmented',
            variation: 'Many short study sessions'
        };
    }
    // Default fallback
    return {
        key: 'dist_spread',
        label: 'LMS activity was spread out',
        variation: 'Engagement was distributed'
    };
}

/**
 * DOMAIN 3: Consistency Over Time (Per Subject)
 * Note: Uses accumulated data for the period (e.g., 7 days)
 */
function evaluateConsistency(daysActive) {
    if (daysActive >= THRESHOLDS.consistency.consistent_days) {
        return {
            key: 'cons_consistent',
            label: 'LMS engagement was consistent',
            variation: 'Engagement occurred on most days'
        };
    }
    if (daysActive >= THRESHOLDS.consistency.somewhat_consistent_min) {
        return {
            key: 'cons_somewhat',
            label: 'LMS engagement was somewhat inconsistent',
            variation: 'Irregular engagement pattern'
        };
    }
    return {
        key: 'cons_inconsistent',
        label: 'LMS engagement was inconsistent',
        variation: 'Few active days for this subject'
    };
}

/**
 * DOMAIN 4: Action Mix (Per Subject)
 * Includes Sub-domains: Passive/Active, Practice Intensity, Discussion
 */
function evaluateActionMix(metrics) {
    const passiveMin = metrics.reading_minutes + metrics.watching_minutes;
    const activePractice = metrics.exercise_practice_events + metrics.assignment_work_events;
    const totalMin = metrics.total_active_minutes;
    const passiveRatio = totalMin > 0 ? passiveMin / totalMin : 0;

    // A. Passive vs Active
    let type = { key: 'mix_passive', label: 'Engagement was mostly passive' };

    if (passiveRatio > THRESHOLDS.action_mix.passive_ratio && metrics.exercise_practice_events === 0) {
        type = { key: 'mix_passive', label: 'Engagement was mostly passive' };
    } else if (metrics.exercise_practice_events >= THRESHOLDS.action_mix.practice_min_active) {
        type = { key: 'mix_active', label: 'Engagement included active practice' };
    } else if (passiveRatio >= THRESHOLDS.action_mix.balanced_passive_min && passiveRatio <= THRESHOLDS.action_mix.balanced_passive_max && metrics.exercise_practice_events >= 1) {
        type = { key: 'mix_balanced', label: 'Engagement was well balanced' };
    }

    // B. Practice Intensity
    let practice = { key: 'prac_low', label: 'Practice activity was low' };
    if (metrics.exercise_practice_events >= THRESHOLDS.practice_intensity.high_min) {
        practice = { key: 'prac_high', label: 'Practice activity was high' };
    } else if (metrics.exercise_practice_events >= THRESHOLDS.practice_intensity.moderate_min) {
        practice = { key: 'prac_moderate', label: 'Practice activity was moderate' };
    }

    // C. Discussion Participation
    let discussion = { key: 'disc_low', label: 'Discussion participation was low' };
    if (metrics.forum_posts >= THRESHOLDS.discussion.high_min) {
        discussion = { key: 'disc_high', label: 'Discussion participation was high' };
    } else if (metrics.forum_posts >= THRESHOLDS.discussion.moderate_min) {
        discussion = { key: 'disc_moderate', label: 'Discussion participation was moderate' };
    }

    return { type, practice, discussion };
}

/**
 * DOMAIN 5: Session Quality (Per Subject)
 */
function evaluateSessionQuality(metrics) {
    const sessions = metrics.number_of_sessions;
    const longest = metrics.longest_session_minutes;
    const avg = sessions > 0 ? metrics.total_active_minutes / sessions : 0;
    const totalMin = metrics.total_active_minutes;

    if (avg >= THRESHOLDS.session_quality.focused_avg_min && longest >= THRESHOLDS.session_quality.focused_longest_min) {
        return { key: 'qual_focused', label: 'Study sessions were focused' };
    }
    if (avg < THRESHOLDS.session_quality.interrupted_avg_max && sessions >= THRESHOLDS.session_quality.interrupted_sessions_min) {
        return { key: 'qual_interrupted', label: 'Study sessions were interrupted' };
    }
    if (totalMin < THRESHOLDS.session_quality.short_total_max && avg < THRESHOLDS.session_quality.short_avg_max) {
        return { key: 'qual_short', label: 'Study sessions were short' };
    }

    return { key: 'qual_standard', label: 'Study sessions were average length' };
}

// =============================================================================
// SENTENCE COMPOSITION
// =============================================================================

function composeSentences(judgments) {
    const { volume, distribution, consistency, actionMix, sessionQuality } = judgments;

    // Sentence 1: Overall activity + consistency/distribution
    // Use variations randomly for natural feel ? - User requested strict format, follow logic
    // Structure: "[Volume Variation] and [Consistency Variation]." or "[Volume Variation] and [Distribution Variation]."

    // Logic: If inconsistent -> highlight consistency. If condensed/fragmented -> highlight distribution.
    let s1_part2 = "";
    if (consistency.key === 'cons_inconsistent' || consistency.key === 'cons_somewhat') {
        s1_part2 = `and ${consistency.variation.toLowerCase()}`;
    } else {
        s1_part2 = `and ${distribution.variation.toLowerCase()}`;
    }

    const sentence1 = `${volume.variation} ${s1_part2}.`;

    // Sentence 2: Action mix + Practice/Discussion
    // Structure: "[Action Mix Label], with [Practice/Discussion summary]."

    let s2_part2 = "";
    if (actionMix.type.key === 'mix_passive') {
        s2_part2 = "with little exercise practice or discussion activity";
    } else if (actionMix.type.key === 'mix_active') {
        s2_part2 = "including regular exercise practice";
        if (actionMix.discussion.key !== 'disc_low') {
            s2_part2 += " and discussion participation";
        }
    } else {
        // Balanced
        s2_part2 = "combining content review with active practice";
    }

    const sentence2 = `${actionMix.type.label}, ${s2_part2}.`;

    return { sentence_1: sentence1, sentence_2: sentence2 };
}

// =============================================================================
// MAIN COMPUTATION FUNCTIONS
// =============================================================================

/**
 * Compute judgments (and sentences) for a subject over a period
 * Aggregates daily sessions for the period logic
 */
/**
 * Compute judgments (and sentences) for LMS activity over a period
 * Aggregates daily sessions for the period logic
 */
async function computeJudgments(pool, userId, days = 7) {
    // 1. Get aggregated metrics for the period
    const { rows: metricsRows } = await pool.query(
        `SELECT 
           SUM(total_active_minutes) as total_active_minutes,
           SUM(total_events) as total_events,
           SUM(number_of_sessions) as number_of_sessions,
           MAX(longest_session_minutes) as longest_session_minutes,
           COUNT(DISTINCT session_date) as days_active,
           SUM(reading_minutes) as reading_minutes,
           SUM(watching_minutes) as watching_minutes,
           SUM(exercise_practice_events) as exercise_practice_events,
           SUM(assignment_work_events) as assignment_work_events,
           SUM(forum_views) as forum_views,
           SUM(forum_posts) as forum_posts
         FROM public.lms_sessions
         WHERE user_id = $1 AND session_date >= CURRENT_DATE - INTERVAL '${days} days'`,
        [userId]
    );

    const metrics = metricsRows[0];

    // If no data, return empty/placeholder?
    if (!metrics || metrics.days_active == 0) {
        return null;
    }

    // Convert strings to numbers (pg sums come back as strings sometimes)
    for (const key in metrics) {
        metrics[key] = Number(metrics[key]);
    }

    // 2. Get baseline
    let baseline = await getOrCreateBaseline(pool, userId);

    // 3. Evaluate Domains
    const volume = evaluateActivityVolume(metrics, baseline);
    const distribution = evaluateDistribution(metrics);
    const consistency = evaluateConsistency(metrics.days_active);
    const actionMix = evaluateActionMix(metrics);
    const sessionQuality = evaluateSessionQuality(metrics);

    // Inject metrics for scoring
    volume.actions = metrics.total_events || 0;
    distribution.activeDays = metrics.days_active || 0;
    consistency.activeDays = metrics.days_active || 0;

    const totalMin = metrics.total_active_minutes || 0;
    const passiveMin = (metrics.reading_minutes || 0) + (metrics.watching_minutes || 0);
    const passiveRatio = totalMin > 0 ? passiveMin / totalMin : 0;
    actionMix.activePercent = Math.round((1 - passiveRatio) * 100);

    const sessions = metrics.number_of_sessions || 0;
    sessionQuality.avgDuration = sessions > 0 ? totalMin / sessions : 0;

    const judgments = { volume, distribution, consistency, actionMix, sessionQuality };

    // 4. Compose Sentences
    const sentences = composeSentences(judgments);

    // 5. Store in DB
    const periodStart = new Date(); // approximation for "current 7 day window"
    periodStart.setDate(periodStart.getDate() - days);

    // We just update the 'current window' record
    await pool.query(
        `INSERT INTO public.lms_judgments 
         (user_id, period_start, period_end, sentence_1, sentence_2, judgment_details, computed_at)
         VALUES ($1, CURRENT_DATE - INTERVAL '${days} days', CURRENT_DATE, $2, $3, $4, NOW())
         ON CONFLICT (user_id, period_start, period_end)
         DO UPDATE SET
           sentence_1 = EXCLUDED.sentence_1,
           sentence_2 = EXCLUDED.sentence_2,
           judgment_details = EXCLUDED.judgment_details,
           computed_at = NOW()`,
        [userId, sentences.sentence_1, sentences.sentence_2, JSON.stringify(judgments)]
    );

    return sentences;
}

/**
 * Get or create baseline for a user
 */
async function getOrCreateBaseline(pool, userId) {
    const { rows } = await pool.query(
        `SELECT * FROM public.lms_baselines WHERE user_id = $1`,
        [userId]
    );

    if (rows.length > 0) {
        return rows[0];
    }

    // Default baseline values (fallback if simulator didn't create them)
    // Assuming Average profile roughly
    await pool.query(
        `INSERT INTO public.lms_baselines (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active) 
         VALUES ($1, 350, 4, 7)
         ON CONFLICT (user_id) DO NOTHING`, // 50 min * 7
        [userId]
    );

    const result = await pool.query(
        `SELECT * FROM public.lms_baselines WHERE user_id = $1`,
        [userId]
    );
    return result.rows[0];
}

/**
 * Get judgments for chatbot Integration
 */
async function getJudgmentsForChatbot(pool, userId) {
    // Get latest judgment
    const { rows } = await pool.query(
        `SELECT * FROM public.lms_judgments 
         WHERE user_id = $1 
         AND period_end = CURRENT_DATE
         LIMIT 1`,
        [userId]
    );

    if (rows.length === 0) {
        return "No LMS activity data available yet.";
    }

    const row = rows[0];
    let result = "## LMS Activity Analysis\n";
    result += `- ${row.sentence_1}\n`;
    result += `- ${row.sentence_2}\n`;

    return result;
}

/**
 * Get raw scores for scoring aggregation (0-100 per aspect)
 */
async function getRawScoresForScoring(pool, userId) {
    const { rows } = await pool.query(
        `SELECT judgment_details FROM public.lms_judgments 
         WHERE user_id = $1 
         AND period_end = CURRENT_DATE
         LIMIT 1`,
        [userId]
    );

    if (rows.length === 0) return [];

    const details = rows[0].judgment_details;
    const aspects = [];

    // Volume score
    if (details.volume) {
        const actionsCount = details.volume.actions || 0;
        const volumeScore = Math.min(100, actionsCount * 2);
        aspects.push({
            domain: 'volume',
            score: Math.round(volumeScore * 100) / 100,
            label: details.volume.label
        });
    }

    // Distribution score
    if (details.distribution) {
        const activeDays = details.distribution.activeDays || 0;
        const distributionScore = (activeDays / 7) * 100;
        aspects.push({
            domain: 'distribution',
            score: Math.round(distributionScore * 100) / 100,
            label: details.distribution.label
        });
    }

    // Consistency score
    if (details.consistency) {
        // Use activeDays since stddev was not tracked
        const activeDays = details.consistency.activeDays || 0;
        // 5+ days = 100, 3 days = 60, 0 days = 0
        const consistencyScore = Math.min(100, (activeDays / 5) * 100);
        aspects.push({
            domain: 'consistency',
            score: Math.round(consistencyScore * 100) / 100,
            label: details.consistency.label
        });
    }

    // Action mix score
    if (details.actionMix) {
        const activePercent = details.actionMix.activePercent || 0;
        const actionMixScore = 50 + (activePercent / 100) * 50;
        const label = details.actionMix.type?.label || 'Action mix evaluated';
        aspects.push({
            domain: 'action_mix',
            score: Math.round(actionMixScore * 100) / 100,
            label: label
        });
    }

    // Session quality score
    if (details.sessionQuality) {
        const avgDuration = details.sessionQuality.avgDuration || 0;
        let sessionScore;
        if (avgDuration >= 30) {
            sessionScore = 100;
        } else if (avgDuration >= 5) {
            sessionScore = 40 + (avgDuration - 5) * (60 / 25);
        } else {
            sessionScore = avgDuration * 8;
        }
        aspects.push({
            domain: 'session_quality',
            score: Math.round(sessionScore * 100) / 100,
            label: details.sessionQuality.label
        });
    }

    return aspects;
}

// Keep old function for backwards compatibility
async function getSeveritiesForScoring(pool, userId) {
    const rawScores = await getRawScoresForScoring(pool, userId);
    return rawScores.map(r => ({
        domain: r.domain,
        severity: r.score >= 75 ? 'ok' : r.score >= 40 ? 'warning' : 'poor'
    }));
}

export {
    computeJudgments,
    getJudgmentsForChatbot,
    getSeveritiesForScoring,
    getRawScoresForScoring,
    evaluateActivityVolume,
    evaluateDistribution,
    evaluateConsistency,
    evaluateActionMix,
    evaluateSessionQuality,
    composeSentences
};


