# 07 — Release, Deployment, Cost and Operations Plan

**Status:** Proposed baseline for sign-off  
**Objective:** Ship responsibly, maintain it, and know how to recover when something fails.

## 1. Environments

- **Local:** Docker Compose, seeded development data, fake/sandbox payment mode, no production secrets.
- **CI:** ephemeral application/test services and disposable PostgreSQL. No production credentials.
- **Staging:** production-like configuration with separate DB, storage and payment sandbox credentials; use synthetic/test personal data only.
- **Production:** separate accounts/credentials, real approved payment mode only after launch gates, restricted DB access and controlled migration releases.

Environment differences are config, not undocumented source edits. An explicit environment banner must make sandbox vs production status clear to authorized operators and in any demonstration.

## 2. Hosting/provider selection checklist

Do not select the cheapest host from a headline price alone. Compare:

- commercial-use and marketplace terms;
- supported runtime/container deployment and long-running worker behavior;
- managed PostgreSQL version, private networking, connection limits, backups/PITR and restore procedures;
- region/data-location options relevant to customers and business obligations;
- object-storage pricing/egress and signed upload/serve support;
- outbound email, domain, HTTPS and webhook reachability;
- observability, logs, alerts, support and incident history;
- monthly base, variable usage, backup, storage, egress and payment fees;
- vendor portability and export/recovery path.

Provider and exact price are **not locked in this document** because prices/terms change and the suitable plan depends on the actual account and traffic. Before approval, record the chosen provider, exact plan/region, pricing URL/date, monthly low/expected/high estimate, limits and exit strategy. Free development tiers may have commercial-use or reliability constraints; verify terms before public operation.

## 3. Required production topology

- HTTPS domain with secure redirect and managed certificate.
- Web frontend and API routed behind a public edge/reverse proxy.
- Database accessible only to application/migration services through private or tightly restricted network paths.
- Application runtime role cannot create/drop schema; migration role is separate and used only during deployment.
- Managed PostgreSQL with automated backups and PITR if selected plan supports it.
- Object storage with least-privilege access and lifecycle/backup decision.
- Email delivery service and durable background job runner for important notifications/reconciliation.
- Central error reporting and structured logs with redaction.
- Separate staging and production resource boundaries.

## 4. Secrets and configuration

Configuration keys should be documented by name and purpose without values. Examples: database URLs, session secret, email provider credentials, payment provider keys/webhook signing secret, object storage keys, public base URL, rate-limit settings, cookie settings and SafeMigrate policy threshold.

Rules:

- Never commit real secrets, `.env` files or production dumps.
- Use a secret manager/host secrets interface in production and repository-environment secrets in CI only where needed.
- Rotate a credential immediately if exposed; revoke old value and inspect logs/history.
- Use separate provider accounts/keys for staging and production.
- Redact connection strings, authorization headers, cookies, signed URLs and webhook secrets from logs.
- Restrict GitHub Actions permissions to minimum required; avoid running untrusted fork code with production secrets.

## 5. Database lifecycle and recovery

- Backups must be automated and monitored; alerts fire on failure or missed backup windows.
- Define target recovery objectives. Proposed launch target: **RPO no worse than 15 minutes and RTO no worse than 4 hours**, provided the chosen provider/plan can support and the restore drill demonstrates it. If budget/provider constraints cannot meet this, document the accepted risk and do not describe the stronger target as achieved.
- Rehearse restore to a separate instance at least before real-money launch and after material backup/DB changes.
- Preserve migration history, release version, seed/reference data version and restore instructions.
- Production migration process: inspect SafeMigrate report; review migration and compatibility; verify backup/restore status; apply through an authorized release step; run health/smoke checks; monitor; execute documented forward-fix or rollback plan if failure occurs.
- A database backup is not a complete recovery plan unless restore and application compatibility are tested.

## 6. Observability and alerts

Monitor at minimum:

- API availability, latency percentiles and 5xx rate;
- DB connection pool usage, saturation, slow queries, lock/deadlock waits and storage capacity;
- checkout attempts, reservation success/failure/expiry, payment pending duration, duplicate webhook count and reconciliation backlog;
- background job age/failure/retry volume;
- email/payment/object-storage provider failures;
- authentication abuse/rate-limit blocks and admin actions;
- SafeMigrate CI failures, analyzer version and rule report availability.

Logs should carry request/correlation IDs and safe lifecycle events, not credentials. Alert thresholds should be calibrated from staging/initial production baselines, then reviewed against false alerts.

## 7. Incident handling

Create a short runbook for:

- checkout/inventory inconsistency;
- payment provider outage or ambiguous payment states;
- duplicate/invalid webhook surge;
- DB outage, saturation or failed migration;
- object-storage/email outage;
- suspected account compromise or exposed secret;
- data restore and production deploy rollback/forward fix.

For each: detection signal, owner/contact, immediate containment, safe customer communication, recovery steps, verification query/test, evidence to preserve and follow-up review. Only designated operators can perform production migration/refund/credential-rotation actions.

## 8. Deployment and release stages

1. **Internal engineering release:** local + CI tests and test-mode integrations pass.
2. **Staging release:** deployed production-like stack, browser journeys, migration-upgrade tests, SafeMigrate gate and restore drill pass.
3. **Controlled pilot:** limited users/vendors under clearly stated policies; sandbox or real payments only according to provider approval and actual operating readiness.
4. **Public real-money launch:** payment/provider approval, customer/vendor policies, refunds, monitoring, support, backups and incident readiness are confirmed.
5. **Scale release:** measured capacity bottlenecks determine whether to add cache, replicas, queue or more instances.

The stages are part of the production delivery plan, not separate throwaway products. Do not label a staging build as a live marketplace.

## 9. Marketplace readiness checklist

- Vendor terms and approval process, privacy notice and customer terms reviewed.
- Shipping, cancellation, return/refund, customer support, product moderation and dispute handling documented.
- Payment provider confirms marketplace fund-flow/settlement model and linked seller eligibility if used.
- Any tax, invoicing, consumer-protection and business obligations are checked with appropriate professional guidance for the actual business; this technical plan does not substitute for legal/accounting advice.
- Secure account recovery, admin protection, abuse reporting and incident response tested.
- Production domain, HTTPS, email delivery and sender/domain configuration verified.
- No test payment secrets or sandbox-only assumptions in production configuration.

## 10. Cost approval gate

Before choosing provider, create a monthly budget table with low/expected/high usage for: web/API compute, database, storage/backups, images/egress, email, monitoring, domain, payment fees, tax/accounting/compliance costs if relevant, and contingency. Include provider quotas and what happens when a free allowance is exceeded. No cost value is represented as current until checked against the provider's live pricing page on the decision date.

## 11. Production release checklist

- [ ] Release candidate and migration hashes identified.
- [ ] Required CI checks pass, including SafeMigrate policy.
- [ ] Database backup/PITR status checked; restore drill evidence is current.
- [ ] Migration/app compatibility plan reviewed; no destructive operation is rushed into deployment.
- [ ] Staging smoke tests pass on the same build/artifacts.
- [ ] Production secrets and payment mode verified by an authorized operator.
- [ ] Health checks, alerts and support owner are active.
- [ ] Rollback/forward-fix plan and migration-specific caveats are recorded.
- [ ] Post-deploy synthetic checkout and inventory integrity checks pass.
- [ ] Release notes describe known limitations honestly.
