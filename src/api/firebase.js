// Live backend: Firebase Auth + Firestore + Storage + Cloud Functions (asia-south1).
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut as fbSignOut, updateProfile as fbUpdateProfile,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit,
  serverTimestamp, increment, Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { APP_NAME, PLANS } from "../lib/config.js";
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
  fb = { auth: getAuth(app), db: getFirestore(app, "lastpick"), fns: getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-south1") };
  return fb;
}

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
};
const nice = (e) => new Error(ERR[e?.code] || e?.message?.replace(/^Firebase: /, "").replace(/ \(.*\)\.?$/, "") || "Something went wrong");
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
const mapSub = (d) => d && ({
  plan: d.plan, status: d.status, currentPeriodEnd: ms(d.currentPeriodEnd), provider: d.provider,
  active: ["active", "cancelled"].includes(d.status) && ms(d.currentPeriodEnd) > Date.now(),
});
const mapBiz = (id, d, c) => ({
  id, ownerId: d.ownerId, name: d.name, category: d.category, about: d.about || "", address: d.address || "", area: d.area || "",
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
  async signUp({ email, password, name, phone }) {
    try {
      const cred = await createUserWithEmailAndPassword(F().auth, email.trim(), password);
      await fbUpdateProfile(cred.user, { displayName: name });
      await setDoc(doc(F().db, "users", cred.user.uid), { name, nameLower: name.toLowerCase(), phone: indianPhone(phone) || phone, email: email.trim(), role: "user", createdAt: serverTimestamp() });
      return { needsConfirmation: false };
    } catch (e) { throw nice(e); }
  },
  async resetPassword(email) { try { await sendPasswordResetEmail(F().auth, email.trim()); } catch (e) { throw nice(e); } },
  async signOut() { await fbSignOut(F().auth); },
  async getProfile() {
    const id = await uid();
    const s = await getDoc(doc(F().db, "users", id));
    const d = s.exists() ? s.data() : {};
    if (!s.exists()) { // profile missing (e.g. created outside the app): create it
      const u = F().auth.currentUser;
      await setDoc(doc(F().db, "users", id), { name: u.displayName || "", nameLower: (u.displayName || "").toLowerCase(), phone: "", email: u.email, role: "user", createdAt: serverTimestamp() });
    }
    return { id, name: d.name || "", phone: d.phone || "", email: d.email || F().auth.currentUser.email, role: d.role || "user", regions: d.regions || [] };
  },
  async updateProfile({ name, phone }) {
    const id = await uid();
    await updateDoc(doc(F().db, "users", id), { name, nameLower: name.toLowerCase(), phone: indianPhone(phone) || phone });
  },

  // ---------- subscriptions ----------
  async mySubscriptions() {
    const id = await uid();
    const [c, o] = await Promise.all([getDoc(doc(F().db, "subscriptions", id + "_customer")), getDoc(doc(F().db, "subscriptions", id + "_owner"))]);
    return { customer: c.exists() ? mapSub(c.data()) : null, owner: o.exists() ? mapSub(o.data()) : null };
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
    const fields = { name: b.name, category: b.category, about: b.about || "", address: b.address || "", area: b.area || "", city: b.city || "",
      state: b.state || "", cityKey: cityKey(b.city), pincode: String(b.pincode || "").trim(), lat: b.lat ?? null, lng: b.lng ?? null,
      geohash: typeof b.lat === "number" && typeof b.lng === "number" ? encodeGeohash(b.lat, b.lng) : null };
    const ref = doc(F().db, "businesses", id);
    const exists = (await getDoc(ref)).exists();
    if (exists) await updateDoc(ref, fields);
    else await setDoc(ref, { ...fields, ownerId: id, status: "pending", statusNote: "", createdAt: serverTimestamp() });
    await setDoc(doc(F().db, "businessContacts", id), { phone: indianPhone(b.phone) || b.phone, whatsapp: !!b.whatsapp, updatedAt: serverTimestamp() });
    return id;
  },

  // ---------- offers ----------
  // Offers are loaded one city at a time, which keeps reads (and the bill) small at India scale.
  async listLive(city) {
    const q = query(collection(F().db, "offers"), where("cityKey", "==", city), where("visible", "==", true), where("status", "==", "live"),
      where("endsAt", ">", Timestamp.now()), orderBy("endsAt"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
  },
  // Offers within radiusKm of a point: query the geohash cells around it, then keep exact matches.
  async listNearby(lat, lng, radiusKm) {
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
    const q = query(collection(F().db, "offers"), where("pincode", "==", String(pincode)), where("visible", "==", true), where("status", "==", "live"),
      where("endsAt", ">", Timestamp.now()), orderBy("endsAt"), limit(200));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
  },
  async getConfig() {
    try { const s = await getDoc(doc(F().db, "config", "app")); return { freeMode: !s.exists() || s.data().freeMode !== false }; }
    catch { return { freeMode: true }; }
  },
  async listCities() {
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
  async createOffer(o) { return call("createOffer", o); },
  async endOffer(id) { await updateDoc(doc(F().db, "offers", id), { status: "ended" }); },
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
        offer: { id: x.offerId, title: o.title, emoji: o.emoji, category: o.category, photoUrl: o.photoThumb || null, price: o.price, origPrice: o.origPrice,
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
  async adminSetConfig(cfg) { return call("adminSetConfig", cfg); },
};
