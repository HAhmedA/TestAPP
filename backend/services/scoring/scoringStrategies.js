// Scoring Strategies
// Strategy pattern for weight configuration
// Allows for future custom weighting without changing aggregation logic

// =============================================================================
// SEVERITY TO SCORE MAPPING
// =============================================================================

/**
 * Standard severity to numeric score mapping
 * ok = fully healthy/good (1.0)
 * warning = minor concern (0.5)
 * poor = significant issue (0.0)
 */
const SEVERITY_SCORES = {
    ok: 1.0,
    warning: 0.5,
    poor: 0.0
};

/**
 * Convert severity string to numeric score
 * @param {string} severity - 'ok', 'warning', or 'poor'
 * @returns {number} - Score between 0.0 and 1.0
 */
function severityToScore(severity) {
    return SEVERITY_SCORES[severity] ?? 0.5; // Default to warning if unknown
}

// =============================================================================
// SCORING STRATEGIES
// =============================================================================

/**
 * Base strategy interface (for documentation purposes)
 * All strategies must implement getWeights(aspects)
 */

/**
 * Equal Weight Strategy
 * Each aspect contributes equally to the final score
 * This is the default/initial strategy
 */
class EqualWeightStrategy {
    /**
     * Get weights for each aspect
     * @param {Array<{domain: string, severity: string}>} aspects - Array of aspects with domain and severity
     * @returns {Array<number>} - Array of weights (sum to 1.0)
     */
    getWeights(aspects) {
        if (!aspects || aspects.length === 0) return [];
        const weight = 1 / aspects.length;
        return aspects.map(() => weight);
    }

    /**
     * Get strategy name for logging/debugging
     */
    getName() {
        return 'equal_weight';
    }
}

/**
 * Custom Weight Strategy (for future use)
 * Allows specifying different weights for different domains
 * 
 * Example usage:
 * const strategy = new CustomWeightStrategy({
 *   duration: 0.5,    // Duration matters most
 *   continuity: 0.3,  // Quality matters
 *   timing: 0.2       // Schedule matters less
 * });
 */
class CustomWeightStrategy {
    constructor(domainWeights) {
        this.domainWeights = domainWeights;
    }

    getWeights(aspects) {
        if (!aspects || aspects.length === 0) return [];

        // Get raw weights for each aspect
        const rawWeights = aspects.map(a => this.domainWeights[a.domain] ?? 1.0);

        // Normalize to sum to 1.0
        const sum = rawWeights.reduce((acc, w) => acc + w, 0);
        return rawWeights.map(w => w / sum);
    }

    getName() {
        return 'custom_weight';
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    SEVERITY_SCORES,
    severityToScore,
    EqualWeightStrategy,
    CustomWeightStrategy
};
