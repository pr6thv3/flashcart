# Issue: Express API Core, Session Authentication and Security

## Description
Build the Node.js Express API service with server-managed session authentication in PostgreSQL and Argon2id hashing.

## Acceptance Criteria
- [ ] API routes hosted under `/api/v1` with standardized JSON error envelopes and `requestId` correlation.
- [ ] Server-managed sessions with opaque session cookies (`HttpOnly`, `SameSite=Lax`, `Secure`).
- [ ] Password hashing using `@node-rs/argon2` with verified parameters.
- [ ] Zod schema validation on all incoming request bodies, query params, and route params.
- [ ] Rate limiting on auth endpoints (`/login`, `/register`, `/password/reset`).
- [ ] Health endpoints `/health/live` and `/health/ready` implemented.
