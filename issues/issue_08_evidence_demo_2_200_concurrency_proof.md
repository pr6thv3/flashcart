# Issue: Evidence Demonstration 2 — 200 Concurrent Requests and Two-Phase Stock Protection

## Description
Execute and document Demonstration 2 from Document 08 proving that flash-sale stock cannot be oversold under high contention, separating the reservation phase from the payment completion phase.

## Acceptance Criteria
- [ ] **Part A (Reservation Invariant Proof)**:
  - Seed 10 sale units on a fresh test sale.
  - Launch 200 simultaneous 1-unit checkout requests with distinct buyer identities and idempotency keys.
  - Assert exactly 10 requests obtain valid reservations (`quantity_reserved == 10`).
  - Assert remaining 190 requests receive clean HTTP 409 conflict responses (`INVENTORY_UNAVAILABLE`); zero unexpected 500 errors.
  - Assert post-test database state: zero negative stock, no constraint violation.
- [ ] **Part B (Payment Conversion Proof)**:
  - Run deterministic sandbox payment completion on accepted reservations.
  - Assert confirmed payments transition reservations to sales exactly once (`quantity_sold == 10`, `quantity_reserved == 0`).
  - Assert no duplicate orders or double-finalizations.
- [ ] Save raw test logs, command, environment metadata, commit SHA, and database invariant verification report in `docs/evidence/`.
