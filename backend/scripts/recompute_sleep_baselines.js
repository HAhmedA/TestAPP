import pool from '../config/database.js';
import { recomputeBaseline } from '../services/annotators/sleepAnnotationService.js';

async function main() {
    console.log('Starting Sleep Baseline Recomputation...');
    try {
        const { rows: users } = await pool.query('SELECT id, email FROM users');
        console.log(`Found ${users.length} users.`);

        for (const user of users) {
            console.log(`Recomputing sleep baseline for ${user.email} (${user.id})...`);
            try {
                await recomputeBaseline(pool, user.id, 7);
                console.log('  - Success.');
            } catch (e) { console.error('  - Error:', e); }
        }
        console.log('Sleep Baseline Recomputation Complete.');
    } catch (err) {
        console.error('Fatal Script Error:', err);
    } finally {
        await pool.end();
    }
}

main();
