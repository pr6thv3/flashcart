import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../common/errors.js';
import { AuthenticatedRequest, StandardErrorEnvelope } from '../common/types.js';

export function notFoundHandler(req: Request, res: Response): void {
  const authReq = req as AuthenticatedRequest;
  const requestId = authReq.id || authReq.requestId || 'unknown-request-id';

  const envelope: StandardErrorEnvelope = {
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl || req.url}`,
      requestId,
    },
  };

  res.status(404).json(envelope);
}

export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const authReq = req as AuthenticatedRequest;
  const requestId = authReq.id || authReq.requestId || 'unknown-request-id';

  // 1. Zod Validation Error -> HTTP 400
  if (err instanceof ZodError) {
    const details = err.issues.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload validation failed',
        details,
        requestId,
      },
    });
    return;
  }

  // 2. Custom Application Errors
  if (err instanceof AppError) {
    const errorBody: any = {
      code: err.code,
      message: err.message,
      requestId,
    };
    if (err.details && err.details.length > 0) {
      errorBody.details = err.details;
    }
    res.status(err.statusCode).json({ error: errorBody });
    return;
  }

  // 3. PostgreSQL Database Error Mapping
  if (err && typeof err.code === 'string') {
    // 23505: unique_violation
    if (err.code === '23505') {
      let code = 'CONFLICT';
      let message = 'A resource with these unique properties already exists.';
      if (err.constraint === 'uq_checkouts_idempotency') {
        code = 'IDEMPOTENCY_CONFLICT';
        message = 'Duplicate checkout request with active idempotency key.';
      } else if (err.constraint === 'uq_webhook_provider_event') {
        code = 'DUPLICATE_WEBHOOK';
        message = 'Webhook event has already been received.';
      } else if (err.constraint === 'uq_users_email') {
        code = 'EMAIL_ALREADY_EXISTS';
        message = 'A user with this email address already exists.';
      }

      res.status(409).json({
        error: {
          code,
          message,
          requestId,
        },
      });
      return;
    }

    // 23514: check_violation
    if (err.code === '23514') {
      let code = 'CHECK_VIOLATION';
      let message = 'Database constraint check failed.';

      if (
        err.constraint === 'chk_inventory_qty_invariants' ||
        err.constraint === 'chk_flash_sales_quantities'
      ) {
        code = 'INVENTORY_UNAVAILABLE';
        message = 'The requested quantity is no longer available.';
      }

      res.status(409).json({
        error: {
          code,
          message,
          requestId,
        },
      });
      return;
    }

    // 40P01: deadlock_detected
    if (err.code === '40P01') {
      res.status(409).json({
        error: {
          code: 'TRANSACTION_LOCK_CONFLICT',
          message: 'Temporary concurrency conflict, please retry the request.',
          requestId,
        },
      });
      return;
    }

    // 40001: serialization_failure
    if (err.code === '40001') {
      res.status(409).json({
        error: {
          code: 'SERIALIZATION_FAILURE',
          message: 'Concurrent transaction conflict, please retry.',
          requestId,
        },
      });
      return;
    }
  }

  // 4. Fallback Internal Server Error (Never leak raw SQL or stack trace)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Unhandled Server Error] [Req: ${requestId}]`, err);
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.',
      requestId,
    },
  });
}
