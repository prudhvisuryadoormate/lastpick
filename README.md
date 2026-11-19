# LastPick

Businesses post offers on anything they need to move before it becomes a loss: empty hotel rooms, a free date at a marriage hall, unsold bus seats, closing-time food, idle rental cars, clearance stock. Customers browse for free. With a monthly **Customer Pass** they see the owner's phone number, call or WhatsApp them, or share their own number. Owners pay a monthly **Owner Pro** fee to post offers and receive interested customers' numbers.

LastPick only connects people. The deal, payment and service are between the customer and the owner.

## What's inside

| Part | Tech | Where |
|---|---|---|
| Web app (customer, owner and admin) | React 18 + Vite | `src/` |
| Login | Firebase Authentication (email + password) | `src/api/firebase.js` |
| Database + security | Cloud Firestore + security rules | `firestore.rules`, `firestore.indexes.json` |
| Offer photos | Cloud Storage | `storage.rules` |
| Number exchange, offer posting, payments, admin tools | Cloud Functions (Node 20, region `asia-south1`) | `functions/index.js` |
| Subscriptions | Razorpay Subscriptions (UPI AutoPay, cards, net banking) | `functions/index.js` |
| Hosting | Firebase Hosting | `firebase.json` |
| Auto-deploy on push | GitHub Actions | `.github/workflows/deploy.yml` |

**Demo mode:** with no Firebase config, the app runs entirely in the browser with sample data and demo accounts (`customer@demo.in`, `owner@demo.in`, `admin@demo.in`, password `demo1234`). No real payments happen.

## How it's protected

- An owner's phone number lives in `businessContacts`, which customers can't read. They get it only from the `revealContact` function, and only with an active Customer Pass.
- A customer's number reaches an owner only when the customer taps **Share my number** (`shareNumber` function). Owners see leads only while Owner Pro is active.
- Offers are created only through the `createOffer` function, which checks the owner's plan. Offers become visible only when the business is **verified by an admin** and Owner Pro is active.
- Subscriptions are written only by Cloud Functions, after Razorpay's payment signature is verified, or by an admin.

## Run locally

```bash
npm install
npm run dev          # demo mode at http://localhost:5173
```

To use your real Firebase project, copy `.env.example` to `.env` and fill in the web config.

## Set up Firebase (one time)

1. In the [Firebase console](https://console.firebase.google.com), create a project **lastpick** and switch it to the **Blaze** plan.
2. Enable **Authentication → Email/Password**, **Firestore** (location `asia-south1`, production mode) and **Storage**.
3. **Project settings → Your apps → Add app → Web.** Copy the config into `.env` (local) or GitHub variables (auto-deploy).
4. Set your project id in `.firebaserc` (currently `laundry-staging-c0722`).
5. Create the payment secrets once. Use the word `unset` until Razorpay is ready:
   ```bash
   npm i -g firebase-tools && firebase login
   firebase functions:secrets:set RAZORPAY_KEY_SECRET      # enter: unset
   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET  # enter: unset
   ```
6. Deploy everything:
   ```bash
   npm install --prefix functions
   npm run deploy      # builds the app, then: firebase deploy
   ```
7. Sign up in the app, then make yourself admin: in **Firestore → users → your document**, set `role` to `admin`.

### Auto-deploy from GitHub (optional)

In the repo's **Settings → Secrets and variables → Actions**, add:
- Secret `FIREBASE_SERVICE_ACCOUNT`: the JSON from **Project settings → Service accounts → Generate new private key**.
- Variables `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.

After that, every push to `main` deploys automatically. Step 5 above still has to be done once.

## Turn on real payments (Razorpay)

1. Create a Razorpay account and complete KYC. Then enable **Subscriptions**.
2. Create two monthly plans: **Customer Pass ₹49** and **Owner Pro ₹499**. Copy their plan ids (`plan_...`).
3. Create `functions/.env` (not committed):
   ```
   RAZORPAY_KEY_ID=rzp_live_xxxxx
   RAZORPAY_PLAN_CUSTOMER=plan_xxxxx
   RAZORPAY_PLAN_OWNER=plan_xxxxx
   ```
4. Set the real secrets: `firebase functions:secrets:set RAZORPAY_KEY_SECRET`. Then in Razorpay go to **Webhooks → Add**:
   - URL: `https://asia-south1-<project-id>.cloudfunctions.net/razorpayWebhook`
   - Events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed`, `subscription.paused`, `subscription.resumed`
   - Pick a webhook secret, and store the same value with `firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET`.
5. `firebase deploy --only functions`.

Until then, an admin can switch on plans by hand in **Admin → Plans**, for example after collecting a UPI payment directly.

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
firestore.rules, firestore.indexes.json, storage.rules, firebase.json
```
