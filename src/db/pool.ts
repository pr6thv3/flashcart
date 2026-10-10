import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'flashcart_db',
  user: process.env.POSTGRES_USER || 'flashcart_user',
  password: process.env.POSTGRES_PASSWORD || 'flashcart_password',
  max: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '15000', 10),
  statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '10000', 10),
};

export const pool = new Pool(poolConfig);

// Capture unexpected errors on idle pool clients to prevent application crash
pool.on('error', (err: Error) => {
  console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

/**
 * Execute a single parameterized query against the connection pool.
 */
export async function query<R extends QueryResultRow = any, I extends any[] = any[]>(
  text: string,
  params?: I
): Promise<QueryResult<R>> {
  const start = Date.now();
  try {
    const res = await pool.query<R>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      console.warn(`[DB Pool Slow Query] ${duration}ms: ${text}`);
    }
    return res;
  } catch (err) {
    console.error(`[DB Pool Query Error] text: ${text}`, err);
    throw err;
  }
}

/**
 * Acquire a dedicated client from the pool (must be released by caller).
 */
export async function getClient(): Promise<PoolClient> {
  const client = await pool.connect();
  return client;
}

/**
 * Execute a transactional operation with automatic BEGIN, COMMIT, and ROLLBACK on error.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[DB Pool] Failed to rollback transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database connection health and response latency.
 */
export async function checkHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1 AS healthcheck');
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

/**
 * Gracefully close the connection pool.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
