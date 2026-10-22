# Deploy the free Google Sheets backend and website

The Android APK and the website use the same interface and the same Google Sheet ledger. The homeowner owns the Sheet. The worker never receives direct Sheet access.

1. Open `https://script.google.com` while signed into the homeowner's Google account.
2. Create a new standalone Apps Script project named `SaafHisaab`.
3. Replace `Code.gs` with the supplied `Code.gs` file.
4. Add an HTML file named `Index` and copy the supplied `Index.html` into it.
5. Open **Project Settings**, enable **Show appsscript.json**, and replace it with the supplied manifest.
6. Run `setupSaafHisaab()` once. Approve the requested Google Sheets permission. Copy the returned `ownerSetupCode` and keep it private.
7. Select **Deploy → New deployment → Web app**.
8. Set **Execute as** to **Me** and **Who has access** to **Anyone**.
9. Deploy and copy the URL ending in `/exec`.
10. Open that URL in a browser or enter it in the Android app. Choose **Set up**, enter the setup code, names, homeowner phone number and homeowner PIN.
11. In **Account**, share the generated one-time invitation with the worker. The worker can use the same website or APK and registers their phone number plus a separate PIN.
12. After registration, either person uses **Login** with their phone number and PIN. The role is found automatically; there is no separate role selector and no OTP or SMS charge.

When code changes, run the local `npm run build:apps-script`, replace `Code.gs` and `Index.html`, then create a new web-app version while retaining the deployment URL.

The public web-app URL is an API doorway, not public access to the ledger. Requests require a hashed-session token after setup. The private Users sheet stores the normalized phone number and a salted PIN hash; it never stores the plain PIN. Keep the owner setup code private.

## Upgrading an existing 1.0 backend

1. Replace `Code.gs` and `Index.html`, then create a new deployment version while retaining the existing `/exec` URL.
2. Run `setupSaafHisaab()` once. It adds the `phone` column without clearing existing records.
3. Run `configureExistingLoginPhones('9876543210', '9123456789')` once from the Apps Script editor. If the worker has not joined, pass only the homeowner number.
4. Confirm that the returned numbers are normalized to `+91…`, then use **Login** in the app.

Phone is not a global primary key. Authentication resolves the composite identity `(householdId, normalized phone)` and then verifies the salted PIN hash.
