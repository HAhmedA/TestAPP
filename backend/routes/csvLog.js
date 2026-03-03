// CSV Log Admin Routes
// All routes require admin privileges.
// File upload body is parsed globally in server.js (express.raw text/csv, 10mb limit).

import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { parseCsv, extractUniqueNames, processUpload } from '../services/csvLogService.js'

const router = Router()
router.use(requireAdmin)

// =============================================================================
// UPLOAD CSV
// POST /api/lms/admin/csv/upload
// Content-Type: text/csv  (raw body — no multipart)
// Header: X-Filename: <original filename>
// =============================================================================
router.post(
    '/admin/csv/upload',
    asyncRoute(async (req, res) => {
        const csvContent = req.body?.toString('utf8') || ''
        if (!csvContent.trim()) throw Errors.VALIDATION('CSV body is empty')

        const filename = req.headers['x-filename'] || 'upload.csv'
        const adminId  = req.session.user.id

        const rows = parseCsv(csvContent)
        if (rows.length === 0) throw Errors.VALIDATION('CSV has no data rows')

        const csvNames = extractUniqueNames(rows)

        const times = rows
            .map(r => new Date((r['Time'] || '').replace(',', '')))
            .filter(d => !isNaN(d.getTime()))
            .sort((a, b) => a - b)
        const dateRangeStart = times.length > 0 ? times[0].toISOString().slice(0, 10) : null
        const dateRangeEnd   = times.length > 0 ? times[times.length - 1].toISOString().slice(0, 10) : null

        const { rows: insertRows } = await pool.query(
            `INSERT INTO public.csv_log_uploads
                 (uploaded_by, filename, csv_content, row_count, date_range_start, date_range_end)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [adminId, filename, csvContent, rows.length, dateRangeStart, dateRangeEnd]
        )
        const uploadId = insertRows[0].id

        const { rows: mappingRows } = await pool.query(
            `SELECT cpa.csv_name, cpa.user_id, u.email
             FROM public.csv_participant_aliases cpa
             JOIN public.users u ON u.id = cpa.user_id
             WHERE cpa.csv_name = ANY($1)`,
            [csvNames]
        )
        const existingMappings = {}
        for (const m of mappingRows) {
            existingMappings[m.csv_name] = { userId: m.user_id, email: m.email }
        }

        logger.info(`CSV upload by admin ${adminId}: ${rows.length} rows, ${csvNames.length} participants`)

        res.status(201).json({
            uploadId,
            rowCount: rows.length,
            dateRange: { start: dateRangeStart, end: dateRangeEnd },
            csvNames,
            existingMappings,
        })
    })
)

// =============================================================================
// GET ALL MAPPINGS
// GET /api/lms/admin/csv/participants
// =============================================================================
router.get('/admin/csv/participants', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT cpa.id, cpa.csv_name, cpa.user_id, u.email, cpa.created_at
         FROM public.csv_participant_aliases cpa
         JOIN public.users u ON u.id = cpa.user_id
         ORDER BY cpa.csv_name`
    )
    res.json({ mappings: rows })
}))

// =============================================================================
// CREATE/UPDATE MAPPING
// POST /api/lms/admin/csv/mapping
// Body: { csvName: string, userId: string }
// =============================================================================
router.post('/admin/csv/mapping', asyncRoute(async (req, res) => {
    const { csvName, userId } = req.body
    if (!csvName || typeof csvName !== 'string') throw Errors.VALIDATION('csvName is required')
    if (!userId  || typeof userId  !== 'string') throw Errors.VALIDATION('userId is required')

    const { rows: userRows } = await pool.query(
        `SELECT id, email FROM public.users WHERE id = $1 AND role = 'student'`,
        [userId]
    )
    if (userRows.length === 0) throw Errors.NOT_FOUND('Student user')

    const { rows } = await pool.query(
        `INSERT INTO public.csv_participant_aliases (csv_name, user_id)
         VALUES ($1, $2)
         ON CONFLICT (csv_name) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING id, csv_name, user_id`,
        [csvName.trim(), userId]
    )
    res.status(201).json({ mapping: { ...rows[0], email: userRows[0].email } })
}))

// =============================================================================
// DELETE MAPPING
// DELETE /api/lms/admin/csv/mapping/:csvName
// =============================================================================
router.delete('/admin/csv/mapping/:csvName', asyncRoute(async (req, res) => {
    const csvName = decodeURIComponent(req.params.csvName)
    const { rowCount } = await pool.query(
        `DELETE FROM public.csv_participant_aliases WHERE csv_name = $1`,
        [csvName]
    )
    if (rowCount === 0) throw Errors.NOT_FOUND('Mapping')
    res.json({ deleted: true, csvName })
}))

// =============================================================================
// DELETE MAPPING + LMS DATA
// DELETE /api/lms/admin/csv/mapping/:csvName/with-data
// Removes the alias mapping AND all non-simulated lms_sessions for that user.
// =============================================================================
router.delete('/admin/csv/mapping/:csvName/with-data', asyncRoute(async (req, res) => {
    const csvName = decodeURIComponent(req.params.csvName)

    // Resolve user_id before deleting the mapping row
    const { rows: aliasRows } = await pool.query(
        `SELECT user_id FROM public.csv_participant_aliases WHERE csv_name = $1`,
        [csvName]
    )
    if (aliasRows.length === 0) throw Errors.NOT_FOUND('Mapping')
    const userId = aliasRows[0].user_id

    const client = await pool.connect()
    try {
        await client.query('BEGIN')

        const { rowCount: sessionsDeleted } = await client.query(
            `DELETE FROM public.lms_sessions WHERE user_id = $1 AND is_simulated = false`,
            [userId]
        )
        await client.query(
            `DELETE FROM public.csv_participant_aliases WHERE csv_name = $1`,
            [csvName]
        )

        await client.query('COMMIT')
        logger.info(`CSV wipe: removed mapping and ${sessionsDeleted} sessions for user ${userId} (csv_name=${csvName})`)
        res.json({ deleted: true, csvName, sessionsDeleted })
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
}))

// =============================================================================
// IMPORT
// POST /api/lms/admin/csv/import/:uploadId
// =============================================================================
router.post('/admin/csv/import/:uploadId', asyncRoute(async (req, res) => {
    const { uploadId } = req.params

    const { rows: uploadRows } = await pool.query(
        `SELECT id, status FROM public.csv_log_uploads WHERE id = $1`,
        [uploadId]
    )
    if (uploadRows.length === 0) throw Errors.NOT_FOUND('CSV upload')
    if (uploadRows[0].status === 'imported') {
        throw Errors.VALIDATION('This upload has already been imported. Upload a new file to import again.')
    }

    logger.info(`CSV import started: uploadId=${uploadId}`)
    const result = await processUpload(uploadId)
    logger.info(`CSV import complete: ${result.imported} imported, ${result.skipped} skipped`)

    res.json(result)
}))

export default router
