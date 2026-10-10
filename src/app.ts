import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { requestIdMiddleware } from './middleware/request_id.js';
import { requestLoggerMiddleware } from './middleware/request_logger.js';
import { authenticate } from './middleware/auth.js';
import { notFoundHandler, globalErrorHandler } from './middleware/error_handler.js';

import { authRoutes } from './modules/auth/auth.routes.js';
import { productRoutes, flashSaleRoutes } from './modules/catalog/catalog.routes.js';
import { cartRoutes } from './modules/cart/cart.routes.js';
import { checkoutRoutes } from './modules/checkout/checkout.routes.js';
import { vendorRoutes } from './modules/vendor/vendor.routes.js';
import { webhookRoutes, paymentRoutes } from './modules/payments/payments.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';

export function createApp(): express.Application {
  const app = express();

  // 1. Security & CORS Middlewares
  app.use(helmet());
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  // 2. Request body parsing (capture raw buffer for webhook HMAC verification)
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // 3. Cookie parser
  app.use(cookieParser(config.cookieSecret));

  // 4. Request ID & Structured access logging
  app.use(requestIdMiddleware as any);
  app.use(requestLoggerMiddleware as any);

  // 5. Session token / Bearer token authentication resolution
  app.use(authenticate as any);

  // 6. Health check endpoints
  app.use('/health', healthRoutes);
  app.use('/api/v1/health', healthRoutes);

  // 7. API v1 Router
  const apiV1Router = express.Router();
  apiV1Router.use('/auth', authRoutes);
  apiV1Router.use('/products', productRoutes);
  apiV1Router.use('/flash-sales', flashSaleRoutes);
  apiV1Router.use('/cart', cartRoutes);
  apiV1Router.use('/checkout', checkoutRoutes);
  apiV1Router.use('/checkouts', checkoutRoutes);
  apiV1Router.use('/vendor', vendorRoutes);
  apiV1Router.use('/orders', orderRoutes);
  apiV1Router.use('/webhooks', webhookRoutes);
  apiV1Router.use('/payments', paymentRoutes);

  app.use('/api/v1', apiV1Router);

  // 8. 404 Handler & Global Error Handler
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

export const app = createApp();
