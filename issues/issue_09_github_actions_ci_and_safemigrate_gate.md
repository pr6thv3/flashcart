# Issue: GitHub Actions CI and SafeMigrate Scanning Gate

## Description
Set up GitHub Actions CI workflow with disposable PostgreSQL, full test suites, and pinned SafeMigrate scanning.

## Acceptance Criteria
- [ ] CI pipeline triggers on pull requests and pushes to `main`.
- [ ] Starts disposable PostgreSQL container, applies migrations, runs unit and integration tests.
- [ ] Downloads/invokes pinned SafeMigrate release against changed migration files.
- [ ] Generates SARIF and JSON artifacts and enforces the configured policy threshold.
