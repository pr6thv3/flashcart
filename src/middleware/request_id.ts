import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../common/types.js';

export function requestIdMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.id = reqId;
  req.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}
