# Issue: Transactional Flash Sale and Zero-Oversell Checkout Core

## Description
Implement the high-contention flash-sale checkout protocol in PostgreSQL with atomic reservations and zero-oversell guarantees.

## Acceptance Criteria
- [ ] Checkout endpoint `/api/v1/checkouts` requires an `Idempotency-Key` header.
- [ ] Ascending `product_id` row locking order or atomic conditional updates on `flash_sales` and `inventory`.
- [ ] Atomic reservation creation: `inventory_reservations` records created with expiration timestamps.
- [ ] Total reserved + sold units strictly capped by `quantity_limit`.
- [ ] Rejected requests when sold out return clean HTTP 409 `INVENTORY_UNAVAILABLE` without unhandled 500s.
