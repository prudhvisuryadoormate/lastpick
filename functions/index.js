// LastPick Cloud Functions (Firebase, 2nd gen, Node 22).
// - Number exchange: revealContact, logContact, shareNumber
// - Offers: createOffer (server checks the owner's plan and business)
// - Billing: Razorpay subscriptions (billing) + razorpayWebhook for renewals
// - Admin: plans, roles (admin / city moderators), business verification, reports, India-wide stats, user search
// - Upkeep: offer visibility sync, per-city counters, hourly plan expiry, nightly archive + cleanup
const crypto = require("crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
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
async function planActive(uid, plan) {
  if (await freeMode()) return true;
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
});
const DAY = 86400000;
// keep in sync with RETENTION in src/lib/config.js
const RETENTION = { endedOfferVisibleDays: 7, archiveDays: 365, leadsDays: 180, contactsDays: 180, reportsDays: 365 };
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
// business verified AND Owner Pro active. Also refresh the business details copied onto offers.
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
  if (!(await planActive(uid, "owner"))) throw new HttpsError("permission-denied", "An active Owner Pro subscription is needed to post offers");
  const contact = await db.doc(`businessContacts/${uid}`).get();
  if (!contact.exists) throw new HttpsError("failed-precondition", "Add your contact number in Business profile first");
  if (!b.city || !b.state || !b.pincode) throw new HttpsError("failed-precondition", "Add your city, state and pincode in Business profile first");

  const title = str(d.title, 120);
  const origPrice = Number(d.origPrice), price = Number(d.price), endsAt = Number(d.endsAt);
  if (title.length < 3) throw new HttpsError("invalid-argument", "Title is too short");
  if (!(origPrice > 0) || !(price >= 0) || !(price < origPrice)) throw new HttpsError("invalid-argument", "Offer price must be lower than the normal price");
  if (!(endsAt > Date.now()) || endsAt > Date.now() + MAX_OFFER_MS + 60000) throw new HttpsError("invalid-argument", "Offers can run for up to 30 days");
  // photo: a small thumbnail lives on the offer (for lists); the full photo lives in offerPhotos/{id} (opened on demand)
  const photoThumb = isDataImage(d.photoThumb, 30000) ? d.photoThumb : null;
  const photo = isDataImage(d.photo, 200000) ? d.photo : null;
  const discount = 1 - price / origPrice;
  const business = bizSummary(b);

  const ref = db.collection("offers").doc();
  const batch = db.batch();
  batch.set(ref, {
    ownerId: uid, businessId: uid, business, cityKey: business.cityKey, pincode: business.pincode, geohash: business.geohash,
    title, description: str(d.description, 1000), category: str(d.category, 30) || "other", emoji: str(d.emoji, 8) || "📦",
    photoThumb, hasPhoto: !!photo, origPrice, price, quantity: str(d.quantity, 60),
    endsAt: Timestamp.fromMillis(endsAt), status: "live", visible: b.status === "verified", views: 0,
    flags: discount >= 0.9 ? ["very-high-discount"] : [],
    createdAt: FieldValue.serverTimestamp(),
  });
  if (photo) batch.set(db.doc(`offerPhotos/${ref.id}`), { ownerId: uid, data: photo, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await refreshCity(business.cityKey);
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
    await ref.set({ customerId: uid, offerId: o.id, how: prev.exists ? prev.data().how : "Viewed number", at: FieldValue.serverTimestamp(), offer: offerSummary(o) }, { merge: true });
  }
  return { phone: c.data().phone, whatsapp: c.data().whatsapp !== false };
});

exports.lpLogContact = onCall(async (req) => {
  const uid = needAuth(req);
  if (!(await planActive(uid, "customer"))) return { ok: false };
  const o = await getOffer(req.data?.offerId);
  if (o.ownerId === uid) return { ok: false };
  await db.doc(`customerContacts/${uid}_${o.id}`).set({
    customerId: uid, offerId: o.id, how: str(req.data?.how, 40) || "Contacted", at: FieldValue.serverTimestamp(), offer: offerSummary(o),
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
  await leadRef.set({
    offerId: o.id, businessId: o.businessId, ownerId: o.ownerId, customerId: uid,
    name: user.name || "Customer", phone: user.phone, offerTitle: o.title, offerEmoji: o.emoji || "📦",
    status: prev.exists ? prev.data().status : "new",
    createdAt: prev.exists ? prev.data().createdAt : FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.doc(`customerContacts/${uid}_${o.id}`).set({
    customerId: uid, offerId: o.id, how: "Shared my number", at: FieldValue.serverTimestamp(), offer: offerSummary(o),
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
  if (before && after && keys.every((k) => before[k] === after[k])) return;
  await syncOwnerOffers(event.params.ownerId);
});

exports.lpOnSubscriptionWrite = onDocumentWritten({ document: "subscriptions/{subId}", database: DB_ID }, async (event) => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  const s = after || before;
  if (!s || s.plan !== "owner") return;
  if (before && after && subActive(before) === subActive(after)) return;
  await syncOwnerOffers(s.userId);
});

// Hourly: mark plans whose paid period ended as expired (the safety net for webhooks) and refresh city counters.
exports.lpExpirePlans = onSchedule("every 60 minutes", async () => {
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
  if (!r?.offerId) return;
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
  const t = (days) => Timestamp.fromMillis(now - days * DAY);
  const archiveDeleted = await deleteWhere(db.collection("offerArchive").where("endsAt", "<", t(RETENTION.archiveDays)));
  const leadsDeleted = await deleteWhere(db.collection("leads").where("createdAt", "<", t(RETENTION.leadsDays)));
  const contactsDeleted = await deleteWhere(db.collection("customerContacts").where("at", "<", t(RETENTION.contactsDays)));
  const oldReports = await db.collection("reports").where("createdAt", "<", t(RETENTION.reportsDays)).limit(400).get();
  const rb = db.batch(); let reportsDeleted = 0;
  oldReports.docs.forEach((d) => { if (d.data().status !== "open") { rb.delete(d.ref); reportsDeleted++; } });
  await rb.commit();
  console.log(JSON.stringify({ archived, archiveDeleted, leadsDeleted, contactsDeleted, reportsDeleted }));
});

// ---------------------------------------------------------------- admin & moderator tools
const ACTIVE_SUB = (plan) => db.collection("subscriptions").where("plan", "==", plan)
  .where("status", "in", ["active", "cancelled"]).where("currentPeriodEnd", ">", Timestamp.now());

exports.lpAdminStats = onCall(async (req) => {
  const me = await staff(req);
  const count = async (q) => (await q.count().get()).data().count;
  const since30 = Timestamp.fromMillis(Date.now() - 30 * DAY);
  const [users, verified, pending, suspended, customers, owners, leads30, openReports, archived] = await Promise.all([
    count(db.collection("users")),
    count(db.collection("businesses").where("status", "==", "verified")),
    count(db.collection("businesses").where("status", "==", "pending")),
    count(db.collection("businesses").where("status", "==", "suspended")),
    count(ACTIVE_SUB("customer")), count(ACTIVE_SUB("owner")),
    count(db.collection("leads").where("createdAt", ">", since30)),
    count(db.collection("reports").where("status", "==", "open")),
    count(db.collection("offerArchive")),
  ]);
  const cities = (await db.collection("cities").orderBy("liveOffers", "desc").limit(300).get()).docs
    .map((d) => ({ key: d.id, ...d.data(), updatedAt: undefined }))
    .filter((c) => me.canSee(c.state));
  const liveOffers = cities.reduce((n, c) => n + (c.liveOffers || 0), 0);
  return {
    role: me.role, regions: me.regions, freeMode: await freeMode(),
    totals: { users, verified, pending, suspended, customers, owners, leads30, openReports, archived, liveOffers },
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
    return {
      id: b.id, name: b.name, category: b.category, address: b.address || "", area: b.area || "", city: b.city || "", state: b.state || "",
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
  await ref.update({ status, statusNote: str(req.data.note, 300), reviewedBy: me.uid, reviewedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.lpAdminListReports = onCall(async (req) => {
  const me = await staff(req);
  const snap = await db.collection("reports").where("status", "==", "open").orderBy("createdAt", "desc").limit(200).get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => me.canSee(r.state));
  const offers = await Promise.all(list.map((r) => db.doc(`offers/${r.offerId}`).get()));
  return list.map((r, i) => {
    const o = offers[i].data();
    return {
      id: r.id, reason: r.reason, details: r.details || "", status: r.status, createdAt: r.createdAt?.toMillis?.() || null,
      city: r.city || "", state: r.state || "",
      offer: o ? { id: offers[i].id, title: o.title, status: o.status, business: { name: o.business?.name || "", city: o.business?.city || "" } } : null,
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
  await ref.update({ status, resolvedBy: me.uid, resolvedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// Switch payments on/off for everyone. Re-syncs every owner's offer visibility afterwards.
exports.lpAdminSetConfig = onCall({ timeoutSeconds: 300 }, async (req) => {
  await needAdmin(req);
  const free = req.data?.freeMode !== false;
  await db.doc("config/app").set({ freeMode: free, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  cfgCache = { at: Date.now(), freeMode: free };
  const owners = await db.collection("businesses").select().get();
  for (const b of owners.docs) await syncOwnerOffers(b.id);
  return { freeMode: free, businesses: owners.size };
});
