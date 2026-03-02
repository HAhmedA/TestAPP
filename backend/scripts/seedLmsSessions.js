/**
 * seedLmsSessions.js — Seed 40 days of realistic LMS session data for test1–test20.
 *
 * Replaces any existing lms_sessions (including stale Feb 22–27 Moodle data) with
 * 40 simulated days matched to each student's simulated_profile.
 *
 * Uses the same generateMockRestData → aggregateToDaily pipeline as real Moodle sync.
 *
 * Usage:
 *   node backend/scripts/seedLmsSessions.js
 */

import pool from '../config/database.js'
import { generateMockRestData } from '../services/moodleEventSimulator.js'
import { aggregateToDaily } from '../services/moodleService.js'
import { withTransaction } from '../utils/withTransaction.js'
import { computeJudgments } from '../services/annotators/lmsAnnotationService.js'
import { computeAllScores } from '../services/scoring/index.js'

const DAYS = 40

// Profile-based baseline values (mirrors MOCK_PROFILES in moodleEventSimulator.js)
const BASELINE_BY_PROFILE = {
    high_achiever: { minutes: 245, sessions: 7, daysActive: 6 },
    average:       { minutes: 100, sessions: 3, daysActive: 4 },
    low_achiever:  { minutes: 45,  sessions: 1, daysActive: 2 },
}

/** Shift a 'YYYY-MM-DD' date string by `delta` days (negative = earlier). */
function shiftDate(dateStr, delta) {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + delta)
    return d.toISOString().slice(0, 10)
}

async function seedUser(userId, email, profile) {
    console.log(`  [${email}] profile=${profile}`)

    // 1. Generate data in weekly chunks so activeDaysPerWeek applies per-week (not total).
    //    generateMockRestData treats activeDaysPerWeek as a total count across 'days', so
    //    calling with days=7 per chunk produces correct weekly-density data.
    const NUM_WEEKS = Math.ceil(DAYS / 7)   // 6 chunks covers 42 days
    const allQuizAttempts = []
    const allAssignments  = []
    const allForumPosts   = []

    for (let week = 0; week < NUM_WEEKS; week++) {
        const { quizAttempts: wq, assignments: wa, forumPosts: wf } = generateMockRestData(profile, 7)
        const offsetDays = week * 7
        allQuizAttempts.push(...wq.map(a => ({
            ...a,
            date:       shiftDate(a.date, -offsetDays),
            timestart:  a.timestart  - offsetDays * 86400,
            timefinish: a.timefinish - offsetDays * 86400,
        })))
        allAssignments.push(...wa.map(a => ({ ...a, date: shiftDate(a.date, -offsetDays) })))
        allForumPosts.push(...wf.map(p => ({ ...p, date: shiftDate(p.date, -offsetDays) })))
    }

    const dailyRows = aggregateToDaily({
        quizAttempts: allQuizAttempts,
        assignments:  allAssignments,
        forumPosts:   allForumPosts,
    })

    if (dailyRows.length === 0) {
        console.log(`    ✗ No rows generated — skipping`)
        return 0
    }

    const baseline = BASELINE_BY_PROFILE[profile] || BASELINE_BY_PROFILE.average

    await withTransaction(pool, async (client) => {
        // 2. Clean slate — delete all existing lms_sessions for this user
        await client.query(`DELETE FROM public.lms_sessions WHERE user_id = $1`, [userId])

        // 3. Upsert fresh simulated rows
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
                    row.assignment_work_events, row.forum_views, row.forum_posts, true,
                ]
            )
        }

        // 4. Recompute baseline (profile-driven, same as simulateUserData)
        await client.query(
            `INSERT INTO public.lms_baselines
                 (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
                 baseline_active_minutes = EXCLUDED.baseline_active_minutes,
                 baseline_sessions       = EXCLUDED.baseline_sessions,
                 baseline_days_active    = EXCLUDED.baseline_days_active`,
            [userId, baseline.minutes, baseline.sessions, baseline.daysActive]
        )
    })

    // 5. Recompute judgments and scores (outside transaction — fire-and-wait in a script)
    await computeJudgments(pool, userId, DAYS)
    await computeAllScores(userId)

    console.log(`    ✓ ${dailyRows.length} days seeded`)
    return dailyRows.length
}

async function main() {
    console.log(`\nSeed LMS Sessions — ${DAYS} days for test1–test20`)
    console.log('─────────────────────────────────────────────────\n')

    try {
        // Query all test students with their assigned profile
        const { rows: students } = await pool.query(`
            SELECT u.id, u.email, sp.simulated_profile AS profile
            FROM public.users u
            JOIN public.student_profiles sp ON sp.user_id = u.id
            WHERE u.email ~ '^test[0-9]+@example\\.com$'
            ORDER BY u.email
        `)

        if (students.length === 0) {
            console.error('No test students found. Run migrations first.')
            process.exit(1)
        }

        console.log(`Found ${students.length} test students\n`)

        let totalDays = 0
        let failed    = 0

        for (const student of students) {
            try {
                totalDays += await seedUser(student.id, student.email, student.profile || 'average')
            } catch (err) {
                console.error(`  ✗ ${student.email}: ${err.message}`)
                failed++
            }
        }

        console.log('\n─────────────────────────────────────────────────')
        console.log(`Done!  Students: ${students.length - failed}/${students.length}  Total days seeded: ${totalDays}`)
        if (failed > 0) console.warn(`  ${failed} student(s) failed — check errors above`)
        console.log()
    } finally {
        await pool.end()
    }
}

main().catch(err => {
    console.error('\nFatal error:', err.message)
    process.exit(1)
})
