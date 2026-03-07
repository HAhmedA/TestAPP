// Context Manager Service
// Manages current chat session and orchestrates the message flow
// Handles session lifecycle, message persistence, and error handling

import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { chatCompletionWithRetry, checkAvailability } from './apiConnectorService.js'
import { assemblePrompt, assembleInitialGreetingPrompt, getSystemInstructionsForAlignment, hasStudentProfile } from './promptAssemblerService.js'
import { getAlignedResponse, quickValidation, SERVICE_UNAVAILABLE_MESSAGE, ALIGNMENT_FAILED_MESSAGE } from './alignmentService.js'
import { invalidateSummary } from './summarizationService.js'
import { hasSRLData } from './annotators/srlAnnotationService.js'
import { isGreetingStale } from './chatbotPreferencesService.js'
import {
    GREETING_NO_DATA_WITH_PROFILE,
    GREETING_NO_DATA_NO_PROFILE,
    GREETING_FALLBACK,
    SESSION_TIMEOUT_SECONDS
} from '../constants.js'

/**
 * Get or create an active session for a user
 * Handles session expiry and creates new session if needed
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{sessionId: string, isNew: boolean}>}
 */
async function getOrCreateSession(userId) {
    // First, expire any timed-out sessions
    await pool.query(
        `UPDATE public.chat_sessions
         SET is_active = false, ended_at = NOW()
         WHERE user_id = $1 
           AND is_active = true
           AND last_activity_at < NOW() - (timeout_seconds || ' seconds')::INTERVAL`,
        [userId]
    )

    // Try to get existing active session
    const { rows: existing } = await pool.query(
        `SELECT id FROM public.chat_sessions 
         WHERE user_id = $1 AND is_active = true
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
    )

    if (existing.length > 0) {
        // Update last activity
        await pool.query(
            `UPDATE public.chat_sessions SET last_activity_at = NOW() WHERE id = $1`,
            [existing[0].id]
        )
        return { sessionId: existing[0].id, isNew: false }
    }

    // Create new session
    const { rows: newSession } = await pool.query(
        `INSERT INTO public.chat_sessions (user_id, timeout_seconds)
         VALUES ($1, $2)
         RETURNING id`,
        [userId, SESSION_TIMEOUT_SECONDS]
    )

    logger.info(`Created new chat session for user ${userId}: ${newSession[0].id}`)
    return { sessionId: newSession[0].id, isNew: true }
}

/**
 * Save a message to the database
 * 
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {Object} metadata - Additional metadata (alignment info)
 * @returns {Promise<string>} - Message ID
 */
async function saveMessage(sessionId, userId, role, content, metadata = {}) {
    const { rows } = await pool.query(
        `INSERT INTO public.chat_messages 
         (session_id, user_id, role, content, alignment_passed, alignment_retries)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [sessionId, userId, role, content, metadata.passed ?? null, metadata.retries ?? 0]
    )

    // Invalidate today's summary since we have new messages
    const today = new Date().toISOString().split('T')[0]
    await invalidateSummary(userId, today)

    return rows[0].id
}

/**
 * Get chat history for a session with pagination
 * 
 * @param {string} sessionId - Session ID
 * @param {number} limit - Max messages to return
 * @param {string} beforeId - Get messages before this ID (for pagination)
 * @returns {Promise<Array>}
 */
async function getSessionHistory(sessionId, limit = 20, beforeId = null) {
    let query = `
        SELECT id, role, content, created_at 
        FROM public.chat_messages 
        WHERE session_id = $1`
    const params = [sessionId]

    if (beforeId) {
        query += ` AND created_at < (SELECT created_at FROM public.chat_messages WHERE id = $2)`
        params.push(beforeId)
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
    params.push(limit)

    const { rows } = await pool.query(query, params)
    // Reverse to get chronological order
    return rows.reverse()
}

/**
 * Get all sessions for a user (for history view)
 * 
 * @param {string} userId - User ID
 * @param {number} limit - Max sessions to return
 * @returns {Promise<Array>}
 */
async function getUserSessions(userId, limit = 10) {
    const { rows } = await pool.query(
        `SELECT id, is_active, created_at, ended_at, last_activity_at
         FROM public.chat_sessions 
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    )
    return rows
}

/**
 * Get all user messages for a session to filter suggested prompts
 * 
 * @param {string} sessionId - Session ID
 * @returns {Promise<string[]>}
 */
async function getSessionUserMessages(sessionId) {
    const { rows } = await pool.query(
        `SELECT content FROM public.chat_messages 
         WHERE session_id = $1 AND role = 'user'`,
        [sessionId]
    )
    return rows.map(r => r.content)
}

/**
 * Parse follow-up suggestions embedded in LLM response via XML tags
 * Also returns the cleaned response without the XML tags
 * 
 * @param {string} response - The raw LLM response
 * @returns {{cleanedResponse: string, suggestions: string[]}}
 */
function parseFollowUpSuggestions(response) {
    const defaultSuggestions = []

    // Match the <followups>...</followups> block
    const followupsMatch = response.match(/<followups>[\s\S]*?<\/followups>/i)

    if (!followupsMatch) {
        return { cleanedResponse: response.trim(), suggestions: defaultSuggestions }
    }

    // Extract individual suggestions
    const suggestionsBlock = followupsMatch[0]
    const suggestionMatches = suggestionsBlock.match(/<suggestion>([^<]+)<\/suggestion>/gi)

    const suggestions = []
    if (suggestionMatches) {
        for (const match of suggestionMatches) {
            const content = match.replace(/<\/?suggestion>/gi, '').trim()
            if (content && content.length > 3 && content.length <= 60) {
                suggestions.push(content)
            }
        }
    }

    // Remove the followups block from the response
    let cleanedResponse = response.replace(/<followups>[\s\S]*?<\/followups>/i, '').trim()

    // Strip any orphaned <suggestion> tags that leaked outside the block
    cleanedResponse = cleanedResponse.replace(/<\/?suggestion>/gi, '').trim()

    return { cleanedResponse, suggestions }
}

/**
 * Generate contextual follow-up prompt suggestions based on the conversation
 * Creates diverse, specific prompts that directly reflect the chatbot's response
 * 
 * @param {string} assistantResponse - The assistant's response to base suggestions on
 * @param {string} userMessage - The original user message for context
 * @param {string} sessionId - Current Session ID (to filter used prompts)
 * @returns {Promise<string[]>} - Array of 3-4 suggested follow-up prompts
 */
async function generateFollowUpPrompts(assistantResponse, userMessage, sessionId = null) {
    const defaultPrompts = [
        "What are the best studying strategies based on my profile?",
        "Analyze my SRL data",
        "What are my learning trends?",
        "How can I improve based on my history?"
    ]

    // Fetch used messages to filter them out
    let usedMessages = []
    if (sessionId) {
        try {
            usedMessages = await getSessionUserMessages(sessionId)
        } catch (err) {
            logger.warn(`Failed to fetch session messages for prompt filtering: ${err.message}`)
        }
    }

    // Normalize for comparison
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim()
    const usedSet = new Set(usedMessages.map(normalize))

    const filterPrompts = (prompts) => {
        return prompts.filter(p => !usedSet.has(normalize(p)))
    }

    const filteredDefaults = filterPrompts(defaultPrompts)

    try {
        const messages = [
            {
                role: 'system',
                content: `You generate follow-up questions for students in a learning chatbot.

CRITICAL RULES:
1. Extract 2-3 SPECIFIC topics/concepts mentioned in the assistant's response
2. Create questions that DIRECTLY reference those specific topics
3. Questions must feel like natural conversation continuations
4. Mix question types: "How", "Why", "Can you", "What about"
5. Each question under 50 characters
6. NO generic questions like "tell me more" or "how can I improve"
7. Return ONLY a JSON array of 4 strings

EXAMPLE:
If response mentions "time management struggles" and "high motivation":
["How do I manage my time better?", "Why is my motivation high?", "Tips for meeting deadlines?", "What affects my focus?"]

If response mentions "anxiety levels" and "seeking help":
["How can I reduce study anxiety?", "When should I ask for help?", "What causes my stress?", "Who can I reach out to?"]`
            },
            {
                role: 'user',
                content: `STUDENT ASKED: "${userMessage}"

ASSISTANT RESPONDED (excerpt):
"${assistantResponse.substring(0, 600)}"

Generate 4 specific follow-up questions based on the topics in this response:`
            }
        ]

        const response = await chatCompletionWithRetry(messages, {
            maxTokens: 150,
            temperature: 0.8
        })

        logger.debug(`Prompt generation raw response: ${response}`)

        // Parse the JSON response - handle potential markdown wrapping
        const cleanResponse = response.replace(/```json/g, '').replace(/```/g, '').trim()
        let parsed
        try {
            parsed = JSON.parse(cleanResponse)
        } catch (e) {
            // Try to find JSON array in the text if direct parse fails
            const arrayMatch = cleanResponse.match(/\[.*\]/s)
            if (arrayMatch) {
                try {
                    parsed = JSON.parse(arrayMatch[0])
                } catch (e2) {
                    logger.warn(`Failed to parse prompts JSON: ${e.message}`)
                    return defaultPrompts
                }
            } else {
                logger.warn(`No JSON array found in prompt response`)
                return filteredDefaults
            }
        }

        if (Array.isArray(parsed) && parsed.length >= 3) {
            // Filter and validate prompts
            const validPrompts = parsed
                .filter(p => typeof p === 'string' && p.length > 3 && p.length <= 75) // Relaxed length slightly
                .filter(p => !p.toLowerCase().includes('tell me more'))

            // Filter out prompts that have already been used
            const uniquePrompts = filterPrompts(validPrompts).slice(0, 4)

            logger.info(`Generated ${uniquePrompts.length} valid unique prompts`)

            if (uniquePrompts.length >= 3) {
                return uniquePrompts
            }
        }

        logger.warn('Generated prompts not in expected format, using defaults', { parsed })
        return filteredDefaults
    } catch (error) {
        logger.warn('Failed to generate follow-up prompts:', error.message)
        return filteredDefaults
    }
}

/**
 * Send a message and get a response
 * This is the main orchestration function
 * 
 * @param {string} userId - User ID
 * @param {string} userMessage - The user's message
 * @returns {Promise<{success: boolean, response: string, sessionId: string, suggestedPrompts: string[]}>}
 */
async function sendMessage(userId, userMessage) {
    try {
        // Check LLM availability first
        const { available } = await checkAvailability()
        if (!available) {
            logger.error('LLM server not available')
            return { success: false, response: SERVICE_UNAVAILABLE_MESSAGE, sessionId: null }
        }

        // Get or create session
        const { sessionId } = await getOrCreateSession(userId)

        // Save user message
        await saveMessage(sessionId, userId, 'user', userMessage)

        // Assemble prompt with all context
        const messages = await assemblePrompt(userId, sessionId, userMessage)

        // Pre-flight validation: check if context was overly truncated or empty
        if (!messages || messages.length <= 1) { // 1 means only system prompt (or even less)
            logger.warn(`Prompt assembly returned insufficient context (length ${messages?.length}). Context may be too large.`)
            // We proceed, but the LLM might struggle. This warning helps debugging.
        }

        // Get system instructions for alignment check
        const systemInstructions = await getSystemInstructionsForAlignment(userId)

        // Generate response with alignment checking
        const result = await getAlignedResponse(
            async () => await chatCompletionWithRetry(messages),
            userMessage,
            systemInstructions
        )

        // Quick validation before saving
        const quickCheck = quickValidation(result.content)
        if (!quickCheck.passed) {
            logger.warn(`Quick validation failed: ${quickCheck.reason}`)
            result.content = ALIGNMENT_FAILED_MESSAGE
            result.passed = false
        }

        // Parse embedded follow-up suggestions from the response
        const { cleanedResponse, suggestions: embeddedSuggestions } = parseFollowUpSuggestions(result.content)
        result.content = cleanedResponse // Use cleaned response without XML tags

        // Save assistant response (cleaned, without XML tags)
        await saveMessage(sessionId, userId, 'assistant', result.content, {
            passed: result.passed,
            retries: result.retries
        })

        // Update session activity
        await pool.query(
            `UPDATE public.chat_sessions SET last_activity_at = NOW() WHERE id = $1`,
            [sessionId]
        )

        // Use embedded suggestions if available, otherwise fall back to generated ones
        let suggestedPrompts
        if (embeddedSuggestions.length >= 3) {
            // Filter out any prompts the user has already used
            let usedMessages = []
            try {
                usedMessages = await getSessionUserMessages(sessionId)
            } catch (err) {
                logger.warn(`Failed to fetch session messages for filtering: ${err.message}`)
            }
            const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim()
            const usedSet = new Set(usedMessages.map(normalize))
            suggestedPrompts = embeddedSuggestions.filter(p => !usedSet.has(normalize(p))).slice(0, 4)
            logger.info(`Using ${suggestedPrompts.length} embedded suggestions from LLM response`)
        } else {
            // Fallback to separate generation
            suggestedPrompts = await generateFollowUpPrompts(result.content, userMessage, sessionId)
        }

        return {
            success: true,
            response: result.content,
            sessionId,
            suggestedPrompts
        }

    } catch (error) {
        logger.error('Error in sendMessage:', error.message)

        // Try to save the user's message even if we can't respond
        try {
            const { sessionId } = await getOrCreateSession(userId)
            await saveMessage(sessionId, userId, 'user', userMessage)
        } catch (saveError) {
            logger.error('Failed to save user message:', saveError.message)
        }

        return { success: false, response: SERVICE_UNAVAILABLE_MESSAGE, sessionId: null }
    }
}

/**
 * Generate initial greeting for a new or returning session
 * Handles cases where user has no SRL data with hardcoded responses
 * to prevent LLM hallucination
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, greeting: string, sessionId: string}>}
 */
async function generateInitialGreeting(userId) {
    logger.chat(`generateInitialGreeting called`, { userId })

    try {
        // Get or create session
        const { sessionId, isNew } = await getOrCreateSession(userId)
        logger.chat(`Session retrieved`, { userId, sessionId, isNew })

        // Check if we already have a cached greeting for this session
        const { rows } = await pool.query(
            `SELECT initial_greeting FROM public.chat_sessions WHERE id = $1`,
            [sessionId]
        )

        const stale = await isGreetingStale(sessionId)
        if (rows[0].initial_greeting && !isNew && !stale) {
            logger.chat(`Returning cached greeting`, {
                userId,
                sessionId,
                greetingLength: rows[0].initial_greeting.length,
                greetingPreview: rows[0].initial_greeting.substring(0, 100) + '...'
            })
            return {
                success: true,
                greeting: rows[0].initial_greeting,
                sessionId
            }
        }
        if (stale) {
            logger.chat(`Cached greeting is stale — regenerating`, { userId, sessionId })
        }

        // Check if user has SRL data - if not, return hardcoded message
        // This prevents LLM from hallucinating questionnaire results
        const userHasSRLData = await hasSRLData(pool, userId)
        logger.chat(`SRL data check`, { userId, userHasSRLData })

        if (!userHasSRLData) {
            // Check specifically for student profile data (not just username)
            const hasProfileData = await hasStudentProfile(userId)
            logger.chat(`No SRL data - returning hardcoded greeting`, { userId, hasProfileData })

            let noDataGreeting
            if (hasProfileData) {
                // Has profile but no SRL data
                noDataGreeting = GREETING_NO_DATA_WITH_PROFILE
            } else {
                // No profile and no SRL data
                noDataGreeting = GREETING_NO_DATA_NO_PROFILE
            }

            // Cache the greeting (set greeting_generated_at for staleness detection)
            await pool.query(
                `UPDATE public.chat_sessions SET initial_greeting = $1, greeting_generated_at = NOW() WHERE id = $2`,
                [noDataGreeting, sessionId]
            )

            // Save as assistant message
            await saveMessage(sessionId, userId, 'assistant', noDataGreeting, { passed: true, retries: 0 })

            logger.info(`User ${userId} has no SRL data - returned hardcoded greeting`)

            // Generate dynamic follow-up prompts for hardcoded greeting too
            const suggestedPrompts = await generateFollowUpPrompts(noDataGreeting, 'Hello, I just started a new session', sessionId)

            return {
                success: true,
                greeting: noDataGreeting,
                sessionId,
                suggestedPrompts
            }
        }

        // User has SRL data - proceed with LLM-generated greeting
        logger.chat(`User has SRL data, proceeding with LLM greeting`, { userId })

        // Check LLM availability
        const { available } = await checkAvailability()
        if (!available) {
            logger.chat(`LLM unavailable for greeting`, { userId })
            return { success: true, greeting: GREETING_FALLBACK, sessionId }
        }

        // Generate new greeting using LLM with alignment checking
        logger.chat(`Assembling initial greeting prompt`, { userId })
        const messages = await assembleInitialGreetingPrompt(userId)
        logger.chat(`Prompt assembled, calling LLM with alignment`, { userId, messageCount: messages.length })

        // Get system instructions for alignment check
        const systemInstructions = await getSystemInstructionsForAlignment(userId)

        // Generate aligned greeting (same as regular messages)
        const result = await getAlignedResponse(
            async () => await chatCompletionWithRetry(messages),
            'Generate a personalized greeting for the user',  // Synthetic user query for context
            systemInstructions
        )

        // Parse embedded follow-up suggestions from the greeting
        const { cleanedResponse: cleanedGreeting, suggestions: embeddedSuggestions } = parseFollowUpSuggestions(result.content)
        const greeting = cleanedGreeting
        logger.chat(`LLM greeting received`, { userId, greetingLength: greeting.length, passed: result.passed, embeddedSuggestions: embeddedSuggestions.length })

        // Cache the cleaned greeting (set greeting_generated_at for staleness detection)
        await pool.query(
            `UPDATE public.chat_sessions SET initial_greeting = $1, greeting_generated_at = NOW() WHERE id = $2`,
            [greeting, sessionId]
        )

        // Save as assistant message with actual alignment result
        await saveMessage(sessionId, userId, 'assistant', greeting, {
            passed: result.passed,
            retries: result.retries
        })

        // Use embedded suggestions if available, otherwise fall back to generated ones
        let suggestedPrompts
        if (embeddedSuggestions.length >= 3) {
            suggestedPrompts = embeddedSuggestions.slice(0, 4)
            logger.info(`Using ${suggestedPrompts.length} embedded suggestions from greeting`)
        } else {
            suggestedPrompts = await generateFollowUpPrompts(greeting, 'Hello, I just started a new session', sessionId)
        }

        return {
            success: true,
            greeting,
            sessionId,
            suggestedPrompts
        }

    } catch (error) {
        logger.error('Error generating initial greeting:', error.message)
        return { success: false, greeting: GREETING_FALLBACK, sessionId: null }
    }
}

/**
 * Manually reset/end the current session
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, newSessionId: string}>}
 */
async function resetSession(userId) {
    try {
        // End all active sessions
        await pool.query(
            `UPDATE public.chat_sessions 
             SET is_active = false, ended_at = NOW() 
             WHERE user_id = $1 AND is_active = true`,
            [userId]
        )

        // Create a new session
        const { sessionId } = await getOrCreateSession(userId)
        logger.info(`Session reset for user ${userId}, new session: ${sessionId}`)

        return { success: true, newSessionId: sessionId }
    } catch (error) {
        logger.error('Error resetting session:', error.message)
        return { success: false, newSessionId: null }
    }
}

export {
    getOrCreateSession,
    saveMessage,
    getSessionHistory,
    getUserSessions,
    sendMessage,
    generateInitialGreeting,
    resetSession,
    SESSION_TIMEOUT_SECONDS
}
