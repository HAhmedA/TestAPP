// Environment Validation
// Validates required environment variables and fails startup in production if missing

import logger from '../utils/logger.js'

// Required environment variables for production
const REQUIRED_PRODUCTION_ENV = {
    SESSION_SECRET: 'Session secret for cookie signing',
    PGHOST: 'PostgreSQL host',
    PGUSER: 'PostgreSQL username',
    PGPASSWORD: 'PostgreSQL password',
    PGDATABASE: 'PostgreSQL database name'
}

// Optional but recommended
const RECOMMENDED_ENV = {
    CORS_ORIGINS: 'Allowed CORS origins (comma-separated)',
    LLM_BASE_URL: 'LLM API base URL',
    LLM_MAIN_MODEL: 'Main LLM model name',
    SIMULATION_MODE: 'Set to "false" to disable simulators and exclude test data from clustering (default: "true")'
}

/**
 * Validate environment variables
 * In production: throws error if required vars are missing
 * In development: logs warnings for missing vars
 * 
 * @param {boolean} isProduction - Whether running in production mode
 * @throws {Error} In production if required variables are missing
 */
function validateEnvironment(isProduction = false) {
    const missing = []
    const warnings = []

    // Check required production variables
    for (const [key, description] of Object.entries(REQUIRED_PRODUCTION_ENV)) {
        if (!process.env[key]) {
            if (isProduction) {
                missing.push(`${key}: ${description}`)
            } else {
                warnings.push(`${key}: ${description} (using default)`)
            }
        }
    }

    // Check for weak secrets in production
    if (isProduction) {
        if (process.env.SESSION_SECRET === 'dev-secret') {
            missing.push('SESSION_SECRET: Cannot use "dev-secret" in production')
        }
        if (process.env.PGPASSWORD === 'password') {
            warnings.push('PGPASSWORD: Using weak password "password" in production is not recommended')
        }
    }

    // Check recommended variables
    for (const [key, description] of Object.entries(RECOMMENDED_ENV)) {
        if (!process.env[key]) {
            warnings.push(`${key}: ${description} (optional)`)
        }
    }

    // Log warnings
    if (warnings.length > 0) {
        logger.warn('Environment warnings:')
        warnings.forEach(w => logger.warn(`  - ${w}`))
    }

    // In production, fail if required vars are missing
    if (isProduction && missing.length > 0) {
        const errorMessage = `Missing required environment variables for production:\n${missing.map(m => `  - ${m}`).join('\n')}`
        logger.error(errorMessage)
        throw new Error(errorMessage)
    }

    logger.info('Environment validation passed')
}

export { validateEnvironment, REQUIRED_PRODUCTION_ENV, RECOMMENDED_ENV }
