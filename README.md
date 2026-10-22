# SaafHisaab

SaafHisaab is a homeowner-first leave and salary manager for recurring household staff. The homeowner records leave or missed work, the app calculates the monthly salary, and both people can review the final record. The same responsive HTML, CSS, and JavaScript in `www/` is used by:

- the Android APK through Capacitor;
- the browser version hosted by Google Apps Script; and
- the local demo preview.

The deployment owner controls one private Google Sheet database. Both people log in with their own phone number and PIN; the worker first registers through a one-time invitation and never receives direct access to the Sheet. Worker confirmation is a transparency feature; the primary workflow is designed for the homeowner managing leave and salary.

The normalized **phone number is the account identity** within one SaafHisaab deployment. One login opens a hub with **Working for me** and **I work for**. Each relationship has a separate random `pairId`; the client sends it only after the user selects a person, and the backend verifies that the logged-in account belongs to that pair. A 10-digit Indian number is normalized to `+91…`; international numbers must include `+country-code`. Phone login is identifier-based and does not send an OTP or SMS.

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
6. Either person may log work or leave. The other person confirms or disputes it. Confirmed entries update the monthly view; the homeowner locks the final amount and the worker acknowledges it.

The product does not read WhatsApp calls or messages. WhatsApp can be used only to share the invitation or a monthly summary. This avoids WhatsApp Business API cost and privacy complications.
The month page provides one shareable text table containing the category amounts, leave/missed-activity list, combined adjustment, final payment, and status. On Android it opens the normal share sheet, where WhatsApp can be selected; in browsers without native sharing, it copies the same summary.

## Deploy the live Google Sheets version

Follow `apps-script/DEPLOY.md`. The one unavoidable external step is authorization in the homeowner's Google account; no developer can grant access to a private Sheet on the owner's behalf.

Google Apps Script hosts both the website and the API. `setupSaafHisaab()` creates a private spreadsheet named **SaafHisaab Shared Ledger** in the deployment owner’s account. Normalized phone numbers are stored in the private Accounts sheet, PINs are stored only as salted hashes, sessions use hashed tokens, failed logins are temporarily rate-limited, pair membership is checked server-side, and salary-changing records retain confirmation and audit state.

For a backend created before version 2.0, replace `Code.gs` and `Index.html`, then run `setupSaafHisaab()` once. Existing `householdId` values become pair IDs without moving payroll rows. Version 1.0 deployments must first run `configureExistingLoginPhones('homeowner number', 'worker number')`; version 1.1 users are migrated automatically into global Accounts and their old household is linked to those accounts.

## Export, import and Google Drive backup

- The people hub can download all pairs visible to the logged-in account as a compact `JSON.gz` file. PIN hashes, session tokens and join codes are excluded from this user export.
- **Back up to Drive** writes the same account-scoped file to the deployment owner’s private `SaafHisaab User Backups` folder.
- The Apps Script owner can run `backupDatabaseToDrive()` to create a complete, restorable `JSON.gz` database backup in `SaafHisaab Database Backups`.
- To import a complete backup, the owner runs `restoreDatabaseFromDrive('DRIVE_FILE_ID')`. SaafHisaab validates every sheet header and automatically creates a fresh pre-restore backup before replacing data.

The full database restore is deliberately not exposed through the public web API. Account-scoped exports are for portability and review; disaster recovery remains an authenticated owner action in Apps Script.

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
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. A Play Store release additionally requires a private release keystore, release signing configuration, and Play Console submission.

## Important boundaries

- This is a payroll record and mutual-confirmation tool, not an attendance surveillance tool.
- Arrival/departure and contact-attempt counts can be logged manually, but SaafHisaab does not inspect phone calls or WhatsApp history.
- The current APK is a debug-signed pilot build for direct installation and testing.
- If the Apps Script owner revokes the deployment or account permission, live synchronization stops; existing Google Sheet data remains in the deployment owner’s Drive.
