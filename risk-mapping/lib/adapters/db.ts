/**
 * Database Adapter
 *
 * Bridge to the shared MSSQL connection pool.
 * Implement these to connect Risk Mapping to your database.
 */

// If Asset-Detection is within promia-web-sb project:
// export { getConnection, sql } from './adapters';

// If Asset-Detection is standalone:
// 1. Install: npm install mssql
// 2. Implement connection pool here:

import ConnectionPool from 'mssql';

let pool: ConnectionPool.ConnectionPool | null = null;

export async function getConnection(): Promise<ConnectionPool.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }

    pool = new ConnectionPool({
        server: process.env.DB_SERVER || 'localhost',
        database: process.env.DB_DATABASE || 'promia',
        authentication: {
            type: 'default',
            options: {
                userName: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
            },
        },
        options: {
            encrypt: true,
            trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
            connectionTimeout: 15000,
            requestTimeout: 15000,
        },
    });

    await pool.connect();
    return pool;
}

export const sql = ConnectionPool;


