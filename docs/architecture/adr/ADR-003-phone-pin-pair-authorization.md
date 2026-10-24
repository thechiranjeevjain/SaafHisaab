# ADR-003: Phone/PIN identity with server-authorized pairs

- Status: Accepted for pilot
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

One person may employ several workers and may also work for one or more homeowners. Users expect phone-number login without requiring each person to understand Google accounts. The ledger must expose only the selected homeowner-worker intersection.

## Decision

Use a normalized phone number as the account identifier and a numeric PIN as the pilot credential. Store only salted PIN hashes and hashed session tokens. Model the account independently from homeowner-worker pairs. Require a random explicit `pairId` on all pair-scoped operations and verify server-side that the account is the homeowner or worker for that pair.

## Alternatives considered

### Phone number as the only key

- Rejected because an identifier is not proof of identity.

### SMS OTP

- Advantages: familiar user experience and verified phone possession.
- Deferred because: message cost, provider setup, abuse controls, delivery reliability, and recovery policy increase pilot complexity.

### Google Sign-In

- Advantages: managed authentication and account recovery.
- Deferred because: some household workers may not use or understand the intended Google account, and identity would become coupled to a Google provider.

### Per-household credentials

- Rejected because one person would need multiple logins and relationship data could be mixed or duplicated.

## Consequences

### Positive

- One login opens “Working for me” and “I work for.”
- Pair isolation is server-enforced rather than dependent on UI filtering.
- Accounts and relationships can evolve independently.
- Login does not require SMS cost.

### Negative

- PIN recovery and device revocation are limited.
- Long-lived tokens need stronger secure storage for public scale.
- Phone ownership is not independently verified.
- Users can choose weak or shared PINs.

## Guardrails

- Normalize supported phone formats before lookup.
- Rate-limit failed logins.
- Hash PINs with per-account salt and compare without early exit.
- Hash session tokens at rest and expire sessions.
- Never accept pair selection without membership verification.
- Exclude PIN hashes and session tokens from account exports.

## Revisit when

- Public acquisition, self-service recovery, multiple devices, revocation, or higher-risk payroll amounts demand managed authentication.
- Move to passkeys, managed phone authentication, or another identity provider under a separate ADR.
