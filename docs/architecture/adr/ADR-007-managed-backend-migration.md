# ADR-007: Evidence-triggered managed backend migration

- Status: Proposed
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

Apps Script and Sheets minimize cost and operational work for a controlled pilot, but they are not the intended indefinite foundation for high-concurrency public SaaS. Migrating prematurely would add cost and delay learning; migrating too late would create reliability and security risk.

## Proposed decision

Keep Apps Script/Sheets while measured behavior and requirements remain within the pilot boundary. Prepare domain contracts so the backend can later move to managed authentication, an API service or serverless functions, PostgreSQL/Firestore, and object storage without rewriting the shared frontend.

## Candidate targets

### Supabase / PostgreSQL

Prefer when relational reporting, transactions, SQL, and row-level security dominate.

### Firebase Auth / Firestore

Prefer when mobile-managed identity, real-time synchronization, and offline SDK behavior dominate.

### Cloud Run or another API service + PostgreSQL

Prefer when domain complexity, background jobs, vendor portability, and operational control justify a dedicated backend team.

## Migration triggers

- Sustained quota, concurrency, execution-time, or latency pressure.
- Need for managed OTP/passkeys, recovery, revocation, or device sessions.
- Cross-tenant analytics and complex reporting.
- Formal isolation, compliance, data-residency, audit, or SLA commitments.
- Reliable offline writes and conflict resolution become core.
- The deployment-owner account is no longer an acceptable operational dependency.

## Migration approach

1. Freeze and document the API action contract.
2. Introduce repository interfaces around Apps Script sheet access.
3. Export a versioned JSON.gz migration snapshot.
4. Backfill accounts, pairs, agreements, logs, requests, payments, and audits.
5. Dual-read in a controlled environment; compare monthly calculations.
6. Cut over writes, retain a rollback window, and verify restore drills.
7. Remove owner-account and Apps Script dependencies only after evidence matches.

## Consequences

### Positive

- Scale investment follows product evidence.
- Existing frontend and domain tests remain useful.
- Versioned exports provide a clean migration boundary.

### Negative

- A later migration still has real cost and requires careful identity mapping.
- Delaying without measurement can hide approaching operational limits.
- Running two systems during cutover increases temporary complexity.
