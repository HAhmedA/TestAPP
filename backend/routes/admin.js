// Admin routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { DEFAULT_ALIGNMENT_PROMPT } from '../services/alignmentService.js'
import { getAnnotations } from '../services/annotators/srlAnnotationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { CONCEPT_NAMES } from '../config/concepts.js'

const router = Router()

// All admin routes require admin privileges
router.use(requireAdmin)

// Valid prompt types
const VALID_PROMPT_TYPES = ['system', 'alignment']

// Get prompt by type (default: system)
router.get('/prompt', asyncRoute(async (req, res) => {
        const promptType = req.query.type || 'system'

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            throw Errors.VALIDATION(`invalid_prompt_type — valid: ${VALID_PROMPT_TYPES.join(', ')}`)
        }

        const { rows } = await pool.query(
            `SELECT prompt, prompt_type, updated_at
             FROM public.system_prompts
             WHERE prompt_type = $1
             ORDER BY updated_at DESC LIMIT 1`,
            [promptType]
        )

        if (rows.length === 0) {
            const defaultPrompt = promptType === 'system' ? 'Be Ethical' : DEFAULT_ALIGNMENT_PROMPT
            return res.json({ prompt: defaultPrompt, prompt_type: promptType, updated_at: null })
        }

        res.json(rows[0])
}))

// Get all prompts (both types)
router.get('/prompts', asyncRoute(async (req, res) => {
        const prompts = {}

        for (const type of VALID_PROMPT_TYPES) {
            const { rows } = await pool.query(
                `SELECT prompt, prompt_type, updated_at
                 FROM public.system_prompts
                 WHERE prompt_type = $1
                 ORDER BY updated_at DESC LIMIT 1`,
                [type]
            )

            prompts[type] = rows.length > 0 ? rows[0] : {
                prompt: type === 'system' ? 'Be Ethical' : DEFAULT_ALIGNMENT_PROMPT,
                prompt_type: type,
                updated_at: null
            }
        }

        res.json(prompts)
}))

// Update prompt by type
router.put('/prompt', asyncRoute(async (req, res) => {
        const { prompt, type } = req.body
        const promptType = type || 'system'
        const userId = req.session.user?.id

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            throw Errors.VALIDATION(`invalid_prompt_type — valid: ${VALID_PROMPT_TYPES.join(', ')}`)
        }

        if (!prompt || typeof prompt !== 'string') {
            throw Errors.VALIDATION('prompt is required')
        }

        // Insert new prompt (keep history)
        const { rows } = await pool.query(
            `INSERT INTO public.system_prompts (prompt, prompt_type, created_by, updated_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING prompt, prompt_type, updated_at`,
            [prompt, promptType, userId]
        )

        logger.info(`${promptType} prompt updated by admin: ${userId}`)
        res.json(rows[0])
}))

// ── Student viewer endpoints ──────────────────────────────────────

// List all student users
router.get('/students', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT id, name, email FROM public.users WHERE role = 'student' ORDER BY created_at DESC`
        )
        res.json({ students: rows })
}))

// Get concept scores for a specific student (mirrors /api/scores logic)
router.get('/students/:studentId/scores', asyncRoute(async (req, res) => {
        const { studentId } = req.params

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1
             ORDER BY concept_id`,
            [studentId]
        )

        // Yesterday scores
        const { rows: yesterdayRows } = await pool.query(
            `SELECT concept_id, score
             FROM public.concept_score_history
             WHERE user_id = $1 AND score_date = CURRENT_DATE - 1`,
            [studentId]
        )
        const yesterdayScores = {}
        for (const r of yesterdayRows) {
            yesterdayScores[r.concept_id] = Math.round(parseFloat(r.score) * 100) / 100
        }

        // Cluster info
        const { rows: clusterRows } = await pool.query(
            `SELECT uca.concept_id, uca.cluster_label, uca.cluster_index,
                    uca.percentile_position,
                    pc.p5, pc.p50, pc.p95, pc.user_count,
                    (SELECT COUNT(*) FROM public.peer_clusters pc2
                     WHERE pc2.concept_id = uca.concept_id) AS total_clusters
             FROM public.user_cluster_assignments uca
             JOIN public.peer_clusters pc
               ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
             WHERE uca.user_id = $1`,
            [studentId]
        )
        const clusterInfo = {}
        for (const r of clusterRows) {
            clusterInfo[r.concept_id] = {
                clusterLabel: r.cluster_label,
                clusterIndex: parseInt(r.cluster_index, 10),
                totalClusters: parseInt(r.total_clusters, 10),
                percentilePosition: parseFloat(r.percentile_position) || 50,
                clusterUserCount: parseInt(r.user_count, 10),
                dialMin: Math.round(parseFloat(r.p5) * 100) / 100,
                dialCenter: Math.round(parseFloat(r.p50) * 100) / 100,
                dialMax: Math.round(parseFloat(r.p95) * 100) / 100
            }
        }

        const scores = rows.map(row => ({
            conceptId: row.concept_id,
            conceptName: CONCEPT_NAMES[row.concept_id] || row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            breakdown: row.aspect_breakdown,
            yesterdayScore: yesterdayScores[row.concept_id] || null,
            clusterLabel: clusterInfo[row.concept_id]?.clusterLabel || null,
            clusterIndex: clusterInfo[row.concept_id]?.clusterIndex ?? null,
            totalClusters: clusterInfo[row.concept_id]?.totalClusters ?? null,
            percentilePosition: clusterInfo[row.concept_id]?.percentilePosition ?? null,
            clusterUserCount: clusterInfo[row.concept_id]?.clusterUserCount ?? null,
            dialMin: clusterInfo[row.concept_id]?.dialMin || 0,
            dialCenter: clusterInfo[row.concept_id]?.dialCenter || 50,
            dialMax: clusterInfo[row.concept_id]?.dialMax || 100,
            computedAt: row.computed_at
        }))

        res.json({ scores })
}))

// Get annotations for a specific student
router.get('/students/:studentId/annotations', asyncRoute(async (req, res) => {
        const { studentId } = req.params
        const { timeWindow } = req.query
        const annotations = await getAnnotations(pool, studentId, timeWindow, false)
        res.json({ annotations })
}))

// Cluster diagnostics — most-recent run per concept
router.get('/cluster-diagnostics', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT DISTINCT ON (concept_id)
                id, concept_id, selected_k, selected_cov_type,
                silhouette_score, davies_bouldin_index,
                all_candidates, cluster_sizes, n_users, n_dimensions, computed_at
         FROM public.cluster_run_diagnostics
         ORDER BY concept_id, computed_at DESC`
    )
    const diagnostics = rows.map(r => ({
        conceptId: r.concept_id,
        selectedK: r.selected_k,
        selectedCovType: r.selected_cov_type,
        silhouetteScore: r.silhouette_score != null ? parseFloat(r.silhouette_score) : null,
        daviesBouldinIndex: r.davies_bouldin_index != null ? parseFloat(r.davies_bouldin_index) : null,
        allCandidates: r.all_candidates,
        clusterSizes: r.cluster_sizes,
        nUsers: r.n_users,
        nDimensions: r.n_dimensions,
        computedAt: r.computed_at
    }))
    res.json({ diagnostics })
}))

// Cluster members — all students with their cluster assignments and scores
router.get('/cluster-members', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT
            uca.concept_id,
            uca.cluster_index,
            uca.cluster_label,
            uca.percentile_position,
            u.id          AS user_id,
            u.name,
            u.email,
            cs.score,
            cs.trend,
            cs.aspect_breakdown,
            pc.p50        AS cluster_p50
         FROM public.user_cluster_assignments uca
         JOIN public.users u
             ON u.id = uca.user_id
         LEFT JOIN public.concept_scores cs
             ON cs.user_id = uca.user_id AND cs.concept_id = uca.concept_id
         JOIN public.peer_clusters pc
             ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
         ORDER BY uca.concept_id, uca.cluster_index, uca.percentile_position DESC`
    )
    const members = rows.map(r => ({
        conceptId: r.concept_id,
        clusterIndex: parseInt(r.cluster_index, 10),
        clusterLabel: r.cluster_label,
        clusterP50: r.cluster_p50 != null ? parseFloat(r.cluster_p50) : null,
        userId: r.user_id,
        name: r.name,
        email: r.email.split('@')[0],
        score: r.score != null ? parseFloat(r.score) : null,
        trend: r.trend,
        percentilePosition: r.percentile_position != null ? parseFloat(r.percentile_position) : null,
        breakdown: r.aspect_breakdown || null
    }))
    res.json({ members })
}))

// Legacy routes for backwards compatibility
router.get('/system-prompt', async (req, res) => {
    req.query.type = 'system'
    return router.handle(req, res)
})

router.put('/system-prompt', async (req, res) => {
    req.body.type = 'system'
    return router.handle(req, res)
})

export default router
