// Admin routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { DEFAULT_ALIGNMENT_PROMPT } from '../services/alignmentService.js'
import { getAnnotations } from '../services/annotators/srlAnnotationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { CONCEPT_NAMES, CONCEPT_IDS } from '../config/concepts.js'
import { getConceptPoolSizes, getUserConceptDataSet } from '../services/scoring/scoreQueryService.js'
import { getLlmConfig } from '../services/llmConfigService.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'

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
            computedAt: row.computed_at,
            coldStart: false
        }))

        // Add cold-start placeholder for concepts where the student has data
        // but the pool is too small for clustering (mirrors /api/scores logic).
        const MIN_CLUSTER_USERS = 10
        const [poolSizes, userHasData] = await Promise.all([
            getConceptPoolSizes(7),
            getUserConceptDataSet(studentId)
        ])
        const scoredConceptIds = new Set(rows.map(r => r.concept_id))
        for (const conceptId of CONCEPT_IDS) {
            if (!scoredConceptIds.has(conceptId) && userHasData.has(conceptId)) {
                if ((poolSizes[conceptId] || 0) < MIN_CLUSTER_USERS) {
                    scores.push({
                        conceptId,
                        conceptName: CONCEPT_NAMES[conceptId],
                        score: null,
                        trend: null,
                        breakdown: null,
                        yesterdayScore: null,
                        clusterLabel: null,
                        dialMin: 0,
                        dialCenter: 50,
                        dialMax: 100,
                        computedAt: null,
                        coldStart: true
                    })
                }
            }
        }

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

// Delete all student data (keeps users, profiles, surveys, prompts, csv logs)
router.delete('/clear-student-data', asyncRoute(async (req, res) => {
    await pool.query(`
        DELETE FROM public.sleep_judgments;
        DELETE FROM public.sleep_baselines;
        DELETE FROM public.sleep_sessions;
        DELETE FROM public.screen_time_judgments;
        DELETE FROM public.screen_time_baselines;
        DELETE FROM public.screen_time_sessions;
        DELETE FROM public.lms_judgments;
        DELETE FROM public.lms_baselines;
        DELETE FROM public.lms_sessions;
        DELETE FROM public.srl_annotations;
        DELETE FROM public.srl_responses;
        DELETE FROM public.questionnaire_results;
        DELETE FROM public.concept_score_history;
        DELETE FROM public.concept_scores;
        DELETE FROM public.user_cluster_assignments;
        DELETE FROM public.peer_clusters;
        DELETE FROM public.cluster_run_diagnostics;
    `)
    logger.warn(`Admin ${req.session.user?.email} cleared all student data`)
    res.json({ cleared: true })
}))

// ── Manual score recomputation ────────────────────────────────────
// Triggers the same pipeline the nightly cron runs, on demand.
// Useful after a CSV import to see scores without waiting until midnight.
router.post('/recompute-scores', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
        SELECT DISTINCT user_id FROM (
            SELECT user_id FROM public.sleep_sessions   WHERE is_simulated = false
            UNION
            SELECT user_id FROM public.screen_time_sessions WHERE is_simulated = false
            UNION
            SELECT user_id FROM public.srl_responses
            UNION
            SELECT user_id FROM public.lms_sessions     WHERE is_simulated = false
        ) active_users
    `)

    if (rows.length === 0) {
        return res.json({ recomputed: 0, errors: 0, message: 'No active users found' })
    }

    let recomputed = 0
    let errors = 0
    for (const { user_id } of rows) {
        try {
            // Pass null as lmsDays to use all-time window — essential after CSV imports
            // where data is typically older than the default 7-day rolling window.
            await computeAllScores(user_id, null)
            recomputed++
        } catch (err) {
            logger.error(`recompute-scores: failed for user ${user_id}: ${err.message}`)
            errors++
        }
    }

    logger.info(`Admin ${req.session.user?.email} triggered score recomputation: ${recomputed} ok, ${errors} errors`)
    res.json({ recomputed, errors, total: rows.length })
}))

// ── LLM Config endpoints ──────────────────────────────────────────

const MASK = '●●●●●●'

function validateLlmConfigBody(body) {
    const { provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs } = body
    if (!provider || typeof provider !== 'string') return 'provider is required'
    if (!baseUrl || typeof baseUrl !== 'string') return 'baseUrl is required'
    try { new URL(baseUrl) } catch { return 'baseUrl must be a valid URL' }
    if (!mainModel || typeof mainModel !== 'string') return 'mainModel is required'
    if (!judgeModel || typeof judgeModel !== 'string') return 'judgeModel is required'
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32000) return 'maxTokens must be integer 1–32000'
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) return 'temperature must be 0.0–2.0'
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) return 'timeoutMs must be integer 1000–120000'
    return null
}

router.get('/llm-config', asyncRoute(async (req, res) => {
    const cfg = await getLlmConfig()
    res.json({
        provider:    cfg.provider,
        baseUrl:     cfg.baseUrl,
        mainModel:   cfg.mainModel,
        judgeModel:  cfg.judgeModel,
        maxTokens:   cfg.maxTokens,
        temperature: cfg.temperature,
        timeoutMs:   cfg.timeoutMs,
        apiKey:      cfg.apiKey ? MASK : '',
        updatedAt:   cfg.updatedAt ?? null
    })
}))

router.put('/llm-config', asyncRoute(async (req, res) => {
    const { provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs, apiKey } = req.body
    const userId = req.session.user?.id

    const validationError = validateLlmConfigBody(req.body)
    if (validationError) throw Errors.VALIDATION(validationError)

    let resolvedApiKey = apiKey
    if (apiKey === MASK) {
        const current = await getLlmConfig()
        resolvedApiKey = current.apiKey
    }

    const { rows } = await pool.query(
        `INSERT INTO public.llm_config
            (provider, base_url, main_model, judge_model, max_tokens, temperature, timeout_ms, api_key, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING provider, base_url, main_model, judge_model, max_tokens, temperature, timeout_ms, updated_at`,
        [provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs, resolvedApiKey, userId]
    )

    const row = rows[0]
    logger.info(`LLM config updated by admin ${userId}: provider=${provider}`)
    res.json({
        provider:    row.provider,
        baseUrl:     row.base_url,
        mainModel:   row.main_model,
        judgeModel:  row.judge_model,
        maxTokens:   row.max_tokens,
        temperature: parseFloat(row.temperature),
        timeoutMs:   row.timeout_ms,
        apiKey:      resolvedApiKey ? MASK : '',
        updatedAt:   row.updated_at
    })
}))

router.post('/llm-config/test', asyncRoute(async (req, res) => {
    const { baseUrl, apiKey: submittedKey, provider } = req.body

    if (!baseUrl) throw Errors.VALIDATION('baseUrl is required')

    let apiKey = submittedKey
    if (submittedKey === MASK) {
        const current = await getLlmConfig()
        apiKey = current.apiKey
    }

    // Validate baseUrl to prevent SSRF
    const resolvedBaseUrl = baseUrl
    try {
        new URL(resolvedBaseUrl)
    } catch {
        return res.status(400).json({ success: false, error: 'baseUrl must be a valid URL' })
    }

    const headers = { 'Content-Type': 'application/json' }
    if (apiKey && provider !== 'lmstudio') {
        headers['Authorization'] = `Bearer ${apiKey}`
    }

    const start = Date.now()
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(`${resolvedBaseUrl}/models`, {
            method: 'GET', headers, signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
            return res.json({ success: false, models: [], latencyMs: Date.now() - start, error: `HTTP ${response.status}` })
        }

        const data = await response.json()
        const models = data.data?.map(m => m.id) || []
        res.json({ success: true, models, latencyMs: Date.now() - start })
    } catch (err) {
        res.json({ success: false, models: [], latencyMs: Date.now() - start, error: err.message })
    }
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
