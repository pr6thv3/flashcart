export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any[];

  constructor(statusCode: number, code: string, message: string, details?: any[]) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', details?: any[]) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: any[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(409, code, message);
  }
}

export class InventoryUnavailableError extends AppError {
  constructor(message = 'The requested quantity is no longer available.') {
    super(409, 'INVENTORY_UNAVAILABLE', message);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'Idempotency key reuse with differing parameters.') {
    super(409, 'IDEMPOTENCY_CONFLICT', message);
  }
}

export class LockConflictError extends AppError {
  constructor(message = 'Temporary concurrency conflict, please retry the request.') {
    super(409, 'TRANSACTION_LOCK_CONFLICT', message);
  }
}
