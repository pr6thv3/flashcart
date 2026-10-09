# Issue: Idempotent Payment Orchestration and Webhook Reconciliation

## Description
Implement the provider-neutral payment interface with sandbox simulation, webhook signature verification, and idempotent state transitions.

## Acceptance Criteria
- [ ] External payment execution executed outside database locks.
- [ ] Webhook endpoint `/api/v1/webhooks/:provider` validates signatures and event IDs.
- [ ] Duplicate webhooks return idempotent success without duplicate order finalization.
- [ ] Late payment reconciliation: If payment succeeds after reservation expiry, refund/void compensation is triggered without overselling.
