# SaafHisaab

SaafHisaab is a homeowner-first leave and salary manager for recurring household staff. The homeowner records leave or missed work, the app calculates the monthly salary, and both people can review the final record. The same responsive HTML, CSS, and JavaScript in `www/` is used by:

- the Android APK through Capacitor;
- the browser version hosted by Google Apps Script; and
- the local demo preview.

The deployment owner controls one private Google Sheet database. Both people log in with their own phone number and PIN; the worker first registers through a one-time invitation and never receives direct access to the Sheet. Worker confirmation is a transparency feature; the primary workflow is designed for the homeowner managing leave and salary.

The normalized **phone number is the account identity** within one SaafHisaab deployment. One login opens a hub with **Working for me** and **I work for**. Each relationship has a separate random `pairId`; the client sends it only after the user selects a person, and the backend verifies that the logged-in account belongs to that pair. A 10-digit Indian number is normalized to `+91…`; international numbers must include `+country-code`. Phone login is identifier-based and does not send an OTP or SMS.

## Architecture documentation

- [`docs/architecture/README.md`](docs/architecture/README.md) — Mermaid system context, container, authorization, logical module, data, salary, backup, trade-off, and scalability diagrams.
- [`docs/architecture/architecture-atlas.html`](docs/architecture/architecture-atlas.html) — colorful browser-viewable architecture atlas.
- [`docs/architecture/adr/README.md`](docs/architecture/adr/README.md) — Architecture Decision Record index with accepted pilot decisions and proposed evolution.
- [`docs/EXTENSIBLE-AGREEMENTS.md`](docs/EXTENSIBLE-AGREEMENTS.md) — detailed future profile-driven employee agreement model.
- [`docs/UX-FIRST-PRINCIPLES-AUDIT.md`](docs/UX-FIRST-PRINCIPLES-AUDIT.md) — screen sequence, usability findings, calendar workflow, rates model, and hourly-pay decision boundary.

## Agreed monthly policy

| Worker-visible category | Monthly commitment | Amount |
| --- | ---: | ---: |
| Cooking | 26 days x morning and evening | Rs 5,000 |
| Cleaning | 26 floor cleanings plus 4 toilet cleanings | Rs 1,200 |
| Utensils | 26 days x morning and evening | Rs 800 |
| **Total salary** |  | **Rs 7,000** |

The worker sees the category amounts, all missed or leave records, confirmation status, one combined salary adjustment, and final payment. Internal per-task deduction rates are visible only to the homeowner.

Four paid leave-equivalent days are included each month. Confirmed full days, half days, and missed activities accumulate against that allowance. Only the excess is adjusted. A full- or half-day leave is not double-counted as missed activities, and pending or disputed records never affect payment.

## Roles and shared use

1. The service owner deploys the supplied Google Apps Script backend once and runs `setupSaafHisaab()`.
2. The first homeowner creates an account and first worker pair using the private owner setup code.
3. From the people hub, a homeowner can add more workers. Each pair gets a separate one-time invitation.
4. A worker opens an invitation in the same APK or hosted website. An existing account reuses the same phone and PIN; a new phone creates an account.
5. Login returns only the account and authorized pair list. Payroll data loads only after one pair is selected.
6. The homeowner records attendance, work, missed activities and no-contact absence. The worker has a read-only payroll view and can submit planned or last-minute leave/correction requests. Only the homeowner can accept a request into the ledger; a worker can still confirm or dispute homeowner-created records and acknowledge the final payment.

The product does not read WhatsApp calls or messages. WhatsApp can be used only to share the invitation or a monthly summary. This avoids WhatsApp Business API cost and privacy complications.
The month page provides one shareable text table containing the category amounts, leave/missed-activity list, combined adjustment, final payment, and status. On Android it opens the normal share sheet, where WhatsApp can be selected; in browsers without native sharing, it copies the same summary.

## Fast daily entry and live salary

The Today screen is exception-based: a normal day is saved with **Everything completed today**, while cooking, utensils, floor cleaning, half-day leave, or full-day leave can be changed only when needed. Arrival/departure, calls, messages, and notes are collapsed under optional details.

A live salary card is visible on Today and Month. It keeps two amounts separate:

- **Confirmed current pay** uses only mutually confirmed entries.
- **Pending possible impact** shows what may change if pending entries are confirmed; it never changes confirmed pay prematurely.

The card also shows leave-equivalent allowance used and remaining. The month calendar marks completed, pending, missed/leave, and disputed days. The app refreshes when it returns to the foreground and every 45 seconds on non-editing screens; unsaved daily edits prevent automatic refresh so they cannot be overwritten.

## Deploy the live Google Sheets version

Follow `apps-script/DEPLOY.md`. The one unavoidable external step is authorization in the homeowner's Google account; no developer can grant access to a private Sheet on the owner's behalf.

Google Apps Script hosts both the website and the API. `setupSaafHisaab()` creates a private spreadsheet named **SaafHisaab Shared Ledger** in the deployment owner’s account. Normalized phone numbers are stored in the private Accounts sheet, PINs are stored only as salted hashes, sessions use hashed tokens, failed logins are temporarily rate-limited, pair membership is checked server-side, and salary-changing records retain confirmation and audit state.

The **Apps Script service URL** is the public API address produced by **Deploy > New deployment > Web app** in Apps Script. It looks like `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`. This is release configuration, not a customer credential: homeowners and workers never type it on the login screen. The Apps Script-hosted website discovers its own URL automatically. Before packaging a standalone website or APK, the app publisher sets the URL once with `npm run configure:service -- <url>` and then builds/syncs the client.

For a backend created before version 2.0, replace `Code.gs` and `Index.html`, then run `setupSaafHisaab()` once. Existing `householdId` values become pair IDs without moving payroll rows. Version 1.0 deployments must first run `configureExistingLoginPhones('homeowner number', 'worker number')`; version 1.1 users are migrated automatically into global Accounts and their old household is linked to those accounts.

## Export, import and Google Drive backup

- The people hub can download all pairs visible to the logged-in account as a compact `JSON.gz` file. PIN hashes, session tokens and join codes are excluded from this user export.
- A homeowner can choose **Save to my Drive**. On Android, the system share sheet lets the homeowner select Google Drive and the intended Google account; compatible browsers do the same, while other browsers download the file for manual upload. The app never claims which account received the file and asks the homeowner to confirm it appears in Drive.
- The Apps Script deployment owner can run `backupDatabaseToDrive()` to create a complete, restorable `JSON.gz` service-database backup in `SaafHisaab Database Backups`.
- `setupSaafHisaab()` installs a daily full-database backup trigger. The newest 14 compressed backups are retained; the live private Google Sheet is updated on every accepted write.
- To import a complete backup, the owner runs `restoreDatabaseFromDrive('DRIVE_FILE_ID')`. SaafHisaab validates every sheet header and automatically creates a fresh pre-restore backup before replacing data.

The full service-database restore is deliberately not exposed through the public web API. Account-scoped homeowner files are for personal backup, portability and review; service disaster recovery remains an authenticated deployment-owner action in Apps Script. The current personal Drive flow is user-confirmed rather than silent or scheduled because Apps Script executes as its deployment owner and cannot write to another person’s Drive without separate Google OAuth consent.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
npm install
npm test
node server.mjs
```

Then open `http://127.0.0.1:4174/` and choose **Demo**. Demo records remain in that browser or phone only and are not shared.

## Rebuild the Apps Script bundle

```powershell
npm run build:apps-script
```

This regenerates `apps-script/Index.html` from the exact files in `www/`, so the browser and Android interfaces stay aligned.

## Rebuild Android

Requirements: Java 21 and Android SDK 36/build-tools 36.

```powershell
npm install
npm run configure:service -- https://script.google.com/macros/s/DEPLOYMENT_ID/exec
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The service address is public routing information and is compiled into the client; PINs, setup codes and tokens must never be placed in `service-config.js`. The result is `android/app/build/outputs/apk/debug/app-debug.apk`. A Play Store release additionally requires a private release keystore, release signing configuration, and Play Console submission.

## Important boundaries

- This is a payroll record and mutual-confirmation tool, not an attendance surveillance tool.
- Arrival/departure and contact-attempt counts can be logged manually, but SaafHisaab does not inspect phone calls or WhatsApp history.
- The current 2.x pilot ships with the cook-and-cleaner agreement template. A future generic agreement schema should store categories, activities, cadence, expected occurrences and monthly weight in each employee profile; that migration should precede adding unrelated employee types so payroll history stays auditable.
- The current APK is a debug-signed pilot build for direct installation and testing.
- If the Apps Script owner revokes the deployment or account permission, live synchronization stops; existing Google Sheet data remains in the deployment owner’s Drive.
