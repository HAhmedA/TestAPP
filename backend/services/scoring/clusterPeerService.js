// Cluster Peer Service
// Parsimonious Gaussian Mixture of Experts (PGMoE) for peer comparison
// Uses feature-dependent gating + parsimonious covariance models
//
// Flow:
//   1. Gather all users' raw metrics per concept
//   2. Winsorize at P5/P95, scale to [0,1], then center-normalize (zero mean, unit var)
//   3. Fit PGMoE: test all (K, covType) combos, select best via BIC+AIC+entropy
//   4. Assign each user to their most-likely cluster
//   5. Compute per-cluster percentiles (P5, P50, P95) on composite score
//   6. Map user's score to 0-100 within their cluster's P5-P95 range

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';

// Re-use the metric queries from the existing service
import { computeStats } from './peerStatsService.js';

// =============================================================================
// PARSIMONIOUS GAUSSIAN MIXTURE OF EXPERTS (PGMoE)
// =============================================================================

/**
 * Center-normalize a feature matrix: zero mean, unit variance per dimension.
 * Returns { centered, means, stds } so we can un-normalize if needed.
 */
function centerNormalize(data) {
    const n = data.length;
    const d = data[0].length;
    const means = new Array(d).fill(0);
    const stds = new Array(d).fill(0);

    // Compute means
    for (const row of data) {
        for (let j = 0; j < d; j++) means[j] += row[j] / n;
    }
    // Compute standard deviations
    for (const row of data) {
        for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2 / n;
    }
    for (let j = 0; j < d; j++) stds[j] = Math.sqrt(Math.max(stds[j], 1e-10));

    // Center and scale
    const centered = data.map(row =>
        row.map((v, j) => (v - means[j]) / stds[j])
    );

    return { centered, means, stds };
}

/**
 * Gaussian PDF (log-domain for numerical stability).
 * Supports both per-component diagonal variance and shared variance.
 */
function gaussianLogPDF(x, mean, variance) {
    const d = x.length;
    let logP = -0.5 * d * Math.log(2 * Math.PI);
    for (let i = 0; i < d; i++) {
        const v = Math.max(variance[i], 1e-6);
        logP -= 0.5 * Math.log(v);
        logP -= 0.5 * ((x[i] - mean[i]) ** 2) / v;
    }
    return logP;
}

function gaussianPDF(x, mean, variance) {
    return Math.exp(gaussianLogPDF(x, mean, variance));
}

/**
 * Softmax gating network: g_k(x) = softmax(W * x + b)
 * First class is reference (W[0]=0, b[0]=0) for identifiability.
 *
 * @param {number[]} x - Feature vector (D)
 * @param {number[][]} W - Weight matrix (K x D), W[0] is zeros
 * @param {number[]} b - Bias vector (K), b[0] is 0
 * @returns {number[]} - Gating probabilities (K), sums to 1
 */
function gatingProbs(x, W, b) {
    const k = W.length;
    const logits = new Array(k);
    let maxLogit = -Infinity;

    for (let c = 0; c < k; c++) {
        let z = b[c];
        for (let j = 0; j < x.length; j++) z += W[c][j] * x[j];
        logits[c] = z;
        if (z > maxLogit) maxLogit = z;
    }

    // Numerically stable softmax
    let sumExp = 0;
    const probs = new Array(k);
    for (let c = 0; c < k; c++) {
        probs[c] = Math.exp(logits[c] - maxLogit);
        sumExp += probs[c];
    }
    for (let c = 0; c < k; c++) probs[c] /= sumExp;

    return probs;
}

/**
 * Update gating parameters (W, b) via IRLS (one Newton-Raphson step per iteration).
 * Treats responsibilities as soft labels for multinomial logistic regression.
 * Component 0 is reference class (W[0]=0, b[0]=0).
 *
 * @param {number[][]} data - N x D feature matrix
 * @param {number[][]} responsibilities - N x K responsibilities
 * @param {number[][]} W - Current K x D weight matrix
 * @param {number[]} b - Current K bias vector
 * @param {number} learningRate - Step size (default 0.1 for stability)
 * @param {number} nSteps - Number of gradient steps per M-step
 */
function updateGating(data, responsibilities, W, b, learningRate = 0.1, nSteps = 3) {
    const n = data.length;
    const d = data[0].length;
    const k = W.length;

    for (let step = 0; step < nSteps; step++) {
        // Compute gradients for each non-reference component (c >= 1)
        for (let c = 1; c < k; c++) {
            const gradW = new Array(d).fill(0);
            let gradB = 0;

            for (let i = 0; i < n; i++) {
                const g = gatingProbs(data[i], W, b);
                const diff = responsibilities[i][c] - g[c];
                for (let j = 0; j < d; j++) {
                    gradW[j] += diff * data[i][j];
                }
                gradB += diff;
            }

            // Gradient ascent with L2 regularization (lambda = 0.01)
            const lambda = 0.01;
            for (let j = 0; j < d; j++) {
                W[c][j] += learningRate * (gradW[j] / n - lambda * W[c][j]);
            }
            b[c] += learningRate * (gradB / n);
        }
    }
}

/**
 * Compute covariance under different parsimonious constraints.
 *
 * @param {number[][]} data - N x D
 * @param {number[][]} responsibilities - N x K
 * @param {number[][]} means - K x D means
 * @param {number} k - Number of components
 * @param {string} covType - 'EII' | 'VII' | 'EEI' | 'VVI'
 * @returns {number[][][]} - K arrays, each D-length (diagonal variances)
 */
function computeParsimonousCovariance(data, responsibilities, means, k, covType) {
    const n = data.length;
    const d = means[0].length;
    const FLOOR = 1e-6;

    if (covType === 'EII') {
        // Equal spherical: single σ² shared across all clusters & dimensions
        let totalVar = 0;
        let totalWeight = 0;
        for (let c = 0; c < k; c++) {
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    totalVar += r * (data[i][j] - means[c][j]) ** 2;
                }
                totalWeight += r;
            }
        }
        const sigma2 = Math.max(totalVar / (totalWeight * d), FLOOR);
        return Array.from({ length: k }, () => new Array(d).fill(sigma2));
    }

    if (covType === 'VII') {
        // Varying spherical: σ_k² per cluster, shared across dimensions
        const variances = [];
        for (let c = 0; c < k; c++) {
            let clusterVar = 0;
            let Nc = 0;
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    clusterVar += r * (data[i][j] - means[c][j]) ** 2;
                }
                Nc += r;
            }
            const sigma2 = Math.max(clusterVar / (Math.max(Nc, FLOOR) * d), FLOOR);
            variances.push(new Array(d).fill(sigma2));
        }
        return variances;
    }

    if (covType === 'EEI') {
        // Equal diagonal: diag(Σ) shared across clusters
        const sharedVar = new Array(d).fill(0);
        let totalWeight = 0;
        for (let c = 0; c < k; c++) {
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    sharedVar[j] += r * (data[i][j] - means[c][j]) ** 2;
                }
                totalWeight += r;
            }
        }
        for (let j = 0; j < d; j++) sharedVar[j] = Math.max(sharedVar[j] / totalWeight, FLOOR);
        return Array.from({ length: k }, () => [...sharedVar]);
    }

    // VVI: varying diagonal (default, most flexible)
    const variances = [];
    for (let c = 0; c < k; c++) {
        const v = new Array(d).fill(0);
        let Nc = 0;
        for (let i = 0; i < n; i++) {
            const r = responsibilities[i][c];
            for (let j = 0; j < d; j++) {
                v[j] += r * (data[i][j] - means[c][j]) ** 2;
            }
            Nc += r;
        }
        for (let j = 0; j < d; j++) v[j] = Math.max(v[j] / Math.max(Nc, FLOOR), FLOOR);
        variances.push(v);
    }
    return variances;
}

/**
 * Count free parameters for a given (K, D, covType) configuration.
 * Includes gating params: (K-1) * (D+1) for softmax regression.
 */
function countParams(k, d, covType) {
    // Gating: (K-1) weight vectors of size D, plus (K-1) biases
    const gatingParams = (k - 1) * (d + 1);
    // Means: K * D
    const meanParams = k * d;
    // Covariance depends on type
    let covParams;
    switch (covType) {
        case 'EII': covParams = 1; break;          // One shared σ²
        case 'VII': covParams = k; break;           // σ_k² per cluster
        case 'EEI': covParams = d; break;           // Shared diagonal
        case 'VVI': covParams = k * d; break;       // Per-cluster diagonal
        default: covParams = k * d;
    }
    return gatingParams + meanParams + covParams;
}

/**
 * K-Means++ initialization for centroids.
 */
function kMeansPPInit(data, k) {
    const n = data.length;
    const d = data[0].length;
    const means = [];

    means.push([...data[Math.floor(Math.random() * n)]]);

    for (let c = 1; c < k; c++) {
        const dists = data.map(point => {
            let minDist = Infinity;
            for (const m of means) {
                let dist = 0;
                for (let i = 0; i < d; i++) dist += (point[i] - m[i]) ** 2;
                minDist = Math.min(minDist, dist);
            }
            return minDist;
        });
        const totalDist = dists.reduce((s, v) => s + v, 0);
        let r = Math.random() * totalDist;
        let idx = 0;
        for (let i = 0; i < n; i++) {
            r -= dists[i];
            if (r <= 0) { idx = i; break; }
        }
        means.push([...data[idx]]);
    }

    return means;
}

/**
 * Fit a Parsimonious Gaussian Mixture of Experts using EM.
 *
 * @param {number[][]} data - N x D feature matrix (should be center-normalized)
 * @param {number} k - Number of components
 * @param {string} covType - 'EII' | 'VII' | 'EEI' | 'VVI'
 * @param {number} maxIter - Maximum EM iterations
 * @param {number} tol - Log-likelihood convergence tolerance
 * @returns {{ means, variances, W, b, assignments, responsibilities, logLikelihood, covType }}
 */
function fitPGMoE(data, k, covType = 'VVI', maxIter = 50, tol = 1e-4) {
    const n = data.length;
    const d = data[0].length;

    // Edge case: fewer data points than clusters
    if (n <= k) {
        const assignments = data.map((_, i) => Math.min(i, k - 1));
        const responsibilities = data.map((_, i) => {
            const row = new Array(k).fill(0);
            row[Math.min(i, k - 1)] = 1;
            return row;
        });
        const means = [];
        for (let c = 0; c < k; c++) {
            const pts = data.filter((_, i) => assignments[i] === c);
            means.push(pts.length > 0 ? pts[0].slice() : new Array(d).fill(0));
        }
        const variances = Array.from({ length: k }, () => new Array(d).fill(1));
        const W = Array.from({ length: k }, () => new Array(d).fill(0));
        const b = new Array(k).fill(0);
        return { means, variances, W, b, assignments, responsibilities, logLikelihood: -Infinity, covType };
    }

    // Initialize means via K-Means++
    let means = kMeansPPInit(data, k);

    // Initialize gating: zero weights (uniform gating to start)
    let W = Array.from({ length: k }, () => new Array(d).fill(0));
    let b = new Array(k).fill(0);

    // Initialize responsibilities uniformly, then compute initial covariance
    let responsibilities = Array.from({ length: n }, () => new Array(k).fill(1 / k));

    // Initial hard assignment to nearest mean for better covariance init
    for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
            let dist = 0;
            for (let j = 0; j < d; j++) dist += (data[i][j] - means[c][j]) ** 2;
            if (dist < bestDist) { bestDist = dist; bestC = c; }
        }
        responsibilities[i] = new Array(k).fill(0);
        responsibilities[i][bestC] = 1;
    }

    let variances = computeParsimonousCovariance(data, responsibilities, means, k, covType);

    // Reset to soft responsibilities
    responsibilities = Array.from({ length: n }, () => new Array(k).fill(1 / k));

    let prevLogL = -Infinity;
    let logLikelihood = -Infinity;

    for (let iter = 0; iter < maxIter; iter++) {
        // ===== E-Step: compute responsibilities =====
        logLikelihood = 0;

        for (let i = 0; i < n; i++) {
            const gate = gatingProbs(data[i], W, b);
            let totalP = 0;
            for (let c = 0; c < k; c++) {
                const gp = gaussianPDF(data[i], means[c], variances[c]);
                responsibilities[i][c] = gate[c] * gp;
                totalP += responsibilities[i][c];
            }
            if (totalP > 0) {
                for (let c = 0; c < k; c++) responsibilities[i][c] /= totalP;
                logLikelihood += Math.log(totalP);
            } else {
                for (let c = 0; c < k; c++) responsibilities[i][c] = 1 / k;
            }
        }

        // Check convergence
        if (Math.abs(logLikelihood - prevLogL) < tol) {
            logger.debug(`PGMoE(${covType},K=${k}) converged at iter ${iter}, logL=${logLikelihood.toFixed(4)}`);
            break;
        }
        prevLogL = logLikelihood;

        // ===== M-Step =====

        // 1. Update gating network (W, b) via gradient ascent
        updateGating(data, responsibilities, W, b);

        // 2. Update means
        for (let c = 0; c < k; c++) {
            let Nc = 0;
            for (let i = 0; i < n; i++) Nc += responsibilities[i][c];
            if (Nc < 1e-10) continue;

            const newMean = new Array(d).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < d; j++) {
                    newMean[j] += responsibilities[i][c] * data[i][j];
                }
            }
            for (let j = 0; j < d; j++) newMean[j] /= Nc;
            means[c] = newMean;
        }

        // 3. Update covariance with parsimony constraints
        variances = computeParsimonousCovariance(data, responsibilities, means, k, covType);
    }

    // Hard assignments via argmax
    const assignments = responsibilities.map(row => {
        let maxIdx = 0;
        for (let c = 1; c < k; c++) {
            if (row[c] > row[maxIdx]) maxIdx = c;
        }
        return maxIdx;
    });

    return { means, variances, W, b, assignments, responsibilities, logLikelihood, covType };
}

/**
 * Compute classification entropy of responsibilities.
 * Returns normalized value in [0, 1] where 1 = perfectly crisp, 0 = max ambiguity.
 */
function computeNormalizedEntropy(responsibilities, n, k) {
    if (k <= 1 || n === 0) return 1;
    let entropy = 0;
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < k; c++) {
            const r = Math.max(responsibilities[i][c], 1e-300);
            entropy -= r * Math.log(r);
        }
    }
    // Max possible entropy = n * log(k) (uniform assignments)
    const maxEntropy = n * Math.log(k);
    // Normalized: 1 = crisp, 0 = ambiguous
    return maxEntropy > 0 ? 1 - (entropy / maxEntropy) : 1;
}

/**
 * Select optimal (K, covType) using composite criterion:
 * rank-based combination of BIC (40%), AIC (30%), and normalized entropy (30%).
 *
 * @param {number[][]} data - Center-normalized feature matrix (N x D)
 * @param {number} kMin - Minimum K to test (default 2)
 * @param {number} kMax - Maximum K to test (default 6)
 * @returns {{ k, covType, model }} - Best K, covariance type, and fitted model
 */
function selectOptimalModel(data, kMin = 2, kMax = 6) {
    const n = data.length;
    const d = data[0].length;
    const COV_TYPES = ['EII', 'VII', 'EEI', 'VVI'];

    kMax = Math.min(kMax, n);
    kMin = Math.min(kMin, kMax);

    const candidates = [];

    for (const covType of COV_TYPES) {
        for (let k = kMin; k <= kMax; k++) {
            const model = fitPGMoE(data, k, covType);
            const logL = model.logLikelihood;
            const p = countParams(k, d, covType);

            const bic = -2 * logL + p * Math.log(n);
            const aic = -2 * logL + 2 * p;
            const entropy = computeNormalizedEntropy(model.responsibilities, n, k);

            candidates.push({ k, covType, model, bic, aic, entropy, logL, p });
        }
    }

    if (candidates.length === 0) {
        // Fallback
        const model = fitPGMoE(data, kMin, 'VVI');
        return { k: kMin, covType: 'VVI', model };
    }

    // Rank each candidate on each criterion (lower rank = better)
    // BIC: lower is better → sort ascending
    const bicSorted = [...candidates].sort((a, b) => a.bic - b.bic);
    // AIC: lower is better → sort ascending
    const aicSorted = [...candidates].sort((a, b) => a.aic - b.aic);
    // Entropy: higher is better → sort descending
    const entSorted = [...candidates].sort((a, b) => b.entropy - a.entropy);

    const bicRank = new Map();
    const aicRank = new Map();
    const entRank = new Map();
    bicSorted.forEach((c, i) => bicRank.set(c, i));
    aicSorted.forEach((c, i) => aicRank.set(c, i));
    entSorted.forEach((c, i) => entRank.set(c, i));

    // Composite score: weighted sum of ranks
    let bestCandidate = candidates[0];
    let bestScore = Infinity;

    for (const c of candidates) {
        const score = 0.4 * bicRank.get(c) + 0.3 * aicRank.get(c) + 0.3 * entRank.get(c);

        logger.debug(`  K=${c.k} ${c.covType}: BIC=${c.bic.toFixed(1)}, AIC=${c.aic.toFixed(1)}, ` +
            `entropy=${c.entropy.toFixed(3)}, composite=${score.toFixed(2)}`);

        if (score < bestScore) {
            bestScore = score;
            bestCandidate = c;
        }
    }

    logger.info(`Selected: K=${bestCandidate.k}, cov=${bestCandidate.covType}, ` +
        `BIC=${bestCandidate.bic.toFixed(1)}, AIC=${bestCandidate.aic.toFixed(1)}, ` +
        `entropy=${bestCandidate.entropy.toFixed(3)}, compositeRank=${bestScore.toFixed(2)}`);

    return {
        k: bestCandidate.k,
        covType: bestCandidate.covType,
        model: bestCandidate.model
    };
}

/**
 * Generate human-readable cluster labels for any K.
 * Labels are ordered from worst (index 0) to best (index K-1).
 */
function generateClusterLabels(k) {
    if (k === 1) return ['Your peer group'];
    if (k === 2) return [
        'Students building stronger habits',
        'Students with strong habits'
    ];
    if (k === 3) return [
        'Students building stronger habits',
        'Students with balanced patterns',
        'Students with strong habits'
    ];
    const labels = [];
    for (let i = 0; i < k; i++) {
        const fraction = i / (k - 1);
        if (fraction < 0.25) labels.push('Students building stronger habits');
        else if (fraction > 0.75) labels.push('Students with strong habits');
        else labels.push(`Students with balanced patterns (group ${i})`);
    }
    return labels;
}

// =============================================================================
// METRIC QUERIES (reused from peerStatsService)
// =============================================================================

// Import the metric queries — we'll re-export the same function
// to avoid code duplication
async function getAllUserMetrics(conceptId, days = 7) {
    // Dynamic import to avoid circular dependency
    const mod = await import('./peerStatsService.js');
    // peerStatsService has a private getAllUserMetrics — we replicate the queries here
    // since that function isn't exported. We call the concept-specific ones.
    switch (conceptId) {
        case 'lms': return getLMSMetrics(days);
        case 'sleep': return getSleepMetrics(days);
        case 'screen_time': return getScreenTimeMetrics(days);
        case 'srl': return getSRLMetrics();
        default:
            logger.warn(`clusterPeerService: unknown concept ${conceptId}`);
            return {};
    }
}

async function getLMSMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               SUM(total_active_minutes) as total_active_minutes,
               SUM(number_of_sessions) as number_of_sessions,
               COUNT(DISTINCT session_date) as days_active,
               SUM(reading_minutes) + SUM(watching_minutes) as passive_minutes,
               SUM(total_active_minutes) as total_minutes,
               CASE WHEN SUM(number_of_sessions) > 0
                    THEN SUM(total_active_minutes)::float / SUM(number_of_sessions)
                    ELSE 0 END as avg_session_duration
        FROM public.lms_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        const totalMin = parseFloat(r.total_minutes) || 0;
        const passiveMin = parseFloat(r.passive_minutes) || 0;
        const activePercent = totalMin > 0 ? ((totalMin - passiveMin) / totalMin) * 100 : 0;
        metrics[r.user_id] = {
            total_active_minutes: parseFloat(r.total_active_minutes) || 0,
            number_of_sessions: parseFloat(r.number_of_sessions) || 0,
            days_active: parseFloat(r.days_active) || 0,
            active_percent: activePercent,
            avg_session_duration: parseFloat(r.avg_session_duration) || 0
        };
    }
    return metrics;
}

async function getSleepMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_sleep_minutes) as avg_sleep_minutes,
               AVG(awakenings_count) as avg_awakenings,
               AVG(awake_minutes) as avg_awake_minutes,
               STDDEV_POP(EXTRACT(HOUR FROM bedtime) + EXTRACT(MINUTE FROM bedtime) / 60.0) as bedtime_stddev
        FROM public.sleep_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            sleep_minutes: parseFloat(r.avg_sleep_minutes) || 0,
            awakenings: parseFloat(r.avg_awakenings) || 0,
            awake_minutes: parseFloat(r.avg_awake_minutes) || 0,
            bedtime_stddev: parseFloat(r.bedtime_stddev) || 0
        };
    }
    return metrics;
}

async function getScreenTimeMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_screen_minutes) as avg_screen_minutes,
               AVG(longest_continuous_session) as avg_longest_session,
               AVG(late_night_screen_minutes) as avg_late_night
        FROM public.screen_time_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            screen_minutes: parseFloat(r.avg_screen_minutes) || 0,
            longest_session: parseFloat(r.avg_longest_session) || 0,
            late_night: parseFloat(r.avg_late_night) || 0
        };
    }
    return metrics;
}

async function getSRLMetrics() {
    const { rows } = await pool.query(`
        SELECT user_id, concept_key, avg_score, is_inverted
        FROM public.srl_annotations
        WHERE time_window = '7d' AND response_count > 0
        ORDER BY user_id, concept_key
    `);
    const metrics = {};
    for (const r of rows) {
        if (!metrics[r.user_id]) metrics[r.user_id] = {};
        metrics[r.user_id][r.concept_key] = {
            score: parseFloat(r.avg_score) || 0,
            isInverted: r.is_inverted
        };
    }
    return metrics;
}

// =============================================================================
// DIMENSION DEFINITIONS (which metrics to use, and which are inverted)
// =============================================================================

const DIMENSION_DEFS = {
    lms: {
        volume: { metric: 'total_active_minutes', inverted: false },
        consistency: { metric: 'days_active', inverted: false },
        action_mix: { metric: 'active_percent', inverted: false },
        session_quality: { metric: 'avg_session_duration', inverted: false }
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
 * Compute percentile of a sorted array at a given percentile (0-100)
 */
function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    if (sortedArr.length === 1) return sortedArr[0];
    const idx = (p / 100) * (sortedArr.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sortedArr[lower];
    return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
}

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

/**
 * Compute cluster-based peer comparison scores for a user.
 *
 * @param {Object} dbPool - Database pool (unused, we use imported pool)
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Object} { clusterLabel, percentileScore, dialMin, dialCenter, dialMax, domains: [...] }
 */
// Minimum number of real users required before PGMoE clustering is meaningful.
// Below this threshold the system returns { coldStart: true } and the dashboard
// shows a "Building your profile" placeholder instead of the gauge.
const MIN_CLUSTER_USERS = 10;

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

    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return null;

    const userIds = Object.keys(allMetrics);

    // Cold start: not enough real users to form meaningful clusters yet.
    if (userIds.length < MIN_CLUSTER_USERS) {
        logger.info(`clusterPeerService: cold start for ${conceptId} (${userIds.length}/${MIN_CLUSTER_USERS} users)`);
        return { coldStart: true };
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
    const { k, covType, model } = selectOptimalModel(centered, 2, 4);
    logger.info(`${conceptId}: K=${k}, cov=${covType} for ${userIds.length} users`);

    // Compute composite scores for each user
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

    // Build re-mapping: original cluster index → ordered index (0=worst, 2=best)
    const clusterRemap = {};
    clusterMeans.forEach((cm, orderedIdx) => {
        clusterRemap[cm.cluster] = orderedIdx;
    });

    // Find the user's cluster and percentile position
    const userIdx = userIds.indexOf(userId);
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

    const labels = generateClusterLabels(k);
    const clusterLabel = labels[Math.min(userOrderedCluster, labels.length - 1)];

    // Store cluster definitions and assignment in DB
    await storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model);
    await storeUserAssignment(userId, conceptId, userOrderedCluster, clusterLabel, userPercentile);

    // Also compute per-domain results for the breakdown
    const { domainScores } = computeCompositeScore(allMetrics[userId], allMetrics, dims);
    const domainResults = domainScores.map(ds => {
        const category = ds.score >= 66 ? 'very_good' : ds.score >= 33 ? 'good' : 'requires_improvement';
        const categoryLabel = ds.score >= 66 ? 'Very Good' : ds.score >= 33 ? 'Good' : 'Could Improve';
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

    const { k, covType, model } = selectOptimalModel(centeredSRL, 2, 4);
    logger.info(`srl: K=${k}, cov=${covType} for ${userIds.length} users`);

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

    const srlLabels = generateClusterLabels(k);
    const clusterLabel = srlLabels[Math.min(userOrderedCluster, srlLabels.length - 1)];

    await storeClusterResults('srl', composites, clusterRemap, clusterMeans, k, model);
    await storeUserAssignment(userId, 'srl', userOrderedCluster, clusterLabel, userPercentile);

    // Per-domain results for SRL
    const domainResults = conceptKeys.map(ck => {
        const data = userDims[ck];
        if (!data) return { domain: ck, numericScore: 50, category: 'good', categoryLabel: 'Good' };
        let score = (data.score / 5) * 100;
        if (data.isInverted) score = 100 - score;
        const category = score >= 66 ? 'very_good' : score >= 33 ? 'good' : 'requires_improvement';
        const categoryLabel = score >= 66 ? 'Very Good' : score >= 33 ? 'Good' : 'Could Improve';
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

// =============================================================================
// DB STORAGE
// =============================================================================

async function storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model) {
    try {
        // Clean up stale clusters from previous runs with higher K
        await pool.query(
            `DELETE FROM public.peer_clusters WHERE concept_id = $1 AND cluster_index >= $2`,
            [conceptId, k]
        );

        const labels = generateClusterLabels(k);
        for (let origC = 0; origC < k; origC++) {
            const orderedIdx = clusterRemap[origC];
            const members = composites.filter(u => u.cluster === origC);
            const scores = members.map(u => u.composite).sort((a, b) => a - b);

            const p5Val = percentile(scores, 5);
            const p50Val = percentile(scores, 50);
            const p95Val = percentile(scores, 95);
            const label = labels[Math.min(orderedIdx, labels.length - 1)];

            await pool.query(
                `INSERT INTO public.peer_clusters
                 (concept_id, cluster_index, cluster_label, centroid, p5, p50, p95, user_count, computed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (concept_id, cluster_index) DO UPDATE SET
                   cluster_label = EXCLUDED.cluster_label,
                   centroid = EXCLUDED.centroid,
                   p5 = EXCLUDED.p5,
                   p50 = EXCLUDED.p50,
                   p95 = EXCLUDED.p95,
                   user_count = EXCLUDED.user_count,
                   computed_at = NOW()`,
                [conceptId, orderedIdx, label, JSON.stringify(model.means[origC] || []),
                    p5Val, p50Val, p95Val, members.length]
            );
        }
    } catch (err) {
        logger.error(`Error storing cluster results for ${conceptId}: ${err.message}`);
    }
}

async function storeUserAssignment(userId, conceptId, clusterIndex, clusterLabel, percentilePosition) {
    try {
        await pool.query(
            `INSERT INTO public.user_cluster_assignments
             (user_id, concept_id, cluster_index, cluster_label, percentile_position, assigned_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id, concept_id) DO UPDATE SET
               cluster_index = EXCLUDED.cluster_index,
               cluster_label = EXCLUDED.cluster_label,
               percentile_position = EXCLUDED.percentile_position,
               assigned_at = NOW()`,
            [userId, conceptId, clusterIndex, clusterLabel, percentilePosition]
        );
    } catch (err) {
        logger.error(`Error storing user cluster assignment: ${err.message}`);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computeClusterScores,
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels,
    centerNormalize,
    percentile,
    mapToRange,
    computeCompositeScore,
    DIMENSION_DEFS
};
