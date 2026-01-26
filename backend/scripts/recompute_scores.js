import { computeAllScores } from '../services/scoring/scoreComputationService.js';
import pool from '../config/database.js';

async function main() {
    console.log('Recomputing scores for ALL users...');
    try {
        const { rows: users } = await pool.query('SELECT id, email FROM users');
        for (const user of users) {
            console.log(`Processing ${user.email} (${user.id})...`);
            try {
                const results = await computeAllScores(user.id);
                // Log deep structure to verify label presence for one user
                if (user.email.startsWith('student') || user.email.startsWith('test')) {
                    console.log('Results (SRL sample):', JSON.stringify(results.srl?.breakdown, null, 2));
                    console.log('Results (LMS sample):', JSON.stringify(results.lms?.breakdown, null, 2));
                }
            } catch (e) { console.error(e); }
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
