// Prompt Assembler Service
// Combines all data sources into a single system prompt for LLM
// Since API calls are stateless, we include all context every time

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { getSummariesForChatbot, hasHistory } from './summarizationService.js'
import { getScoresForChatbot } from './scoring/index.js'
import { estimateTokens } from './apiConnectorService.js'

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths to prompt files
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system_prompt.txt')
const ALIGNMENT_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'alignment_prompt.txt')

// Maximum token budget for context (leaving room for response)
// Defaults to 32k for production, can be overridden in .env (e.g. 4096 for local testing)
const LLM_CONTEXT_LIMIT = parseInt(process.env.LLM_CONTEXT_LIMIT) || 32768
const RESPONSE_RESERVE = parseInt(process.env.LLM_RESPONSE_RESERVE) || 2000
const MAX_CONTEXT_TOKENS = LLM_CONTEXT_LIMIT - RESPONSE_RESERVE
const MAX_SESSION_MESSAGES = 50 // Increased for high-context models, but subject to token limit

/**
 * Seed a prompt from file if it doesn't exist in DB
 * 
 * @param {string} promptType - 'system' or 'alignment'
 * @param {string} filePath - Path to the prompt file
 */
async function seedPromptIfMissing(promptType, filePath) {
    // Check if this type of prompt exists
    const { rows } = await pool.query(
        `SELECT id FROM public.system_prompts WHERE prompt_type = $1 LIMIT 1`,
        [promptType]
    )

    if (rows.length === 0) {
        // Prompt doesn't exist - seed from file
        try {
            const filePrompt = fs.readFileSync(filePath, 'utf-8')
            await pool.query(
                `INSERT INTO public.system_prompts (prompt, prompt_type, updated_at) VALUES ($1, $2, NOW())`,
                [filePrompt, promptType]
            )
            logger.info(`${promptType} prompt seeded from file to database`)
        } catch (err) {
            logger.warn(`Could not seed ${promptType} prompt from file: ${err.message}`)
        }
    } else {
        logger.info(`${promptType} prompt already exists in database`)
    }
}

/**
 * Initialize prompts - seeds database from files if empty
 * Call this once at server startup
 */
async function initializeSystemPrompt() {
    try {
        await seedPromptIfMissing('system', SYSTEM_PROMPT_PATH)
        await seedPromptIfMissing('alignment', ALIGNMENT_PROMPT_PATH)
    } catch (err) {
        logger.error(`Failed to initialize prompts: ${err.message}`)
    }
}

/**
 * Get the current system prompt from database
 * 
 * @returns {Promise<string>} - System prompt text
 */
async function getSystemPrompt() {
    const { rows } = await pool.query(
        `SELECT prompt FROM public.system_prompts 
         WHERE prompt_type = 'system'
         ORDER BY updated_at DESC LIMIT 1`
    )
    return rows.length > 0 ? rows[0].prompt : 'Be helpful and ethical.'
}

/**
 * Get user context from their profile
 * 
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted user context
 */
async function getUserContext(userId) {
    const { rows } = await pool.query(
        `SELECT u.name, sp.edu_level, sp.field_of_study, sp.major, sp.learning_formats, sp.disabilities
         FROM public.users u
         LEFT JOIN public.student_profiles sp ON u.id = sp.user_id
         WHERE u.id = $1`,
        [userId]
    )

    if (rows.length === 0) {
        return 'No profile information provided.'
    }

    const profile = rows[0]
    const parts = []
    const name = profile.name || 'the student'

    let description = `This is a student named ${name}`

    if (profile.major) {
        description += `, majoring in ${profile.major}`
    } else if (profile.field_of_study) {
        description += `, studying ${profile.field_of_study}`
    }

    if (profile.edu_level) {
        description += ` at the ${profile.edu_level} level`
    }

    description += '.'

    if (profile.learning_formats && profile.learning_formats.length > 0) {
        const formats = Array.isArray(profile.learning_formats)
            ? profile.learning_formats
            : JSON.parse(profile.learning_formats)
        if (formats.length > 0) {
            description += ` They prefer learning via: ${formats.join(', ')}.`
        }
    }

    if (profile.disabilities && profile.disabilities.length > 0) {
        const disabilities = Array.isArray(profile.disabilities)
            ? profile.disabilities
            : JSON.parse(profile.disabilities)
        if (disabilities.length > 0) {
            description += ` Accessibility needs include: ${disabilities.join(', ')}.`
        }
    }

    return description
}

/**
 * Get current session messages
 * 
 * @param {string} sessionId - Session ID
 * @param {number} limit - Maximum messages to include
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function getSessionMessages(sessionId, limit = MAX_SESSION_MESSAGES) {
    const { rows } = await pool.query(
        `SELECT role, content FROM public.chat_messages 
         WHERE session_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [sessionId, limit]
    )
    // Reverse to get chronological order
    return rows.reverse()
}

/**
 * Assemble the complete prompt for the LLM
 * This is the main function that combines all data sources
 * 
 * @param {string} userId - User ID
 * @param {string} sessionId - Current session ID
 * @param {string} userMessage - Current user message (optional, for new messages)
 * @returns {Promise<Array<{role: string, content: string}>>} - Messages array for LLM
 */
async function assemblePrompt(userId, sessionId, userMessage = null) {
    logger.prompt(`Assembling prompt for user ${userId}, session ${sessionId}`)

    // Gather all data sources in parallel
    const [systemPrompt, userContext, conceptScores, summaries] = await Promise.all([
        getSystemPrompt(),
        getUserContext(userId),
        getScoresForChatbot(userId),
        getSummariesForChatbot(userId)
    ])

    // Log what data we have
    logger.prompt(`Prompt data gathered`, {
        userId,
        sessionId,
        userContextLength: userContext.length,
        conceptScoresLength: conceptScores.length,
        conceptScoresPreview: conceptScores.substring(0, 200),
        summariesLength: summaries.length
    })

    // Get current session messages
    const sessionMessages = await getSessionMessages(sessionId, MAX_SESSION_MESSAGES)

    // Check if this is a first-time or returning user
    const userHasHistory = await hasHistory(userId)
    const userType = userHasHistory
        ? 'This is a returning student.'
        : 'This is a new student.'

    // PRIORITY-BASED TRUNCATION STRATEGY
    // 1. Base System Prompt (Highest Priority - Never Truncate)
    const baseSystemPrompt = `${systemPrompt}\n\n---\n\nDATA PRIORITY (IMPORTANT):\nThe USER CONTEXT & PREFERENCES section below contains the CURRENT, AUTHORITATIVE information about this student.\nIf any previous messages in the chat history contradict or differ from the USER CONTEXT section, ALWAYS use the USER CONTEXT section as the source of truth.\nThe student's profile may have been updated since previous messages were sent.\n\n---\n`

    let currentTokens = estimateTokens(baseSystemPrompt)
    let assembledContext = baseSystemPrompt

    // 2. Context Sections (Prioritized: User Context > Data Summary > Summaries)
    const contextSections = [
        { name: 'USER CONTEXT & PREFERENCES', content: userContext, priority: 1 },
        { name: 'STUDENT DATA SUMMARY', content: conceptScores, priority: 2 },
        { name: 'PREVIOUS CHATS (SUMMARIZED)', content: summaries, priority: 3 },
        { name: 'CURRENT SESSION', content: userType, priority: 1 } // High priority for session type
    ]

    // Sort by priority (1 is highest)
    const sortedSections = contextSections.sort((a, b) => a.priority - b.priority)

    // Reserve 30% of remaining budget for session messages
    const messageReserve = Math.floor(MAX_CONTEXT_TOKENS * 0.3)
    const staticContentBudget = MAX_CONTEXT_TOKENS - messageReserve

    for (const section of sortedSections) {
        const sectionContent = `\n${section.name}:\n${section.content}\n`
        const sectionTokens = estimateTokens(sectionContent)

        // Allow slightly more than static budget if total is still safe, 
        // but try to leave room for messages
        if (currentTokens + sectionTokens <= MAX_CONTEXT_TOKENS - 500) {
            assembledContext += sectionContent
            currentTokens += sectionTokens
        } else {
            logger.warn(`Context truncation: ${section.name} excluded (${sectionTokens} tokens)`)
            // For lower priority items, we might add a placeholder
            if (section.priority > 2) {
                assembledContext += `\n${section.name}:\n[Truncated due to length limits]\n`
            }
        }
    }

    // 3. User Message (Next Highest Priority - shouldn't drop current query)
    let userMessageContent = ''
    if (userMessage) {
        userMessageContent = userMessage
        currentTokens += estimateTokens(userMessageContent) // Add user token cost
    }

    // 4. Session History (Newest First)
    const messages = []

    // Add system prompt first
    messages.push({ role: 'system', content: assembledContext })

    // Add session messages, prioritizing RECENT messages
    // Messages came in reverse chronological (newest first) from getSessionMessages if we used that query,
    // BUT getSessionMessages currently returns chronological (oldest first) due to .reverse()

    // Let's optimize: work backwards from newest to oldest
    // We strictly check token budget here
    const messagesToInclude = []

    // Convert back to newest-first to interact with them
    const reversedSessionMessages = [...sessionMessages].reverse()

    for (const msg of reversedSessionMessages) {
        const msgTokens = estimateTokens(msg.content)

        if (currentTokens + msgTokens <= MAX_CONTEXT_TOKENS) {
            messagesToInclude.unshift(msg) // Add to front (so they end up chronological)
            currentTokens += msgTokens
        } else {
            logger.warn(`Session history truncated: kept ${messagesToInclude.length}/${sessionMessages.length} messages`)
            break // Stop adding older messages
        }
    }

    // Add included messages to final array
    messages.push(...messagesToInclude)

    // Add current user message last
    if (userMessage) {
        messages.push({ role: 'user', content: userMessage })
    }

    logger.info(`Assembled prompt: ${messages.length} messages, ~${currentTokens}/${MAX_CONTEXT_TOKENS} tokens (Limit: ${LLM_CONTEXT_LIMIT})`)

    if (currentTokens > MAX_CONTEXT_TOKENS) {
        logger.warn(`Prompt exceeds target budget! (${currentTokens} > ${MAX_CONTEXT_TOKENS}) - this shouldn't happen with logic above`)
    }

    return messages
}

/**
 * Assemble initial greeting prompt
 * Used when starting a new session to generate the opening message
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function assembleInitialGreetingPrompt(userId) {
    logger.prompt(`Assembling initial greeting prompt`, { userId })

    const [systemPrompt, userContext, conceptScores, summaries] = await Promise.all([
        getSystemPrompt(),
        getUserContext(userId),
        getScoresForChatbot(userId),
        getSummariesForChatbot(userId)
    ])

    const userHasHistory = await hasHistory(userId)
    const userType = userHasHistory ? 'returning student' : 'new student'

    // Log detailed data for debugging
    logger.prompt(`Initial greeting data assembled`, {
        userId,
        userType,
        userContextLength: userContext.length,
        userContextPreview: userContext.substring(0, 150),
        conceptScoresLength: conceptScores.length,
        conceptScoresPreview: conceptScores.substring(0, 300),
        summariesLength: summaries.length
    })

    // Note: Greeting behavior is defined in system_prompt.txt under Greeting Rules
    const assembledSystem = `${systemPrompt}

---

USER CONTEXT & PREFERENCES:
${userContext}

STUDENT DATA SUMMARY:
${conceptScores}

PREVIOUS CHATS (SUMMARIZED):
${summaries}

CURRENT SESSION:
This is a ${userType}. Generate a personalized greeting following the Greeting Rules.
`

    const messages = [
        { role: 'system', content: assembledSystem },
        { role: 'user', content: "Hello, I just opened the chat. Please greet me and briefly summarize my data in bulletpoints. Please, provide few personalized recommendations that aligns with my charachteristics in bulletpoints." }
    ]

    logger.info(`FULL INITIAL GREETING PROMPT for ${userId}:\n${JSON.stringify(messages, null, 2)}`)

    return messages
}

/**
 * Assemble system instructions for alignment checking
 * MUST include the same context (user profile, concept scores) as the main prompt
 * so the judge knows what data the assistant is working with.
 * 
 * @param {string} userId - User ID (optional, but needed for context)
 * @returns {Promise<string>}
 */
async function getSystemInstructionsForAlignment(userId = null) {
    const baseSystemPrompt = await getSystemPrompt()

    if (!userId) {
        return baseSystemPrompt
    }

    // accurate context for the judge
    const [userContext, conceptScores, summaries] = await Promise.all([
        getUserContext(userId),
        getScoresForChatbot(userId),
        getSummariesForChatbot(userId)
    ])

    return `${baseSystemPrompt}

---

USER CONTEXT & PREFERENCES:
${userContext}

STUDENT DATA SUMMARY:
${conceptScores}

PREVIOUS CHATS (SUMMARIZED):
${summaries}
`
}

/**
 * Check if a user has actual student profile data set up
 * This checks for edu_level, field_of_study, major - not just the username
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user has profile data beyond just name
 */
async function hasStudentProfile(userId) {
    const { rows } = await pool.query(
        `SELECT edu_level, field_of_study, major, learning_formats, disabilities
         FROM public.student_profiles
         WHERE user_id = $1`,
        [userId]
    )

    if (rows.length === 0) {
        return false
    }

    const profile = rows[0]
    // Check if any meaningful profile field is filled in
    return !!(profile.edu_level || profile.field_of_study || profile.major ||
        (profile.learning_formats && profile.learning_formats.length > 0) ||
        (profile.disabilities && profile.disabilities.length > 0))
}

export {
    assemblePrompt,
    assembleInitialGreetingPrompt,
    getSystemPrompt,
    getUserContext,
    getSessionMessages,
    getSystemInstructionsForAlignment,
    hasStudentProfile,
    initializeSystemPrompt
}
