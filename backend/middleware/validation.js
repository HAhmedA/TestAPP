// Validation middleware
import { validationResult } from 'express-validator'

// Wrapper for express-validator rules
export const validate = (rules) => [
    ...rules,
    (req, res, next) => {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'validation_error', details: errors.array() })
        }
        next()
    }
]
