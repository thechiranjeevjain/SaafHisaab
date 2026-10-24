# ADR-002: Apps Script, Sheets, and Drive backend

- Status: Accepted for pilot
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

The controlled pilot needs shared live state, authorization, an auditable ledger, compressed backups, and minimal hosting cost. The service owner is comfortable with Google Workspace, and early data volume and concurrency are low.

## Decision

Use Google Apps Script as the HTTPS/API execution layer, a private Google Sheets workbook as the live ledger, and Google Drive for compressed backup files. Run the web app as the deploying owner and enforce application authentication, role checks, and pair isolation inside the Apps Script API.

## Alternatives considered

### Firebase Authentication and Firestore

- Advantages: managed identity, real-time synchronization, mobile SDKs, better concurrency and scale.
- Deferred because: more configuration, security-rule complexity, service coupling, and potential usage cost before product-market evidence.

### Supabase and PostgreSQL

- Advantages: relational integrity, SQL reporting, row-level security, straightforward migration path.
- Deferred because: introduces a hosted database and operational surface before the pilot requires it.

### Spring Boot and PostgreSQL

- Advantages: maximum domain control, strong testing/tooling, conventional transactional backend.
- Deferred because: requires hosting, monitoring, patching, deployment, and on-call ownership disproportionate to the current product.

### Local-only database

- Advantages: no backend cost and strong offline behavior.
- Rejected because: two people cannot reliably share one authoritative ledger; phone loss becomes data loss; relationship authorization is not centrally enforceable.

## Consequences

### Positive

- Near-zero infrastructure cost for the pilot.
- Private, owner-inspectable data and simple disaster recovery.
- One deployment hosts both UI and API.
- LockService provides coarse write serialization.

### Negative

- Sheets is not a transactional multi-tenant database.
- Row scans, quota limits, execution ceilings, and cold-start variability constrain scale.
- Running as the owner makes that Google account an operational dependency.
- Observability, indexing, schema migrations, and automated integration testing are limited.
- An anonymously reachable web deployment relies on correct application-layer authentication for every protected action.

## Guardrails

- Every protected operation authenticates a session and authorizes an explicit pair.
- Writes run under a script lock.
- Full restore is never exposed through the public API.
- Backups are versioned, validated, compressed, and preceded by a pre-restore backup.
- Live Google authorization and deployment configuration must be tested by the owner before public use.

## Revisit when

- Measured traffic encounters quota, concurrency, or latency pressure.
- Cross-household reporting needs indexed relational queries.
- Formal tenant isolation, SLAs, regional storage, or audited administration are required.
- The owner account becomes an unacceptable single point of operational failure.
