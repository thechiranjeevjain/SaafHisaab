# Architecture Decision Records

ADRs capture why a significant decision was made, alternatives considered, consequences, and the evidence that should cause a revisit. They are append-only historical records: when a decision changes, supersede it with a new ADR rather than rewriting history.

| ADR | Status | Date | Title |
| --- | --- | --- | --- |
| [001](./ADR-001-shared-web-capacitor.md) | Accepted | 2026-10-24 | Shared vanilla web UI packaged with Capacitor |
| [002](./ADR-002-apps-script-sheets-drive.md) | Accepted for pilot | 2026-10-24 | Apps Script, Sheets, and Drive backend |
| [003](./ADR-003-phone-pin-pair-authorization.md) | Accepted for pilot | 2026-10-24 | Phone/PIN identity with server-authorized pairs |
| [004](./ADR-004-json-gzip-backup.md) | Accepted | 2026-10-24 | Versioned JSON.gz backup and restore |
| [005](./ADR-005-worker-request-boundary.md) | Accepted | 2026-10-24 | Read-only worker ledger with requests |
| [006](./ADR-006-versioned-agreement-engine.md) | Accepted for pilot | 2026-10-26 | Versioned, profile-driven agreements |
| [007](./ADR-007-managed-backend-migration.md) | Proposed | 2026-10-24 | Evidence-triggered managed backend migration |

## Status vocabulary

- **Proposed** — designed but not approved or implemented.
- **Accepted** — the active architectural decision.
- **Accepted for pilot** — appropriate within an explicit scale/security boundary and expected to be revisited.
- **Deprecated** — still present but should not be used for new work.
- **Superseded** — replaced by another ADR.
