# LastPick

Businesses post offers on anything they need to move before it becomes a loss: empty hotel rooms, a free date at a marriage hall, unsold bus seats, closing-time food, idle rental cars, clearance stock. Customers browse for free. With a monthly **Customer Pass** they see the owner's phone number, call or WhatsApp them, or share their own number. Owners pay a monthly **Owner Pro** fee to post offers and receive interested customers' numbers.

LastPick only connects people. The deal, payment and service are between the customer and the owner.

## What's inside

| Part | Tech | Where |
|---|---|---|
| Web app (customer, owner and admin) | React 18 + Vite | `src/` |
| Login | Firebase Authentication (email + password) | `src/api/firebase.js` |
| Database + security | Cloud Firestore database **`lastpick`** + security rules | `firestore.rules`, `firestore.indexes.json` |
| Offer photos | Compressed JPEGs stored with each offer | `src/lib/image.js` |
| Number exchange, offer posting, payments, admin tools | Cloud Functions, codebase **`lastpick`**, names start with `lp` (Node 22, `asia-south1`) | `functions/index.js` |
| Subscriptions | Razorpay Subscriptions (UPI AutoPay, cards, net banking) | `functions/index.js` |
| Hosting | Firebase Hosting | `firebase.json` |
| Auto-deploy on push | GitHub Actions | `.github/workflows/deploy.yml` |

**Demo mode:** with no Firebase config, the app runs entirely in the browser with sample data and demo accounts (`customer@demo.in`, `owner@demo.in`, `admin@demo.in`, password `demo1234`). No real payments happen.

## How it's protected

- An owner's phone number lives in `businessContacts`, which customers can't read. They get it only from the `lpRevealContact` function, and only with an active Customer Pass.
- A customer's number reaches an owner only when the customer taps **Share my number** (`lpShareNumber` function). Owners see leads only while Owner Pro is active.
- Offers are created only through the `lpCreateOffer` function, which checks the owner's plan. Offers become visible only when the business is **verified by an admin** and Owner Pro is active.
- Subscriptions are written only by Cloud Functions, after Razorpay's payment signature is verified, or by an admin.
- **Rate limits** per user (`rateLimits/{uid}`): 60 new numbers viewed/hour, 30 numbers shared/hour, 30 offers/day, 10 reviews/day, 5 complaints/day. This stops scraping of business numbers and runaway bills.
- **Audit log** (`auditLog`, kept 1 year): number views and shares, offers, reviews, admin actions, data exports and account deletions. Apps can't read or write it; view it in the Firebase console.
- **Encryption:** HTTPS/TLS in transit and Google-managed encryption at rest for Auth, Firestore and Functions. Hosting sends HSTS, no-framing and no-sniff headers (`firebase.json`).
- **Partners post only in their categories.** A business picks a main category plus up to 2 more (`businesses.categories`). `lpCreateOffer` refuses any other category, so a business registered for food can post only food. A category change shows as a flag to moderators.

## Reviews

- Only a customer who viewed the number of, called, messaged or shared their number with a business through LastPick can review it. Reviews show "Contacted via LastPick" and the customer's first name (follows IS 19000:2022 on online consumer reviews).
- One review per customer per business, editable. Phone numbers, e-mails and links are refused.
- Businesses reply (Owner → Reviews) but can't delete reviews. Anyone can report a review. Admins and moderators hide reviews from Admin → Reports.
- The rating (`businesses.rating = {avg, count}`) is recalculated by `lpOnReviewWrite` and copied onto offers.

## Privacy, consent and complaints (India)

Built to follow the **DPDP Act 2023 + DPDP Rules 2025** (most duties apply from 13 May 2027, built in now), the **IT (Intermediary Guidelines) Rules 2021**, the **Consumer Protection (E-Commerce) Rules 2020** and **Google Play's** account-deletion policy.

- **Notice + consent at sign-up:** an itemised "what we collect and why" list and two unticked boxes (18+, agree). The consent is stored server-side with the notice version (`consentLog`, `users.consent`). When `CONSENT_VERSION` changes, everyone is asked again. Businesses accept separate business terms (`users.partnerConsent`).
- **Share-my-number confirmation:** customers see exactly who gets their name and number before it's shared.
- **Location** is used on the phone only and never stored on the server.
- **Rights:** Account → Privacy & your data: **download my data** (`lpExportMyData`, JSON), correct details, **delete my account** (`lpDeleteMyAccount` + `lpPurgeUserTask`). The public page `https://lastpick-ce569.web.app/#/delete-account` is the URL to give Play Console → Data safety → Delete account.
- **Complaints:** `#/grievance` gives every complaint a ticket number; admins handle them in Admin → Complaints (acknowledge within 24 h, resolve within 15 days).
- **Your legal details** must be shown in the app. Set these in `.env.production` before launch (as a personal publisher, use your own name and address):
  `VITE_LEGAL_NAME`, `VITE_LEGAL_ADDRESS`, `VITE_GRIEVANCE_OFFICER`, `VITE_GRIEVANCE_EMAIL`, `VITE_GRIEVANCE_PHONE`.

## Login with a one-time code

- **Mobile (SMS):** Firebase phone auth. Turn it on once: Firebase console → Authentication → Sign-in method → **Phone** → Enable. For testing without real SMS, add test numbers there (e.g. +91 99999 00001, code 123456). SMS is billed per message by Google after a small daily free allowance.
- **E-mail:** `lpSendEmailOtp` mails a 6-digit code (10-minute expiry, 5 tries, 5 codes an hour, 30 s between codes) and `lpVerifyEmailOtp` signs the user in. It needs an SMTP login, for example a Gmail app password:
  `firebase functions:secrets:set LASTPICK_SMTP_URL` → `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`, and `LASTPICK_MAIL_FROM=LastPick <you@gmail.com>` in `functions/.env.laundry-staging-c0722`. Until then the secret can be `unset`, and the app tells people to use their mobile number.
- **Existing accounts are kept.** A mobile login with the same number as an older e-mail account signs into that account (`lpCompletePhoneLogin`); an e-mail code signs into the account with that e-mail. E-mail + password login still works ("Have a password?").
- New accounts fill in name, the other contact detail and consent once (`CompleteProfile`), then their free month starts.
- `scripts/setup-production.sh` grants the functions' service account **Service Account Token Creator**, which sign-in tokens need.

## Free month and plans

- Customers: 30 days free from sign-up (`users.trialEndsAt`, set by `lpOnUserCreate`). Then Customer Pass ₹149/month, ₹399 for 3 months, ₹749 for 6, ₹1,399 for a year.
- Businesses: 30 days free from the day an admin verifies them (`businesses.trialEndsAt`). Then Business Pro ₹499/month, ₹1,349 for 3 months, ₹2,499 for 6, ₹4,499 for a year.
- Prices live in `PLANS` in `src/lib/config.js`. While free launch mode is on, everyone keeps access after their free month.

## Play Store builds

The Android workflow builds, for each app, a test APK and (once the signing secrets exist) a signed **.aab** for Play Console, targeting **API 36**. Add these repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Every build gets a new version code (the workflow run number).

## Payments and Google Play

Google Play's payments policy says digital features sold inside an app (such as a pass that unlocks phone numbers) must use **Google Play Billing**. In India you may offer an outside gateway such as PayU **alongside** Play Billing ("alternative billing"), with a 4% lower Google fee, after enrolling in Play Console and integrating Google's alternative billing APIs. A PayU-only checkout inside the app breaks the policy.

So the apps (`IS_NATIVE`) never show prices or payment buttons. Choose one before turning payments on:
1. **Pay on the website only** (simplest, no Google fee): users subscribe at the web app; the APK just logs in and uses the plan. The app must not link to or mention the website for payment.
2. **Google Play Billing in the app** (+ optionally PayU as alternative billing): needs a native billing plugin and server-side purchase verification.

## Caching, queue and costs

- **Caching:** feeds are reused for 60 s and the city list for 5 min (`src/api/firebase.js`); Firestore keeps already-read documents on the phone (IndexedDB); app files are cached by the Firebase CDN for a year (`/assets/**`). Redis/Memorystore isn't used: it costs about ₹3,000+/month even when idle.
- **Queue:** Cloud Tasks (`lpSyncOwnerTask`, `lpPurgeUserTask`) runs fan-out work in the background with retries. If the queue isn't available, the work runs inline.
- **Database:** Firestore has no servers or connection pools to manage and scales automatically. Function instances are capped (`maxInstances: 10`) so a traffic spike can't run up the bill; raise it as you grow. The named `lastpick` database has no free tier, so every read and write is billed, but at Firestore's per-100,000-operation prices that's small. Caching keeps the counts down.
- **Storage:** full photos (≤200 KB) are deleted as soon as an offer ends; thumbnails (≤30 KB) go when the offer is archived 7 days later; the archive keeps about 1 KB per offer.
- **Monitoring and backups:** run `bash scripts/setup-production.sh you@example.com` once in Cloud Shell. It sets up daily backups (7 days) + point-in-time recovery, error and crash alerts by e-mail, and an uptime check. Then add a budget alert in the Billing console.

## Run locally

```bash
npm install
npm run dev          # demo mode at http://localhost:5173
```

To use your real Firebase project, copy `.env.example` to `.env` and fill in the web config.

## Sharing a Firebase project with another app

LastPick lives in project `laundry-staging-c0722` next to another app, so everything it owns is kept separate:
- its own **Firestore database `lastpick`** (the other app's `(default)` database and rules are never touched),
- its own **functions codebase `lastpick`** (function names start with `lp`; secrets start with `LASTPICK_`),
- its own **Hosting site `lastpick-ce569`**.

Always deploy with `npm run deploy`, which runs `firebase deploy --only hosting,firestore,functions:lastpick`.
**Never run a plain `firebase deploy`** in this project: it could delete the other app's functions.
Firebase Authentication is shared by the whole project, so accounts from the other app can also log in to LastPick.

## Set up Firebase (one time)

Run these in Google Cloud Shell (no install needed) or any terminal with `firebase-tools`:

```bash
git clone https://github.com/prudhvisuryadoormate/lastpick && cd lastpick
npm install && npm install --prefix functions
firebase login --no-localhost
# 1. LastPick's own database
firebase firestore:databases:create lastpick --location=asia-south1
# 2. Payment secrets (placeholder until Razorpay is ready)
printf unset | firebase functions:secrets:set LASTPICK_RAZORPAY_KEY_SECRET --data-file=-
printf unset | firebase functions:secrets:set LASTPICK_RAZORPAY_WEBHOOK_SECRET --data-file=-
# 3. Deploy LastPick only
npm run deploy
```

Also make sure **Authentication → Sign-in method → Email/Password** is enabled. Then sign up at https://lastpick-ce569.web.app and make yourself admin: in **Firestore → database `lastpick` → users → your document**, set `role` to `admin`.

### Auto-deploy from GitHub (optional)

In the repo's **Settings → Secrets and variables → Actions**, add:
- Secret `FIREBASE_SERVICE_ACCOUNT`: the JSON from **Project settings → Service accounts → Generate new private key**.
- Variable `FIREBASE_PROJECT_ID` = `laundry-staging-c0722`. (The web config is already in `.env.production`.)

After that, every push to `main` deploys automatically. The one-time setup above still has to be done once.

## Turn on real payments (Razorpay)

1. Create a Razorpay account and complete KYC. Then enable **Subscriptions**.
2. Create two monthly plans: **Customer Pass ₹49** and **Owner Pro ₹499**. Copy their plan ids (`plan_...`).
3. Put the Key ID and plan ids in `functions/.env.laundry-staging-c0722` (replace `unset`):
   ```
   LASTPICK_RAZORPAY_KEY_ID=rzp_live_xxxxx
   LASTPICK_RAZORPAY_PLAN_CUSTOMER=plan_xxxxx
   LASTPICK_RAZORPAY_PLAN_OWNER=plan_xxxxx
   ```
4. Set the real secrets: `firebase functions:secrets:set LASTPICK_RAZORPAY_KEY_SECRET`. Then in Razorpay go to **Webhooks → Add**:
   - URL: `https://asia-south1-laundry-staging-c0722.cloudfunctions.net/lpRazorpayWebhook`
   - Events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed`, `subscription.paused`, `subscription.resumed`
   - Pick a webhook secret, and store the same value with `firebase functions:secrets:set LASTPICK_RAZORPAY_WEBHOOK_SECRET`.
5. `npm run deploy`.

Until then, an admin can switch on plans by hand in **Admin → Plans**, for example after collecting a UPI payment directly.

## Free launch mode (payments on hold)

Until payments are switched on, **everyone who logs in can see owners' numbers and post offers, free**. This is the default when there's no `config/app` document. A super admin switches it in **Admin → Overview → Turn payments on / Make it free**. The server (`lpAdminSetConfig`) then re-checks every owner's offers. While free mode is on, the subscription screens say "Free during launch" and the billing function refuses to charge.

## What customers see: near them only

- **Near me:** offers within **5, 10, 20 or 30 km** of the customer's GPS location (30 km by default). Offers store a `geohash` of the shop's location. The app queries the 9 geohash cells around the customer, then keeps only offers within the exact distance (`src/lib/geo.js`).
- **Pincode:** offers from businesses in that 6-digit pincode. This is used automatically when location is off.
- **Whole city:** still available from the picker.
- Owners must enter their **pincode** and tap **Use my location at the shop**. Without a location, their offers can't appear in "near me".

## Running at India scale

- **City-based feed.** Customers pick a city (the nearest big city is chosen automatically). Each feed loads only that city's live offers, which keeps database reads and costs low. `cities/{cityKey}` holds live-offer counts per city.
- **Photos.** Each offer stores a small thumbnail (about 2–25 KB) for lists. The full photo lives in `offerPhotos/{offerId}` and loads only on the offer page.
- **Nightly cleanup** (`lpNightlyCleanup`, 02:30 IST) moves offers that ended more than 7 days ago into a compact `offerArchive` (owners see it under My offers → History) and deletes their photos. Full photos are deleted as soon as an offer ends. It also deletes archive entries, leads, contact logs, audit logs and resolved reports after 12 months (DPDP Rules 2025 ask for 1 year of logs), closed complaints after 24 months, and expired rate-limit counters. The periods are in `RETENTION` in `src/lib/config.js` and `functions/index.js`.
- **India only.** Sign-up and business numbers must be Indian (+91 mobile, or landline with STD code). Businesses must pick an Indian state.
- **Admin team.**
  - `admin` sees all of India: overview and revenue, businesses, reports, users, plans and team.
  - `moderator` sees and acts only on the states assigned in **Admin → Team**: verifying businesses and handling reports.
  - Businesses get automatic red flags: reported 2+ times, a phone number shared with another business, or new in the last 48 h. Offers with 90%+ discounts are flagged too.
- **Budget alert.** Set one in Google Cloud → Billing → Budgets & alerts.

## Change prices, name or categories

Edit `src/lib/config.js`: app name, plan prices and perks, categories, templates, support email. When you change a price, change the Razorpay plan amount too.

## Before launch

- Have a lawyer review the template **Terms** and **Privacy notice** (`src/pages/privacy.jsx`).
- Fill in your legal details and Grievance Officer in `.env.production` (see Privacy above).
- Run `scripts/setup-production.sh` and add a budget alert.
- Play Console: a **personal** account created after 13 Nov 2023 must run a **closed test with 12+ testers for 14 days** before production. Fill in the Data safety form (name, e-mail, phone, approximate location used on device, app activity, crash logs) and give the delete-account URL.
- Decide how payments work with Google Play (see above) before turning payments on.
- Add your real support email in `src/lib/config.js`.
- In Firebase Authentication → Settings, add your domain to **Authorized domains** if you use a custom domain.

## Project structure

```
src/
  api/          firebase.js (live), demo.js (in-browser demo), index.js (picks one)
  lib/          config.js (name, prices, categories), format.js
  pages/        customer.jsx, owner.jsx, account.jsx (subscribe, login, admin), privacy.jsx (notice, consent,
                terms, complaints, data export, account deletion), reviews.jsx
scripts/        setup-production.sh (backups, alerts, uptime check; run in Cloud Shell)
  components.jsx, state.jsx (app state + router), App.jsx, main.jsx, styles.css
functions/      Cloud Functions
firestore.rules, firestore.indexes.json, firebase.json
```
