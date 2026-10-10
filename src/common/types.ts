import { Request } from 'express';

export type UserRole = 'customer' | 'vendor' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: UserRole[];
}

export interface VendorProfileContext {
  id: string;
  userId: string;
  storeName: string;
  slug: string;
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
}

export interface AuthenticatedRequest extends Request {
  id: string;
  requestId: string;
  user?: AuthUser;
  sessionId?: string;
  vendorId?: string;
  vendor?: VendorProfileContext;
  rawBody?: Buffer;
}

export interface StandardErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: any[];
    requestId: string;
  };
}
