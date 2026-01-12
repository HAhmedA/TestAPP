// Centralized logging utility using Winston
import winston from 'winston'

const { combine, timestamp, printf, colorize, errors } = winston.format

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`
})

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true })
    ),
    transports: [
        // Console transport with colors
        new winston.transports.Console({
            format: combine(
                colorize(),
                consoleFormat
            )
        })
    ],
    // Don't exit on handled exceptions
    exitOnError: false
})

// Stream for Morgan HTTP logging (if needed later)
logger.stream = {
    write: (message) => logger.info(message.trim())
}

export default logger
