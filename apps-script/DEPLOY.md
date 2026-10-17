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
10. Open that URL in a browser or enter it in the Android app. Choose **Homeowner**, enter the setup code, names and a homeowner PIN.
11. In **Account**, share the generated one-time invitation with the worker. The worker can use the same website or APK and creates a separate PIN.

When code changes, run the local `npm run build:apps-script`, replace `Code.gs` and `Index.html`, then create a new web-app version while retaining the deployment URL.

The public web-app URL is an API doorway, not public access to the ledger. Requests require a hashed-session token after setup. Keep the owner setup code private.
