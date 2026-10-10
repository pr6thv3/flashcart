import { checkHealth, closePool } from './pool.js';

async function waitForDb(maxRetries = 30, delayMs = 1000): Promise<void> {
  console.log('[wait_for_db] Waiting for PostgreSQL database to become available...');
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const health = await checkHealth();
    if (health.status === 'healthy') {
      console.log(`[wait_for_db] PostgreSQL is ready and responding! (Latency: ${health.latencyMs}ms)`);
      await closePool();
      process.exit(0);
    }
    console.log(`[wait_for_db] Attempt ${attempt}/${maxRetries} failed (${health.error || 'unhealthy'}), retrying in ${delayMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  console.error('[wait_for_db] Timed out waiting for PostgreSQL.');
  await closePool();
  process.exit(1);
}

waitForDb();
