import pool from '../config/database.js'
import logger from '../utils/logger.js'

let _cache = null
let _cacheExpiry = 0
const CACHE_TTL_MS = 60_000

function envFallback() {
    return {
        provider:    process.env.LLM_PROVIDER    || 'lmstudio',
        baseUrl:     process.env.LLM_BASE_URL     || 'http://host.docker.internal:1234/v1',
        mainModel:   process.env.LLM_MAIN_MODEL   || 'hermes-3-llama-3.2-3b',
        judgeModel:  process.env.LLM_JUDGE_MODEL  || 'qwen2.5-3b-instruct',
        maxTokens:   parseInt(process.env.LLM_MAX_TOKENS  || '2000', 10),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
        timeoutMs:   parseInt(process.env.LLM_TIMEOUT_MS  || '30000', 10),
        apiKey:      process.env.LLM_API_KEY       || '',
        updatedAt:   null
    }
}

/** Exposed only for unit tests — resets the in-memory cache. */
export function _resetCacheForTesting() {
    _cache = null
    _cacheExpiry = 0
}

/** Call after saving new config so the next request reads from DB immediately. */
export function clearLlmConfigCache() {
    _cache = null
    _cacheExpiry = 0
}

export async function getLlmConfig() {
    if (_cache && Date.now() < _cacheExpiry) return _cache

    try {
        const { rows } = await pool.query(
            `SELECT provider, base_url, main_model, judge_model,
                    max_tokens, temperature, timeout_ms, api_key, updated_at
             FROM public.llm_config
             ORDER BY updated_at DESC LIMIT 1`
        )

        if (rows.length === 0) {
            const result = envFallback()
            _cache = result
            _cacheExpiry = Date.now() + CACHE_TTL_MS
            return result
        }

        const row = rows[0]
        const result = {
            provider:    row.provider,
            baseUrl:     row.base_url,
            mainModel:   row.main_model,
            judgeModel:  row.judge_model,
            maxTokens:   row.max_tokens,
            temperature: parseFloat(row.temperature),
            timeoutMs:   row.timeout_ms,
            apiKey:      row.api_key ?? '',
            updatedAt:   row.updated_at ?? null
        }
        _cache = result
        _cacheExpiry = Date.now() + CACHE_TTL_MS
        return result
    } catch (err) {
        logger.warn('getLlmConfig: DB error, falling back to env vars:', err.message)
        return envFallback()
    }
}
