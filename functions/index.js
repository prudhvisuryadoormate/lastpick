// LastPick Cloud Functions (Firebase, 2nd gen, Node 20).
// - Number exchange: revealContact, logContact, shareNumber
// - Offers: createOffer (server checks the owner's plan and business)
// - Billing: Razorpay subscriptions (billing) + razorpayWebhook for renewals
// - Admin: adminSetPlan
// - Upkeep: keep offer visibility in sync with business status and owner plan; expire old plans hourly
const crypto = require("crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

// Razorpay settings. Set them before going live (see README):
//   firebase functions:secrets:set RAZORPAY_KEY_SECRET
//   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
//   and RAZORPAY_KEY_ID / RAZORPAY_PLAN_CUSTOMER / RAZORPAY_PLAN_OWNER in functions/.env
const RAZORPAY_KEY_ID = defineString("RAZORPAY_KEY_ID", { default: "unset" });
const RAZORPAY_PLAN_CUSTOMER = defineString("RAZORPAY_PLAN_CUSTOMER", { default: "unset" });
const RAZORPAY_PLAN_OWNER = defineString("RAZORPAY_PLAN_OWNER", { default: "unset" });
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

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
async function needAdmin(req) {
  const uid = needAuth(req);
  if (!(await isAdmin(uid))) throw new HttpsError("permission-denied", "Admins only");
  return uid;
}
function subActive(s) {
  return !!s && ["active", "cancelled"].includes(s.status) && s.currentPeriodEnd && s.currentPeriodEnd.toMillis() > Date.now();
}
async function planActive(uid, plan) {
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
  title: o.title, emoji: o.emoji || "📦", category: o.category, photoUrl: o.photoUrl || null, price: o.price,
  origPrice: o.origPrice, endsAt: o.endsAt, businessName: o.business?.name || "", area: o.business?.area || "",
});
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Recompute whether an owner's offers are shown to customers:
// business verified AND Owner Pro active. Also refresh the business details copied onto offers.
async function syncOwnerOffers(ownerId) {
  const [biz, active] = await Promise.all([db.doc(`businesses/${ownerId}`).get(), planActive(ownerId, "owner")]);
  const b = biz.exists ? biz.data() : null;
  const visible = !!b && b.status === "verified" && active;
  const business = b ? { name: b.name, area: b.area || "", city: b.city || "", lat: b.lat ?? null, lng: b.lng ?? null } : null;
  const offers = await db.collection("offers").where("ownerId", "==", ownerId).get();
  let batch = db.batch(), n = 0;
  for (const d of offers.docs) {
    const patch = { visible };
    if (business) patch.business = business;
    batch.update(d.ref, patch);
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
}

// ---------------------------------------------------------------- offers
exports.createOffer = onCall(async (req) => {
  const uid = needAuth(req);
  const d = req.data || {};
  const biz = await db.doc(`businesses/${uid}`).get();
  if (!biz.exists) throw new HttpsError("failed-precondition", "Set up your business first");
  const b = biz.data();
  if (["rejected", "suspended"].includes(b.status)) throw new HttpsError("permission-denied", "Your business is " + b.status);
  if (!(await planActive(uid, "owner"))) throw new HttpsError("permission-denied", "An active Owner Pro subscription is needed to post offers");
  const contact = await db.doc(`businessContacts/${uid}`).get();
  if (!contact.exists) throw new HttpsError("failed-precondition", "Add your contact number in Business profile first");

  const title = str(d.title, 120);
  const origPrice = Number(d.origPrice), price = Number(d.price), endsAt = Number(d.endsAt);
  if (title.length < 3) throw new HttpsError("invalid-argument", "Title is too short");
  if (!(origPrice > 0) || !(price >= 0) || !(price < origPrice)) throw new HttpsError("invalid-argument", "Offer price must be lower than the normal price");
  if (!(endsAt > Date.now()) || endsAt > Date.now() + MAX_OFFER_MS + 60000) throw new HttpsError("invalid-argument", "Offers can run for up to 30 days");
  const photoUrl = typeof d.photoUrl === "string" && d.photoUrl.startsWith("https://") ? d.photoUrl : null;

  const ref = await db.collection("offers").add({
    ownerId: uid, businessId: uid,
    business: { name: b.name, area: b.area || "", city: b.city || "", lat: b.lat ?? null, lng: b.lng ?? null },
    title, description: str(d.description, 1000), category: str(d.category, 30) || "other", emoji: str(d.emoji, 8) || "📦",
    photoUrl, origPrice, price, quantity: str(d.quantity, 60),
    endsAt: Timestamp.fromMillis(endsAt), status: "live", visible: b.status === "verified", views: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, visible: b.status === "verified" };
});

// ---------------------------------------------------------------- number exchange
exports.revealContact = onCall(async (req) => {
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

exports.logContact = onCall(async (req) => {
  const uid = needAuth(req);
  if (!(await planActive(uid, "customer"))) return { ok: false };
  const o = await getOffer(req.data?.offerId);
  if (o.ownerId === uid) return { ok: false };
  await db.doc(`customerContacts/${uid}_${o.id}`).set({
    customerId: uid, offerId: o.id, how: str(req.data?.how, 40) || "Contacted", at: FieldValue.serverTimestamp(), offer: offerSummary(o),
  }, { merge: true });
  return { ok: true };
});

exports.shareNumber = onCall(async (req) => {
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

exports.billing = onCall({ secrets: [RAZORPAY_KEY_SECRET] }, async (req) => {
  const uid = needAuth(req);
  const { action, plan } = req.data || {};
  if (!PLANS.includes(plan)) throw new HttpsError("invalid-argument", "Unknown plan");
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

// Razorpay dashboard -> Webhooks -> URL of this function, same secret as RAZORPAY_WEBHOOK_SECRET.
exports.razorpayWebhook = onRequest({ secrets: [RAZORPAY_WEBHOOK_SECRET] }, async (req, res) => {
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
exports.adminSetPlan = onCall(async (req) => {
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
exports.onBusinessWrite = onDocumentWritten("businesses/{ownerId}", async (event) => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  const keys = ["status", "name", "area", "city", "lat", "lng"];
  if (before && after && keys.every((k) => before[k] === after[k])) return;
  await syncOwnerOffers(event.params.ownerId);
});

exports.onSubscriptionWrite = onDocumentWritten("subscriptions/{subId}", async (event) => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  const s = after || before;
  if (!s || s.plan !== "owner") return;
  if (before && after && subActive(before) === subActive(after)) return;
  await syncOwnerOffers(s.userId);
});

// Mark plans whose paid period ended as expired (webhooks normally do this; this is the safety net).
exports.expirePlans = onSchedule("every 60 minutes", async () => {
  const due = await db.collection("subscriptions")
    .where("status", "in", ["active", "cancelled"])
    .where("currentPeriodEnd", "<", Timestamp.now())
    .limit(400).get();
  const batch = db.batch();
  due.docs.forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
});
