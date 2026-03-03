// Chatbot Constants
// Centralized location for greeting messages and other magic strings

/**
 * Greeting message for users who have a profile but no data yet
 */
export const GREETING_NO_DATA_WITH_PROFILE =
    "Hello! Welcome to your learning support assistant. " +
    "I see you've set up your profile - that's great! " +
    "To provide you with personalized recommendations, I'll need a bit more data from you:\n\n" +
    "• Complete the Self-Regulated Learning (SRL) questionnaire\n" +
    "• Log your daily sleep hours\n" +
    "• Track your daily screen time\n\n" +
    "Once you've shared this information, I'll be able to analyze your learning patterns, " +
    "sleep habits, and digital wellness to offer tailored advice. " +
    "How can I help you in the meantime?"

/**
 * Greeting message for users with no profile and no data
 */
export const GREETING_NO_DATA_NO_PROFILE =
    "Hello! Welcome to your learning support assistant. " +
    "I'm here to help you on your learning journey. " +
    "To get started with personalized recommendations, please: \n" +
    "1. Complete your profile with your educational background and preferences\n" +
    "2. Fill out the Self-Regulated Learning (SRL) questionnaire\n" +
    "3. Log your daily sleep hours and screen time\n\n" +
    "Once you've done that, I'll be able to analyze your learning patterns, " +
    "sleep habits, and digital wellness to provide tailored advice. " +
    "Feel free to ask me any questions in the meantime!"

/**
 * Fallback greeting when LLM is unavailable or errors occur
 */
export const GREETING_FALLBACK =
    "Hello! I'm here to help you with your learning journey. How can I assist you today?"

/**
 * Session configuration
 */
export const SESSION_TIMEOUT_SECONDS = 1800 // 30 minutes

/**
 * Numeric boundaries for the three-tier score category system.
 * Used by the PGMoE clustering pipeline to classify per-domain scores (0–100).
 *   score >= VERY_GOOD  → 'very_good'
 *   score >= GOOD       → 'good'
 *   else                → 'requires_improvement'
 */
export const SCORE_THRESHOLDS = {
    VERY_GOOD: 66,
    GOOD: 33,
}
