# ADR-006: Versioned, profile-driven employee agreements

- Status: Proposed
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

Version 2.x hard-codes the cook-and-cleaner pilot activities and amounts. The intended product should support a cook, cleaner, nanny, driver, gardener, office helper, or custom recurring employee without deploying new code. Simply renaming labels would corrupt salary semantics and historical reports.

## Proposed decision

Represent each pair’s employment agreement as immutable versions containing worker-visible categories, internal activities, cadence, expected monthly occurrences, internal weights, salary, working days, leave allowance, and an effective month. The calculation engine and UI should render from the active agreement version.

## Key rules

- One person has one relationship profile with multiple categories; do not create separate cook and cleaner identities for the same worker.
- An agreement version becomes immutable after payroll records reference it.
- Changes create a new version effective from a future month.
- Historical logs preserve activity ID and a display snapshot.
- Worker-visible category totals and internal weights must each reconcile to salary.
- Internal per-activity weights remain homeowner-only.
- The worker acknowledges a new agreement before activation.

## Alternatives considered

### Continue adding fixed columns

- Rejected because every employee type requires schema, UI, calculation, backup, and migration changes.

### Store arbitrary form definitions without a domain model

- Rejected because generic forms alone cannot guarantee salary reconciliation, historical meaning, or auditability.

### Separate profile per job category

- Rejected because one person’s leave, login, payment, and acknowledgement would fragment across artificial identities.

## Consequences

### Positive

- Plug-in/plug-out activities without releases.
- Reusable product beyond cooks and cleaners.
- Effective-dated history and stable audit.

### Negative

- Requires data migration and a more generic calculation engine.
- Configuration UX must prevent invalid agreements.
- The worker snapshot must avoid leaking internal rates while still showing authoritative projections.

## Acceptance criteria

- Existing 2.x pairs migrate deterministically to agreement version 1.
- Current and historical salary tests remain unchanged after migration.
- Agreement changes cannot retroactively alter locked or open historical months.
- Both web and Android render entirely from profile data.
- Backup versions and restore migration cover the new schema.
