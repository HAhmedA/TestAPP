// Database connection pool configuration
import pkg from 'pg'
const { Pool } = pkg

const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'password',
    database: process.env.PGDATABASE || 'postgres',
})

export default pool
