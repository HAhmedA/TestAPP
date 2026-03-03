// Cluster Peer Service
// Parsimonious Gaussian Mixture of Experts (PGMoE) for peer comparison
// Uses feature-dependent gating + parsimonious covariance models

/**
 * @typedef {Object} ClusterResult
 * @property {string} clusterLabel
 * @property {number} clusterIndex
 * @property {number} percentileScore
 * @property {number} compositeScore
 * @property {number} dialMin
 * @property {number} dialCenter
 * @property {number} dialMax
 * @property {number} userCount
 * @property {Array<{domain: string, numericScore: number, category: string, categoryLabel: string}>} domains
 */

//
// Flow:
//   1. Gather all users' raw metrics per concept
//   2. Winsorize at P5/P95, scale to [0,1], then center-normalize (zero mean, unit var)
//   3. Fit PGMoE: test all (K, covType) combos, select best via BIC+AIC+entropy
//   4. Assign each user to their most-likely cluster
//   5. Compute per-cluster percentiles (P5, P50, P95) on composite score
//   6. Map user's score to 0-100 within their cluster's P5-P95 range

import logger from '../../utils/logger.js';
import { getAllUserMetrics } from './scoreQueryService.js';
import {
    centerNormalize,
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels,
    computeSilhouetteScore,
    computeDaviesBouldinIndex
} from './pgmoeAlgorithm.js';
import { storeClusterResults, storeUserAssignment, storeDiagnostics } from './clusterStorageService.js';
import { withTransaction } from '../../utils/withTransaction.js';
import pool from '../../config/database.js';
import { percentile } from '../../utils/stats.js';
import { SCORE_THRESHOLDS } from '../../constants.js';

// =============================================================================
// DIMENSION DEFINITIONS (which metrics to use, and which are inverted)
// =============================================================================

const DIMENSION_DEFS = {
    lms: {
        volume:                 { metric: 'total_active_minutes', inverted: false },
        consistency:            { metric: 'days_active',          inverted: false },
        participation_variety:  { metric: 'participation_score',  inverted: false },
        session_quality:        { metric: 'avg_session_duration', inverted: false },
    },
    sleep: {
        duration: { metric: 'sleep_minutes', inverted: false },
        continuity: { metric: 'awakenings', inverted: true },
        timing: { metric: 'bedtime_stddev', inverted: true }
    },
    screen_time: {
        volume: { metric: 'screen_minutes', inverted: true },
        distribution: { metric: 'longest_session', inverted: true },
        pre_sleep: { metric: 'late_night', inverted: true }
    }
};

// Cluster labels are now generated dynamically via generateClusterLabels(k)
// This supports K=2 through K=6 automatically.

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Map a value to 0-100 within a [min, max] range
 */
function mapToRange(value, min, max) {
    if (max === min) return 50;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * Compute a composite score for a user from their metrics.
 * For non-inverted metrics: higher = better.
 * For inverted metrics: lower = better (we negate after normalization).
 * Returns a single 0-100 number.
 */
function computeCompositeScore(userMetrics, allMetrics, dims) {
    const domainScores = [];

    for (const [domain, def] of Object.entries(dims)) {
        const allValues = Object.values(allMetrics).map(m => m[def.metric]).filter(v => v != null).sort((a, b) => a - b);
        if (allValues.length === 0) continue;

        // Winsorize at P5/P95, then scale to 0-100
        const p5Val = percentile(allValues, 5);
        const p95Val = percentile(allValues, 95);
        const raw = userMetrics[def.metric];
        const clipped = Math.max(p5Val, Math.min(p95Val, raw));
        let normalized = p95Val > p5Val ? ((clipped - p5Val) / (p95Val - p5Val)) * 100 : 50;

        // For inverted metrics, flip so higher = better
        if (def.inverted) normalized = 100 - normalized;

        domainScores.push({ domain, score: normalized });
    }

    if (domainScores.length === 0) return { composite: 50, domainScores: [] };

    const composite = domainScores.reduce((s, d) => s + d.score, 0) / domainScores.length;
    return { composite, domainScores };
}

// =============================================================================
// MAIN PUBLIC API
// =============================================================================

// Minimum number of real users required before PGMoE clustering is meaningful.
// Below this threshold the system returns { coldStart: true } and the dashboard
// shows a "Building your profile" placeholder instead of the gauge.
const MIN_CLUSTER_USERS = 10;

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Run PGMoE clustering for a concept without writing to the DB.
 * Returns all intermediate objects so callers can store results their own way.
 *
 * @param {string} conceptId - 'lms', 'sleep', or 'screen_time' (not 'srl')
 * @param {number} days - Look-back window
 * @returns {Object|null} null = cold start; otherwise { allMetrics, userIds, composites,
 *                                                        clusterRemap, clusterMeans, k,
 *                                                        model, dims, labels }
 */
async function _runConceptClustering(conceptId, days) {
    const allMetrics = await getAllUserMetrics(conceptId, days);
    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return null;

    const userIds = Object.keys(allMetrics);

    if (userIds.length < MIN_CLUSTER_USERS) {
        logger.info(`_runConceptClustering: cold start for ${conceptId} (${userIds.length}/${MIN_CLUSTER_USERS} users)`);
        return null;
    }

    const dimKeys = Object.keys(dims);

    // Build feature matrix for clustering (N users x D dimensions)
    // Winsorize at P5/P95, then scale to [0, 1]
    // This prevents outliers from compressing the majority of data into a narrow band
    const ranges = {};
    for (const dk of dimKeys) {
        const metric = dims[dk].metric;
        const allVals = userIds.map(uid => allMetrics[uid][metric]).filter(v => v != null).sort((a, b) => a - b);
        const p5Val = percentile(allVals, 5);
        const p95Val = percentile(allVals, 95);
        ranges[dk] = { p5: p5Val, p95: p95Val };
    }

    const featureMatrix = userIds.map(uid => {
        return dimKeys.map(dk => {
            const metric = dims[dk].metric;
            const raw = allMetrics[uid][metric] || 0;
            const { p5, p95 } = ranges[dk];
            // Winsorize: clip to [P5, P95]
            const clipped = Math.max(p5, Math.min(p95, raw));
            // Scale to [0, 1]
            let normalized = p95 > p5 ? (clipped - p5) / (p95 - p5) : 0.5;
            // For inverted metrics, flip so higher = better in feature space
            if (dims[dk].inverted) normalized = 1 - normalized;
            return normalized;
        });
    });

    // Center-normalize for PGMoE (after Winsorize+scale, before model fitting)
    const { centered } = centerNormalize(featureMatrix);

    // Select optimal (K, covType) via composite BIC+AIC+entropy criterion
    const { k, covType, model, diagnostics } = selectOptimalModel(centered, 2, 4);
    logger.info(`${conceptId}: K=${k}, cov=${covType} for ${userIds.length} users`);

    // Compute and store diagnostics (fire-and-forget — does not block scoring)
    // Silhouette/Davies-Bouldin are O(N²). Cap to 100 random samples so cost is
    // bounded at ~10K comparisons regardless of cohort size. nUsers still reflects
    // the real cohort size so the admin panel shows accurate context.
    {
        const DIAG_SAMPLE = 100;
        const nAll = centered.length;
        let sampledCentered, sampledAssignments;
        if (nAll <= DIAG_SAMPLE) {
            sampledCentered    = centered;
            sampledAssignments = model.assignments;
        } else {
            const indices = Array.from({ length: DIAG_SAMPLE }, () =>
                Math.floor(Math.random() * nAll)
            );
            sampledCentered    = indices.map(i => centered[i]);
            sampledAssignments = indices.map(i => model.assignments[i]);
        }

        const silhouette    = computeSilhouetteScore(sampledCentered, sampledAssignments, k);
        const daviesBouldin = computeDaviesBouldinIndex(sampledCentered, sampledAssignments, k, model.means);
        const clusterSizes  = [];
        for (let c = 0; c < k; c++) {
            clusterSizes.push(model.assignments.filter(a => a === c).length);
        }
        storeDiagnostics(conceptId, {
            silhouette,
            daviesBouldin,
            diagnostics,
            clusterSizes,
            nUsers: userIds.length,       // real count, not sample
            nDimensions: dimKeys.length
        }).catch(err => logger.error(`storeDiagnostics fire-and-forget error: ${err.message}`));
    }

    // Compute composite scores for all users
    const composites = userIds.map((uid, idx) => ({
        userId: uid,
        composite: computeCompositeScore(allMetrics[uid], allMetrics, dims).composite,
        cluster: model.assignments[idx]
    }));

    // Order clusters by mean composite score (low→high)
    const clusterMeans = [];
    for (let c = 0; c < k; c++) {
        const members = composites.filter(u => u.cluster === c);
        const mean = members.length > 0
            ? members.reduce((s, u) => s + u.composite, 0) / members.length
            : 0;
        clusterMeans.push({ cluster: c, mean, count: members.length });
    }
    clusterMeans.sort((a, b) => a.mean - b.mean);

    // Build re-mapping: original cluster index → ordered index (0=worst, k-1=best)
    const clusterRemap = {};
    clusterMeans.forEach((cm, orderedIdx) => {
        clusterRemap[cm.cluster] = orderedIdx;
    });

    const labels = generateClusterLabels(k, conceptId);
    return { allMetrics, userIds, composites, clusterRemap, clusterMeans, k, model, dims, labels };
}

/**
 * Compute cluster-based peer comparison scores for a user.
 *
 * @param {Object} dbPool - Database pool (unused, we use imported pool)
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Object} { clusterLabel, percentileScore, dialMin, dialCenter, dialMax, domains: [...] }
 */
async function computeClusterScores(dbPool, conceptId, userId, days = 7) {
    const allMetrics = await getAllUserMetrics(conceptId, days);

    if (!allMetrics[userId]) {
        logger.debug(`clusterPeerService: no ${conceptId} data for user ${userId}`);
        return null;
    }

    // SRL is special — variable dimensions
    if (conceptId === 'srl') {
        const userCount = Object.keys(allMetrics).length;
        if (userCount < MIN_CLUSTER_USERS) {
            logger.info(`clusterPeerService: cold start for SRL (${userCount}/${MIN_CLUSTER_USERS} users)`);
            return { coldStart: true };
        }
        return computeSRLClusterScores(allMetrics, userId);
    }

    if (!DIMENSION_DEFS[conceptId]) return null;

    const fit = await _runConceptClustering(conceptId, days);
    if (!fit) return { coldStart: true };

    const { userIds, composites, clusterRemap, clusterMeans, k, model, dims, labels } = fit;

    // Find the user's cluster and percentile position
    const userIdx = userIds.indexOf(userId);
    if (userIdx === -1) return null;
    const userOrigCluster = model.assignments[userIdx];
    const userOrderedCluster = clusterRemap[userOrigCluster];
    const userComposite = composites[userIdx].composite;

    // Get all composites in the user's cluster
    const clusterComposites = composites
        .filter(u => u.cluster === userOrigCluster)
        .map(u => u.composite)
        .sort((a, b) => a - b);

    const p5 = percentile(clusterComposites, 5);
    const p50 = percentile(clusterComposites, 50);
    const p95 = percentile(clusterComposites, 95);
    const userPercentile = mapToRange(userComposite, p5, p95);

    const clusterLabel = labels[Math.min(userOrderedCluster, labels.length - 1)];

    // Store cluster definitions and assignment atomically
    await withTransaction(pool, async (client) => {
        await storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model, client);
        await storeUserAssignment(userId, conceptId, userOrderedCluster, clusterLabel, userPercentile, client);
    });

    // Per-domain results for the breakdown
    const { domainScores } = computeCompositeScore(allMetrics[userId], allMetrics, dims);
    const domainResults = domainScores.map(ds => {
        const category = ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'very_good' : ds.score >= SCORE_THRESHOLDS.GOOD ? 'good' : 'requires_improvement';
        const categoryLabel = ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'Very Good' : ds.score >= SCORE_THRESHOLDS.GOOD ? 'Good' : 'Could Improve';
        return {
            domain: ds.domain,
            numericScore: Math.round(ds.score * 100) / 100,
            category,
            categoryLabel
        };
    });

    return {
        clusterLabel,
        clusterIndex: userOrderedCluster,
        percentileScore: Math.round(userPercentile * 100) / 100,
        compositeScore: Math.round(userComposite * 100) / 100,
        dialMin: Math.round(p5 * 100) / 100,
        dialCenter: Math.round(p50 * 100) / 100,
        dialMax: Math.round(p95 * 100) / 100,
        userCount: clusterComposites.length,
        domains: domainResults
    };
}

/**
 * SRL-specific clustering (variable number of concept dimensions)
 */
async function computeSRLClusterScores(allMetrics, userId) {
    const userDims = allMetrics[userId];
    if (!userDims) return null;

    // Get all concept keys that appear across any user
    const allConceptKeys = new Set();
    for (const dims of Object.values(allMetrics)) {
        for (const key of Object.keys(dims)) allConceptKeys.add(key);
    }
    const conceptKeys = [...allConceptKeys].sort();

    if (conceptKeys.length === 0) return null;

    const userIds = Object.keys(allMetrics);

    // Build feature matrix: each user gets a vector of their scores for each concept
    const featureMatrix = userIds.map(uid => {
        return conceptKeys.map(ck => {
            const data = allMetrics[uid]?.[ck];
            if (!data) return 0.5; // default if concept not present
            let score = data.score / 5; // Normalize from 1-5 to 0-1 scale
            if (data.isInverted) score = 1 - score;
            return score;
        });
    });

    // Center-normalize for PGMoE
    const { centered: centeredSRL } = centerNormalize(featureMatrix);

    const { k, covType, model, diagnostics } = selectOptimalModel(centeredSRL, 2, 4);
    logger.info(`srl: K=${k}, cov=${covType} for ${userIds.length} users`);

    // Compute and store diagnostics (fire-and-forget)
    {
        const silhouette = computeSilhouetteScore(centeredSRL, model.assignments, k);
        const daviesBouldin = computeDaviesBouldinIndex(centeredSRL, model.assignments, k, model.means);
        const clusterSizes = [];
        for (let c = 0; c < k; c++) {
            clusterSizes.push(model.assignments.filter(a => a === c).length);
        }
        storeDiagnostics('srl', {
            silhouette,
            daviesBouldin,
            diagnostics,
            clusterSizes,
            nUsers: userIds.length,
            nDimensions: conceptKeys.length
        }).catch(err => logger.error(`storeDiagnostics(srl) fire-and-forget error: ${err.message}`));
    }

    // Compute composite scores
    const composites = userIds.map((uid, idx) => {
        const scores = conceptKeys.map(ck => {
            const data = allMetrics[uid]?.[ck];
            if (!data) return 50;
            let s = (data.score / 5) * 100;
            if (data.isInverted) s = 100 - s;
            return s;
        });
        return {
            userId: uid,
            composite: scores.reduce((a, b) => a + b, 0) / scores.length,
            cluster: model.assignments[idx]
        };
    });

    // Order clusters
    const clusterMeans = [];
    for (let c = 0; c < k; c++) {
        const members = composites.filter(u => u.cluster === c);
        const mean = members.length > 0
            ? members.reduce((s, u) => s + u.composite, 0) / members.length
            : 0;
        clusterMeans.push({ cluster: c, mean, count: members.length });
    }
    clusterMeans.sort((a, b) => a.mean - b.mean);

    const clusterRemap = {};
    clusterMeans.forEach((cm, orderedIdx) => { clusterRemap[cm.cluster] = orderedIdx; });

    const userIdx = userIds.indexOf(userId);
    const userOrigCluster = model.assignments[userIdx];
    const userOrderedCluster = clusterRemap[userOrigCluster];
    const userComposite = composites[userIdx].composite;

    const clusterComposites = composites
        .filter(u => u.cluster === userOrigCluster)
        .map(u => u.composite)
        .sort((a, b) => a - b);

    const p5 = percentile(clusterComposites, 5);
    const p50 = percentile(clusterComposites, 50);
    const p95 = percentile(clusterComposites, 95);
    const userPercentile = mapToRange(userComposite, p5, p95);

    const srlLabels = generateClusterLabels(k, 'srl');
    const clusterLabel = srlLabels[Math.min(userOrderedCluster, srlLabels.length - 1)];

    await withTransaction(pool, async (client) => {
        await storeClusterResults('srl', composites, clusterRemap, clusterMeans, k, model, client);
        await storeUserAssignment(userId, 'srl', userOrderedCluster, clusterLabel, userPercentile, client);
    });

    // Per-domain results for SRL
    const domainResults = conceptKeys.map(ck => {
        const data = userDims[ck];
        if (!data) return { domain: ck, numericScore: 50, category: 'good', categoryLabel: 'Good' };
        let score = (data.score / 5) * 100;
        if (data.isInverted) score = 100 - score;
        const category = score >= SCORE_THRESHOLDS.VERY_GOOD ? 'very_good' : score >= SCORE_THRESHOLDS.GOOD ? 'good' : 'requires_improvement';
        const categoryLabel = score >= SCORE_THRESHOLDS.VERY_GOOD ? 'Very Good' : score >= SCORE_THRESHOLDS.GOOD ? 'Good' : 'Could Improve';
        return {
            domain: ck,
            numericScore: Math.round(score * 100) / 100,
            category,
            categoryLabel
        };
    });

    return {
        clusterLabel,
        clusterIndex: userOrderedCluster,
        percentileScore: Math.round(userPercentile * 100) / 100,
        compositeScore: Math.round(userComposite * 100) / 100,
        dialMin: Math.round(p5 * 100) / 100,
        dialCenter: Math.round(p50 * 100) / 100,
        dialMax: Math.round(p95 * 100) / 100,
        userCount: clusterComposites.length,
        domains: domainResults
    };
}

/**
 * Batch-score ALL users for a concept in a single PGMoE run.
 * Use after bulk data writes (e.g. CSV import) so every user is clustered
 * against the same complete, stable pool.
 *
 * @param {string} conceptId - 'lms', 'sleep', or 'screen_time' (not 'srl')
 * @param {number} days - Look-back window (default 7)
 * @returns {Promise<{coldStart?: boolean, usersScored: number, conceptId?: string}>}
 */
async function batchComputeClusterScores(conceptId, days = 7) {
    const fit = await _runConceptClustering(conceptId, days);
    if (!fit) {
        logger.info(`batchComputeClusterScores: cold start for ${conceptId}`);
        return { coldStart: true, usersScored: 0 };
    }

    const { allMetrics, userIds, composites, clusterRemap, clusterMeans, k, model, dims, labels } = fit;

    await withTransaction(pool, async (client) => {
        await storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model, client);

        for (let i = 0; i < userIds.length; i++) {
            const uid            = userIds[i];
            const origCluster    = model.assignments[i];
            const orderedCluster = clusterRemap[origCluster];
            const userComposite  = composites[i].composite;

            const clusterComposites = composites
                .filter(u => u.cluster === origCluster)
                .map(u => u.composite)
                .sort((a, b) => a - b);

            const p5  = percentile(clusterComposites, 5);
            const p95 = percentile(clusterComposites, 95);
            const userPercentile = mapToRange(userComposite, p5, p95);
            const clusterLabel   = labels[Math.min(orderedCluster, labels.length - 1)];

            await storeUserAssignment(uid, conceptId, orderedCluster, clusterLabel, userPercentile, client);
        }
    });

    // Build per-user domain results with categories so callers can write concept_scores
    // without re-running PGMoE.
    const userResults = userIds.map((uid, i) => {
        const userComposite = composites[i].composite;
        const { domainScores } = computeCompositeScore(allMetrics[uid], allMetrics, dims);
        const domains = domainScores.map(ds => ({
            domain: ds.domain,
            numericScore: Math.round(ds.score * 100) / 100,
            category: ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'very_good'
                    : ds.score >= SCORE_THRESHOLDS.GOOD ? 'good'
                    : 'requires_improvement',
            categoryLabel: ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'Very Good'
                         : ds.score >= SCORE_THRESHOLDS.GOOD ? 'Good'
                         : 'Could Improve'
        }));
        return { userId: uid, composite: Math.round(userComposite * 100) / 100, domains };
    });

    logger.info(`batchComputeClusterScores: ${conceptId} — ${userIds.length} users scored in one run`);
    return { usersScored: userIds.length, conceptId, userResults };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computeClusterScores,
    batchComputeClusterScores,
    DIMENSION_DEFS,
    // Re-exports from sub-modules for backwards compatibility
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels,
    centerNormalize,
    percentile,
    mapToRange,
    computeCompositeScore
};
