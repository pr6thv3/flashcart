import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../common/types.js';

export function requestLoggerMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (process.env.NODE_ENV === 'test' && !process.env.VERBOSE_LOGS) {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        level: 'info',
        requestId: req.id,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        userId: req.user?.id,
        vendorId: req.vendorId,
      })
    );
  });

  next();
}
