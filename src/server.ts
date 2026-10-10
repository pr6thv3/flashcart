import { app } from './app.js';
import { config } from './config/index.js';
import { checkHealth, closePool } from './db/pool.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { ReservationSweeper } from './workers/reservation_sweeper.js';

const authRepo = new AuthRepository();
const sweeper = new ReservationSweeper();

async function startServer() {
  console.log('[FlashCart Server] Initializing server...');

  // 1. Verify DB connection
  const health = await checkHealth();
  if (health.status !== 'healthy') {
    console.error('[FlashCart Server] Database healthcheck failed:', health.error);
    process.exit(1);
  }
  console.log(`[FlashCart Server] Connected to PostgreSQL in ${health.latencyMs}ms`);

  // 2. Ensure system roles exist
  await authRepo.ensureDefaultRoles();
  console.log('[FlashCart Server] Verified default system roles (customer, vendor, admin)');

  // 3. Start background reservation sweeper
  sweeper.start();
  console.log('[FlashCart Server] Background reservation sweeper started');

  // 4. Start HTTP listener
  const server = app.listen(config.port, () => {
    console.log(`[FlashCart Server] Express API running on port ${config.port} (${config.nodeEnv})`);
    console.log(`[FlashCart Server] API v1 base: http://localhost:${config.port}/api/v1`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[FlashCart Server] Received ${signal}. Initiating graceful shutdown...`);
    sweeper.stop();
    server.close(async () => {
      console.log('[FlashCart Server] HTTP server closed.');
      await closePool();
      console.log('[FlashCart Server] Database connection pool drained.');
      process.exit(0);
    });

    // Force shutdown after 10s timeout
    setTimeout(() => {
      console.error('[FlashCart Server] Shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[FlashCart Server] Fatal error during startup:', err);
    process.exit(1);
  });
}

export { startServer, sweeper };
