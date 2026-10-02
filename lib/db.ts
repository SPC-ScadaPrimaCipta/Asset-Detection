import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // max concurrent connections
  idleTimeoutMillis: 30_000,  // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if can't connect within 5s
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

export { pool };
export default pool;

