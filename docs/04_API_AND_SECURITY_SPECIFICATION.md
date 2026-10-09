# 04 — API Contracts, Authentication and Security Specification

**Status:** Proposed baseline for sign-off  
**API prefix:** `/api/v1` (versioning policy may evolve, but breaking contracts must not be silently shipped)

## 1. API conventions

- JSON request/response bodies except binary upload flows handled through signed object-storage URLs.
- UTC ISO-8601 timestamps; money as integer minor units plus currency code.
- Stable resource IDs; pagination uses a defined cursor or bounded page/limit contract.
- Validate all request parameters, path IDs, query strings and bodies at runtime.
- Use consistent error envelopes, request IDs and safe messages. Do not send stack traces, SQL, provider secrets or internal object-storage paths to clients.
- Require an `Idempotency-Key` header for checkout creation, payment initiation where applicable, and refund initiation.
- API clients must be able to distinguish validation, authorization, not-found, conflict/sold-out, rate-limit, provider-pending and server errors.

Suggested error envelope:

```json
{
  "error": {
    "code": "INVENTORY_UNAVAILABLE",
    "message": "The requested quantity is no longer available.",
    "requestId": "server-generated-correlation-id"
  }
}
```

## 2. Core route inventory

Routes are a contract proposal. Exact payload fields and generated OpenAPI definition are locked during implementation design; don't expose internal DB columns directly by default.

### Public/customer

| Method | Route | Purpose / access |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create customer account; rate limited |
| `POST` | `/api/v1/auth/login` | Start session after credential checks |
| `POST` | `/api/v1/auth/logout` | Revoke session |
| `POST` | `/api/v1/auth/password/forgot` | Request reset without revealing whether an email exists |
| `POST` | `/api/v1/auth/password/reset` | Consume a short-lived single-use reset token |
| `GET` | `/api/v1/me` | Current user and effective roles |
| `GET` | `/api/v1/products` | Published catalog, search/filter/sort/pagination |
| `GET` | `/api/v1/products/:slug` | Published product detail, stock/sale display information |
| `GET` | `/api/v1/categories` | Active category tree/list |
| `GET` | `/api/v1/cart` | Current user's cart |
| `PUT` | `/api/v1/cart/items/:productId` | Add/update quantity; cart remains advisory |
| `DELETE` | `/api/v1/cart/items/:productId` | Remove cart line |
| `POST` | `/api/v1/checkouts` | Create idempotent checkout and inventory reservations |
| `GET` | `/api/v1/checkouts/:id` | Own checkout status; sensitive fields excluded |
| `GET` | `/api/v1/orders` | Current customer's order list |
| `GET` | `/api/v1/orders/:id` | Own order only |
| `POST` | `/api/v1/orders/:id/cancel` | Request cancellation if policy/state permits |
| `POST` | `/api/v1/products/:id/reviews` | Optional launch feature; delivered/verified-purchase policy applies if enabled |

### Vendor

| Method | Route | Purpose / access |
|---|---|---|
| `POST` | `/api/v1/vendor/applications` | Submit vendor application |
| `GET` | `/api/v1/vendor/profile` | Read own vendor profile/status |
| `PATCH` | `/api/v1/vendor/profile` | Edit allowed own profile fields |
| `GET` | `/api/v1/vendor/products` | List own products |
| `POST` | `/api/v1/vendor/products` | Create product under authenticated vendor identity |
| `PATCH` | `/api/v1/vendor/products/:id` | Edit own product only |
| `POST` | `/api/v1/vendor/products/:id/publish` | Publish when listing preconditions pass |
| `POST` | `/api/v1/vendor/products/:id/flash-sales` | Create sale for owned product |
| `PATCH` | `/api/v1/vendor/products/:id/inventory` | Perform approved stock adjustment with audit reason |
| `GET` | `/api/v1/vendor/orders` | List only orders belonging to the authenticated vendor |
| `PATCH` | `/api/v1/vendor/orders/:id/fulfillment` | Change allowed fulfillment fields/status only |

### Admin and integrations

| Method | Route | Purpose / access |
|---|---|---|
| `GET` | `/api/v1/admin/vendor-applications` | Admin review queue |
| `POST` | `/api/v1/admin/vendor-applications/:id/approve` | Approve vendor; audited |
| `POST` | `/api/v1/admin/vendor-applications/:id/reject` | Reject vendor; audited |
| `POST` | `/api/v1/admin/users/:id/suspend` | Suspend subject to policy; audited |
| `GET` | `/api/v1/admin/orders` | Authorized operational order search |
| `POST` | `/api/v1/admin/orders/:id/refunds` | Request permitted refund with idempotency key |
| `GET` | `/api/v1/admin/audit-log` | Restricted audit view |
| `POST` | `/api/v1/webhooks/:provider` | Provider-specific signature verification, deduplication and processing |
| `GET` | `/health/live` | Process liveness; no sensitive data |
| `GET` | `/health/ready` | Dependency readiness with safe status; restrict detailed output |

## 3. Authentication/session decisions

- Use a secure, server-managed session; the browser receives only an opaque session cookie.
- Cookie flags: `HttpOnly`, `Secure` in deployed environments, a deliberate `SameSite` policy, narrow path/domain and bounded lifetime.
- Route the API under the same public origin through the edge proxy to simplify cookies and avoid permissive CORS configuration.
- Mutating cookie-authenticated requests require CSRF protection and origin checks appropriate to the deployed topology.
- Session IDs are rotated after login/privilege changes and revoked on logout/password reset/account suspension.
- Password hashes use a modern password-hashing algorithm (Argon2id preferred) with parameters stored/versioned; never use plaintext or a fast general-purpose hash.
- Login, password-reset, registration and vendor-application endpoints are rate limited. Password-reset responses do not reveal account existence.
- Require verified email before high-impact account actions according to product policy.

## 4. Authorization model

Authorization occurs on the backend at both service and data-query boundaries.

- A customer's order lookup includes the authenticated customer ID in the query filter.
- Vendor product/order queries always constrain by the authenticated vendor profile ID derived on the server; a client-supplied vendor ID is never trusted as proof of ownership.
- A customer cannot assign themselves the vendor/admin role via registration or profile update.
- Admin access is role-gated and audited. High-impact admin actions can require recent re-authentication and/or a separate permission.
- Tests must attempt IDOR-style access by changing object IDs across customers and vendors.
- Object-storage upload keys/URLs are scoped to the authenticated owner and validated file types/sizes; publish only server-verified upload records.

## 5. Validation and data handling

- Allowlist sort fields; never interpolate raw user input into SQL identifiers.
- Use parameterized SQL for values.
- Normalize email/slug/SKU according to one shared rule before checking uniqueness.
- Enforce limits for description length, image size/type/count, cart lines, quantity and pagination.
- Reject invalid state transitions even if called directly via API.
- Do not log passwords, reset tokens, session cookies, provider secrets, full addresses unnecessarily, payment credentials, or full webhook secrets/payloads indiscriminately.
- Establish data retention and deletion/export procedures appropriate to the actual legal/business obligations before launch.

## 6. Checkout and payment API behavior

- Checkout response distinguishes `created/pending_payment/paid/failed/expired/cancelled` states; use the final agreed state machine, not arbitrary values.
- `Idempotency-Key` is scoped to authenticated actor/operation. Store a request fingerprint and response/operation reference; a repeated identical request returns the previous result, while key reuse with a different payload returns a conflict.
- Server-calculated totals are persisted as snapshots; clients cannot submit authoritative price/tax/shipping totals.
- Provider initiation is outside the inventory lock transaction. Ambiguous timeouts are reconciled by provider reference/lookup, not by blindly retrying a non-idempotent charge.
- Verify webhook signature over the raw body according to provider docs, apply timestamp/replay checks if supported, deduplicate provider event IDs and update state transactionally.
- Return safe acknowledgements only after the event is durably accepted/processed according to provider retry expectations. Alert on repeatedly failed event processing.
- Refunds are separately idempotent and capped by the refundable amount and provider/order state.

## 7. Security controls

- HTTPS only; redirect HTTP to HTTPS and enable appropriate security headers.
- Secure secrets through environment secrets/managed secret store; separate per-environment credentials.
- Database runtime role follows least privilege; migration credentials are unavailable to web requests.
- Parameterized queries; request payload validation; output encoding; controlled upload processing.
- Rate limiting by identity and IP where appropriate, with stronger checkout/login/webhook controls.
- Audit high-impact actions; structured logs with request IDs and redaction.
- Dependency/SAST/secrets scans in CI; automated dependency updates reviewed and tested.
- Production admin accounts use strong credentials and MFA where available.
- Database backup, restore, incident response and key rotation procedures are exercised.

## 8. Security test cases required before launch

1. SQL injection strings in every query/body field fail safely.
2. Customer A cannot view/change Customer B's cart, address, checkout or order.
3. Vendor A cannot edit Vendor B's product, inventory or fulfillment status.
4. User cannot self-assign privileged roles or bypass vendor approval.
5. Expired/revoked/reset sessions cannot access protected routes.
6. CSRF attempt from a disallowed origin is rejected.
7. Invalid/forged/duplicate/out-of-order payment webhooks do not create duplicate state transitions.
8. Oversized/malicious image uploads fail safely.
9. Rate limits work without allowing easy user-ID/IP header spoof bypass.
10. Logs and error payloads contain no secrets or full stack traces.
11. Admin endpoints and audit log are inaccessible to ordinary customers/vendors.
12. Dependency/secret scan results are reviewed before production release.

## 9. Open/conditional items

The public API contract and generated OpenAPI document must be committed before parallel frontend/backend implementation. Payment routes depend on chosen provider and its webhook schema. Any legal/tax/shipping fields not yet decided must not be invented; document product policy first. Exact retention periods and privacy copy require business/legal review for the operating jurisdiction.
