# ADR-004: Versioned JSON.gz backup and restore

- Status: Accepted
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

The database must be portable, small, fast to transfer, and restorable without depending on formatted spreadsheet exports. Recovery must preserve identifiers, relationships, approvals, payments, and audit history.

## Decision

Serialize versioned logical records and full sheet tables as JSON, compress them with gzip, calculate a SHA-256 digest, and store full backups in a dedicated Google Drive folder. Keep the latest 14 scheduled backups. Before a restore, make a fresh backup, validate the backup format, normalize compatible headers, then replace tables under a script lock.

## Alternatives considered

### CSV per sheet

- Rejected because multiple files lose database-level versioning and make relationships, escaping, and atomic recovery harder.

### XLSX copy

- Rejected as the primary machine backup because presentation formatting increases size and does not provide a clean versioned logical contract.

### Raw Google Sheet copies only

- Useful operationally but rejected as the only format because it couples recovery to spreadsheet structure and is less portable to a future database.

### Uncompressed JSON

- Rejected because repeated field names and audit history compress well; gzip reduces transfer and storage cost with little complexity.

## Consequences

### Positive

- Compact, inspectable, versioned, and portable.
- Supports migration away from Google Sheets.
- Checksums detect accidental corruption.
- Pre-restore snapshots make recovery safer.

### Negative

- Owner-only restore currently requires an Apps Script function call.
- Full backup restore is coarse-grained rather than record-selective.
- Backups in the same Google account do not protect against loss of that account.

## Guardrails

- Never include plaintext PINs or session tokens in user exports.
- Validate format version and headers before destructive replacement.
- Keep an encrypted backup outside the owner account for stronger disaster recovery.
- Test restore periodically; backup creation alone does not prove recoverability.
