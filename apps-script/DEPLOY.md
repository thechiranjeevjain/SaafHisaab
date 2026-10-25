# Deploy the free central Google Sheets backend and website

The Android APK and website use the same interface and one central Google Sheet database. The Google account that deploys Apps Script owns the Sheet; homeowners and workers use app accounts and never receive direct Sheet access.

1. Open `https://script.google.com` while signed into the homeowner's Google account.
2. Create a new standalone Apps Script project named `SaafHisaab`.
3. Replace `Code.gs` with the supplied `Code.gs` file.
4. Add an HTML file named `Index` and copy the supplied `Index.html` into it.
5. Open **Project Settings**, enable **Show appsscript.json**, and replace it with the supplied manifest.
6. Run `setupSaafHisaab()` once. Approve the requested Google Sheets permission. Copy the returned `ownerSetupCode` and keep it private.
7. Select **Deploy → New deployment → Web app**.
8. Set **Execute as** to **Me** and **Who has access** to **Anyone**.
9. Deploy and copy the URL ending in `/exec`. This is publisher configuration, not something a homeowner or worker should type during login.
10. Open that URL in a browser and choose **Create homeowner account**. Enter the setup code, names, homeowner phone number and homeowner PIN. The hosted website discovers its own service URL automatically.
11. In **Account**, share the generated one-time invitation with the worker. The worker can use the same website or APK and registers their phone number plus a PIN.
12. After registration, either person uses **Login** with their phone number and PIN. Login opens all authorized relationships; clicking one loads only that pair’s ledger.
13. Use **Add a worker** from the hub for additional staff. A phone may appear under both **Working for me** and **I work for** when appropriate.

When code changes, run the local `npm run build:apps-script`, replace `Code.gs` and `Index.html`, then create a new web-app version while retaining the deployment URL.

For an Android or separately hosted web release, configure the public endpoint before copying the web assets:

```powershell
npm run configure:service -- https://script.google.com/macros/s/DEPLOYMENT_ID/exec
npx cap sync android
```

The generated client remembers only this public server address. Never place the owner setup code, PINs or session tokens in `service-config.js`.

The public web-app URL is an API doorway, not public access to the ledger. Requests require a hashed account-session token after setup, and every ledger action is authorized against its pair ID. The private Accounts sheet stores the normalized phone number and a salted PIN hash; it never stores the plain PIN. Keep the owner setup code private.

## Upgrading an existing 1.x backend

1. Replace `Code.gs` and `Index.html`, then create a new deployment version while retaining the existing `/exec` URL.
2. Run `setupSaafHisaab()` once. It adds Accounts, Account Sessions and pair links without clearing existing records.
3. For version 1.0 only, run `configureExistingLoginPhones('9876543210', '9123456789')`. Omit the worker number when the worker has not joined.
4. Confirm the existing household appears in the people hub. Its historical payroll rows stay under the same ID, now treated as its pair ID.

## Database backup and restore

- Run `backupDatabaseToDrive()` in the Apps Script editor for a complete compressed backup. Copy the returned Drive file ID.
- Run `restoreDatabaseFromDrive('file-id')` to restore one. A pre-restore backup is created automatically, and an incompatible file is rejected before any sheet is changed.
- Logged-in users can download their authorized account-scoped archive. Homeowners can use **Save to my Drive**, then select Google Drive and their Google account in the phone’s system share sheet. This is a compressed personal backup, not the service’s full multi-account database and not an automatic OAuth upload.
- Legacy clients may still create an account-scoped recovery copy in the deployment owner’s Drive. The current customer UI does not present that destination as the homeowner’s Drive.
- Logged-in users cannot invoke full service-database restore through the public API.
