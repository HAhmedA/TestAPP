// LMS Annotation Service
// Rule-based computation engine that generates human-readable LMS judgments
// Evaluates volume, consistency, participation variety, and session quality domains

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
            variation: 'Moderate engagement with this subject'
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
 * DOMAIN 4: Participation Variety (replaces Action Mix)
 * Measures breadth of LMS tool usage across quizzes, assignments, and forums.
 *
 * Replaces the old passive/active time ratio which was always 100% when using
 * module-specific REST APIs (reading_minutes and watching_minutes are unavailable).
 *
 * tool_count (0–3) drives the primary judgment:
 *   0 → no_active_work   (only content viewing, if any)
 *   1 → single_tool      (only one activity type used)
 *   2 → multi_tool       (two activity types used)
 *   3 → fully_engaged    (all three: quizzes + assignments + forum)
 *
 * Sub-domains practice_intensity and discussion remain unchanged.
 */
function evaluateParticipationVariety(metrics) {
    const has_quizzes     = (metrics.exercise_practice_events || 0) > 0;
    const has_assignments = (metrics.assignment_work_events || 0) > 0;
    const has_forum       = (metrics.forum_posts || 0) > 0;
    const tool_count      = (has_quizzes ? 1 : 0) + (has_assignments ? 1 : 0) + (has_forum ? 1 : 0);

    // A. Tool breadth (participation variety)
    let type;
    if (tool_count === 0) {
        type = { key: 'no_active_work', label: 'No active LMS tools used this week' };
    } else if (tool_count === 1) {
        type = { key: 'single_tool', label: 'Only one type of LMS activity recorded' };
    } else if (tool_count === 2) {
        type = { key: 'multi_tool', label: 'Two types of LMS activity recorded' };
    } else {
        type = { key: 'fully_engaged', label: 'All three LMS activity types used' };
    }

    // Store tool flags for sentence composition
    type.has_quizzes     = has_quizzes;
    type.has_assignments = has_assignments;
    type.has_forum       = has_forum;

    // B. Practice Intensity (unchanged)
    let practice = { key: 'prac_low', label: 'Practice activity was low' };
    if (metrics.exercise_practice_events >= THRESHOLDS.practice_intensity.high_min) {
        practice = { key: 'prac_high', label: 'Practice activity was high' };
    } else if (metrics.exercise_practice_events >= THRESHOLDS.practice_intensity.moderate_min) {
        practice = { key: 'prac_moderate', label: 'Practice activity was moderate' };
    }

    // C. Discussion Participation (unchanged)
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

    // Sentence 2: Participation variety + Practice/Discussion
    // Structure: "[Type Label], with [tool/activity summary]."

    let s2_part2 = "";
    const { key, has_quizzes, has_assignments, has_forum } = actionMix.type;

    if (key === 'no_active_work') {
        s2_part2 = "with no quiz, assignment, or discussion activity recorded";
    } else if (key === 'single_tool') {
        if (has_quizzes)     s2_part2 = "with only quiz practice activity";
        else if (has_assignments) s2_part2 = "with only assignment submissions";
        else                 s2_part2 = "with only forum discussion activity";
    } else if (key === 'multi_tool') {
        s2_part2 = "combining multiple types of LMS activity";
        if (actionMix.discussion.key !== 'disc_low') {
            s2_part2 += " including discussion participation";
        }
    } else {
        // fully_engaged
        s2_part2 = "actively using quizzes, assignments, and discussions";
    }

    const sentence2 = `${actionMix.type.label}, ${s2_part2}.`;

    return { sentence_1: sentence1, sentence_2: sentence2 };
}

// =============================================================================
// MAIN COMPUTATION FUNCTIONS
// =============================================================================

/**
 * Compute judgments (and sentences) for LMS activity over a period.
 * Aggregates daily lms_sessions rows for the requested look-back window.
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
         WHERE user_id = $1 AND session_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')`,
        [userId, days]
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
    const actionMix = evaluateParticipationVariety(metrics);
    const sessionQuality = evaluateSessionQuality(metrics);

    // Inject metrics for scoring
    volume.actions = metrics.total_events || 0;
    distribution.activeDays = metrics.days_active || 0;
    consistency.activeDays = metrics.days_active || 0;

    // participation_score: breadth of tool usage (0–100)
    // Replaces activePercent which was always 100% with module REST APIs
    const quizContrib   = Math.min(metrics.exercise_practice_events || 0, 3) / 3.0 * 34;
    const assignContrib = Math.min(metrics.assignment_work_events   || 0, 2) / 2.0 * 33;
    const forumContrib  = Math.min(metrics.forum_posts              || 0, 2) / 2.0 * 33;
    actionMix.participationScore = Math.round(quizContrib + assignContrib + forumContrib);

    const sessions = metrics.number_of_sessions || 0;
    const totalMin = metrics.total_active_minutes || 0;
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
         VALUES ($1, CURRENT_DATE - ($2 * INTERVAL '1 day'), CURRENT_DATE, $3, $4, $5, NOW())
         ON CONFLICT (user_id, period_start, period_end)
         DO UPDATE SET
           sentence_1 = EXCLUDED.sentence_1,
           sentence_2 = EXCLUDED.sentence_2,
           judgment_details = EXCLUDED.judgment_details,
           computed_at = NOW()`,
        [userId, days, sentences.sentence_1, sentences.sentence_2, JSON.stringify(judgments)]
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
 * Get formatted LMS analysis for chatbot prompt.
 * Returns a placeholder when no LMS data is available (integration pending).
 * When data exists, includes peer context (internal only) and weekly patterns.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted markdown for prompt assembly
 */
async function getJudgmentsForChatbot(pool, userId) {
    // Fetch last 7 days of LMS sessions
    const { rows: sessions } = await pool.query(
        `SELECT session_date, total_active_minutes, number_of_sessions,
                exercise_practice_events, assignment_work_events, forum_posts
         FROM public.lms_sessions
         WHERE user_id = $1
         ORDER BY session_date DESC
         LIMIT 7`,
        [userId]
    );

    if (sessions.length === 0) {
        return 'LMS Activity Analysis: LMS data is not yet available for this student. ' +
            'If the student asks about their LMS activity, let them know this feature is coming soon ' +
            'and focus the conversation on the data that is available (sleep, screen time, SRL).';
    }

    // Fetch peer cluster context (if available)
    const { rows: clusterRows } = await pool.query(
        `SELECT uca.percentile_position, pc.p5, pc.p50, pc.p95
         FROM public.user_cluster_assignments uca
         JOIN public.peer_clusters pc
           ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
         WHERE uca.user_id = $1 AND uca.concept_id = 'lms'`,
        [userId]
    );

    const toMin = (m) => m != null ? `${Math.round(m)} min` : 'N/A';

    let result = '## LMS Activity Analysis\n\n';

    // Internal peer context block
    if (clusterRows.length > 0) {
        const c = clusterRows[0];
        const pct = c.percentile_position != null ? Math.round(parseFloat(c.percentile_position)) : null;
        result += `[Internal context — do not share with student]\n`;
        result += `Peer context: Typical weekly LMS engagement for students with similar patterns is `;
        result += `${toMin(c.p5)}–${toMin(c.p95)} total active time, median ${toMin(c.p50)}. `;
        if (pct != null) result += `Student is at the ${pct}th percentile within this group.\n\n`;
        else result += '\n\n';
    }

    const totalActive = sessions.reduce((s, r) => s + (r.total_active_minutes || 0), 0);
    const totalSessions = sessions.reduce((s, r) => s + (r.number_of_sessions || 0), 0);
    const activeDays = new Set(sessions.map(s => s.session_date)).size;
    const quizEvents = sessions.reduce((s, r) => s + (r.exercise_practice_events || 0), 0);
    const assignEvents = sessions.reduce((s, r) => s + (r.assignment_work_events || 0), 0);
    const forumPosts = sessions.reduce((s, r) => s + (r.forum_posts || 0), 0);

    // Participation variety: breadth of tool usage (quizzes, assignments, forum)
    const toolCount = (quizEvents > 0 ? 1 : 0) + (assignEvents > 0 ? 1 : 0) + (forumPosts > 0 ? 1 : 0);
    const participationLabel = toolCount === 0 ? 'No active LMS tools used'
        : toolCount === 1 ? 'Only one type of LMS activity recorded'
        : toolCount === 2 ? 'Two types of LMS activity recorded'
        : 'All three LMS activity types used';

    result += `### Past 7 days:\n`;
    result += `- Active days: ${activeDays}/7\n`;
    result += `- Total active time: ${toMin(totalActive)}\n`;
    result += `- Total sessions: ${totalSessions}\n`;
    result += `- Activity breadth: ${participationLabel} (quizzes: ${quizEvents}, assignments: ${assignEvents}, forum posts: ${forumPosts})\n`;

    return result;
}

/**
 * Get cluster-based scores for scoring aggregation
 * Uses PGMoE clustering + percentile scoring instead of Z-scores
 */
async function getRawScoresForScoring(pool, userId, days = 7) {
    const { computeClusterScores } = await import('../scoring/clusterPeerService.js');
    const clusterResult = await computeClusterScores(pool, 'lms', userId, days);

    if (!clusterResult) return [];
    if (clusterResult.coldStart) return [{ coldStart: true }];
    if (!clusterResult.domains) return [];

    // Fetch judgment labels to attach to each domain
    const { rows } = await pool.query(
        `SELECT judgment_details FROM public.lms_judgments
         WHERE user_id = $1 AND period_end = CURRENT_DATE LIMIT 1`,
        [userId]
    );
    const details = rows.length > 0 ? rows[0].judgment_details : {};

    const labelMap = {
        volume:                details.volume?.label,
        consistency:           details.consistency?.label,
        participation_variety: details.actionMix?.type?.label || 'Tool engagement evaluated',
        session_quality:       details.sessionQuality?.label,
    };

    return clusterResult.domains.map(r => ({
        ...r,
        label: labelMap[r.domain] || r.categoryLabel,
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

export {
    computeJudgments,
    getJudgmentsForChatbot,
    getSeveritiesForScoring,
    getRawScoresForScoring,
    evaluateActivityVolume,
    evaluateDistribution,
    evaluateConsistency,
    evaluateParticipationVariety,
    evaluateSessionQuality,
    composeSentences
};


