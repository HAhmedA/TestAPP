// Scoring Service Index
// Re-exports all scoring-related functions

export {
    SEVERITY_SCORES,
    severityToScore,
    EqualWeightStrategy,
    CustomWeightStrategy
} from './scoringStrategies.js';

export {
    computeScore,
    computeAndStoreScore,
    calculateTrend,
    get7DayAverage,
    getAllScoresForChatbot,
    getScoreForChatbot,
    formatScoreForChatbot,
    storeScore
} from './conceptScoreService.js';

export {
    computeConceptScore,
    computeAllScores,
    getScoresForChatbot
} from './scoreComputationService.js';

