# ADR-001: Shared vanilla web UI packaged with Capacitor

- Status: Accepted
- Date: 2026-10-24
- Owners: SaafHisaab product and engineering

## Context

SaafHisaab needs a phone-friendly Android experience and a browser experience while remaining free or inexpensive to operate. The initial team is small, the UI is form- and ledger-oriented, and most business logic is portable JavaScript rather than device-specific behavior.

## Decision

Build the product UI once in HTML, CSS, and modern JavaScript under `www/`. Package the same assets for Android with Capacitor and bundle them into Google Apps Script HTML for the website. Add native plugins only for capabilities that materially improve the workflow, currently the operating-system share sheet.

## Alternatives considered

### Native Kotlin and a separate web application

- Advantages: strongest Android integration, mature platform tooling, best control over performance and accessibility.
- Rejected for pilot because: two user interfaces and duplicated domain behavior would slow iteration and increase testing cost.

### Flutter

- Advantages: polished cross-platform widgets, strong mobile performance, one primary UI codebase.
- Rejected for pilot because: it would replace already-working web code, increase binary/tooling complexity, and still require a separate hosting/backend strategy.

### React Native plus React web

- Advantages: large ecosystem, scalable component model, familiar hiring market.
- Rejected for pilot because: dependency and build complexity are not justified by the present UI size; web/native behavior can still diverge.

### Progressive Web App only

- Advantages: simplest distribution and updates.
- Rejected as the only channel because: users asked for an installable APK and native sharing; Play distribution may become valuable.

## Consequences

### Positive

- Android and web reuse the same interaction and salary code.
- Small dependency surface and fast releases.
- Browser behavior can be tested without an emulator.
- A future backend migration does not require replacing the frontend.

### Negative

- WebView behavior and accessibility need explicit device testing.
- Deep Android features may need native plugins and platform-specific code.
- Large UI growth may eventually benefit from a component framework.
- `localStorage` is not a robust offline database.

## Revisit when

- Native background work, widgets, biometric storage, rich notifications, or reliable offline-first synchronization become core.
- UI complexity produces repeated state/rendering defects that a component framework would materially reduce.
- Measured WebView performance or accessibility cannot meet product requirements.
