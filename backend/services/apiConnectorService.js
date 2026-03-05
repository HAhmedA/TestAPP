// API Connector Service
// Handles LLM API communication with LMStudio (OpenAI-compatible API)
// Future support for OpenAI and Google APIs

import logger from '../utils/logger.js'
import { getLlmConfig } from './llmConfigService.js'

/**
 * Send a chat completion request to the LLM
 * 
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} options - Optional overrides
 * @param {string} options.model - Model to use (defaults to mainModel)
 * @param {number} options.maxTokens - Max tokens for response
 * @param {number} options.temperature - Temperature for randomness
 * @returns {Promise<string>} - The assistant's response content
 */
async function chatCompletion(messages, options = {}) {
    const config = await getLlmConfig()
    const model = options.model || config.mainModel
    const maxTokens = options.maxTokens || config.maxTokens
    const temperature = options.temperature ?? config.temperature

    const endpoint = `${config.baseUrl}/chat/completions`

    const requestBody = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature
    }

    // Add API key header for cloud providers
    const headers = {
        'Content-Type': 'application/json'
    }
    if (config.apiKey && config.provider !== 'lmstudio') {
        headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    logger.info(`LLM request to ${config.provider} (${model}): ${messages.length} messages`)

    // Debug mode: log full request payload
    if (process.env.DEBUG_LLM === 'true') {
        logger.info('DEBUG_LLM - Full request payload:')
        console.log(JSON.stringify(requestBody, null, 2))
    }

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs)

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`LLM API error ${response.status}: ${errorText}`)
        }

        const data = await response.json()

        if (!data.choices || data.choices.length === 0) {
            throw new Error('LLM API returned no choices')
        }

        const content = data.choices[0].message?.content || ''
        logger.info(`LLM response received: ${content.length} chars`)

        return content
    } catch (error) {
        if (error.name === 'AbortError') {
            logger.error(`LLM request timed out after ${config.timeoutMs}ms`)
            throw new Error('LLM_TIMEOUT')
        }
        logger.error(`LLM API error: ${error.message}`)
        throw error
    }
}

/**
 * Send a chat completion request with retries
 * 
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} options - Options including retry configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: 2)
 * @returns {Promise<string>} - The assistant's response content
 */
async function chatCompletionWithRetry(messages, options = {}) {
    const maxRetries = options.maxRetries ?? 2
    let lastError

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await chatCompletion(messages, options)
        } catch (error) {
            lastError = error
            if (attempt < maxRetries) {
                // Exponential backoff: 1s, 2s, 4s...
                const delay = Math.pow(2, attempt) * 1000
                logger.warn(`LLM retry ${attempt + 1}/${maxRetries} after ${delay}ms`)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }

    throw lastError
}

/**
 * Check if the LLM server is available
 * 
 * @returns {Promise<{available: boolean, models: string[]}>}
 */
async function checkAvailability() {
    const config = await getLlmConfig()
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

        logger.info(`Checking LLM availability at ${config.baseUrl}/models`)

        const availHeaders = { 'Content-Type': 'application/json' }
        if (config.apiKey && config.provider !== 'lmstudio') {
            availHeaders['Authorization'] = `Bearer ${config.apiKey}`
        }

        const response = await fetch(`${config.baseUrl}/models`, {
            method: 'GET',
            headers: availHeaders,
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            logger.error(`LLM availability check failed with status: ${response.status}`)
            return { available: false, models: [] }
        }

        const data = await response.json()
        const models = data.data?.map(m => m.id) || []
        logger.info(`LLM available, models: ${models.join(', ')}`)
        return { available: true, models }
    } catch (error) {
        logger.error(`LLM availability check failed: ${error.name} - ${error.message}`)
        return { available: false, models: [] }
    }
}

/**
 * Estimate token count from text (rough approximation)
 * Uses ~4 characters per token as a rule of thumb
 * 
 * @param {string} text - Text to estimate
 * @returns {number} - Estimated token count
 */
function estimateTokens(text) {
    if (!text) return 0
    return Math.ceil(text.length / 4)
}

export {
    chatCompletion,
    chatCompletionWithRetry,
    checkAvailability,
    estimateTokens,
    getLlmConfig
}
