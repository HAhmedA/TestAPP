// Cluster Storage Service
// Handles persisting PGMoE cluster results and user assignments to the database.

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { withTransaction } from '../../utils/withTransaction.js';
import { generateClusterLabels } from './pgmoeAlgorithm.js';
import { percentile } from '../../utils/stats.js';

// =============================================================================
// DB STORAGE
// =============================================================================

async function storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model, externalClient = null) {
    const doWork = async (client) => {
        // Clean up stale clusters from previous runs with higher K
        await client.query(
            `DELETE FROM public.peer_clusters WHERE concept_id = $1 AND cluster_index >= $2`,
            [conceptId, k]
        );

        const labels = generateClusterLabels(k, conceptId);
        for (let origC = 0; origC < k; origC++) {
            const orderedIdx = clusterRemap[origC];
            const members = composites.filter(u => u.cluster === origC);
            const scores = members.map(u => u.composite).sort((a, b) => a - b);

            const p5Val = percentile(scores, 5);
            const p50Val = percentile(scores, 50);
            const p95Val = percentile(scores, 95);
            const label = labels[Math.min(orderedIdx, labels.length - 1)];

            await client.query(
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
    };

    if (externalClient) {
        await doWork(externalClient);
        return;
    }
    try {
        await withTransaction(pool, doWork);
    } catch (err) {
        logger.error(`Error storing cluster results for ${conceptId}: ${err.message}`);
    }
}

async function storeUserAssignment(userId, conceptId, clusterIndex, clusterLabel, percentilePosition, externalClient = null) {
    const sql = `INSERT INTO public.user_cluster_assignments
             (user_id, concept_id, cluster_index, cluster_label, percentile_position, assigned_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id, concept_id) DO UPDATE SET
               cluster_index = EXCLUDED.cluster_index,
               cluster_label = EXCLUDED.cluster_label,
               percentile_position = EXCLUDED.percentile_position,
               assigned_at = NOW()`;
    const params = [userId, conceptId, clusterIndex, clusterLabel, percentilePosition];

    if (externalClient) {
        // Inside a transaction — let errors propagate so withTransaction can rollback
        await externalClient.query(sql, params);
        return;
    }

    // Standalone path (fire-and-forget) — log but don't crash the caller
    try {
        await pool.query(sql, params);
    } catch (err) {
        logger.error(`Error storing user cluster assignment: ${err.message}`);
    }
}

/**
 * Persist a cluster run diagnostic record (append-only, no upsert).
 * Fire-and-forget: callers should not await unless they need confirmation.
 *
 * @param {string} conceptId
 * @param {Object} payload
 * @param {number} payload.silhouette
 * @param {number} payload.daviesBouldin
 * @param {Object} payload.diagnostics - { selected, candidates } from selectOptimalModel
 * @param {number[]} payload.clusterSizes - member counts per ordered cluster
 * @param {number} payload.nUsers
 * @param {number} payload.nDimensions
 */
async function storeDiagnostics(conceptId, payload) {
    const { silhouette, daviesBouldin, diagnostics, clusterSizes, nUsers, nDimensions } = payload;
    try {
        await pool.query(
            `INSERT INTO public.cluster_run_diagnostics
               (concept_id, selected_k, selected_cov_type,
                silhouette_score, davies_bouldin_index,
                all_candidates, cluster_sizes, n_users, n_dimensions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                conceptId,
                diagnostics.selected.k,
                diagnostics.selected.covType,
                silhouette != null ? Math.round(silhouette * 1000) / 1000 : null,
                daviesBouldin != null ? Math.round(daviesBouldin * 1000) / 1000 : null,
                JSON.stringify(diagnostics.candidates),
                JSON.stringify(clusterSizes),
                nUsers,
                nDimensions
            ]
        );
    } catch (err) {
        logger.error(`storeDiagnostics(${conceptId}): ${err.message}`);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { storeClusterResults, storeUserAssignment, storeDiagnostics };
