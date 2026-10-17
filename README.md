# SaafHisaab

SaafHisaab is a homeowner-first leave and salary manager for recurring household staff. The homeowner records leave or missed work, the app calculates the monthly salary, and both people can review the final record. The same responsive HTML, CSS, and JavaScript in `www/` is used by:

- the Android APK through Capacitor;
- the browser version hosted by Google Apps Script; and
- the local demo preview.

The homeowner owns the Google Sheet. The worker may use the app or website with a separate invitation and PIN and never receives direct access to the Sheet. Worker confirmation is a transparency feature; the primary workflow is designed for the homeowner managing leave and salary.

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

1. The homeowner deploys the supplied Google Apps Script backend once and runs `setupSaafHisaab()`.
2. The homeowner creates the household using the private owner setup code.
3. SaafHisaab creates a one-time worker invitation.
4. The worker opens that invitation in the same APK or hosted website and chooses a separate PIN.
5. Either person may log work or leave. The other person confirms or disputes it.
6. Confirmed entries update the monthly view for both people. The homeowner can lock a completed month and the worker can acknowledge payment.

The product does not read WhatsApp calls or messages. WhatsApp can be used only to share the invitation or a monthly summary. This avoids WhatsApp Business API cost and privacy complications.
The month page provides one shareable text table containing the category amounts, leave/missed-activity list, combined adjustment, final payment, and status. On Android it opens the normal share sheet, where WhatsApp can be selected; in browsers without native sharing, it copies the same summary.

## Deploy the live Google Sheets version

Follow `apps-script/DEPLOY.md`. The one unavoidable external step is authorization in the homeowner's Google account; no developer can grant access to a private Sheet on the owner's behalf.

Google Apps Script hosts both the website and the API. `setupSaafHisaab()` creates a private spreadsheet named **SaafHisaab Shared Ledger** in the homeowner's account. PINs are stored as salted hashes, sessions use hashed tokens, and salary-changing records retain confirmation and audit state.

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
- If the Apps Script owner revokes the deployment or account permission, live synchronization stops; existing Google Sheet data remains in the owner's Drive.
