// Live backend: Firebase Auth + Firestore + Storage + Cloud Functions (asia-south1).
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut as fbSignOut, updateProfile as fbUpdateProfile,
  RecaptchaVerifier, signInWithPhoneNumber, signInWithCustomToken,
} from "firebase/auth";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit,
  serverTimestamp, increment, Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { APP_NAME, CONSENT_VERSION, PLANS } from "../lib/config.js";
import { compressPhoto } from "../lib/image.js";
import { cityKey } from "../lib/config.js";
import { distanceKm, indianPhone } from "../lib/format.js";
import { encodeGeohash, geohashPrefixes } from "../lib/geo.js";

const env = import.meta.env;
let fb;
function F() {
  if (fb) return fb;
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
  });
  // LastPick has its own Firestore database ("lastpick") inside the Firebase project.
  // Documents already read are kept on the phone (IndexedDB), so revisits and offline use don't re-read the database.
  let fdb;
  try { fdb = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, "lastpick"); }
  catch { fdb = getFirestore(app, "lastpick"); }
  fb = { auth: getAuth(app), db: fdb, fns: getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-south1") };
  return fb;
}

// Short-lived in-memory cache for the offer lists: switching tabs or going back doesn't re-run the query.
const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  return v;
}
const clearCache = () => memo.clear();
const live = (list) => list.filter((o) => o.endsAt > Date.now());

// Wait for Firebase to restore the login on page load.
let authReady;
const ready = () => (authReady ||= new Promise((res) => { const off = onAuthStateChanged(F().auth, () => { off(); res(); }); }));
async function uid() {
  await ready();
  const u = F().auth.currentUser;
  if (!u) throw new Error("Please log in");
  return u.uid;
}
const ms = (v) => (v instanceof Timestamp ? v.toMillis() : typeof v === "number" ? v : v?.seconds ? v.seconds * 1000 : null);

const ERR = {
  "auth/invalid-credential": "Wrong email or password",
  "auth/wrong-password": "Wrong email or password",
  "auth/user-not-found": "Wrong email or password",
  "auth/email-already-in-use": "An account with this email already exists",
  "auth/weak-password": "Password must be at least 6 characters",
  "auth/invalid-email": "Please enter a valid email",
  "auth/too-many-requests": "Too many attempts. Try again in a few minutes",
  "auth/network-request-failed": "No internet connection",
  "auth/invalid-verification-code": "That code is not right. Check it and try again.",
  "auth/code-expired": "This code has expired. Ask for a new one.",
  "auth/invalid-phone-number": "Please enter a valid Indian mobile number",
  "auth/quota-exceeded": "Too many codes sent. Try again later or use e-mail.",
  "auth/captcha-check-failed": "Security check failed. Please try again.",
  "auth/operation-not-allowed": "Mobile login isn't switched on yet. Please use e-mail.",
  "functions/internal": "Something went wrong on our side. Please try again in a minute.",
  "functions/unavailable": "Can't reach LastPick right now. Check your internet and try again.",
  "functions/deadline-exceeded": "That took too long. Please try again.",
};
const nice = (e) => new Error((e?.code !== "functions/internal" || e?.message === "internal" ? ERR[e?.code] : null) || e?.message?.replace(/^Firebase: /, "").replace(/ \(.*\)\.?$/, "") || "Something went wrong");
// Cloud Functions are named lp<Name> (e.g. lpCreateOffer) to keep them apart from other apps in the project.
async function call(name, data) {
  const fn = "lp" + name[0].toUpperCase() + name.slice(1);
  try { return (await httpsCallable(F().fns, fn)(data)).data; } catch (e) { throw nice(e); }
}

const mapOffer = (id, d) => ({
  id, businessId: d.businessId, ownerId: d.ownerId, business: { id: d.businessId, ...(d.business || {}) }, title: d.title,
  description: d.description || "", category: d.category, emoji: d.emoji || "📦", photoUrl: d.photoThumb || null, hasPhoto: !!d.hasPhoto,
  origPrice: d.origPrice, price: d.price, quantity: d.quantity || "", endsAt: ms(d.endsAt), status: d.status,
  visible: d.visible, views: d.views || 0, createdAt: ms(d.createdAt) || Date.now(),
});
const mapReview = (id, d) => ({
  id, businessId: d.businessId, customerId: d.customerId, name: d.name, rating: d.rating, text: d.text || "", offerTitle: d.offerTitle || "",
  status: d.status, edited: !!d.edited, createdAt: ms(d.createdAt) || Date.now(), reply: d.reply ? { text: d.reply.text, at: ms(d.reply.at) } : null,
});
const mapSub = (d) => d && ({
  plan: d.plan, status: d.status, currentPeriodEnd: ms(d.currentPeriodEnd), provider: d.provider,
  active: ["active", "cancelled"].includes(d.status) && ms(d.currentPeriodEnd) > Date.now(),
});
const mapBiz = (id, d, c) => ({
  trialEndsAt: ms(d.trialEndsAt) || (d.status === "verified" ? (ms(d.reviewedAt) || ms(d.createdAt) || Date.now()) + 30 * 86400000 : null),
  id, ownerId: d.ownerId, name: d.name, category: d.category, categories: d.categories?.length ? d.categories : [d.category || "other"], rating: d.rating || null, about: d.about || "", address: d.address || "", area: d.area || "",
  city: d.city || "", state: d.state || "", pincode: d.pincode || "", lat: d.lat ?? null, lng: d.lng ?? null, status: d.status, statusNote: d.statusNote || "",
  createdAt: ms(d.createdAt), phone: c?.phone || "", whatsapp: c ? c.whatsapp !== false : true,
});

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection."));
    document.body.appendChild(s);
  });
}

export const api = {
  mode: "live",

  // ---------- auth & profile ----------
  async getSession() {
    await ready();
    const u = F().auth.currentUser;
    return u ? { user: { id: u.uid, email: u.email } } : null;
  },
  onAuthChange(cb) { return onAuthStateChanged(F().auth, () => cb()); },
  async signIn(email, password) {
    try { await signInWithEmailAndPassword(F().auth, email.trim(), password); } catch (e) { throw nice(e); }
  },
  async signUp({ email, password, name, phone, consent }) {
    try {
      const cred = await createUserWithEmailAndPassword(F().auth, email.trim(), password);
      await fbUpdateProfile(cred.user, { displayName: name });
      const ref = doc(F().db, "users", cred.user.uid);
      const fields = { name, nameLower: name.toLowerCase(), phone: indianPhone(phone) || phone };
      // the profile may already have been created by getProfile() a moment earlier; then just fill in the details
      try { await setDoc(ref, { ...fields, email: email.trim(), role: "user", createdAt: serverTimestamp() }); }
      catch { await updateDoc(ref, fields); }
      if (consent) await call("recordConsent", { kind: "user", version: CONSENT_VERSION, adult: !!consent.adult, items: consent.items || [] });
      return { needsConfirmation: false };
    } catch (e) { throw nice(e); }
  },
  // ---------- one-time codes ----------
  async sendPhoneOtp(phone) {
    const auth = F().auth;
    // a fresh invisible reCAPTCHA for every send, so "Resend code" works too
    try { this._recaptcha?.clear(); } catch { /* ignore */ }
    const box = document.getElementById("otp-captcha");
    if (box) box.innerHTML = "";
    try {
      this._recaptcha = new RecaptchaVerifier(auth, "otp-captcha", { size: "invisible" });
      this._confirm = await signInWithPhoneNumber(auth, indianPhone(phone), this._recaptcha);
    } catch (e) { try { this._recaptcha?.clear(); } catch { /* ignore */ } this._recaptcha = null; throw nice(e); }
  },
  async verifyPhoneOtp(code) {
    if (!this._confirm) throw new Error("Ask for a code first");
    try { await this._confirm.confirm(code); } catch (e) { throw nice(e); }
    const r = await call("completePhoneLogin", {});
    if (r.token) await signInWithCustomToken(F().auth, r.token);
    return { isNew: !!r.isNew };
  },
  async sendEmailOtp(email) { await call("sendEmailOtp", { email }); },
  async verifyEmailOtp(email, code) {
    const r = await call("verifyEmailOtp", { email, code });
    try { await signInWithCustomToken(F().auth, r.token); } catch (e) { throw nice(e); }
    return { isNew: !!r.isNew };
  },
  // first time after a one-time-code login: save name, contact details and consent
  async completeProfile({ name, phone, email, consent }) {
    const id = await uid();
    const u = F().auth.currentUser;
    await setDoc(doc(F().db, "users", id), {
      name, nameLower: name.toLowerCase(), phone: u.phoneNumber || indianPhone(phone) || phone, email: (u.email || email || "").trim(),
      role: "user", createdAt: serverTimestamp(),
    });
    await fbUpdateProfile(u, { displayName: name }).catch(() => {});
    await call("recordConsent", { kind: "user", version: CONSENT_VERSION, adult: !!consent.adult, items: consent.items || [] });
  },
  async resetPassword(email) { try { await sendPasswordResetEmail(F().auth, email.trim()); } catch (e) { throw nice(e); } },
  async signOut() { await fbSignOut(F().auth); },
  async getProfile() {
    const id = await uid();
    const s = await getDoc(doc(F().db, "users", id));
    const u = F().auth.currentUser;
    // new one-time-code logins have no profile yet: the app asks for their details and consent first
    if (!s.exists()) return { id, needsProfile: true, name: u.displayName || "", phone: u.phoneNumber || "", email: u.email || "", role: "user", regions: [] };
    const d = s.data();
    return {
      trialEndsAt: ms(d.trialEndsAt) || (ms(d.createdAt) || Date.now()) + 30 * 86400000,
      id, name: d.name || "", phone: d.phone || "", email: d.email || u.email || "", role: d.role || "user", regions: d.regions || [],
      consentVersion: d.consent?.version || null, partnerConsentVersion: d.partnerConsent?.version || null,
    };
  },
  async updateProfile({ name, phone }) {
    const id = await uid();
    await updateDoc(doc(F().db, "users", id), { name, nameLower: name.toLowerCase(), phone: indianPhone(phone) || phone });
  },

  // ---------- subscriptions ----------
  async mySubscriptions() {
    const id = await uid();
    const one = async (k) => { try { const d = await getDoc(doc(F().db, "subscriptions", id + "_" + k)); return d.exists() ? mapSub(d.data()) : null; } catch { return null; } };
    const [customer, owner] = await Promise.all([one("customer"), one("owner")]);
    return { customer, owner };
  },
  async subscribe(plan, prefill) {
    const { subscriptionId, keyId } = await call("billing", { action: "create", plan });
    await loadRazorpay();
    const resp = await new Promise((resolve, reject) => {
      const rz = new window.Razorpay({
        key: keyId, subscription_id: subscriptionId, name: APP_NAME, description: `${PLANS[plan].name} (monthly)`,
        prefill: { name: prefill?.name, email: prefill?.email, contact: prefill?.phone },
        theme: { color: "#ff5a36" }, handler: resolve,
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rz.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed")));
      rz.open();
    });
    await call("billing", { action: "verify", plan, ...resp });
  },
  async cancelPlan(plan) { await call("billing", { action: "cancel", plan }); },

  // ---------- business (id = owner's uid) ----------
  async myBusiness() {
    const id = await uid();
    const b = await getDoc(doc(F().db, "businesses", id));
    if (!b.exists()) return null;
    const c = await getDoc(doc(F().db, "businessContacts", id));
    return mapBiz(id, b.data(), c.exists() ? c.data() : null);
  },
  async saveBusiness(b) {
    const id = await uid();
    const categories = [...new Set([b.category, ...(b.categories || [])].filter(Boolean))].slice(0, 3);
    const fields = { name: b.name, category: b.category, categories, about: b.about || "", address: b.address || "", area: b.area || "", city: b.city || "",
      state: b.state || "", cityKey: cityKey(b.city), pincode: String(b.pincode || "").trim(), lat: b.lat ?? null, lng: b.lng ?? null,
      geohash: typeof b.lat === "number" && typeof b.lng === "number" ? encodeGeohash(b.lat, b.lng) : null };
    const ref = doc(F().db, "businesses", id);
    const prev = await getDoc(ref);
    const exists = prev.exists();
    const before = exists ? (prev.data().categories?.length ? prev.data().categories : [prev.data().category]) : [];
    if (exists && [...before].sort().join() !== [...categories].sort().join()) fields.categoriesChangedAt = serverTimestamp(); // shown to moderators
    if (exists) await updateDoc(ref, fields);
    else await setDoc(ref, { ...fields, ownerId: id, status: "pending", statusNote: "", createdAt: serverTimestamp() });
    await setDoc(doc(F().db, "businessContacts", id), { phone: indianPhone(b.phone) || b.phone, whatsapp: !!b.whatsapp, updatedAt: serverTimestamp() });
    clearCache();
    return id;
  },

  // ---------- offers ----------
  // Offers are loaded one city at a time, which keeps reads (and the bill) small at India scale.
  async listLive(city) {
    return live(await cached("city:" + city, 60000, () => api._listLive(city)));
  },
  async _listLive(city) {
    const q = query(collection(F().db, "offers"), where("cityKey", "==", city), where("visible", "==", true), where("status", "==", "live"),
      where("endsAt", ">", Timestamp.now()), orderBy("endsAt"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
  },
  // Offers within radiusKm of a point: query the geohash cells around it, then keep exact matches.
  async listNearby(lat, lng, radiusKm) {
    // ~1 km grid, so small GPS jitter reuses the same cached result
    const key = `near:${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`;
    return live(await cached(key, 60000, () => api._listNearby(lat, lng, radiusKm)));
  },
  async _listNearby(lat, lng, radiusKm) {
    const now = Date.now();
    const snaps = await Promise.all(geohashPrefixes(lat, lng, radiusKm).map((p) => getDocs(query(collection(F().db, "offers"),
      where("visible", "==", true), where("status", "==", "live"), where("geohash", ">=", p), where("geohash", "<=", p + "~"), limit(300)))));
    const seen = new Map();
    snaps.forEach((s) => s.docs.forEach((d) => seen.set(d.id, mapOffer(d.id, d.data()))));
    return [...seen.values()]
      .filter((o) => o.endsAt > now && distanceKm({ lat, lng }, o.business) <= radiusKm)
      .sort((a, b) => a.endsAt - b.endsAt);
  },
  async listByPincode(pincode) {
    return live(await cached("pin:" + pincode, 60000, () => api._listByPincode(pincode)));
  },
  async _listByPincode(pincode) {
    const q = query(collection(F().db, "offers"), where("pincode", "==", String(pincode)), where("visible", "==", true), where("status", "==", "live"),
      where("endsAt", ">", Timestamp.now()), orderBy("endsAt"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
  },
  async getConfig() { return cached("config", 60000, () => api._getConfig()); },
  async _getConfig() {
    try { const s = await getDoc(doc(F().db, "config", "app")); return { freeMode: !s.exists() || s.data().freeMode !== false }; }
    catch { return { freeMode: true }; }
  },
  async listCities() { return cached("cities", 300000, () => api._listCities()); },
  async _listCities() {
    const snap = await getDocs(query(collection(F().db, "cities"), orderBy("liveOffers", "desc"), limit(300)));
    return snap.docs.map((d) => ({ key: d.id, name: d.data().name, state: d.data().state, lat: d.data().lat, lng: d.data().lng, liveOffers: d.data().liveOffers || 0 }));
  },
  async getOfferPhoto(id) {
    try { const s = await getDoc(doc(F().db, "offerPhotos", id)); return s.exists() ? s.data().data : null; } catch { return null; }
  },
  async myArchive() {
    const id = await uid();
    const q = query(collection(F().db, "offerArchive"), where("ownerId", "==", id), orderBy("endsAt", "desc"), limit(100));
    return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), endsAt: ms(d.data().endsAt), createdAt: ms(d.data().createdAt) }));
  },
  async getOffer(id) {
    try {
      const s = await getDoc(doc(F().db, "offers", id));
      return s.exists() ? mapOffer(s.id, s.data()) : null;
    } catch { return null; } // not visible to this user
  },
  async myOffers() {
    const id = await uid();
    const q = query(collection(F().db, "offers"), where("ownerId", "==", id), orderBy("createdAt", "desc"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
  },
  async createOffer(o) { const r = await call("createOffer", o); clearCache(); return r; },
  async endOffer(id) { await updateDoc(doc(F().db, "offers", id), { status: "ended" }); clearCache(); },
  async addView(id) { try { await updateDoc(doc(F().db, "offers", id), { views: increment(1) }); } catch { /* ignore */ } },
  // returns a small thumbnail (for lists) and a full photo (opened on the offer page)
  async uploadPhoto(file) {
    const [thumb, photo] = await Promise.all([compressPhoto(file, 360, 28000), compressPhoto(file, 1000, 190000)]);
    return { thumb, photo };
  },

  // ---------- number exchange ----------
  async revealContact(offerId) { return call("revealContact", { offerId }); },
  async logContact(offerId, how) { try { await call("logContact", { offerId, how }); } catch { /* not critical */ } },
  async shareNumber(offerId) { await call("shareNumber", { offerId }); },
  async mySharedOfferIds() {
    const id = await uid();
    return (await getDocs(query(collection(F().db, "leads"), where("customerId", "==", id)))).docs.map((d) => d.data().offerId);
  },
  async myContacts() {
    const id = await uid();
    const q = query(collection(F().db, "customerContacts"), where("customerId", "==", id), orderBy("at", "desc"), limit(200));
    return (await getDocs(q)).docs.map((d) => {
      const x = d.data(), o = x.offer || {};
      return {
        how: x.how, at: ms(x.at) || Date.now(),
        offer: { id: x.offerId, businessId: x.businessId || null, title: o.title, emoji: o.emoji, category: o.category, photoUrl: o.photoThumb || null, price: o.price, origPrice: o.origPrice,
          endsAt: ms(o.endsAt), business: { name: o.businessName, area: o.area } },
      };
    });
  },
  async ownerLeads() {
    const id = await uid();
    const q = query(collection(F().db, "leads"), where("ownerId", "==", id), orderBy("createdAt", "desc"), limit(300));
    try {
      return (await getDocs(q)).docs.map((d) => {
        const x = d.data();
        return { id: d.id, offerId: x.offerId, offerTitle: x.offerTitle, offerEmoji: x.offerEmoji, name: x.name, phone: x.phone, status: x.status, createdAt: ms(x.createdAt) || Date.now() };
      });
    } catch { return []; } // owner plan not active
  },
  async setLeadStatus(id, status) { await updateDoc(doc(F().db, "leads", id), { status }); },

  // ---------- reports ----------
  async report(offerId, reason, details) {
    const id = await uid();
    await addDoc(collection(F().db, "reports"), { offerId, reporterId: id, reason, details: details || "", status: "open", createdAt: serverTimestamp() });
  },

  // ---------- admin & moderators (all through Cloud Functions, which check roles and regions) ----------
  async adminStats() { return call("adminStats", {}); },
  async adminFindUsers(q) { return call("adminFindUsers", { q }); },
  async adminSetRole(email, role, regions) { await call("adminSetRole", { email, role, regions }); },
  async adminBusinesses(filter = {}) { return call("adminListBusinesses", filter); },
  async setBusinessStatus(id, status, note) { await call("adminSetBusinessStatus", { businessId: id, status, note }); },
  async adminReports() { return call("adminListReports", {}); },
  async resolveReport(id, status, removeOffer = false) { await call("adminResolveReport", { reportId: id, status, removeOffer }); },
  async adminSetPlan(email, plan, months) { await call("adminSetPlan", { email, plan, months }); },
  async adminSetConfig(cfg) { clearCache(); return call("adminSetConfig", cfg); },
  async adminBusinessPlan(businessId, action, extra = {}) { await call("adminBusinessPlan", { businessId, action, ...extra }); },
  async adminGrievances(status) { return call("adminListGrievances", { status }); },
  async adminUpdateGrievance(ticket, status, reply) { await call("adminUpdateGrievance", { ticket, status, reply }); },

  // ---------- reviews ----------
  async listReviews(businessId) {
    const q = query(collection(F().db, "reviews"), where("businessId", "==", businessId), where("status", "==", "published"), orderBy("createdAt", "desc"), limit(30));
    return (await getDocs(q)).docs.map((d) => mapReview(d.id, d.data()));
  },
  async myReview(businessId) {
    const id = await uid();
    try { const s = await getDoc(doc(F().db, "reviews", `${businessId}_${id}`)); return s.exists() ? mapReview(s.id, s.data()) : null; } catch { return null; }
  },
  async ownerReviews() {
    const id = await uid();
    const q = query(collection(F().db, "reviews"), where("businessId", "==", id), orderBy("createdAt", "desc"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapReview(d.id, d.data()));
  },
  async submitReview(businessId, rating, text) { const r = await call("submitReview", { businessId, rating, text }); clearCache(); return r; },
  async replyReview(reviewId, text) { await call("replyReview", { reviewId, text }); },
  async reportReview(reviewId, reason, details) { await call("reportReview", { reviewId, reason, details }); },

  // ---------- privacy & complaints ----------
  async recordConsent(kind, extra = {}) { await call("recordConsent", { kind, version: CONSENT_VERSION, ...extra }); },
  async exportMyData() { return call("exportMyData", {}); },
  async deleteMyAccount() { await call("deleteMyAccount", { confirm: "DELETE" }); clearCache(); await fbSignOut(F().auth).catch(() => {}); },
  async submitGrievance(g) { return call("submitGrievance", g); },
  async myGrievances() {
    const id = await uid();
    const q = query(collection(F().db, "grievances"), where("userId", "==", id), orderBy("createdAt", "desc"), limit(50));
    return (await getDocs(q)).docs.map((d) => ({ ...d.data(), createdAt: ms(d.data().createdAt), updatedAt: ms(d.data().updatedAt) }));
  },
  async logClientError(e) { try { await call("logClientError", e); } catch { /* never let error reporting break the app */ } },
};
