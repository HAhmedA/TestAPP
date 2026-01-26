import pool from '../config/database.js';
import { generateStudentData } from '../services/simulationOrchestratorService.js';

const userId = 'a6e7cf73-444c-476e-b255-f04ab98acaf5';

async function main() {
    console.log(`Running simulation for ${userId}...`);
    try {
        const profile = await generateStudentData(pool, userId);
        console.log(`Success! Profile assigned: ${profile}`);
    } catch (err) {
        console.error('Error running simulation:', err);
    } finally {
        await pool.end();
    }
}

main();
