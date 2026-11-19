// LastPick Cloud Functions (Firebase, 2nd gen, Node 22).
// - Number exchange: revealContact, logContact, shareNumber
// - Offers: createOffer (server checks the owner's plan and business)
// - Billing: Razorpay subscriptions (billing) + razorpayWebhook for renewals
// - Admin: plans, roles (admin / city moderators), business verification, reports, India-wide stats, user search
// - Upkeep: offer visibility sync, per-city counters, hourly plan expiry, nightly archive + cleanup
// - Reviews (only customers who contacted the business), owner replies, review reports
// - Privacy (DPDP Act 2023 / Rules 2025): consent records, data export, account deletion, grievance tickets
// - Safety: per-user rate limits, a 1-year audit log, Cloud Tasks queue for heavy fan-out jobs
// - Login: one-time codes by SMS (Firebase phone auth) or e-mail (lpSendEmailOtp / lpVerifyEmailOtp), linked to existing accounts
// - Free month: 30 days for customers from sign-up, 30 days for businesses from verification
const crypto = require("crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp, AggregateField } = require("firebase-admin/firestore");
const { getFunctions } = require("firebase-admin/functions");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
// LastPick uses its own Firestore database ("lastpick") so it never touches other apps in this project.
const DB_ID = "lastpick";
const db = getFirestore(DB_ID);
setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

// Razorpay settings. Set them before going live (see README):
//   firebase functions:secrets:set LASTPICK_RAZORPAY_KEY_SECRET
//   firebase functions:secrets:set LASTPICK_RAZORPAY_WEBHOOK_SECRET
//   and LASTPICK_RAZORPAY_KEY_ID / LASTPICK_RAZORPAY_PLAN_CUSTOMER / LASTPICK_RAZORPAY_PLAN_OWNER in functions/.env
const RAZORPAY_KEY_ID = defineString("LASTPICK_RAZORPAY_KEY_ID", { default: "unset" });
const RAZORPAY_PLAN_CUSTOMER = defineString("LASTPICK_RAZORPAY_PLAN_CUSTOMER", { default: "unset" });
const RAZORPAY_PLAN_OWNER = defineString("LASTPICK_RAZORPAY_PLAN_OWNER", { default: "unset" });
const RAZORPAY_KEY_SECRET = defineSecret("LASTPICK_RAZORPAY_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("LASTPICK_RAZORPAY_WEBHOOK_SECRET");

const PLANS = ["customer", "owner"];
const TRIAL_DAYS = 30;
// E-mail one-time codes are sent by SMTP. Set before using e-mail login (see README):
//   firebase functions:secrets:set LASTPICK_SMTP_URL   e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
//   LASTPICK_MAIL_FROM in functions/.env              e.g. LastPick <you@gmail.com>
const SMTP_URL = defineSecret("LASTPICK_SMTP_URL");
const MAIL_FROM = defineString("LASTPICK_MAIL_FROM", { default: "LastPick <no-reply@lastpick.in>" });
const MAX_OFFER_MS = 30 * 86400000;

// ---------------------------------------------------------------- helpers
function needAuth(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in");
  return req.auth.uid;
}
async function isAdmin(uid) {
  const u = await db.doc(`users/${uid}`).get();
  return u.exists && u.data().role === "admin";
}
// Super admin ("admin") sees all of India. A "moderator" only manages the states listed in users/{uid}.regions.
async function staff(req, { superOnly = false } = {}) {
  const uid = needAuth(req);
  const u = (await db.doc(`users/${uid}`).get()).data() || {};
  if (u.role === "admin") return { uid, role: "admin", regions: null, canSee: () => true };
  if (u.role === "moderator" && !superOnly) {
    const regions = Array.isArray(u.regions) ? u.regions : [];
    return { uid, role: "moderator", regions, canSee: (state) => regions.includes(state) };
  }
  throw new HttpsError("permission-denied", superOnly ? "Super admins only" : "Admins only");
}
async function needAdmin(req) { return (await staff(req, { superOnly: true })).uid; }
// ---- free-launch mode ----
// config/app.freeMode = true (or no config yet) means nobody needs a subscription: payments are on hold.
// Super admins switch it in Admin -> Overview.
let cfgCache = { at: 0, freeMode: true };
async function freeMode() {
  if (Date.now() - cfgCache.at < 30000) return cfgCache.freeMode;
  const d = await db.doc("config/app").get();
  cfgCache = { at: Date.now(), freeMode: !d.exists || d.data().freeMode !== false };
  return cfgCache.freeMode;
}

function subActive(s) {
  return !!s && ["active", "cancelled"].includes(s.status) && s.currentPeriodEnd && s.currentPeriodEnd.toMillis() > Date.now();
}
// End of the free month: customers from sign-up, businesses from the day they were verified.
async function trialEnd(uid, plan) {
  const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : 0);
  if (plan === "customer") {
    const u = (await db.doc(`users/${uid}`).get()).data();
    if (!u) return 0;
    return ms(u.trialEndsAt) || (ms(u.createdAt) || Date.now()) + TRIAL_DAYS * DAY;
  }
  const b = (await db.doc(`businesses/${uid}`).get()).data();
  if (!b || b.status !== "verified") return 0;
  return ms(b.trialEndsAt) || (ms(b.reviewedAt) || ms(b.createdAt) || Date.now()) + TRIAL_DAYS * DAY;
}
async function planActive(uid, plan) {
  if (await freeMode()) return true;
  if ((await trialEnd(uid, plan)) > Date.now()) return true;
  const s = await db.doc(`subscriptions/${uid}_${plan}`).get();
  return s.exists && subActive(s.data());
}
async function getOffer(offerId) {
  if (typeof offerId !== "string" || !offerId) throw new HttpsError("invalid-argument", "Missing offer");
  const snap = await db.doc(`offers/${offerId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Offer not found");
  return { id: snap.id, ...snap.data() };
}
const offerSummary = (o) => ({
  title: o.title, emoji: o.emoji || "📦", category: o.category, photoThumb: o.photoThumb || null, price: o.price,
  origPrice: o.origPrice, endsAt: o.endsAt, businessName: o.business?.name || "", area: o.business?.area || "", city: o.business?.city || "",
});
const cityKey = (name) => String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function geohash(lat, lng, precision = 9) {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180, hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) { const m = (lngMin + lngMax) / 2; if (lng >= m) { ch |= 1 << (4 - bit); lngMin = m; } else lngMax = m; }
    else { const m = (latMin + latMax) / 2; if (lat >= m) { ch |= 1 << (4 - bit); latMin = m; } else latMax = m; }
    even = !even;
    if (bit < 4) bit++; else { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}
const bizSummary = (b) => ({
  name: b.name, area: b.area || "", city: b.city || "", state: b.state || "", cityKey: cityKey(b.city), pincode: b.pincode || "",
  lat: b.lat ?? null, lng: b.lng ?? null,
  geohash: typeof b.lat === "number" && typeof b.lng === "number" ? geohash(b.lat, b.lng) : null,
  rating: b.rating && b.rating.count ? { avg: b.rating.avg, count: b.rating.count } : null,
});
const DAY = 86400000;
// keep in sync with RETENTION in src/lib/config.js
// Logs of who exchanged numbers are kept 1 year (DPDP Rules 2025, rule 8(3)), then deleted.
const RETENTION = { endedOfferVisibleDays: 7, archiveDays: 365, leadsDays: 365, contactsDays: 365, reportsDays: 365, auditDays: 365, closedGrievanceDays: 730 };
// Bump when the privacy notice / terms change: everyone is asked to accept again. Keep in sync with src/lib/config.js.
const CONSENT_VERSION = "2026-11-19";

// ---- audit log: who did what, kept 1 year. Not readable or writable by apps (no rule allows it).
function audit(type, data = {}) {
  return db.collection("auditLog").add({ type, ...data, at: FieldValue.serverTimestamp() }).catch((e) => console.error("audit failed", e.message));
}
// ---- per-user rate limits (fixed window). Stops number scraping, spam reviews and runaway bills.
async function rateLimit(uid, action, max, windowSec) {
  const ref = db.doc(`rateLimits/${uid}`);
  await db.runTransaction(async (t) => {
    const d = (await t.get(ref)).data() || {};
    const now = Date.now();
    const cur = d[action] && now - d[action].start < windowSec * 1000 ? d[action] : { start: now, n: 0 };
    if (cur.n >= max) throw new HttpsError("resource-exhausted", "Too many requests. Please try again later.");
    t.set(ref, { [action]: { start: cur.start, n: cur.n + 1 }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
// ---- queue (Cloud Tasks): heavy jobs run in the background with retries. Falls back to running inline.
async function enqueue(fn, data, delaySeconds = 2) {
  try {
    await getFunctions().taskQueue(`locations/asia-south1/functions/${fn}`).enqueue(data, { scheduleDelaySeconds: delaySeconds });
    return true;
  } catch (e) {
    console.warn(JSON.stringify({ severity: "WARNING", message: `queue ${fn} unavailable, running inline`, error: e.message }));
    return false;
  }
}
async function queueOwnerSync(ownerId) { if (!(await enqueue("lpSyncOwnerTask", { ownerId }))) await syncOwnerOffers(ownerId); }
// Phone numbers, links and e-mails are not allowed in reviews/replies (keeps contact inside the number-exchange flow).
const hasContactInfo = (t) => /[6-9]\d{9}/.test(String(t).replace(/[\s().+-]/g, "")) || /https?:\/\/|www\.|\S+@\S+\.\S+/i.test(t);
const firstName = (n) => String(n || "Customer").trim().split(/\s+/)[0].slice(0, 30) || "Customer";
const isDataImage = (v, max) => typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= max;

// Per-city counter of live offers (cities/{cityKey}), used for the city picker and the admin dashboard.
async function refreshCity(key) {
  if (!key) return;
  const live = await db.collection("offers").where("cityKey", "==", key).where("visible", "==", true)
    .where("status", "==", "live").where("endsAt", ">", Timestamp.now()).count().get();
  const businesses = await db.collection("businesses").where("cityKey", "==", key).where("status", "==", "verified").count().get();
  const sample = await db.collection("businesses").where("cityKey", "==", key).limit(1).get();
  const b = sample.empty ? {} : sample.docs[0].data();
  await db.doc(`cities/${key}`).set({
    name: b.city || key, state: b.state || "", lat: b.lat ?? null, lng: b.lng ?? null,
    liveOffers: live.data().count, verifiedBusinesses: businesses.data().count, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Recompute whether an owner's offers are shown to customers:
// business verified AND Business Pro active. Also refresh the business details copied onto offers.
async function syncOwnerOffers(ownerId) {
  const [biz, active] = await Promise.all([db.doc(`businesses/${ownerId}`).get(), planActive(ownerId, "owner")]);
  const b = biz.exists ? biz.data() : null;
  const visible = !!b && b.status === "verified" && active;
  const business = b ? bizSummary(b) : null;
  const offers = await db.collection("offers").where("ownerId", "==", ownerId).get();
  const keys = new Set();
  let batch = db.batch(), n = 0;
  for (const d of offers.docs) {
    keys.add(d.data().cityKey);
    const patch = { visible };
    if (business) {
      patch.business = business; patch.cityKey = business.cityKey; patch.pincode = business.pincode; patch.geohash = business.geohash;
      keys.add(business.cityKey);
    }
    batch.update(d.ref, patch);
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  if (b) keys.add(cityKey(b.city));
  await Promise.all([...keys].filter(Boolean).map(refreshCity));
}

// ---------------------------------------------------------------- offers
exports.lpCreateOffer = onCall(async (req) => {
  const uid = needAuth(req);
  const d = req.data || {};
  const biz = await db.doc(`businesses/${uid}`).get();
  if (!biz.exists) throw new HttpsError("failed-precondition", "Set up your business first");
  const b = biz.data();
  if (["rejected", "suspended"].includes(b.status)) throw new HttpsError("permission-denied", "Your business is " + b.status);
  // a business waiting for verification may post (offers stay hidden until verified, when its free month starts)
  if (b.status !== "pending" && !(await planActive(uid, "owner"))) throw new HttpsError("permission-denied", "Your free month has ended. Pick a Business Pro plan to post offers.");
  const contact = await db.doc(`businessContacts/${uid}`).get();
  if (!contact.exists) throw new HttpsError("failed-precondition", "Add your contact number in Business profile first");
  if (!b.city || !b.state || !b.pincode) throw new HttpsError("failed-precondition", "Add your city, state and pincode in Business profile first");

  const title = str(d.title, 120);
  const origPrice = Number(d.origPrice), price = Number(d.price), endsAt = Number(d.endsAt);
  if (title.length < 3) throw new HttpsError("invalid-argument", "Title is too short");
  if (!(origPrice > 0) || !(price >= 0) || !(price < origPrice)) throw new HttpsError("invalid-argument", "Offer price must be lower than the normal price");
  if (!(endsAt > Date.now()) || endsAt > Date.now() + MAX_OFFER_MS + 60000) throw new HttpsError("invalid-argument", "Offers can run for up to 30 days");
  // photo: a small thumbnail lives on the offer (for lists); the full photo lives in offerPhotos/{id} (opened on demand)
  // a business posts only in the categories it registered (main + up to 2 more)
  const allowed = Array.isArray(b.categories) && b.categories.length ? b.categories : [b.category || "other"];
  const category = str(d.category, 30) || allowed[0];
  if (!allowed.includes(category)) {
    throw new HttpsError("permission-denied", "Your business can post only in its registered categories. Add this category in Business profile first.");
  }
  await rateLimit(uid, "createOffer", 30, 86400);
  const photoThumb = isDataImage(d.photoThumb, 30000) ? d.photoThumb : null;
  const photo = isDataImage(d.photo, 200000) ? d.photo : null;
  const discount = 1 - price / origPrice;
  const business = bizSummary(b);

  const ref = db.collection("offers").doc();
  const batch = db.batch();
  batch.set(ref, {
    ownerId: uid, businessId: uid, business, cityKey: business.cityKey, pincode: business.pincode, geohash: business.geohash,
    title, description: str(d.description, 1000), category, emoji: str(d.emoji, 8) || "📦",
    photoThumb, hasPhoto: !!photo, origPrice, price, quantity: str(d.quantity, 60),
    endsAt: Timestamp.fromMillis(endsAt), status: "live", visible: b.status === "verified", views: 0,
    flags: discount >= 0.9 ? ["very-high-discount"] : [],
    createdAt: FieldValue.serverTimestamp(),
  });
  if (photo) batch.set(db.doc(`offerPhotos/${ref.id}`), { ownerId: uid, data: photo, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await refreshCity(business.cityKey);
  audit("offer_created", { actor: uid, offerId: ref.id, category });
  return { id: ref.id, visible: b.status === "verified" };
});

// ---------------------------------------------------------------- number exchange
exports.lpRevealContact = onCall(async (req) => {
  const uid = needAuth(req);
  const o = await getOffer(req.data?.offerId);
  const own = o.ownerId === uid;
  const customer = await planActive(uid, "customer");
  if (!customer && !own && !(await isAdmin(uid))) {
    throw new HttpsError("permission-denied", "Subscribe to the Customer Pass to see this number");
  }
  const c = await db.doc(`businessContacts/${o.ownerId}`).get();
  if (!c.exists) throw new HttpsError("not-found", "The owner has not added a contact number");
  if (customer && !own) {
    const ref = db.doc(`customerContacts/${uid}_${o.id}`);
    const prev = await ref.get();
    if (!prev.exists) { await rateLimit(uid, "reveal", 60, 3600); audit("number_viewed", { actor: uid, offerId: o.id, businessId: o.businessId }); }
    await ref.set({ customerId: uid, offerId: o.id, businessId: o.businessId, how: prev.exists ? prev.data().how : "Viewed number", at: FieldValue.serverTimestamp(), offer: offerSummary(o) }, { merge: true });
  }
  return { phone: c.data().phone, whatsapp: c.data().whatsapp !== false };
});

exports.lpLogContact = onCall(async (req) => {
  const uid = needAuth(req);
  if (!(await planActive(uid, "customer"))) return { ok: false };
  const o = await getOffer(req.data?.offerId);
  if (o.ownerId === uid) return { ok: false };
  await db.doc(`customerContacts/${uid}_${o.id}`).set({
    customerId: uid, offerId: o.id, businessId: o.businessId, how: str(req.data?.how, 40) || "Contacted", at: FieldValue.serverTimestamp(), offer: offerSummary(o),
  }, { merge: true });
  return { ok: true };
});

exports.lpShareNumber = onCall(async (req) => {
  const uid = needAuth(req);
  if (!(await planActive(uid, "customer"))) throw new HttpsError("permission-denied", "Subscribe to the Customer Pass first");
  const o = await getOffer(req.data?.offerId);
  if (o.status !== "live" || !o.visible || o.endsAt.toMillis() <= Date.now()) throw new HttpsError("failed-precondition", "This offer has ended");
  if (o.ownerId === uid) throw new HttpsError("failed-precondition", "This is your own offer");
  const user = (await db.doc(`users/${uid}`).get()).data() || {};
  if (!user.phone) throw new HttpsError("failed-precondition", "Add your phone number in Account first");

  const leadRef = db.doc(`leads/${o.id}_${uid}`);
  const prev = await leadRef.get();
  if (!prev.exists) { await rateLimit(uid, "share", 30, 3600); audit("number_shared", { actor: uid, offerId: o.id, businessId: o.businessId }); }
  await leadRef.set({
    offerId: o.id, businessId: o.businessId, ownerId: o.ownerId, customerId: uid,
    name: user.name || "Customer", phone: user.phone, offerTitle: o.title, offerEmoji: o.emoji || "📦",
    status: prev.exists ? prev.data().status : "new",
    createdAt: prev.exists ? prev.data().createdAt : FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.doc(`customerContacts/${uid}_${o.id}`).set({
    customerId: uid, offerId: o.id, businessId: o.businessId, how: "Shared my number", at: FieldValue.serverTimestamp(), offer: offerSummary(o),
  }, { merge: true });
  return { ok: true };
});

// ---------------------------------------------------------------- billing (Razorpay subscriptions)
async function razorpay(path, body) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID.value()}:${RAZORPAY_KEY_SECRET.value()}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new HttpsError("internal", data?.error?.description || `Razorpay error ${res.status}`);
  return data;
}
const hmac = (secret, msg) => crypto.createHmac("sha256", secret).update(msg).digest("hex");
const sameHex = (a, b) => typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const periodEnd = (currentEnd) => Timestamp.fromMillis(currentEnd ? currentEnd * 1000 : Date.now() + 30 * 86400000);

exports.lpBilling = onCall({ secrets: [RAZORPAY_KEY_SECRET] }, async (req) => {
  const uid = needAuth(req);
  const { action, plan } = req.data || {};
  if (!PLANS.includes(plan)) throw new HttpsError("invalid-argument", "Unknown plan");
  if (await freeMode()) throw new HttpsError("failed-precondition", "LastPick is free during launch. No payment is needed.");
  const planId = plan === "customer" ? RAZORPAY_PLAN_CUSTOMER.value() : RAZORPAY_PLAN_OWNER.value();
  if (RAZORPAY_KEY_ID.value() === "unset" || planId === "unset") {
    throw new HttpsError("failed-precondition", "Online payments are not set up yet. Please contact support.");
  }
  const ref = db.doc(`subscriptions/${uid}_${plan}`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;

  if (action === "create") {
    if (existing && existing.status === "active" && subActive(existing)) throw new HttpsError("already-exists", "This plan is already active");
    const sub = await razorpay("/subscriptions", { plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1, notes: { user_id: uid, plan } });
    await ref.set({ userId: uid, plan, provider: "razorpay", providerSubscriptionId: sub.id, status: existing && subActive(existing) ? existing.status : "created", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { subscriptionId: sub.id, keyId: RAZORPAY_KEY_ID.value() };
  }

  if (action === "verify") {
    const { razorpay_payment_id: payId, razorpay_subscription_id: subId, razorpay_signature: sig } = req.data;
    if (!existing || existing.providerSubscriptionId !== subId) throw new HttpsError("not-found", "Subscription not found");
    if (!sameHex(hmac(RAZORPAY_KEY_SECRET.value(), `${payId}|${subId}`), sig)) throw new HttpsError("permission-denied", "Payment could not be verified");
    const sub = await razorpay(`/subscriptions/${subId}`);
    await ref.set({ status: "active", currentPeriodEnd: periodEnd(sub.current_end), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true };
  }

  if (action === "cancel") {
    if (!existing) throw new HttpsError("not-found", "No subscription to cancel");
    if (existing.provider === "razorpay" && existing.providerSubscriptionId) {
      await razorpay(`/subscriptions/${existing.providerSubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
    }
    await ref.set({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true };
  }
  throw new HttpsError("invalid-argument", "Unknown action");
});

const WEBHOOK_STATUS = {
  "subscription.activated": "active", "subscription.charged": "active", "subscription.resumed": "active",
  "subscription.cancelled": "cancelled", "subscription.halted": "halted", "subscription.paused": "halted",
  "subscription.completed": "expired",
};

// Razorpay dashboard -> Webhooks -> URL of this function, same secret as LASTPICK_RAZORPAY_WEBHOOK_SECRET.
exports.lpRazorpayWebhook = onRequest({ secrets: [RAZORPAY_WEBHOOK_SECRET] }, async (req, res) => {
  const sig = req.get("x-razorpay-signature") || "";
  if (!sameHex(hmac(RAZORPAY_WEBHOOK_SECRET.value(), req.rawBody), sig)) { res.status(400).send("invalid signature"); return; }
  const event = req.body || {};
  const status = WEBHOOK_STATUS[event.event];
  const sub = event.payload?.subscription?.entity;
  if (!status || !sub) { res.send("ignored"); return; }
  const patch = { status, updatedAt: FieldValue.serverTimestamp() };
  if (status === "active") patch.currentPeriodEnd = periodEnd(sub.current_end);
  if (status === "expired") patch.currentPeriodEnd = Timestamp.now();

  const found = await db.collection("subscriptions").where("providerSubscriptionId", "==", sub.id).get();
  if (!found.empty) await Promise.all(found.docs.map((d) => d.ref.set(patch, { merge: true })));
  else if (sub.notes?.user_id && PLANS.includes(sub.notes?.plan)) {
    await db.doc(`subscriptions/${sub.notes.user_id}_${sub.notes.plan}`).set({
      userId: sub.notes.user_id, plan: sub.notes.plan, provider: "razorpay", providerSubscriptionId: sub.id, ...patch,
    }, { merge: true });
  }
  res.send("ok");
});

// ---------------------------------------------------------------- admin
// Activate or extend a plan by email, e.g. when a payment was collected outside the app. months = 0 ends it.
exports.lpAdminSetPlan = onCall(async (req) => {
  await needAdmin(req);
  const { email, plan } = req.data || {};
  const months = Math.max(0, Math.min(24, Number(req.data?.months) || 0));
  if (!PLANS.includes(plan)) throw new HttpsError("invalid-argument", "Unknown plan");
  let user;
  try { user = await getAuth().getUserByEmail(String(email || "").trim()); } catch { throw new HttpsError("not-found", "No user with that email"); }
  const ref = db.doc(`subscriptions/${user.uid}_${plan}`);
  const prev = (await ref.get()).data();
  const base = prev && subActive(prev) ? prev.currentPeriodEnd.toMillis() : Date.now();
  await ref.set({
    userId: user.uid, plan, provider: "manual",
    status: months > 0 ? "active" : "expired",
    currentPeriodEnd: Timestamp.fromMillis(months > 0 ? base + months * 30 * 86400000 : Date.now()),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

// ---------------------------------------------------------------- upkeep triggers
exports.lpOnBusinessWrite = onDocumentWritten({ document: "businesses/{ownerId}", database: DB_ID }, async (event) => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  const keys = ["status", "name", "area", "city", "state", "pincode", "lat", "lng"];
  const sameRating = JSON.stringify(before?.rating || null) === JSON.stringify(after?.rating || null);
  if (before && after && sameRating && keys.every((k) => before[k] === after[k])) return;
  await queueOwnerSync(event.params.ownerId);
});

exports.lpOnSubscriptionWrite = onDocumentWritten({ document: "subscriptions/{subId}", database: DB_ID }, async (event) => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  const s = after || before;
  if (!s || s.plan !== "owner") return;
  if (before && after && subActive(before) === subActive(after)) return;
  await queueOwnerSync(s.userId);
});

// Every new account gets a free month from sign-up.
exports.lpOnUserCreate = onDocumentCreated({ document: "users/{uid}", database: DB_ID }, async (event) => {
  const u = event.data?.data();
  if (!u || u.trialEndsAt) return;
  await event.data.ref.set({ trialEndsAt: Timestamp.fromMillis(Date.now() + TRIAL_DAYS * DAY) }, { merge: true });
});

// Hourly: mark plans whose paid period ended as expired (the safety net for webhooks) and refresh city counters.
exports.lpExpirePlans = onSchedule("every 60 minutes", async () => {
  // businesses whose free month just ended: re-check whether their offers stay visible
  const ended = await db.collection("businesses").where("trialEndsAt", ">", Timestamp.fromMillis(Date.now() - 2 * 3600000))
    .where("trialEndsAt", "<=", Timestamp.now()).limit(400).get();
  for (const b of ended.docs) await queueOwnerSync(b.id);
  const due = await db.collection("subscriptions")
    .where("status", "in", ["active", "cancelled"])
    .where("currentPeriodEnd", "<", Timestamp.now())
    .limit(400).get();
  const batch = db.batch();
  due.docs.forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  const cities = await db.collection("cities").select().get();
  for (const c of cities.docs) await refreshCity(c.id);
});

// Keep city counters right when an offer ends or is removed early.
exports.lpOnOfferWrite = onDocumentWritten({ document: "offers/{offerId}", database: DB_ID }, async (event) => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  if (before && after && before.status === after.status && before.visible === after.visible) return;
  const keys = new Set([before?.cityKey, after?.cityKey].filter(Boolean));
  for (const k of keys) await refreshCity(k);
});

// A new report: stamp it with the offer's business and state (so city moderators see it) and count it on the business.
exports.lpOnReportCreate = onDocumentCreated({ document: "reports/{reportId}", database: DB_ID }, async (event) => {
  const r = event.data?.data();
  if (!r?.offerId || r.type === "review") return;
  const offer = (await db.doc(`offers/${r.offerId}`).get()).data();
  if (!offer) return;
  await event.data.ref.set({ businessId: offer.businessId, state: offer.business?.state || "", city: offer.business?.city || "" }, { merge: true });
  await db.doc(`businesses/${offer.businessId}`).set({ reportCount: FieldValue.increment(1) }, { merge: true });
});

// Nightly (02:30 IST): archive ended offers into a compact history and delete old activity, to keep storage small.
async function deleteWhere(q, max = 5000) {
  let total = 0;
  while (total < max) {
    const snap = await q.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}
exports.lpNightlyCleanup = onSchedule({ schedule: "30 2 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 540 }, async () => {
  const now = Date.now();
  const cutoff = Timestamp.fromMillis(now - RETENTION.endedOfferVisibleDays * DAY);
  let archived = 0;
  while (archived < 5000) {
    const snap = await db.collection("offers").where("endsAt", "<", cutoff).limit(200).get();
    if (snap.empty) break;
    const ids = snap.docs.map((d) => d.id);
    const leadCounts = await Promise.all(ids.map((id) => db.collection("leads").where("offerId", "==", id).count().get()));
    const batch = db.batch();
    snap.docs.forEach((d, i) => {
      const o = d.data();
      batch.set(db.doc(`offerArchive/${d.id}`), {
        ownerId: o.ownerId, businessId: o.businessId, businessName: o.business?.name || "", city: o.business?.city || "",
        state: o.business?.state || "", cityKey: o.cityKey || "", title: o.title, category: o.category, emoji: o.emoji || "📦",
        origPrice: o.origPrice, price: o.price, views: o.views || 0, leads: leadCounts[i].data().count,
        status: o.status, createdAt: o.createdAt || null, endsAt: o.endsAt, archivedAt: FieldValue.serverTimestamp(),
      });
      batch.delete(d.ref);
      batch.delete(db.doc(`offerPhotos/${d.id}`));
    });
    await batch.commit();
    archived += snap.size;
  }
  // full-size photos are deleted as soon as an offer ends (the thumbnail stays until the offer is archived)
  let photosDeleted = 0;
  while (photosDeleted < 5000) {
    const snap = await db.collection("offers").where("hasPhoto", "==", true).where("endsAt", "<", Timestamp.now()).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => { batch.delete(db.doc(`offerPhotos/${d.id}`)); batch.update(d.ref, { hasPhoto: false }); });
    await batch.commit();
    photosDeleted += snap.size;
  }
  const t = (days) => Timestamp.fromMillis(now - days * DAY);
  const auditDeleted = await deleteWhere(db.collection("auditLog").where("at", "<", t(RETENTION.auditDays)));
  const ratesDeleted = await deleteWhere(db.collection("rateLimits").where("updatedAt", "<", t(2)));
  await deleteWhere(db.collection("otps").where("expiresAt", "<", Timestamp.now()));
  const deletedAccountsDeleted = await deleteWhere(db.collection("deletedAccounts").where("deletedAt", "<", t(RETENTION.auditDays)));
  const grievancesDeleted = await deleteWhere(db.collection("grievances").where("status", "in", ["resolved", "rejected"]).where("updatedAt", "<", t(RETENTION.closedGrievanceDays)));
  const archiveDeleted = await deleteWhere(db.collection("offerArchive").where("endsAt", "<", t(RETENTION.archiveDays)));
  const leadsDeleted = await deleteWhere(db.collection("leads").where("createdAt", "<", t(RETENTION.leadsDays)));
  const contactsDeleted = await deleteWhere(db.collection("customerContacts").where("at", "<", t(RETENTION.contactsDays)));
  const oldReports = await db.collection("reports").where("createdAt", "<", t(RETENTION.reportsDays)).limit(400).get();
  const rb = db.batch(); let reportsDeleted = 0;
  oldReports.docs.forEach((d) => { if (d.data().status !== "open") { rb.delete(d.ref); reportsDeleted++; } });
  await rb.commit();
  console.log(JSON.stringify({ message: "nightly cleanup", archived, photosDeleted, archiveDeleted, leadsDeleted, contactsDeleted, reportsDeleted, auditDeleted, ratesDeleted, deletedAccountsDeleted, grievancesDeleted }));
});

// ---------------------------------------------------------------- admin & moderator tools
const ACTIVE_SUB = (plan) => db.collection("subscriptions").where("plan", "==", plan)
  .where("status", "in", ["active", "cancelled"]).where("currentPeriodEnd", ">", Timestamp.now());

exports.lpAdminStats = onCall(async (req) => {
  const me = await staff(req);
  const count = async (q) => (await q.count().get()).data().count;
  const since30 = Timestamp.fromMillis(Date.now() - 30 * DAY);
  const [users, verified, pending, suspended, customers, owners, leads30, openReports, archived, openGrievances, reviews] = await Promise.all([
    count(db.collection("users")),
    count(db.collection("businesses").where("status", "==", "verified")),
    count(db.collection("businesses").where("status", "==", "pending")),
    count(db.collection("businesses").where("status", "==", "suspended")),
    count(ACTIVE_SUB("customer")), count(ACTIVE_SUB("owner")),
    count(db.collection("leads").where("createdAt", ">", since30)),
    count(db.collection("reports").where("status", "==", "open")),
    count(db.collection("offerArchive")),
    count(db.collection("grievances").where("status", "in", ["open", "acknowledged"])),
    count(db.collection("reviews").where("status", "==", "published")),
  ]);
  const cities = (await db.collection("cities").orderBy("liveOffers", "desc").limit(300).get()).docs
    .map((d) => ({ key: d.id, ...d.data(), updatedAt: undefined }))
    .filter((c) => me.canSee(c.state));
  const liveOffers = cities.reduce((n, c) => n + (c.liveOffers || 0), 0);
  return {
    role: me.role, regions: me.regions, freeMode: await freeMode(),
    totals: { users, verified, pending, suspended, customers, owners, leads30, openReports, archived, liveOffers, openGrievances: me.role === "admin" ? openGrievances : null, reviews },
    cities,
  };
});

exports.lpAdminFindUsers = onCall(async (req) => {
  await staff(req, { superOnly: true });
  const q = str(req.data?.q, 80);
  let docs = [];
  if (!q) docs = (await db.collection("users").orderBy("createdAt", "desc").limit(50).get()).docs;
  else if (q.includes("@")) {
    try { const u = await getAuth().getUserByEmail(q); const d = await db.doc(`users/${u.uid}`).get(); if (d.exists) docs = [d]; } catch { /* none */ }
  } else if (/\d{6,}/.test(q.replace(/\D/g, ""))) {
    const d = q.replace(/\D/g, "").slice(-10);
    docs = (await db.collection("users").where("phone", "==", "+91" + d).limit(20).get()).docs;
  } else {
    const name = q[0].toUpperCase() + q.slice(1);
    docs = (await db.collection("users").orderBy("name").startAt(name).endAt(name + "\uf8ff").limit(30).get()).docs;
  }
  return Promise.all(docs.map(async (d) => {
    const u = d.data();
    const [c, o, b] = await Promise.all([
      db.doc(`subscriptions/${d.id}_customer`).get(), db.doc(`subscriptions/${d.id}_owner`).get(), db.doc(`businesses/${d.id}`).get(),
    ]);
    const sub = (s) => s.exists ? { status: s.data().status, until: s.data().currentPeriodEnd?.toMillis() || null, active: subActive(s.data()) } : null;
    return {
      id: d.id, name: u.name || "", phone: u.phone || "", email: u.email || "", role: u.role || "user", regions: u.regions || [],
      createdAt: u.createdAt?.toMillis?.() || null, customer: sub(c), owner: sub(o),
      business: b.exists ? { name: b.data().name, city: b.data().city, state: b.data().state, status: b.data().status } : null,
    };
  }));
});

// Set someone's role: "user", "moderator" (with regions = list of states) or "admin".
exports.lpAdminSetRole = onCall(async (req) => {
  const me = await needAdmin(req);
  const { email, role } = req.data || {};
  if (!["user", "moderator", "admin"].includes(role)) throw new HttpsError("invalid-argument", "Unknown role");
  let user;
  try { user = await getAuth().getUserByEmail(String(email || "").trim()); } catch { throw new HttpsError("not-found", "No user with that email"); }
  if (user.uid === me && role !== "admin") throw new HttpsError("failed-precondition", "You can't remove your own admin access");
  const regions = role === "moderator" ? (Array.isArray(req.data.regions) ? req.data.regions.map((r) => str(r, 60)).filter(Boolean) : []) : [];
  await db.doc(`users/${user.uid}`).set({ role, regions }, { merge: true });
  audit("admin_role", { actor: me, target: user.uid, role, regions });
  return { ok: true };
});

exports.lpAdminListBusinesses = onCall(async (req) => {
  const me = await staff(req);
  const status = ["pending", "verified", "rejected", "suspended"].includes(req.data?.status) ? req.data.status : null;
  const state = str(req.data?.state, 60);
  let q = db.collection("businesses");
  if (status) q = q.where("status", "==", status);
  if (state) q = q.where("state", "==", state);
  const snap = await q.orderBy("createdAt", "desc").limit(200).get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => me.canSee(b.state));
  const contacts = await Promise.all(list.map((b) => db.doc(`businessContacts/${b.id}`).get()));
  const phones = contacts.map((c) => c.data()?.phone || "");
  return list.map((b, i) => {
    const dupes = phones.filter((p) => p && p === phones[i]).length;
    const flags = [];
    if ((b.reportCount || 0) >= 2) flags.push(`Reported ${b.reportCount}×`);
    if (dupes > 1) flags.push("Same phone as another business");
    if (b.createdAt && Date.now() - b.createdAt.toMillis() < 2 * DAY) flags.push("New in last 48 h");
    if (b.categoriesChangedAt && Date.now() - b.categoriesChangedAt.toMillis() < 7 * DAY) flags.push("Changed categories this week");
    return {
      id: b.id, name: b.name, category: b.category, categories: b.categories?.length ? b.categories : [b.category], rating: b.rating || null, address: b.address || "", area: b.area || "", city: b.city || "", state: b.state || "",
      lat: b.lat ?? null, lng: b.lng ?? null, status: b.status, statusNote: b.statusNote || "", reportCount: b.reportCount || 0,
      createdAt: b.createdAt?.toMillis?.() || null, phone: phones[i], flags,
    };
  });
});

exports.lpAdminSetBusinessStatus = onCall(async (req) => {
  const me = await staff(req);
  const { businessId, status } = req.data || {};
  if (!["pending", "verified", "rejected", "suspended"].includes(status)) throw new HttpsError("invalid-argument", "Unknown status");
  const ref = db.doc(`businesses/${businessId}`);
  const b = (await ref.get()).data();
  if (!b) throw new HttpsError("not-found", "Business not found");
  if (!me.canSee(b.state)) throw new HttpsError("permission-denied", "This business is outside your region");
  const patch = { status, statusNote: str(req.data.note, 300), reviewedBy: me.uid, reviewedAt: FieldValue.serverTimestamp() };
  // the business's free month starts the first time it is verified
  if (status === "verified" && !b.trialEndsAt) patch.trialEndsAt = Timestamp.fromMillis(Date.now() + TRIAL_DAYS * DAY);
  await ref.update(patch);
  audit("admin_business_status", { actor: me.uid, businessId, status });
  return { ok: true };
});

exports.lpAdminListReports = onCall(async (req) => {
  const me = await staff(req);
  const snap = await db.collection("reports").where("status", "==", "open").orderBy("createdAt", "desc").limit(200).get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => me.canSee(r.state));
  const offers = await Promise.all(list.map((r) => r.offerId ? db.doc(`offers/${r.offerId}`).get() : null));
  const reviews = await Promise.all(list.map((r) => r.reviewId ? db.doc(`reviews/${r.reviewId}`).get() : null));
  const bizNames = await Promise.all(list.map((r) => r.reviewId && r.businessId ? db.doc(`businesses/${r.businessId}`).get() : null));
  return list.map((r, i) => {
    const o = offers[i]?.data(), rv = reviews[i]?.data();
    return {
      id: r.id, type: r.type || "offer", reason: r.reason, details: r.details || "", status: r.status, createdAt: r.createdAt?.toMillis?.() || null,
      city: r.city || "", state: r.state || "",
      offer: o ? { id: offers[i].id, title: o.title, status: o.status, business: { name: o.business?.name || "", city: o.business?.city || "" } } : null,
      review: rv ? { id: reviews[i].id, name: rv.name, rating: rv.rating, text: rv.text, status: rv.status, businessName: bizNames[i]?.data()?.name || "" } : null,
    };
  });
});

exports.lpAdminResolveReport = onCall(async (req) => {
  const me = await staff(req);
  const { reportId, status, removeOffer } = req.data || {};
  if (!["dismissed", "actioned"].includes(status)) throw new HttpsError("invalid-argument", "Unknown status");
  const ref = db.doc(`reports/${reportId}`);
  const r = (await ref.get()).data();
  if (!r) throw new HttpsError("not-found", "Report not found");
  if (!me.canSee(r.state)) throw new HttpsError("permission-denied", "This report is outside your region");
  if (removeOffer && r.offerId) await db.doc(`offers/${r.offerId}`).set({ status: "removed" }, { merge: true });
  if (removeOffer && r.reviewId) await db.doc(`reviews/${r.reviewId}`).set({ status: "hidden", hiddenBy: me.uid }, { merge: true });
  await ref.update({ status, resolvedBy: me.uid, resolvedAt: FieldValue.serverTimestamp() });
  audit("admin_report", { actor: me.uid, reportId, status, removed: !!removeOffer });
  return { ok: true };
});

// Switch payments on/off for everyone. Re-syncs every owner's offer visibility afterwards.
exports.lpAdminSetConfig = onCall({ timeoutSeconds: 300 }, async (req) => {
  await needAdmin(req);
  const free = req.data?.freeMode !== false;
  await db.doc("config/app").set({ freeMode: free, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  cfgCache = { at: Date.now(), freeMode: free };
  const owners = await db.collection("businesses").select().get();
  for (const b of owners.docs) await queueOwnerSync(b.id);
  audit("admin_config", { actor: req.auth.uid, freeMode: free });
  return { freeMode: free, businesses: owners.size };
});

// ---------------------------------------------------------------- queue workers (Cloud Tasks)
// Re-sync one owner's offers (visibility, business details, rating). Retried automatically on failure.
exports.lpSyncOwnerTask = onTaskDispatched({
  retryConfig: { maxAttempts: 5, minBackoffSeconds: 30 },
  rateLimits: { maxConcurrentDispatches: 6 },
}, async (req) => {
  if (typeof req.data?.ownerId === "string") await syncOwnerOffers(req.data.ownerId);
});

// Removes everything left of a deleted account (the account itself is deleted right away by lpDeleteMyAccount).
exports.lpPurgeUserTask = onTaskDispatched({
  retryConfig: { maxAttempts: 5, minBackoffSeconds: 60 },
  rateLimits: { maxConcurrentDispatches: 2 },
  timeoutSeconds: 540,
}, async (req) => {
  if (typeof req.data?.uid === "string") await purgeUser(req.data.uid);
});

// ---------------------------------------------------------------- reviews
// Only a customer who viewed the number of, called, messaged or shared their number with a business
// through LastPick can review it ("Contacted via LastPick"). One review per customer per business, editable.
// Owners can reply but can't delete reviews; admins/moderators hide reviews that break the rules (IS 19000:2022).
async function contactedBusiness(uid, businessId) {
  const [c, l] = await Promise.all([
    db.collection("customerContacts").where("customerId", "==", uid).where("businessId", "==", businessId).limit(1).get(),
    db.collection("leads").where("customerId", "==", uid).where("businessId", "==", businessId).limit(1).get(),
  ]);
  if (!c.empty) return c.docs[0].data().offer?.title || "";
  if (!l.empty) return l.docs[0].data().offerTitle || "";
  return null;
}

exports.lpSubmitReview = onCall(async (req) => {
  const uid = needAuth(req);
  const businessId = str(req.data?.businessId, 128);
  const rating = Math.round(Number(req.data?.rating));
  const text = str(req.data?.text, 500);
  if (!businessId) throw new HttpsError("invalid-argument", "Missing business");
  if (!(rating >= 1 && rating <= 5)) throw new HttpsError("invalid-argument", "Pick 1 to 5 stars");
  if (hasContactInfo(text)) throw new HttpsError("invalid-argument", "Please don't include phone numbers, e-mails or links in a review");
  if (businessId === uid) throw new HttpsError("failed-precondition", "You can't review your own business");
  const biz = await db.doc(`businesses/${businessId}`).get();
  if (!biz.exists) throw new HttpsError("not-found", "Business not found");
  const offerTitle = await contactedBusiness(uid, businessId);
  if (offerTitle === null) throw new HttpsError("failed-precondition", "You can review a business after you contact it through LastPick");
  await rateLimit(uid, "review", 10, 86400);
  const user = (await db.doc(`users/${uid}`).get()).data() || {};
  const ref = db.doc(`reviews/${businessId}_${uid}`);
  const prev = (await ref.get()).data();
  await ref.set({
    businessId, customerId: uid, name: firstName(user.name), rating, text, offerTitle: str(offerTitle, 120), verified: true,
    status: prev?.status === "hidden" ? "hidden" : "published", reportCount: prev?.reportCount || 0, reply: prev?.reply || null,
    state: biz.data().state || "", edited: !!prev,
    createdAt: prev?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  audit("review", { actor: uid, businessId, rating, edited: !!prev });
  return { ok: true, hidden: prev?.status === "hidden" };
});

exports.lpReplyReview = onCall(async (req) => {
  const uid = needAuth(req);
  const ref = db.doc(`reviews/${str(req.data?.reviewId, 300)}`);
  const r = (await ref.get()).data();
  if (!r || r.businessId !== uid) throw new HttpsError("permission-denied", "Only the business owner can reply");
  const text = str(req.data?.text, 500);
  if (hasContactInfo(text)) throw new HttpsError("invalid-argument", "Please don't include phone numbers, e-mails or links in a reply");
  await rateLimit(uid, "reply", 50, 86400);
  await ref.update({ reply: text ? { text, at: Timestamp.now() } : null });
  return { ok: true };
});

exports.lpReportReview = onCall(async (req) => {
  const uid = needAuth(req);
  const reviewId = str(req.data?.reviewId, 300);
  const ref = db.doc(`reviews/${reviewId}`);
  const r = (await ref.get()).data();
  if (!r) throw new HttpsError("not-found", "Review not found");
  await rateLimit(uid, "report", 20, 86400);
  const dup = await db.collection("reports").where("reviewId", "==", reviewId).where("reporterId", "==", uid).limit(1).get();
  if (!dup.empty) return { ok: true };
  await db.collection("reports").add({
    type: "review", reviewId, businessId: r.businessId, state: r.state || "", city: "", reporterId: uid,
    reason: str(req.data?.reason, 80) || "Breaks the rules", details: str(req.data?.details, 500), status: "open", createdAt: FieldValue.serverTimestamp(),
  });
  await ref.update({ reportCount: FieldValue.increment(1) });
  return { ok: true };
});

// Keep the business rating (average of published reviews) up to date; offers copy it via syncOwnerOffers.
exports.lpOnReviewWrite = onDocumentWritten({ document: "reviews/{reviewId}", database: DB_ID }, async (event) => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  const r = after || before;
  if (!r) return;
  if (before && after && before.rating === after.rating && before.status === after.status) return;
  const agg = await db.collection("reviews").where("businessId", "==", r.businessId).where("status", "==", "published")
    .aggregate({ n: AggregateField.count(), avg: AggregateField.average("rating") }).get();
  const { n, avg } = agg.data();
  const biz = db.doc(`businesses/${r.businessId}`);
  if (!(await biz.get()).exists) return;
  await biz.update({ rating: { avg: n ? Math.round(avg * 10) / 10 : 0, count: n } });
});

// ---------------------------------------------------------------- privacy: consent, export, deletion
// Consent is recorded server-side with the notice version, so we can show who agreed to what and when.
exports.lpRecordConsent = onCall(async (req) => {
  const uid = needAuth(req);
  const kind = req.data?.kind === "partner" ? "partner" : "user";
  if (req.data?.version !== CONSENT_VERSION) throw new HttpsError("failed-precondition", "Please update the app to see the latest privacy notice");
  if (kind === "user" && req.data?.adult !== true) throw new HttpsError("invalid-argument", "You must be 18 or older to use LastPick");
  const items = Array.isArray(req.data?.items) ? req.data.items.map((x) => str(x, 60)).filter(Boolean).slice(0, 10) : [];
  await db.collection("consentLog").add({
    userId: uid, kind, version: CONSENT_VERSION, items, at: FieldValue.serverTimestamp(),
    userAgent: str(req.rawRequest?.headers?.["user-agent"], 200),
  });
  await db.doc(`users/${uid}`).set({ [kind === "partner" ? "partnerConsent" : "consent"]: { version: CONSENT_VERSION, at: FieldValue.serverTimestamp() } }, { merge: true });
  return { ok: true, version: CONSENT_VERSION };
});

// Plain JSON copy of everything we hold about the user (right to access, DPDP Act s.11).
function plain(v) {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
exports.lpExportMyData = onCall(async (req) => {
  const uid = needAuth(req);
  await rateLimit(uid, "export", 5, 86400);
  const one = async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const many = async (q) => (await q.limit(1000).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [profile, business, businessContact, subCustomer, subOwner, offers, offerHistory, contacts, numbersShared, leadsReceived, reviewsWritten, reviewsOfMyBusiness, grievances, consents] = await Promise.all([
    one(`users/${uid}`), one(`businesses/${uid}`), one(`businessContacts/${uid}`), one(`subscriptions/${uid}_customer`), one(`subscriptions/${uid}_owner`),
    many(db.collection("offers").where("ownerId", "==", uid)), many(db.collection("offerArchive").where("ownerId", "==", uid)),
    many(db.collection("customerContacts").where("customerId", "==", uid)), many(db.collection("leads").where("customerId", "==", uid)),
    many(db.collection("leads").where("ownerId", "==", uid)), many(db.collection("reviews").where("customerId", "==", uid)),
    many(db.collection("reviews").where("businessId", "==", uid)), many(db.collection("grievances").where("userId", "==", uid)),
    many(db.collection("consentLog").where("userId", "==", uid)),
  ]);
  offers.forEach((o) => { delete o.photoThumb; });
  contacts.forEach((c) => { if (c.offer) delete c.offer.photoThumb; });
  audit("data_export", { actor: uid });
  return plain({
    exportedAt: new Date(), app: "LastPick", account: { uid, email: req.auth.token?.email || profile?.email || "" },
    profile, business, businessContact, subscriptions: [subCustomer, subOwner].filter(Boolean), offers, offerHistory, contacts, numbersShared,
    leadsReceived, reviewsWritten, reviewsOfMyBusiness, grievances, consents,
  });
});

async function deleteDocs(q) {
  let n = 0;
  for (;;) {
    const snap = await q.limit(300).get();
    if (snap.empty) return n;
    const batch = db.batch();
    snap.docs.forEach((d) => { batch.delete(d.ref); if (d.ref.parent.id === "offers") batch.delete(db.doc(`offerPhotos/${d.id}`)); });
    await batch.commit();
    n += snap.size;
  }
}
async function purgeUser(uid) {
  const biz = (await db.doc(`businesses/${uid}`).get()).data();
  const counts = {
    offers: await deleteDocs(db.collection("offers").where("ownerId", "==", uid)),
    archive: await deleteDocs(db.collection("offerArchive").where("ownerId", "==", uid)),
    contacts: await deleteDocs(db.collection("customerContacts").where("customerId", "==", uid)),
    leadsShared: await deleteDocs(db.collection("leads").where("customerId", "==", uid)),
    leadsReceived: await deleteDocs(db.collection("leads").where("ownerId", "==", uid)),
    reviewsWritten: await deleteDocs(db.collection("reviews").where("customerId", "==", uid)),
    reviewsReceived: await deleteDocs(db.collection("reviews").where("businessId", "==", uid)),
  };
  await Promise.all([`users/${uid}`, `businesses/${uid}`, `businessContacts/${uid}`, `subscriptions/${uid}_customer`, `subscriptions/${uid}_owner`, `rateLimits/${uid}`]
    .map((p) => db.doc(p).delete()));
  if (biz?.city) await refreshCity(cityKey(biz.city));
  console.log(JSON.stringify({ message: "account purged", uid, ...counts }));
}

// Delete my account (Google Play requires this in the app and on the web). Withdrawing consent = deleting the account.
// Kept afterwards, for 1 year only (DPDP Rules 2025 rule 8(3)): the audit log, consent records, open complaints.
exports.lpDeleteMyAccount = onCall({ timeoutSeconds: 300 }, async (req) => {
  const uid = needAuth(req);
  if (req.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Type DELETE to confirm");
  const u = (await db.doc(`users/${uid}`).get()).data() || {};
  if (["admin", "moderator"].includes(u.role)) throw new HttpsError("failed-precondition", "Staff accounts must have their admin role removed by another admin before they can be deleted");
  const email = req.auth.token?.email || u.email || "";
  await db.doc(`deletedAccounts/${uid}`).set({
    deletedAt: FieldValue.serverTimestamp(), emailHash: crypto.createHash("sha256").update(email.toLowerCase()).digest("hex"),
    hadBusiness: (await db.doc(`businesses/${uid}`).get()).exists,
  });
  audit("account_deleted", { actor: uid });
  // hide the business and its offers immediately, then delete the login; the rest is purged by the queue
  await db.doc(`users/${uid}`).delete();
  const biz = db.doc(`businesses/${uid}`);
  if ((await biz.get()).exists) await biz.update({ status: "suspended", statusNote: "Account deleted" });
  try { await getAuth().deleteUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  if (!(await enqueue("lpPurgeUserTask", { uid }, 10))) await purgeUser(uid);
  return { ok: true };
});

// ---------------------------------------------------------------- grievances (IT Rules 2021, Consumer Protection (E-Commerce) Rules 2020)
// Every complaint gets a ticket number. We acknowledge within 24 hours and resolve within 15 days.
const GRIEVANCE_TYPES = ["Offer or business", "My account or data (privacy)", "A review", "Payments or plans", "Something else"];
exports.lpSubmitGrievance = onCall(async (req) => {
  const uid = needAuth(req);
  await rateLimit(uid, "grievance", 5, 86400);
  const subject = str(req.data?.subject, 120), details = str(req.data?.details, 2000);
  const type = GRIEVANCE_TYPES.includes(req.data?.type) ? req.data.type : "Something else";
  if (subject.length < 3 || details.length < 10) throw new HttpsError("invalid-argument", "Please add a subject and some details");
  const ticket = "LP" + Date.now().toString(36).toUpperCase().slice(-6) + crypto.randomInt(10, 99);
  const now = Date.now();
  await db.doc(`grievances/${ticket}`).set({
    ticket, userId: uid, email: req.auth.token?.email || "", type, subject, details, status: "open", reply: "",
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    ackDue: Timestamp.fromMillis(now + DAY), resolveDue: Timestamp.fromMillis(now + 15 * DAY),
  });
  audit("grievance", { actor: uid, ticket });
  return { ticket };
});

exports.lpAdminListGrievances = onCall(async (req) => {
  await needAdmin(req);
  const status = ["open", "acknowledged", "resolved", "rejected"].includes(req.data?.status) ? req.data.status : "open";
  const snap = await db.collection("grievances").where("status", "==", status).orderBy("createdAt", "desc").limit(200).get();
  return snap.docs.map((d) => plain({ id: d.id, ...d.data() }));
});

exports.lpAdminUpdateGrievance = onCall(async (req) => {
  const me = await needAdmin(req);
  const status = req.data?.status;
  if (!["acknowledged", "resolved", "rejected"].includes(status)) throw new HttpsError("invalid-argument", "Unknown status");
  const ref = db.doc(`grievances/${str(req.data?.ticket, 40)}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Ticket not found");
  await ref.update({ status, reply: str(req.data?.reply, 2000), handledBy: me, updatedAt: FieldValue.serverTimestamp() });
  audit("admin_grievance", { actor: me, ticket: ref.id, status });
  return { ok: true };
});

// ---------------------------------------------------------------- monitoring
// Crashes in the app are sent here and show up in Google Cloud Error Reporting / Logging (filter: source="client").
exports.lpLogClientError = onCall({ maxInstances: 3 }, async (req) => {
  const d = req.data || {};
  console.error(JSON.stringify({
    severity: "ERROR", source: "client", message: `Client error: ${str(d.message, 500)}`, stack_trace: str(d.stack, 3000),
    url: str(d.url, 300), app: str(d.app, 20), version: str(d.version, 20), uid: req.auth?.uid || null,
  }));
  return { ok: true };
});

// ---------------------------------------------------------------- one-time-code login
// Mobile: the app verifies the number with Firebase phone auth (SMS), then calls lpCompletePhoneLogin, which links it
// to an existing account with the same number (e.g. one made with e-mail + password) instead of creating a duplicate.
// E-mail: lpSendEmailOtp mails a 6-digit code; lpVerifyEmailOtp checks it and returns a sign-in token for the account.
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

async function accountForEmail(email) {
  try { return (await getAuth().getUserByEmail(email)).uid; } catch { /* not an auth e-mail */ }
  const byProfile = await db.collection("users").where("email", "==", email).limit(1).get();
  return byProfile.empty ? null : byProfile.docs[0].id;
}

exports.lpSendEmailOtp = onCall({ secrets: [SMTP_URL] }, async (req) => {
  const email = normEmail(req.data?.email);
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Please enter a valid e-mail address");
  const ip = req.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req.rawRequest?.ip || "unknown";
  await rateLimit("ip_" + sha(ip).slice(0, 24), "otpSend", 20, 3600);
  const ref = db.doc(`otps/${sha("email:" + email)}`);
  const prev = (await ref.get()).data();
  const now = Date.now();
  if (prev && now - prev.sentAt.toMillis() < 30000) throw new HttpsError("resource-exhausted", "Please wait 30 seconds before asking for a new code");
  const windowStart = prev && now - prev.windowStart.toMillis() < 3600000 ? prev.windowStart.toMillis() : now;
  const sends = prev && windowStart === prev.windowStart.toMillis() ? prev.sends + 1 : 1;
  if (sends > 5) throw new HttpsError("resource-exhausted", "Too many codes. Try again in an hour, or use your mobile number");
  if (!SMTP_URL.value() || SMTP_URL.value() === "unset") throw new HttpsError("failed-precondition", "E-mail codes aren't switched on yet. Please use your mobile number.");
  const code = String(crypto.randomInt(100000, 1000000));
  await ref.set({
    kind: "email", codeHash: sha(code + ":" + email), attempts: 0, sends, windowStart: Timestamp.fromMillis(windowStart),
    sentAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 10 * 60000),
  });
  const nodemailer = require("nodemailer");
  await nodemailer.createTransport(SMTP_URL.value()).sendMail({
    from: MAIL_FROM.value(), to: email, subject: `${code} is your LastPick code`,
    text: `Your LastPick code is ${code}. It expires in 10 minutes.\n\nNever share this code. LastPick and businesses will never ask for it.\nIf you didn't ask for it, ignore this e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16171D"><p>Your LastPick code is</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p><p>It expires in 10 minutes. Never share this code. LastPick and businesses will never ask for it.</p><p style="color:#5E6070;font-size:13px">If you didn't ask for this code, you can ignore this e-mail.</p></div>`,
  });
  return { ok: true };
});

exports.lpVerifyEmailOtp = onCall(async (req) => {
  const email = normEmail(req.data?.email);
  const code = String(req.data?.code || "").replace(/\D/g, "");
  if (!validEmail(email) || code.length !== 6) throw new HttpsError("invalid-argument", "Enter the 6-digit code");
  const ref = db.doc(`otps/${sha("email:" + email)}`);
  const d = (await ref.get()).data();
  if (!d || d.expiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "This code has expired. Ask for a new one.");
  if (d.attempts >= 5) { await ref.delete(); throw new HttpsError("resource-exhausted", "Too many wrong tries. Ask for a new code."); }
  if (!sameHex(sha(code + ":" + email), d.codeHash)) {
    await ref.update({ attempts: FieldValue.increment(1) });
    throw new HttpsError("permission-denied", "That code is not right. Check it and try again.");
  }
  await ref.delete();
  let uid = await accountForEmail(email);
  if (uid) { try { await getAuth().updateUser(uid, { emailVerified: true }); } catch { /* profile-only e-mail */ } }
  else uid = (await getAuth().createUser({ email, emailVerified: true })).uid;
  const isNew = !(await db.doc(`users/${uid}`).get()).exists;
  audit("login_email_otp", { actor: uid, isNew });
  return { token: await getAuth().createCustomToken(uid), isNew };
});

exports.lpCompletePhoneLogin = onCall(async (req) => {
  const uid = needAuth(req);
  const phone = req.auth.token?.phone_number;
  if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) throw new HttpsError("failed-precondition", "Please verify an Indian mobile number (+91)");
  if ((await db.doc(`users/${uid}`).get()).exists) { audit("login_phone_otp", { actor: uid }); return { isNew: false }; }
  // an older account (e.g. e-mail + password) with this number in its profile: sign in to that one instead
  const existing = await db.collection("users").where("phone", "==", phone).limit(2).get();
  const other = existing.docs.find((d) => d.id !== uid);
  if (other) {
    await getAuth().deleteUser(uid); // the temporary phone-only login
    try { await getAuth().updateUser(other.id, { phoneNumber: phone }); } catch (e) { console.warn("link phone", e.message); }
    audit("login_phone_otp", { actor: other.id, linked: true });
    return { token: await getAuth().createCustomToken(other.id), isNew: false };
  }
  audit("login_phone_otp", { actor: uid, isNew: true });
  return { isNew: true };
});
