// CSV Log Service
// Parses Moodle activity log CSV exports, computes EALT session metrics,
// classifies events by Component, and writes to lms_sessions.

import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { withTransaction } from '../utils/withTransaction.js'
import { batchScoreLMSCohort } from './scoring/scoreComputationService.js'
import { computeJudgments } from './annotators/lmsAnnotationService.js'

// =============================================================================
// CSV PARSING
// =============================================================================

function parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
            result.push(current)
            current = ''
        } else {
            current += ch
        }
    }
    result.push(current)
    return result
}

function parseCsv(text) {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    const headers = parseCsvLine(lines[0]).map(h => h.trim())
    return lines.slice(1).map(line => {
        const values = parseCsvLine(line)
        const row = {}
        headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim() })
        return row
    }).filter(row => Object.values(row).some(v => v !== ''))
}

function extractUniqueNames(rows) {
    const names = new Set(
        rows
            .map(r => r['User full name'])
            .filter(n => n && n.trim())
    )
    return [...names].sort()
}

// =============================================================================
// EVENT CLASSIFICATION
// =============================================================================

function classifyComponent(component, eventName) {
    switch (component) {
        case 'Quiz':
            return { exercise_practice_events: 1 }
        case 'Assignment':
            return { assignment_work_events: 1 }
        case 'Forum': {
            const lower = (eventName || '').toLowerCase()
            if (lower.includes('created') || lower.includes('posted')) {
                return { forum_posts: 1 }
            }
            return { forum_views: 1 }
        }
        default:
            return {}
    }
}

// =============================================================================
// EALT ALGORITHM
// =============================================================================

const SESSION_GAP_MS = 30 * 60 * 1000
const EVENT_CAP_MIN  = 10

function computeEalt(events) {
    if (events.length === 0) {
        return {
            number_of_sessions: 0,
            total_active_minutes: 0,
            longest_session_minutes: 0,
            session_durations: []
        }
    }

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
    const sessionDurations = []
    let currentSessionMin = 0

    for (let i = 0; i < sorted.length; i++) {
        const next = sorted[i + 1]

        if (!next) {
            sessionDurations.push(Math.round(currentSessionMin))
            break
        }

        const gapMs  = next.timestamp - sorted[i].timestamp
        const gapMin = gapMs / 60000

        if (gapMs > SESSION_GAP_MS) {
            // For a single-event session (no accumulated time), credit a tail cap
            if (currentSessionMin === 0) {
                currentSessionMin = EVENT_CAP_MIN
            }
            sessionDurations.push(Math.round(currentSessionMin))
            currentSessionMin = 0
        } else {
            currentSessionMin += Math.min(gapMin, EVENT_CAP_MIN)
        }
    }

    const total   = sessionDurations.reduce((s, d) => s + d, 0)
    const longest = sessionDurations.length > 0 ? Math.max(...sessionDurations) : 0

    return {
        number_of_sessions:      sessionDurations.length,
        total_active_minutes:    total,
        longest_session_minutes: longest,
        session_durations:       sessionDurations
    }
}

// =============================================================================
// AGGREGATION
// =============================================================================

function parseMoodleTime(timeStr) {
    if (!timeStr) return null

    // ── Format 1: YYYY-MM-DD HH:MM:SS  (ISO-like, 24-hour, no T separator)
    //   e.g. "2019-10-26 09:37:12"
    const isoSpaceMatch = timeStr.match(
        /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/
    )
    if (isoSpaceMatch) {
        const [, year, month, day, hour, min, sec] = isoSpaceMatch
        const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day),
                           parseInt(hour), parseInt(min), parseInt(sec))
        return isNaN(d.getTime()) ? null : d
    }

    // ── Format 2: M/D/YYYY H:MM:SS AM/PM  (US locale, 12-hour)
    //   e.g. "10/15/2019 3:47:25 PM"
    const usMatch = timeStr.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i
    )
    if (usMatch) {
        const [, month, day, year, rawHour, min, sec, meridiem] = usMatch
        let hour = parseInt(rawHour)
        if (meridiem.toUpperCase() === 'PM' && hour !== 12) hour += 12
        if (meridiem.toUpperCase() === 'AM' && hour === 12) hour = 0
        const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day),
                           hour, parseInt(min), parseInt(sec))
        return isNaN(d.getTime()) ? null : d
    }

    // ── Format 3: D/M/YY HH:MM:SS  (Moodle numeric locale, 24-hour)
    //   e.g. "30/05/25, 21:28:10"
    // new Date() treats slashes as M/D/Y which breaks this format for day≤12,
    // so we parse it explicitly.
    const moodleNumericMatch = timeStr.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/
    )
    if (moodleNumericMatch) {
        const [, day, month, year, hour, min, sec] = moodleNumericMatch
        const fullYear = year.length === 2 ? 2000 + parseInt(year) : parseInt(year)
        const d = new Date(fullYear, parseInt(month) - 1, parseInt(day),
                           parseInt(hour), parseInt(min), parseInt(sec))
        return isNaN(d.getTime()) ? null : d
    }

    // ── Format 4: "D Month YYYY, H:MM:SS AM/PM"  (Moodle English locale)
    //   e.g. "1 March 2026, 10:00:00 AM" — new Date() handles this on V8.
    const d = new Date(timeStr.replace(',', ''))
    return isNaN(d.getTime()) ? null : d
}

function toDateString(d) {
    return d.toISOString().slice(0, 10)
}

function aggregateCsvToDaily(csvName, rows) {
    const userEvents = rows
        .filter(r => r['User full name'] === csvName)
        .map(r => ({
            timestamp: parseMoodleTime(r['Time']),
            component: r['Component'] || '',
            eventName: r['Event name'] || ''
        }))
        .filter(e => e.timestamp !== null)

    if (userEvents.length === 0) return []

    const byDate = {}
    for (const event of userEvents) {
        const date = toDateString(event.timestamp)
        if (!byDate[date]) byDate[date] = []
        byDate[date].push(event)
    }

    return Object.entries(byDate).map(([date, events]) => {
        const ealt = computeEalt(events)

        const counters = {
            exercise_practice_events: 0,
            assignment_work_events:   0,
            forum_views:              0,
            forum_posts:              0,
        }
        for (const event of events) {
            const inc = classifyComponent(event.component, event.eventName)
            for (const [k, v] of Object.entries(inc)) {
                counters[k] = (counters[k] || 0) + v
            }
        }

        return {
            session_date:              date,
            total_active_minutes:      ealt.total_active_minutes,
            total_events:              events.length,
            number_of_sessions:        ealt.number_of_sessions,
            longest_session_minutes:   ealt.longest_session_minutes,
            days_active_in_period:     1,
            reading_minutes:           0,
            watching_minutes:          0,
            exercise_practice_events:  counters.exercise_practice_events,
            assignment_work_events:    counters.assignment_work_events,
            forum_views:               counters.forum_views,
            forum_posts:               counters.forum_posts,
            session_durations:         ealt.session_durations,
        }
    })
}

// =============================================================================
// EXPORTS (pure functions)
// =============================================================================

export {
    parseCsv,
    extractUniqueNames,
    classifyComponent,
    computeEalt,
    aggregateCsvToDaily,
}

// =============================================================================
// DB OPERATIONS
// =============================================================================

async function upsertSessionRows(client, userId, dailyRows) {
    for (const row of dailyRows) {
        await client.query(
            `INSERT INTO public.lms_sessions
                 (user_id, session_date, total_active_minutes, total_events,
                  number_of_sessions, longest_session_minutes, days_active_in_period,
                  reading_minutes, watching_minutes, exercise_practice_events,
                  assignment_work_events, forum_views, forum_posts,
                  session_durations, is_simulated)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
                 session_durations        = EXCLUDED.session_durations,
                 is_simulated             = EXCLUDED.is_simulated`,
            [
                userId, row.session_date,
                row.total_active_minutes, row.total_events,
                row.number_of_sessions, row.longest_session_minutes,
                row.days_active_in_period, row.reading_minutes, row.watching_minutes,
                row.exercise_practice_events, row.assignment_work_events,
                row.forum_views, row.forum_posts,
                JSON.stringify(row.session_durations), false
            ]
        )
    }

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
}

async function processUpload(uploadId) {
    try {
        const { rows: uploadRows } = await pool.query(
            `SELECT id, csv_content FROM public.csv_log_uploads WHERE id = $1`,
            [uploadId]
        )
        if (uploadRows.length === 0) throw new Error(`Upload ${uploadId} not found`)
        const csvContent = uploadRows[0].csv_content

        const { rows: mappings } = await pool.query(
            `SELECT cpa.csv_name, cpa.user_id, u.email
             FROM public.csv_participant_aliases cpa
             JOIN public.users u ON u.id = cpa.user_id`
        )
        if (mappings.length === 0) {
            return { imported: 0, skipped: 0, details: [] }
        }

        const rows = parseCsv(csvContent)

        const details = []
        let imported = 0
        let skipped  = 0

        // ── Phase 1: write all sessions (per-student error isolation) ──────────
        const importedMappings = []

        for (const mapping of mappings) {
            const dailyRows = aggregateCsvToDaily(mapping.csv_name, rows)
            if (dailyRows.length === 0) {
                skipped++
                details.push({ csvName: mapping.csv_name, email: mapping.email, daysUpdated: 0, totalEvents: 0 })
                continue
            }

            try {
                await withTransaction(pool, async (client) => {
                    await upsertSessionRows(client, mapping.user_id, dailyRows)
                })

                importedMappings.push({ ...mapping, dailyRows })

                const totalEvents = dailyRows.reduce((s, r) => s + r.total_events, 0)
                imported++
                details.push({
                    csvName:     mapping.csv_name,
                    email:       mapping.email,
                    daysUpdated: dailyRows.length,
                    totalEvents,
                })
                logger.info(`CSV import: ${mapping.csv_name} → ${mapping.email}: ${dailyRows.length} days, ${totalEvents} events`)
            } catch (studentErr) {
                logger.error(`CSV import: failed for ${mapping.csv_name} (${mapping.email}): ${studentErr.message}`)
                skipped++
                details.push({ csvName: mapping.csv_name, email: mapping.email, daysUpdated: 0, totalEvents: 0 })
            }
        }

        // ── Phase 2: single batch rescore after all writes complete ───────────
        if (importedMappings.length > 0) {
            // ONE PGMoE run — all students scored against the same complete pool (all-time window)
            batchScoreLMSCohort().catch(err =>
                logger.error(`CSV import: batchScoreLMSCohort error: ${err.message}`)
            )

            // Per-user judgments (reads lms_sessions directly, doesn't need scoring to finish)
            for (const m of importedMappings) {
                computeJudgments(pool, m.user_id).catch(err =>
                    logger.error(`CSV import: computeJudgments error for ${m.user_id}: ${err.message}`)
                )
            }
        }

        await pool.query(
            `UPDATE public.csv_log_uploads SET status = 'imported', imported_at = NOW() WHERE id = $1`,
            [uploadId]
        )

        return { imported, skipped, details }
    } catch (err) {
        // Mark upload as failed so admin knows to retry
        await pool.query(
            `UPDATE public.csv_log_uploads SET status = 'failed' WHERE id = $1`,
            [uploadId]
        ).catch(updateErr => logger.error(`CSV import: could not write failed status: ${updateErr.message}`))
        throw err
    }
}

export { processUpload }
