# SaafHisaab architecture atlas

This document describes SaafHisaab 2.2 as it exists today and the intended scale-up path. Diagrams marked **Current** correspond to code in `www/`, `apps-script/`, and `android/`. Diagrams marked **Proposed** are design direction, not shipped functionality.

- Open [`architecture-atlas.html`](./architecture-atlas.html) for a colorful, navigable presentation.
- Read [`adr/README.md`](./adr/README.md) for the decision log.
- Read [`../EXTENSIBLE-AGREEMENTS.md`](../EXTENSIBLE-AGREEMENTS.md) for the future profile-driven agreement model.

## 1. System context — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#dcfce7","primaryTextColor":"#14332b","primaryBorderColor":"#15803d","lineColor":"#64748b","secondaryColor":"#dbeafe","tertiaryColor":"#fef3c7","fontFamily":"Inter,Segoe UI,sans-serif"}}}%%
flowchart LR
  H([Homeowner]):::person
  W([Worker]):::person
  APP[SaafHisaab shared UI<br/>HTML · CSS · JavaScript]:::ui
  APK[Android APK<br/>Capacitor WebView]:::mobile
  WEB[Apps Script website]:::web
  API[Google Apps Script API<br/>V8 JavaScript]:::api
  SHEETS[(Private Google Sheets<br/>live ledger)]:::data
  DRIVE[(Google Drive<br/>JSON.gz backups)]:::backup
  SHARE[Android / Web share sheet<br/>WhatsApp is a destination only]:::external

  H --> APP
  W --> APP
  APP --> APK
  APP --> WEB
  APK -->|HTTPS JSON| API
  WEB -->|google.script.run| API
  API -->|authorized pair reads/writes| SHEETS
  API -->|daily + manual backup| DRIVE
  APP -->|invitation / monthly summary| SHARE

  classDef person fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  classDef ui fill:#ecfccb,stroke:#65a30d,color:#365314,stroke-width:2px;
  classDef mobile fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
  classDef web fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
  classDef api fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:2px;
  classDef data fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px;
  classDef backup fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
  classDef external fill:#f1f5f9,stroke:#64748b,color:#334155,stroke-width:2px;
```

## 2. Container and deployment view — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter,Segoe UI,sans-serif","lineColor":"#475569"}}}%%
flowchart TB
  subgraph Source[One shared source tree]
    WWW[www/<br/>index.html · app.js · core.js · styles.css]:::source
    TESTS[Node test suite]:::test
  end

  subgraph Android[Android package]
    SYNC[Capacitor sync]:::build
    ASSETS[Android assets/public]:::mobile
    NATIVE[Capacitor Android + Share plugin]:::mobile
    APK[APK / future AAB]:::artifact
  end

  subgraph Google[Google-hosted runtime]
    BUNDLE[build-apps-script.mjs]:::build
    INDEX[Apps Script Index.html]:::web
    CODE[Code.gs API and domain services]:::api
    DB[(Private Sheets workbook)]:::data
    BACKUP[(Drive JSON.gz)]:::backup
  end

  WWW --> SYNC --> ASSETS --> NATIVE --> APK
  WWW --> BUNDLE --> INDEX
  TESTS -. verifies .-> WWW
  TESTS -. verifies .-> CODE
  INDEX --> CODE --> DB
  CODE --> BACKUP

  classDef source fill:#ecfccb,stroke:#4d7c0f,color:#365314,stroke-width:2px;
  classDef build fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef mobile fill:#ede9fe,stroke:#7c3aed,color:#4c1d95;
  classDef artifact fill:#fae8ff,stroke:#c026d3,color:#701a75,stroke-width:2px;
  classDef web fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  classDef api fill:#ccfbf1,stroke:#0f766e,color:#134e4a;
  classDef data fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef backup fill:#ffedd5,stroke:#ea580c,color:#7c2d12;
  classDef test fill:#f1f5f9,stroke:#475569,color:#1e293b;
```

## 3. Authentication and pair authorization — current

The phone number identifies an account, but it is not authorization by itself. Every pair-scoped operation requires a valid session token and explicit `pairId` membership.

```mermaid
%%{init: {"theme":"base","themeVariables":{"actorBkg":"#fff7ed","actorBorder":"#ea580c","actorTextColor":"#7c2d12","signalColor":"#334155","signalTextColor":"#0f172a","noteBkgColor":"#fef3c7","noteBorderColor":"#d97706"}}}%%
sequenceDiagram
  autonumber
  actor U as Homeowner or worker
  participant C as APK / web client
  participant D as dispatch_()
  participant A as authenticateAccount_()
  participant P as authorizePair_()
  participant S as Google Sheets

  U->>C: Enter phone + PIN
  C->>D: login(phone, PIN)
  D->>S: Read normalized account
  D->>D: Verify salted PIN hash + rate limit
  D-->>C: Opaque session token + authorized pair list
  U->>C: Select one person
  C->>D: action(token, pairId, payload)
  D->>A: Validate hashed session token
  A->>S: Load active account/session
  D->>P: Verify membership in pairId
  P->>S: Load relationship
  alt Member with permitted role
    P-->>D: actor {userId, pairId, role}
    D->>S: Read/write only that pair
    D-->>C: Pair-scoped snapshot
  else Missing pair or outsider
    P-->>C: Denied — no ledger data
  end
```

## 4. Worker request and payroll-write boundary — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"lineColor":"#475569","fontFamily":"Inter,Segoe UI,sans-serif"}}}%%
stateDiagram-v2
  [*] --> Draft: Worker prepares leave request
  Draft --> Pending: submitRequest_()
  Pending --> Declined: homeowner declines
  Pending --> Accepted: homeowner accepts
  Accepted --> ConfirmedLedger: server creates/updates daily record
  ConfirmedLedger --> SalaryProjection: included as confirmed
  Declined --> [*]
  SalaryProjection --> LockedPayment: all records resolved + homeowner locks month
  LockedPayment --> Acknowledged: worker acknowledges payment

  note right of Pending
    No salary impact
    Month cannot be locked
  end note
  note right of ConfirmedLedger
    Worker cannot call saveDaily_
    or saveToilet_ directly
  end note
```

## 5. Logical module/class view — current

The code is functional JavaScript, not an object-oriented class hierarchy. This diagram shows logical responsibilities and dependencies so future refactoring can preserve boundaries.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e0f2fe","primaryBorderColor":"#0284c7","primaryTextColor":"#0c4a6e","lineColor":"#64748b","fontFamily":"JetBrains Mono,Consolas,monospace"}}}%%
classDiagram
  direction LR

  class AppController {
    +state
    +render()
    +refresh()
    +silentRefresh()
    +openPair(pairId)
  }
  class ViewRenderer {
    +renderAuth()
    +renderHub()
    +renderToday()
    +renderMonth()
    +renderActivity()
    +renderAccount()
  }
  class ApiClient {
    +api(action, payload, useAuth)
    +demoApi(action, payload)
  }
  class LocalStore {
    +loadStore()
    +saveStore()
    +cached snapshot
  }
  class SalaryEngine {
    +calculateMonth(input)
    +salaryPosition(input)
    +rates(policy)
    +missedActivityRows()
  }
  class IdentityCodec {
    +normalizePhone()
    +inviteEncode()
    +inviteDecode()
  }

  class Dispatcher {
    +dispatch_(request)
  }
  class AccountAuth {
    +login_()
    +authenticateAccount_()
    +createAccountSession_()
  }
  class PairAuthorizer {
    +authorizePair_(account, pairId)
    +pairsForAccount_(account)
  }
  class PayrollService {
    +saveDaily_()
    +saveToilet_()
    +calculateMonth_()
  }
  class RequestService {
    +submitRequest_()
    +reviewRequest_()
    +reviewEntry_()
  }
  class PaymentService {
    +lockMonth_()
    +acknowledgePayment_()
  }
  class BackupService {
    +exportMyData_()
    +backupDatabaseToDrive()
    +restoreDatabaseFromDrive()
  }
  class SheetRepository {
    +rows_(table)
    +appendObject_(table, object)
    +updateObject_(table, row, object)
    +findRow_(table, predicate)
    +lockedWrite_(work)
  }

  AppController --> ViewRenderer
  AppController --> ApiClient
  AppController --> LocalStore
  AppController --> SalaryEngine
  AppController --> IdentityCodec
  ApiClient --> Dispatcher : HTTPS / google.script.run
  Dispatcher --> AccountAuth
  Dispatcher --> PairAuthorizer
  Dispatcher --> PayrollService
  Dispatcher --> RequestService
  Dispatcher --> PaymentService
  Dispatcher --> BackupService
  AccountAuth --> SheetRepository
  PairAuthorizer --> SheetRepository
  PayrollService --> SheetRepository
  RequestService --> SheetRepository
  PaymentService --> SheetRepository
  BackupService --> SheetRepository
```

## 6. Data model — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#f0fdf4","primaryBorderColor":"#16a34a","primaryTextColor":"#14532d","lineColor":"#64748b","fontFamily":"Inter,Segoe UI,sans-serif"}}}%%
erDiagram
  ACCOUNT ||--o{ ACCOUNT_SESSION : owns
  ACCOUNT ||--o{ PAIR : homeowner
  ACCOUNT ||--o{ PAIR : worker
  PAIR ||--o{ DAILY_LOG : contains
  PAIR ||--o{ TOILET_LOG : contains
  PAIR ||--o{ REQUEST : contains
  PAIR ||--o{ PAYMENT : closes
  PAIR ||--o{ AUDIT_ENTRY : records

  ACCOUNT {
    string userId PK
    string phone UK
    string displayName
    string pinSalt
    string pinHash
    string status
  }
  ACCOUNT_SESSION {
    string tokenHash PK
    string userId FK
    datetime expiresAt
    datetime lastSeenAt
  }
  PAIR {
    string householdId PK "pairId"
    string employerUserId FK
    string workerUserId FK
    string employerName
    string workerName
    string joinCode
    number monthlySalary
    number workingDays
    number paidLeaveDays
  }
  DAILY_LOG {
    string id PK
    string householdId FK
    date date
    string leave
    string leaveNotice
    string taskOutcomes
    string createdBy
    string approval
  }
  TOILET_LOG {
    string id PK
    string householdId FK
    string month
    number slot
    string outcome
    string approval
  }
  REQUEST {
    string id PK
    string householdId FK
    date date
    string leave
    string leaveNotice
    string status
  }
  PAYMENT {
    string householdId FK
    string month
    number baseSalary
    number adjustment
    number finalPayment
    string status
  }
  AUDIT_ENTRY {
    string id PK
    string householdId FK
    datetime at
    string role
    string action
    string entity
  }
```

## 7. Salary calculation flow — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter,Segoe UI,sans-serif","lineColor":"#475569"}}}%%
flowchart TD
  INPUT[Daily logs + monthly toilet logs + policy + month]:::input
  FILTER{Approval state}:::decision
  CONF[Confirmed records]:::good
  PEND[Pending records]:::warn
  DISP[Disputed records]:::bad
  VALUE[Convert leave and missed activities<br/>to agreed internal value]:::calc
  ALLOW[Allowance = paid leave days × daily rate]:::calc
  ADJUST[Adjustment = max 0, used value − allowance]:::calc
  PAY[Confirmed pay = salary − adjustment]:::good
  PROJECT[Projected pay if pending is confirmed]:::warn

  INPUT --> FILTER
  FILTER -->|confirmed| CONF --> VALUE
  FILTER -->|pending| PEND --> PROJECT
  FILTER -->|disputed| DISP
  VALUE --> ADJUST
  ALLOW --> ADJUST --> PAY
  PEND -. does not change .-> PAY

  classDef input fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
  classDef decision fill:#f3e8ff,stroke:#9333ea,color:#581c87,stroke-width:2px;
  classDef good fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
  classDef warn fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px;
  classDef calc fill:#ccfbf1,stroke:#0f766e,color:#134e4a;
```

## 8. Backup and restore — current

```mermaid
%%{init: {"theme":"base","themeVariables":{"actorBkg":"#ecfccb","actorBorder":"#65a30d","signalColor":"#334155","noteBkgColor":"#fef3c7","noteBorderColor":"#d97706"}}}%%
sequenceDiagram
  autonumber
  participant T as Daily trigger / owner
  participant B as BackupService
  participant S as Google Sheets
  participant D as Service-owner Drive
  participant H as Homeowner app
  participant P as Homeowner Drive

  T->>B: backupDatabaseToDrive()
  B->>S: Read all known tables
  S-->>B: Versioned rows + headers
  B->>B: JSON serialize → gzip → SHA-256
  B->>D: Store .json.gz
  B->>D: Retain newest 14 backups

  opt Homeowner personal backup
    H->>B: exportMyData()
    B->>S: Read only authorized pairs
    B-->>H: Scoped JSON.gz without credentials
    H->>P: System share sheet; homeowner selects Drive account
    Note over H,P: User confirms the file appears in personal Drive
  end

  opt Disaster recovery
    T->>B: restoreDatabaseFromDrive(fileId)
    B->>B: Create pre-restore backup
    B->>D: Read selected .json.gz
    B->>B: Validate format v2/v3 + normalize headers
    B->>S: Replace tables under script lock
    B-->>T: Restored + pre-restore backup ID
  end
```

## 9. Technology decision matrix

Scores are relative to this product at pilot stage: 5 is strongest. Cost means low operating cost; scale means headroom without migration.

| Option | Delivery speed | Shared Android/web code | Operating cost | Scale headroom | Operational simplicity | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Vanilla JS + Capacitor | 5 | 5 | 5 | 3 | 5 | **Chosen now** |
| Native Kotlin + separate web app | 2 | 1 | 3 | 5 | 2 | Reject for pilot; reconsider for deep Android features |
| Flutter | 3 | 4 | 4 | 4 | 3 | Good alternative, but unnecessary rewrite and ecosystem cost |
| React Native + React web | 3 | 4 | 4 | 4 | 3 | Good at larger team scale; more dependency and build complexity |

| Backend option | Delivery speed | Zero/low cost | Query/concurrency scale | Built-in backup/admin | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Apps Script + Sheets + Drive | 5 | 5 | 2 | 5 | **Chosen for controlled pilot** |
| Firebase Auth + Firestore | 4 | 4 | 4 | 3 | Strong next step for managed mobile scale |
| Supabase Auth + PostgreSQL | 4 | 4 | 5 | 4 | Strong next step for relational reporting |
| Spring Boot + PostgreSQL | 2 | 2 | 5 | 3 | Best when a backend team and mature operations exist |

## 10. Scalability path

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter,Segoe UI,sans-serif","lineColor":"#64748b"}}}%%
flowchart LR
  P1[Phase 1 · Current pilot<br/>Capacitor + Apps Script + Sheets<br/>single service owner]:::now
  G1{Measured pressure?<br/>latency · quota · concurrency<br/>support burden · security needs}:::gate
  P2[Phase 2 · Managed backend<br/>Firebase/Supabase auth<br/>PostgreSQL/Firestore<br/>object storage backups]:::next
  G2{Business scale?<br/>multi-tenant billing · analytics<br/>regional availability · SLAs}:::gate
  P3[Phase 3 · Service platform<br/>API service + queue + workers<br/>observability + feature flags<br/>tenant isolation + DR drills]:::later

  P1 --> G1
  G1 -->|not yet| P1
  G1 -->|yes| P2
  P2 --> G2
  G2 -->|not yet| P2
  G2 -->|yes| P3

  classDef now fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:3px;
  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:3px;
  classDef later fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:3px;
  classDef gate fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
```

### What already scales reasonably

- The APK and website share one dependency-light UI and calculation engine.
- Every ledger operation is explicitly partitioned by `pairId`.
- Session and account identity are separate from the homeowner-worker relationship.
- Pure salary functions are portable to another backend runtime.
- Versioned compressed exports provide a migration and disaster-recovery boundary.
- The API action boundary can be preserved when replacing Apps Script.

### What does not scale indefinitely

- Google Sheets is a spreadsheet, not a transactional multi-tenant database.
- Apps Script has platform quotas, execution limits, cold-start variability, and limited observability.
- Whole-sheet scans grow with data volume because the current repository helpers are row-oriented.
- A single deployment owner is an operational and account-recovery dependency.
- Custom PIN authentication creates support and account-recovery work at public scale.
- `localStorage` is a cache, not a durable offline write queue or secure credential vault.

### Migration triggers

Migrate because measurements or product requirements demand it—not merely because another stack is fashionable. Trigger a backend migration when several of these become true:

1. Normal user traffic approaches Apps Script quota or concurrency constraints.
2. Measured p95 API latency becomes unacceptable for routine ledger updates.
3. Support requires reliable self-service recovery, OTP/passkeys, revocation, or device management.
4. Reporting needs relational queries across many households or payroll periods.
5. The product needs formal tenant isolation, regional residency, SLAs, or audited access controls.
6. Offline writes and conflict resolution become core requirements.
7. The service owner account becomes an unacceptable single operational dependency.

## 11. Proposed profile-driven agreement architecture

```mermaid
%%{init: {"theme":"base","themeVariables":{"lineColor":"#64748b","fontFamily":"Inter,Segoe UI,sans-serif"}}}%%
flowchart TB
  TEMPLATE[Starter template<br/>cook · nanny · driver · custom]:::proposed
  EDITOR[Agreement editor<br/>categories · activities · cadence · amounts]:::proposed
  VALIDATE[Reconciliation validator<br/>visible totals = salary<br/>internal weights = salary]:::guard
  VERSION[Immutable AgreementVersion<br/>effectiveFrom month]:::version
  ACK[Worker acknowledgement]:::worker
  ENGINE[Generic calculation engine<br/>loads active agreement version]:::engine
  HISTORY[(Historical logs retain<br/>activity ID + display snapshot)]:::data

  TEMPLATE --> EDITOR --> VALIDATE --> VERSION --> ACK --> ENGINE
  VERSION --> HISTORY
  ENGINE --> HISTORY

  classDef proposed fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
  classDef guard fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
  classDef version fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
  classDef worker fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  classDef engine fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:2px;
  classDef data fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px;
```

This future model keeps one employee relationship and plugs activities in or out through versioned agreements. It must migrate historical cook/cleaner fields safely before being called complete.

## 12. Decision records

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-001](./adr/ADR-001-shared-web-capacitor.md) | Accepted | Shared vanilla web UI packaged with Capacitor |
| [ADR-002](./adr/ADR-002-apps-script-sheets-drive.md) | Accepted for pilot | Apps Script, Sheets, and Drive serverless backend |
| [ADR-003](./adr/ADR-003-phone-pin-pair-authorization.md) | Accepted for pilot | Phone + PIN account with server-authorized pair boundary |
| [ADR-004](./adr/ADR-004-json-gzip-backup.md) | Accepted | Versioned JSON.gz export and Drive recovery |
| [ADR-005](./adr/ADR-005-worker-request-boundary.md) | Accepted | Worker read-only ledger with request/review workflow |
| [ADR-006](./adr/ADR-006-versioned-agreement-engine.md) | Proposed | Profile-driven versioned employee agreements |
| [ADR-007](./adr/ADR-007-managed-backend-migration.md) | Proposed | Evidence-triggered migration to a managed database/backend |
