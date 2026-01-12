// Logger utility tests
import logger from '../utils/logger.js'

describe('Logger Utility', () => {
    test('logger is defined', () => {
        expect(logger).toBeDefined()
    })

    test('logger has info method', () => {
        expect(typeof logger.info).toBe('function')
    })

    test('logger has error method', () => {
        expect(typeof logger.error).toBe('function')
    })

    test('logger has warn method', () => {
        expect(typeof logger.warn).toBe('function')
    })

    test('logger can log info without throwing', () => {
        expect(() => logger.info('Test log message')).not.toThrow()
    })
})
