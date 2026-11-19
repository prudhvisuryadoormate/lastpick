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
- **Nightly cleanup** (`lpNightlyCleanup`, 02:30 IST) moves offers that ended more than 7 days ago into a compact `offerArchive` (owners see it under My offers → History) and deletes their photos. It also deletes archive entries after 12 months, leads and contact logs after 6 months, and resolved reports after 12 months. The periods are in `RETENTION` in `src/lib/config.js` and `functions/index.js`.
- **India only.** Sign-up and business numbers must be Indian (+91 mobile, or landline with STD code). Businesses must pick an Indian state.
- **Admin team.**
  - `admin` sees all of India: overview and revenue, businesses, reports, users, plans and team.
  - `moderator` sees and acts only on the states assigned in **Admin → Team**: verifying businesses and handling reports.
  - Businesses get automatic red flags: reported 2+ times, a phone number shared with another business, or new in the last 48 h. Offers with 90%+ discounts are flagged too.
- **Budget alert.** Set one in Google Cloud → Billing → Budgets & alerts.

## Change prices, name or categories

Edit `src/lib/config.js`: app name, plan prices and perks, categories, templates, support email. When you change a price, change the Razorpay plan amount too.

## Before launch

- Have a lawyer review the template **Terms** and **Privacy** pages (`src/pages/account.jsx`). They cover India's consumer and data-protection rules, including the DPDP Act.
- Add your real support email in `src/lib/config.js`.
- In Firebase Authentication → Settings, add your domain to **Authorized domains** if you use a custom domain.

## Project structure

```
src/
  api/          firebase.js (live), demo.js (in-browser demo), index.js (picks one)
  lib/          config.js (name, prices, categories), format.js
  pages/        customer.jsx, owner.jsx, account.jsx (subscribe, login, legal, admin)
  components.jsx, state.jsx (app state + router), App.jsx, main.jsx, styles.css
functions/      Cloud Functions
firestore.rules, firestore.indexes.json, firebase.json
```
