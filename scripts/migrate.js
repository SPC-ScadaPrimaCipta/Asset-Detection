const { ConnectionPool } = require('mssql');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function migrate() {
    const pool = new ConnectionPool({
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
            requestTimeout: 30000,
        },
    });

    try {
        console.log('Connecting to database...');
        await pool.connect();
        console.log('Connected.');

        const migrationPath = path.join(__dirname, '..', 'risk-mapping', 'database', 'migrations', '001_risk_mapping_schema.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Running migration: 001_risk_mapping_schema.sql');
        await pool.request().query(sql);
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        await pool.close();
    }
}

migrate();
