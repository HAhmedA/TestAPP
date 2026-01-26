import pool from '../config/database.js';
import { computeJudgments } from '../services/annotators/lmsAnnotationService.js';

async function main() {
    console.log('Starting LMS Judgment Recomputation...');
    try {
        const { rows: users } = await pool.query('SELECT id, email FROM users');
        console.log(`Found ${users.length} users.`);

        for (const user of users) {
            console.log(`Recomputing LMS judgments for ${user.email} (${user.id})...`);
            try {
                const result = await computeJudgments(pool, user.id, 7);
                if (result) {
                    console.log(`  - Success: Generated ${Object.keys(result).length} sentences.`);
                } else {
                    console.log(`  - Skipped: No data.`);
                }
            } catch (err) {
                console.error(`  - Error processing user ${user.id}:`, err.message);
            }
        }
        console.log('LMS Recomputation Complete.');
    } catch (err) {
        console.error('Fatal Script Error:', err);
    } finally {
        await pool.end();
    }
}

main();
