// Seed Data Service
// Generates simulated data for pre-created test accounts on backend startup.
// Only runs for seed accounts that have a simulated_profile but no SRL data yet.
// Always runs a score recomputation pass for all test accounts so early-seeded
// users (whose scores were cold-start skipped) get scores once the pool is full.

import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { generateStudentData } from './simulationOrchestratorService.js';
import { computeAllScores } from './scoring/scoreComputationService.js';

/**
 * Recompute scores for all seeded test accounts (fire-and-forget helper).
 * Runs after data generation so that users seeded while pool < threshold
 * get their scores computed now that the full cohort is available.
 */
async function recomputeAllSeedScores() {
    try {
        const { rows } = await pool.query(`
            SELECT u.id FROM public.users u
            JOIN public.student_profiles sp ON sp.user_id = u.id
            WHERE sp.simulated_profile IS NOT NULL
              AND u.email LIKE 'test%@example.com'
        `);
        if (rows.length === 0) return;
        logger.info(`Seed data: Recomputing scores for ${rows.length} seeded account(s)...`);
        let ok = 0;
        for (const { id } of rows) {
            try { await computeAllScores(id); ok++; }
            catch (err) { logger.error(`Seed data: score recompute failed for ${id}: ${err.message}`); }
        }
        logger.info(`Seed data: Score recomputation complete — ${ok}/${rows.length} updated.`);
    } catch (err) {
        logger.error(`Seed data: score recomputation pass error: ${err.message}`);
    }
}

/**
 * Find seed accounts that need data generation and run the orchestrator for each.
 * A seed account is one with a simulated_profile set but no srl_responses yet.
 * Always finishes with a score recompute pass for the full cohort.
 */
export async function seedTestAccountData() {
    // When SIMULATION_MODE is explicitly disabled, do not run simulators.
    if (process.env.SIMULATION_MODE === 'false') {
        logger.info('Seed data: SIMULATION_MODE=false — skipping test account data generation.');
        return;
    }

    try {
        // Find accounts with a profile but no SRL responses (i.e. no simulation data yet)
        const { rows: accountsNeedingData } = await pool.query(`
            SELECT u.id, u.email, sp.simulated_profile
            FROM public.users u
            JOIN public.student_profiles sp ON sp.user_id = u.id
            WHERE sp.simulated_profile IS NOT NULL
              AND u.email LIKE 'test%@example.com'
              AND NOT EXISTS (
                  SELECT 1 FROM public.srl_responses sr WHERE sr.user_id = u.id
              )
            ORDER BY u.email
        `);

        if (accountsNeedingData.length === 0) {
            logger.info('Seed data: All test accounts already have simulated data.');
        } else {
            logger.info(`Seed data: ${accountsNeedingData.length} test account(s) need data generation.`);

            for (const account of accountsNeedingData) {
                try {
                    logger.info(`Seed data: Generating data for ${account.email} (profile: ${account.simulated_profile})...`);
                    await generateStudentData(pool, account.id);
                    logger.info(`Seed data: ✓ ${account.email} complete.`);
                } catch (err) {
                    logger.error(`Seed data: ✗ Failed for ${account.email}: ${err.message}`);
                }
            }

            logger.info('Seed data: All test account data generation finished.');
        }

        // Always recompute scores for the full cohort so that users seeded under
        // cold-start (pool < threshold at the time they were generated) get their
        // scores now that the full pool is present.
        recomputeAllSeedScores(); // fire-and-forget — does not block startup
    } catch (err) {
        logger.error(`Seed data service error: ${err.message}`);
    }
}
