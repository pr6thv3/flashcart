import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  cookieSecret: process.env.COOKIE_SECRET || 'flashcart-secret-cookie-key-99',
  sandboxWebhookSecret: process.env.SANDBOX_WEBHOOK_SECRET || 'sandbox_test_secret_key_12345',
  reservationExpiryMinutes: parseInt(process.env.RESERVATION_EXPIRY_MINUTES || '10', 10),
  sessionExpiryDays: parseInt(process.env.SESSION_EXPIRY_DAYS || '7', 10),
  sweeperIntervalMs: parseInt(process.env.SWEEPER_INTERVAL_MS || '5000', 10),
  sweeperBatchSize: parseInt(process.env.SWEEPER_BATCH_SIZE || '100', 10),
};
