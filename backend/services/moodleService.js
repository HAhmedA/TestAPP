// Moodle REST API Service
// Pure service layer for Moodle LMS integration via module-specific REST endpoints.
// All functions throw AppError on failure — no Express dependency.
//
// Known limitations (by design):
//   - reading_minutes and watching_minutes are always 0 — content views are invisible
//     to module REST APIs. This is why action_mix was replaced with participation_variety.
//   - Assignment time is estimated at 10 min/submission (no time-on-task in REST API)
//   - Session quality reflects quiz attempt durations only; assignment submissions
//     contribute to session count but not measured duration
//   - Forum traversal capped at MAX_FORUM_DISCUSSIONS_PER_SYNC per forum to prevent
//     excessive per-discussion API call chains
//   - Email mismatch between app and Moodle → sync skips that student (not_found_in_moodle)

import http from 'http'
import https from 'https'
import logger from '../utils/logger.js'
import { Errors } from '../utils/errors.js'
import { withTransaction } from '../utils/withTransaction.js'
import { computeAllScores } from './scoring/index.js'
import { computeJudgments } from './annotators/lmsAnnotationService.js'
import { updateDataVersion } from './chatbotPreferencesService.js'
import pLimit from 'p-limit'

const MAX_FORUM_DISCUSSIONS_PER_SYNC = 50

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Return { baseUrl, token } or throw MOODLE_NOT_CONFIGURED (503).
 */
function getMoodleConfig() {
    const baseUrl = process.env.MOODLE_BASE_URL
    const token   = process.env.MOODLE_TOKEN
    if (!baseUrl || !token) {
        throw Errors.MOODLE_NOT_CONFIGURED()
    }
    return { baseUrl, token }
}

/**
 * HTTP GET using Node.js built-in http/https module.
 * Avoids Docker Desktop's transparent proxy which intercepts undici (fetch) connections.
 *
 * Docker/Moodle redirect problem:
 *   Moodle's $CFG->wwwroot = 'http://localhost:8888/moodle501'
 *   Our MOODLE_BASE_URL     = 'http://host.docker.internal:8888/moodle501'
 *   When Moodle receives Host: host.docker.internal it issues a 303 redirect to localhost:8888.
 *   But localhost inside the container means the container itself, not the host → ECONNREFUSED.
 *
 * Fix: on any redirect to localhost, rewrite the connection target back to the configured
 * Moodle host (host.docker.internal) while spoofing the Host header as 'localhost:PORT'.
 * Moodle then sees a matching Host header and returns the API response without redirecting.
 *
 * @param {string} urlStr - Absolute URL to request
 * @param {string|null} overrideHostHeader - If set, sent as the HTTP Host header
 * @param {number} redirectsLeft - Recursion guard (max 3 redirects)
 * @returns {Promise<string>} - Raw response body
 */
function nodeHttpGet(urlStr, overrideHostHeader = null, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlStr)
        const transport = parsedUrl.protocol === 'https:' ? https : http

        const options = {
            hostname: parsedUrl.hostname,
            port:     parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path:     parsedUrl.pathname + parsedUrl.search,
            headers:  overrideHostHeader ? { Host: overrideHostHeader } : {},
        }

        transport.get(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirectsLeft === 0) {
                    return reject(Errors.MOODLE_API_ERROR('Moodle returned too many redirects'))
                }

                // Resolve relative redirect URLs
                let redirectUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, urlStr).toString()

                const redirectParsed  = new URL(redirectUrl)
                let nextOverrideHost  = overrideHostHeader

                // Moodle redirects to its wwwroot (localhost:PORT). From inside Docker,
                // localhost means the container — rewrite to the configured Moodle host
                // and tell Moodle we're localhost via the Host header.
                if (redirectParsed.hostname === 'localhost' && parsedUrl.hostname !== 'localhost') {
                    nextOverrideHost         = redirectParsed.host   // e.g. 'localhost:8888'
                    redirectParsed.hostname  = parsedUrl.hostname    // 'host.docker.internal'
                    redirectParsed.port      = parsedUrl.port        // '8888'
                    redirectUrl              = redirectParsed.toString()
                }

                return nodeHttpGet(redirectUrl, nextOverrideHost, redirectsLeft - 1)
                    .then(resolve).catch(reject)
            }

            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(Errors.MOODLE_API_ERROR(`Moodle HTTP ${res.statusCode}`))
            }

            let body = ''
            res.setEncoding('utf8')
            res.on('data',  chunk => { body += chunk })
            res.on('end',   ()    => resolve(body))
        }).on('error', err => {
            reject(Errors.MOODLE_API_ERROR(`Network error reaching Moodle: ${err.message}`))
        })
    })
}

/**
 * Make a Moodle REST API call.
 * Builds: <baseUrl>/webservice/rest/server.php?wstoken=...&moodlewsrestformat=json&wsfunction=...
 * Handles array params as PHP-style courseids[0]=..., courseids[1]=...
 *
 * @param {string} wsfunction - Moodle web service function name
 * @param {Object} params - Query parameters (arrays serialized as indexed keys)
 * @returns {Promise<any>} - Parsed JSON response
 */
async function moodleRequest(wsfunction, params = {}) {
    const { baseUrl, token } = getMoodleConfig()

    const searchParams = new URLSearchParams({
        wstoken:              token,
        moodlewsrestformat:   'json',
        wsfunction,
    })

    // Flatten params: arrays become key[0]=v0&key[1]=v1 (PHP array convention)
    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
            value.forEach((v, i) => searchParams.append(`${key}[${i}]`, String(v)))
        } else {
            searchParams.append(key, String(value))
        }
    }

    const url = `${baseUrl}/webservice/rest/server.php?${searchParams}`

    // Use Node.js http/https instead of native fetch — Docker Desktop's transparent
    // proxy layer intercepts undici (fetch) connections but not Node's http module.
    const body = await nodeHttpGet(url)
    const json = JSON.parse(body)

    if (json && json.exception) {
        throw Errors.MOODLE_API_ERROR(`Moodle exception in ${wsfunction}: ${json.message || json.exception}`)
    }

    return json
}

// =============================================================================
// PUBLIC API FUNCTIONS
// =============================================================================

/**
 * Verify Moodle connection by calling core_webservice_get_site_info.
 * @returns {{ sitename: string, username: string }}
 */
async function verifyConnection() {
    const info = await moodleRequest('core_webservice_get_site_info')
    return { sitename: info.sitename, username: info.username }
}

/**
 * Look up a Moodle user by email address.
 * Returns the Moodle numeric user ID, or null if not found.
 *
 * @param {string} email
 * @returns {Promise<number|null>}
 */
async function getMoodleUserId(email) {
    const result = await moodleRequest('core_user_get_users_by_field', {
        field:      'email',
        'values[0]': email,
    })
    const users = Array.isArray(result) ? result : []
    if (users.length === 0) return null
    return users[0].id
}

/**
 * Get courses the Moodle user is enrolled in.
 *
 * @param {number} moodleUserId
 * @returns {Promise<Array<{ id: number, fullname: string }>>}
 */
async function getEnrolledCourses(moodleUserId) {
    const courses = await moodleRequest('core_enrol_get_users_courses', { userid: moodleUserId })
    return Array.isArray(courses) ? courses.map(c => ({ id: c.id, fullname: c.fullname })) : []
}

/**
 * Fetch finished quiz attempts for a user across all enrolled courses.
 * Filters to attempts with timefinish >= sinceTimestamp.
 * Duration is capped at 180 minutes.
 *
 * @param {number} moodleUserId
 * @param {Array<{ id: number }>} courses
 * @param {number} sinceTimestamp - Unix timestamp (seconds)
 * @returns {Promise<Array<{ date: string, timestart: number, timefinish: number, duration_minutes: number, quizid: number }>>}
 */
async function fetchQuizAttempts(moodleUserId, courses, sinceTimestamp) {
    const courseIds = courses.map(c => c.id)
    const quizzesResp = await moodleRequest('mod_quiz_get_quizzes_by_courses', { courseids: courseIds })
    const quizzes = quizzesResp?.quizzes ?? []

    const attempts = []
    for (const quiz of quizzes) {
        let attemptsResp
        try {
            attemptsResp = await moodleRequest('mod_quiz_get_user_quiz_attempts', {
                quizid: quiz.id,
                userid: moodleUserId,
                status: 'finished',
            })
        } catch (err) {
            logger.warn(`fetchQuizAttempts: skipping quiz ${quiz.id} — ${err.message}`)
            continue
        }

        for (const attempt of attemptsResp?.attempts ?? []) {
            if (attempt.state !== 'finished') continue
            if (attempt.timefinish < sinceTimestamp) continue

            const durationMin = Math.ceil((attempt.timefinish - attempt.timestart) / 60)
            const cappedDuration = Math.min(durationMin, 180)

            attempts.push({
                date:             tsToDate(attempt.timestart),
                timestart:        attempt.timestart,
                timefinish:       attempt.timefinish,
                duration_minutes: cappedDuration,
                quizid:           quiz.id,
            })
        }
    }
    return attempts
}

/**
 * Fetch assignment submissions for a user across all enrolled courses.
 * Filters to submissions with timemodified >= sinceTimestamp and
 * status in ('submitted', 'reopened').
 *
 * @param {number} moodleUserId
 * @param {Array<{ id: number }>} courses
 * @param {number} sinceTimestamp - Unix timestamp (seconds)
 * @returns {Promise<Array<{ date: string, assignmentid: number }>>}
 */
async function fetchAssignmentSubmissions(moodleUserId, courses, sinceTimestamp) {
    const courseIds = courses.map(c => c.id)
    const assignResp = await moodleRequest('mod_assign_get_assignments', { courseids: courseIds })

    // Flatten all assignment IDs from all courses
    const assignments = (assignResp?.courses ?? []).flatMap(c => c.assignments ?? [])
    if (assignments.length === 0) return []

    const assignmentIds = assignments.map(a => a.id)
    const subsResp = await moodleRequest('mod_assign_get_submissions', { assignmentids: assignmentIds })

    const results = []
    for (const assignBlock of subsResp?.assignments ?? []) {
        for (const sub of assignBlock.submissions ?? []) {
            if (sub.userid !== moodleUserId) continue
            if (sub.timemodified < sinceTimestamp) continue
            if (!['submitted', 'reopened'].includes(sub.status)) continue

            results.push({
                date:         tsToDate(sub.timemodified),
                assignmentid: assignBlock.assignmentid,
            })
        }
    }
    return results
}

/**
 * Fetch forum posts by a user across all enrolled courses.
 * Traverses forums → discussions (capped at MAX_FORUM_DISCUSSIONS_PER_SYNC) → posts.
 * Filters to posts with created >= sinceTimestamp by the target user.
 *
 * @param {number} moodleUserId
 * @param {Array<{ id: number }>} courses
 * @param {number} sinceTimestamp - Unix timestamp (seconds)
 * @returns {Promise<Array<{ date: string, discussionid: number }>>}
 */
async function fetchForumPosts(moodleUserId, courses, sinceTimestamp) {
    const courseIds = courses.map(c => c.id)
    // Forums endpoint returns a plain array (no wrapper object)
    const forums = await moodleRequest('mod_forum_get_forums_by_courses', { courseids: courseIds })
    if (!Array.isArray(forums) || forums.length === 0) return []

    const posts = []
    for (const forum of forums) {
        let discussionsResp
        try {
            discussionsResp = await moodleRequest('mod_forum_get_forum_discussions', {
                forumid: forum.id,
                page:    0,
                perpage: MAX_FORUM_DISCUSSIONS_PER_SYNC,
            })
        } catch (err) {
            logger.warn(`fetchForumPosts: skipping forum ${forum.id} — ${err.message}`)
            continue
        }

        const discussions = discussionsResp?.discussions ?? []
        const discussionLimit = pLimit(5)

        const discussionResults = await Promise.all(
            discussions.map(discussion =>
                discussionLimit(async () => {
                    try {
                        const postsResp = await moodleRequest('mod_forum_get_discussion_posts', {
                            discussionid: discussion.id,
                        })
                        return (postsResp?.posts ?? [])
                            .filter(post => post.userid === moodleUserId && post.created >= sinceTimestamp)
                            .map(post => ({
                                date:         tsToDate(post.created),
                                discussionid: discussion.id,
                            }))
                    } catch (err) {
                        logger.warn(`fetchForumPosts: skipping discussion ${discussion.id} — ${err.message}`)
                        return []
                    }
                })
            )
        )

        for (const result of discussionResults) {
            posts.push(...result)
        }
    }
    return posts
}

// =============================================================================
// AGGREGATION
// =============================================================================

/**
 * Aggregate raw REST events into one lms_sessions row per day.
 *
 * Column notes (by design — module REST cannot provide these):
 *   reading_minutes  = 0  (content views invisible to module REST APIs)
 *   watching_minutes = 0  (same reason)
 *   forum_views      = 0  (same reason)
 *
 * @param {{ quizAttempts: Array, assignments: Array, forumPosts: Array, sinceDate?: string }}
 * @returns {Array<Object>} - One object per active day; empty array if no events
 */
function aggregateToDaily({ quizAttempts, assignments, forumPosts }) {
    const dayMap = {}

    const ensureDay = (date) => {
        if (!dayMap[date]) dayMap[date] = { quiz: [], assign: [], forum: [] }
    }

    for (const q of quizAttempts) {
        ensureDay(q.date)
        dayMap[q.date].quiz.push(q)
    }
    for (const a of assignments) {
        ensureDay(a.date)
        dayMap[a.date].assign.push(a)
    }
    for (const f of forumPosts) {
        ensureDay(f.date)
        dayMap[f.date].forum.push(f)
    }

    return Object.entries(dayMap).map(([date, events]) => {
        const quizCount   = events.quiz.length
        const assignCount = events.assign.length
        const forumCount  = events.forum.length

        const quizDurations   = events.quiz.map(q => q.duration_minutes)
        const totalQuizMin    = quizDurations.reduce((s, d) => s + d, 0)
        // Assignment time: estimated 10 min per submission (no time-on-task in REST API)
        const totalActiveMin  = totalQuizMin + assignCount * 10
        const numSessions     = quizCount + assignCount
        const longestSession  = quizDurations.length > 0 ? Math.max(...quizDurations) : 0

        return {
            session_date:              date,
            total_active_minutes:      totalActiveMin,
            total_events:              quizCount + assignCount + forumCount,
            number_of_sessions:        numSessions,
            longest_session_minutes:   longestSession,
            days_active_in_period:     1,
            reading_minutes:           0,
            watching_minutes:          0,
            exercise_practice_events:  quizCount,
            assignment_work_events:    assignCount,
            forum_views:               0,
            forum_posts:               forumCount,
        }
    })
}

// =============================================================================
// SYNC ORCHESTRATION
// =============================================================================

/**
 * Sync a single app user's LMS activity from Moodle into lms_sessions.
 *
 * @param {import('pg').Pool} pool
 * @param {string} userId  - App user ID
 * @param {string} userEmail
 * @returns {{ synced: number, days: string[] } | { skipped: true, reason: string }}
 */
async function syncUserFromMoodle(pool, userId, userEmail) {
    // 1. Resolve Moodle user ID from email
    const moodleUserId = await getMoodleUserId(userEmail)
    if (moodleUserId === null) {
        logger.info(`syncUserFromMoodle: ${userEmail} not found in Moodle`)
        return { skipped: true, reason: 'not_found_in_moodle' }
    }

    // 2. Get enrolled courses
    const courses = await getEnrolledCourses(moodleUserId)
    if (courses.length === 0) {
        logger.info(`syncUserFromMoodle: ${userEmail} has no enrolled courses`)
        return { skipped: true, reason: 'no_courses' }
    }

    // 3. Look back 7 days; add 5-minute clock buffer
    const sinceTimestamp = Math.floor(Date.now() / 1000) - 7 * 86400 - 300

    // 4. Fetch all activity types in parallel
    const [quizAttempts, assignments, forumPosts] = await Promise.all([
        fetchQuizAttempts(moodleUserId, courses, sinceTimestamp),
        fetchAssignmentSubmissions(moodleUserId, courses, sinceTimestamp),
        fetchForumPosts(moodleUserId, courses, sinceTimestamp),
    ])

    logger.info(`syncUserFromMoodle ${userEmail}: ${quizAttempts.length} quiz attempts, ` +
        `${assignments.length} assignment submissions, ${forumPosts.length} forum posts`)

    // 5. Aggregate into daily rows
    const dailyRows = aggregateToDaily({ quizAttempts, assignments, forumPosts })
    if (dailyRows.length === 0) {
        return { skipped: true, reason: 'no_activity' }
    }

    // 6. Upsert lms_sessions and recompute baseline
    await withTransaction(pool, async (client) => {
        for (const row of dailyRows) {
            await client.query(
                `INSERT INTO public.lms_sessions
                     (user_id, session_date, total_active_minutes, total_events,
                      number_of_sessions, longest_session_minutes, days_active_in_period,
                      reading_minutes, watching_minutes, exercise_practice_events,
                      assignment_work_events, forum_views, forum_posts, is_simulated)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (user_id, session_date) DO UPDATE SET
                     total_active_minutes     = EXCLUDED.total_active_minutes,
                     total_events             = EXCLUDED.total_events,
                     number_of_sessions       = EXCLUDED.number_of_sessions,
                     longest_session_minutes  = EXCLUDED.longest_session_minutes,
                     reading_minutes          = EXCLUDED.reading_minutes,
                     watching_minutes         = EXCLUDED.watching_minutes,
                     exercise_practice_events = EXCLUDED.exercise_practice_events,
                     assignment_work_events   = EXCLUDED.assignment_work_events,
                     forum_views              = EXCLUDED.forum_views,
                     forum_posts              = EXCLUDED.forum_posts,
                     is_simulated             = EXCLUDED.is_simulated`,
                [
                    userId, row.session_date, row.total_active_minutes, row.total_events,
                    row.number_of_sessions, row.longest_session_minutes, row.days_active_in_period,
                    row.reading_minutes, row.watching_minutes, row.exercise_practice_events,
                    row.assignment_work_events, row.forum_views, row.forum_posts, false,
                ]
            )
        }

        // Recompute baseline from rolling 7-day average of real rows
        await client.query(
            `WITH baseline_data AS (
                 SELECT COALESCE(AVG(total_active_minutes), 0) AS avg_min,
                        COALESCE(AVG(number_of_sessions), 0)   AS avg_sessions,
                        COUNT(DISTINCT session_date)            AS active_days
                 FROM public.lms_sessions
                 WHERE user_id = $1
                   AND is_simulated = false
                   AND session_date >= CURRENT_DATE - INTERVAL '7 days'
             )
             INSERT INTO public.lms_baselines
                 (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active)
             SELECT $1, avg_min, avg_sessions, active_days FROM baseline_data
             ON CONFLICT (user_id) DO UPDATE SET
                 baseline_active_minutes = EXCLUDED.baseline_active_minutes,
                 baseline_sessions       = EXCLUDED.baseline_sessions,
                 baseline_days_active    = EXCLUDED.baseline_days_active`,
            [userId]
        )
    })

    // 7. Fire-and-forget score computation + data version bump (non-blocking)
    computeAllScores(userId).catch(err =>
        logger.error(`computeAllScores error for ${userId}: ${err.message}`)
    )
    await updateDataVersion(userId)

    // 8. Return sync summary
    return {
        synced: dailyRows.length,
        days:   dailyRows.map(r => r.session_date),
    }
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Convert a Unix timestamp (seconds) to a YYYY-MM-DD date string.
 */
function tsToDate(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

export {
    verifyConnection,
    getMoodleUserId,
    getEnrolledCourses,
    fetchQuizAttempts,
    fetchAssignmentSubmissions,
    fetchForumPosts,
    aggregateToDaily,
    syncUserFromMoodle,
}
