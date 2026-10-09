# Issue: Evidence Demonstration 2 — 200 Concurrent Requests on 10 Units

## Description
Execute and document Demonstration 2 from Document 08 proving that flash-sale stock cannot be oversold under high contention.

## Acceptance Criteria
- [ ] Test scenario: Seed 10 sale units; launch 200 simultaneous 1-unit checkout attempts.
- [ ] Assert exactly 10 requests obtain valid reservations/orders.
- [ ] Assert remaining 190 requests receive clean HTTP 409 conflict responses; zero unexpected 500 errors.
- [ ] Assert post-test database state: `quantity_reserved + quantity_sold == 10`, `on_hand_qty >= 0`, no negative stock.
- [ ] Save raw test outputs, latency distribution (p50, p95, p99), and database invariant verification queries.
