# ADR-005: Read-only worker ledger with requests

- Status: Accepted
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

The homeowner is responsible for maintaining the payroll ledger, while the worker needs transparency and a way to report planned or last-minute leave and challenge incorrect entries. Allowing both parties to rewrite canonical records creates ambiguity over authorship and final authority.

## Decision

Only the homeowner may write canonical daily and monthly task outcomes. The worker receives a read-only payroll view and may submit structured requests. A request has no salary effect until the homeowner accepts it. The worker may confirm or dispute homeowner-created records and acknowledge the final locked payment.

## Alternatives considered

### Both parties edit any record

- Rejected because edits can overwrite evidence, blur authorship, and create difficult merge rules.

### Homeowner-only system with no worker account

- Rejected because it removes transparency, correction, acknowledgement, and shared trust.

### Worker creates canonical entries requiring homeowner confirmation

- Feasible, but rejected for the primary workflow because the user explicitly chose homeowner-led payroll and worker requests.

## Consequences

### Positive

- Clear authority boundary and audit trail.
- Worker remains informed and can request corrections.
- Pending requests cannot silently change salary.
- Server-side checks prevent UI bypass.

### Negative

- Homeowner remains a workflow bottleneck.
- Request acceptance needs careful conflict handling when a daily record already exists.
- Disputes may require richer comments or evidence later.

## Invariants

- `saveDaily_` and `saveToilet_` reject the worker role.
- Only workers submit worker requests.
- Only homeowners accept or decline requests.
- Pending requests block month locking.
- No-contact/no-response classification is homeowner-created, not worker self-report.
