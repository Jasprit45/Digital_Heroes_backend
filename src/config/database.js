const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const {
  NODE_ENV = 'development',
  DATABASE_URL,
} = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured in .env');
}

/*
 * Supabase PostgreSQL connection.
 *
 * SSL is enabled because this is a remote database.
 * rejectUnauthorized: false is commonly used for initial setup.
 *
 * For stricter production verification, Supabase recommends using
 * the server root certificate and certificate verification.
 */

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  // Keep this modest for a backend using Supabase.
  max: NODE_ENV === 'production' ? 10 : 5,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('PostgreSQL client connected');
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Execute a normal query.
 */
const query = (text, params) => {
  return pool.query(text, params);
};

/**
 * Acquire a dedicated client.
 *
 * Use this for transactions:
 *
 * const client = await getClient();
 *
 * try {
 *   await client.query('BEGIN');
 *   ...
 *   await client.query('COMMIT');
 * } catch (error) {
 *   await client.query('ROLLBACK');
 *   throw error;
 * } finally {
 *   client.release();
 * }
 */
const getClient = () => {
  return pool.connect();
};

/**
 * Test database connectivity.
 */
const testConnection = async () => {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS current_time,
        current_database() AS database_name,
        current_user AS database_user
    `);

    return {
      success: true,
      timestamp: result.rows[0].current_time,
      database: result.rows[0].database_name,
      user: result.rows[0].database_user,
    };
  } catch (error) {
    console.error('Database connection failed:', error.message);

    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  pool,
  query,
  getClient,
  testConnection,
};