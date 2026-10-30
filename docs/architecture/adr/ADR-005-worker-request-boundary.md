# ADR-005: Worker-authored work logs and released compensation

- Status: Accepted
- Date: 2026-10-30
- Owners: SaafHisaab product and engineering

## Context

The homeowner owns compensation decisions, while the worker is the most direct source for work completed and needs a way to report planned or last-minute leave. Allowing either person to overwrite the other person’s record creates ambiguity, but making the worker fully read-only creates an unnecessary logging bottleneck. Live salary projections and category allocations are also more detail than the worker needs during the month.

## Decision

Either party may create daily and flexible-function work records. A record keeps its author and only that author may update it; the other person confirms or disputes it. Workers cannot mark a whole day household-not-required, record household-cancelled work, enter expenses, alter agreements, or overwrite homeowner records. Leave remains a structured worker request with no ledger or salary effect until homeowner acceptance.

The backend redacts compensation from worker policy versions and omits live month calculations and audit rows. When the homeowner locks/releases a month, the resulting payment record becomes the worker’s final salary sheet: monthly salary, one combined adjustment, final salary, release status, and a compact non-monetary work summary. Category allocations, task rates and deduction arithmetic remain homeowner-only.

## Alternatives considered

### Both parties edit any record

- Rejected because edits can overwrite evidence, blur authorship, and create difficult merge rules.

### Homeowner-only system with no worker account

- Rejected because it removes transparency, correction, acknowledgement, and shared trust.

### Read-only worker with requests only

- Rejected because it prevents the worker from recording ordinary work and makes the homeowner the sole logging bottleneck.

## Consequences

### Positive

- Clear authority boundary and audit trail.
- Worker can log work directly without gaining compensation authority.
- Pending requests cannot silently change salary.
- Server-side checks prevent UI bypass.
- Live salary and calculation internals are absent from worker API responses.

### Negative

- Homeowner must still review worker-authored entries before month release.
- Request acceptance needs careful conflict handling when a daily record already exists.
- Disputes may require richer comments or evidence later.

## Invariants

- `saveDaily_` and `saveToilet_` accept worker-authored work records but preserve authorship.
- Workers cannot use work logging to self-approve leave, household cancellations or not-required days.
- Only workers submit worker requests.
- Only homeowners accept or decline requests.
- Pending requests block month locking.
- No-contact/no-response classification is homeowner-created, not worker self-report.
- Worker snapshots contain no live salary calculation, category allocations, task amounts or calculation audit.
- A payment is visible to the worker only after the homeowner releases the locked month.
