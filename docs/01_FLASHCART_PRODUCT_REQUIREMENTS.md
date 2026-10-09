# 01 — FlashCart Product Requirements Document (PRD)

**Status:** Proposed baseline for sign-off  
**Product:** FlashCart — a multi-vendor marketplace with limited-stock flash sales  
**Audience:** Product owner, engineering, testers, deployment owner and reviewers

## 1. Product outcome

FlashCart will be a usable marketplace that can be operated responsibly, not a throwaway prototype. Customers can discover products and place orders; approved vendors can manage their own catalogs and fulfill orders; platform administrators can manage marketplace activity. Flash-sale inventory must remain correct even when many buyers compete for a small quantity.

SafeMigrate is a separate product. FlashCart supplies real, evolving PostgreSQL migrations against which SafeMigrate can be tested, but FlashCart must not depend on SafeMigrate for runtime checkout correctness.

### Product principles

1. **Correctness before scale claims.** The database is authoritative for prices, stock, orders and payment state.
2. **Security at the server boundary.** Hiding a button is not authorization.
3. **Recoverable workflows.** Timeouts, duplicate requests, payment retries and background-task failures are expected cases.
4. **Incremental release without throwaway architecture.** Every delivery stage extends the same repositories, schema history and tests.
5. **Evidence over marketing.** Capacity, safety and reliability claims require reproducible test results.

## 2. Target users

- **Customer:** browses products, adds products from one or more vendors to a cart, checks out, pays, tracks orders and requests help/returns.
- **Vendor:** applies to sell, maintains a vendor profile, creates and manages products, updates available stock, and views/fulfills only their own orders.
- **Administrator/support operator:** reviews vendors and listings, handles user/order issues, issues permitted refunds, sees audit history, and can disable abusive accounts or listings.
- **Engineering/release operator:** observes service health, checks migrations, investigates failed jobs and restores service after an incident.

A user may be both a customer and vendor. Permissions must not assume one mutually exclusive role per account.

## 3. Launch scope

The first public release is the first production release of a continuously developed product. The following scope is required before accepting real customer payments.

### 3.1 Storefront

- Responsive homepage, category pages, search, sorting and filters.
- Product detail page with price, product images, vendor identity, availability, clear sale start/end status and shipping/return information.
- Stable product URLs and basic metadata for search engines.
- Clear empty, loading, sold-out, unavailable and error states.

### 3.2 Accounts and permissions

- Registration, login, logout, email verification and password reset.
- Account profile and shipping addresses.
- Vendor application and administrator approval/suspension.
- Server-enforced permissions for customer, vendor and administrator actions.
- Account/order data access must be restricted to the owner or explicitly authorized staff.

### 3.3 Vendor tools

- Create, edit, publish/unpublish and archive owned products.
- Upload/manage product images through controlled object storage.
- Set prices and stock; schedule flash sales with a maximum sale quantity and time window.
- View vendor-specific orders and update allowed fulfillment states.
- See basic order/sales summaries. Advanced analytics are not a release blocker.

### 3.4 Cart, checkout and orders

- Cart can contain products from multiple vendors.
- Server recalculates price and eligibility at checkout; client-submitted totals are never trusted.
- Checkout creates an aggregate checkout record and vendor-specific order records as needed.
- Inventory is reserved atomically before payment is initiated; the reservation expires if payment does not complete within the configured window.
- Checkout accepts an idempotency key. Retrying the same checkout request must not create duplicate orders/reservations.
- Order status history is recorded. Customers can view their own order details and tracking information.
- Payment failures, pending payments, late webhooks, duplicate webhooks and refund states have explicit handling.

### 3.5 Payment policy

- Build a provider-neutral internal payment interface and implement a sandbox integration first.
- A real payment provider and marketplace split/settlement product must be confirmed based on business eligibility, fees, supported fund flow, refunds, settlement rules and account approval.
- No real-money launch until provider onboarding and required compliance/business checks have been completed.
- Do not store raw card credentials. Store provider IDs and minimal transaction metadata only.
- A sandbox transaction must be visibly labelled as test/sandbox in demonstration and documentation.

### 3.6 Administration and operations

- Admin can review vendor applications, unpublish unsafe listings, suspend accounts, inspect orders and initiate/approve supported refunds.
- Sensitive admin/vendor actions create audit events with actor, action, target, timestamp and relevant before/after values without logging secrets or payment credentials.
- Basic customer support/contact process and incident contact are published before public launch.
- Shipping can begin with manual carrier/tracking entry by the vendor; shipping aggregator integration is deferred until demand justifies it.

## 4. Explicit exclusions from the first public release

These are not promises for launch day: native mobile applications, international markets/multiple currencies, recommendation ML, automated loyalty program, complex coupon/affiliate engine, multi-region active-active deployment, Kubernetes, separate microservices per domain, MongoDB-based reviews, and automated integration with every shipping carrier. They may be added only after product need and cost are assessed.

Redis, read replicas, partitioning, message queues and MongoDB must not be included merely for architectural decoration. The design may leave a clean path for them, but each component requires a concrete use case, observable need and tests.

## 5. Business and product rules

- All money is represented as integer minor units (for INR, paise), with currency recorded explicitly.
- Product price, discount and vendor ownership are resolved on the server.
- Inventory quantity and a flash-sale's own quantity cap are separate constraints.
- Sale limit enforcement is database-backed, not a front-end counter.
- An order is not paid merely because a browser says payment succeeded; verified provider confirmation is required.
- Vendor users may only mutate products, stock and vendor orders owned by their vendor account.
- Admin permissions are explicit and audited; support access must not be unlimited by default.
- Order and payment transitions are controlled state machines, not arbitrary string updates.

## 6. Core user journeys

### Customer purchase

1. Browse/search and open a product.
2. Add one or more products to cart.
3. Review availability, item prices, shipping, discounts and total.
4. Submit checkout with an idempotency key.
5. Server atomically reserves inventory and creates pending order/payment records.
6. Customer completes the provider checkout.
7. Backend verifies the result from the provider webhook/API, confirms or fails the order, and updates inventory reservations consistently.
8. Customer sees the correct order/payment state and subsequent fulfillment updates.

### Vendor publishes a flash sale

1. Vendor application is approved.
2. Vendor creates/updates a product and stock amount.
3. Vendor creates a sale with start/end times, sale price and maximum quantity.
4. Server validates ownership, values and schedule; administrator can unpublish a problematic listing.
5. At sale time, checkout enforces both warehouse inventory and sale-specific capacity.

### Administrator handles a refund

1. Admin selects a paid order and a supported refund action.
2. Backend validates status, permission and remaining refundable amount.
3. Provider refund is requested idempotently.
4. Provider result/webhook is reconciled; order/payment/refund states and audit event are updated.
5. Inventory is not automatically restored unless an explicit return/restock policy says it should be.

## 7. Non-functional requirements

- **Integrity:** zero overselling, negative inventory, duplicate payment finalization or duplicate order creation in tested adversarial scenarios.
- **Security:** parameterized SQL, server-side authorization, secure session cookies, CSRF defenses for cookie-authenticated writes, request validation, rate limiting, secrets management and verified payment webhooks.
- **Reliability:** documented backup/restore, migrations, health checks, error tracking and incident response.
- **Accessibility/usability:** keyboard-accessible main flows, legible errors, responsive layout and meaningful form labels.
- **Maintainability:** TypeScript checks, formatting/linting, tests, reviewed migrations and versioned API contracts.
- **Observability:** correlation/request IDs, structured logs, checkout lifecycle events, metrics and error alerts without sensitive data leakage.
- **Performance:** define and measure a baseline in the selected staging/production-like environment; report p50/p95/p99 and error rates. Do not advertise an unmeasured request-per-second capacity.

## 8. Acceptance criteria for a public launch

- A new customer can register, log in, browse, maintain a cart, complete the supported payment flow and see order status.
- An approved vendor can manage only their own products and fulfill only their own orders.
- An administrator can manage vendor/listing status and review audited order/refund actions.
- Cart prices are revalidated by the server.
- For a flash sale of 10 units with 200 simultaneous one-unit attempts, the controlled test ends with exactly 10 units sold/reserved according to the defined terminal state, no negative stock, no sale-cap violation, and clean sold-out responses for the rest. The exact expected final counts depend on whether the test waits for payment expiry; the test must assert the documented reservation/payment policy rather than count all reservations as completed sales.
- Duplicate checkout requests and duplicate webhooks do not duplicate their effects.
- A payment timeout/failure/late-success scenario has a deterministic recovery path tested against the sandbox/provider simulator.
- Migrations can be applied to a clean test database and tested on an existing populated schema.
- Critical/high security findings are resolved or explicitly accepted by the release owner; no secrets appear in logs or repository history.
- Backup restoration has been rehearsed; health monitoring and incident contacts work.
- SafeMigrate's scan runs in CI against FlashCart migration changes with a documented policy.
- The deployed site, test environment, production/test payment mode, limitations, and support policy are described honestly.

## 9. Decisions

### Locked for the plan

- PostgreSQL is the source of truth for marketplace transactions.
- A flash sale has its own cap independent of warehouse stock.
- Multi-vendor carts are supported in the data model.
- Payment calls are outside long-running database transactions; local state is reconciled through idempotent operations and provider events.
- SafeMigrate is a separate product and never participates in runtime checkout decisions.
- Public launch is gated on evidence and operational readiness, not merely on the UI being complete.

### Conditional

- Live payment provider and settlement product: conditional on eligibility, approval, fees and business requirements.
- Hosting vendors, domains and service region: conditional on current pricing, commercial-use terms, data location needs, backups and operational requirements.
- Shipping provider: manual tracking first unless integration is a firm launch requirement.

### Deferred

- Redis, read replicas, MongoDB, multi-region, Kubernetes, queue vendor and high-volume capacity claims.

## 10. Product success metrics

Track at minimum: successful checkout rate; payment failure and reconciliation rate; oversell count (must remain zero in controlled tests); expired reservation count; checkout retry/idempotency rate; cancellation/refund time; vendor catalog errors; 5xx rate; p95 API latency; and support incidents. Metrics are operational signals, not a substitute for test assertions.
