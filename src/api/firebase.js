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
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { APP_NAME, PLANS } from "../lib/config.js";

const env = import.meta.env;
let fb;
function F() {
  if (fb) return fb;
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
  });
  fb = { auth: getAuth(app), db: getFirestore(app), storage: getStorage(app), fns: getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-south1") };
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
async function call(name, data) {
  try { return (await httpsCallable(F().fns, name)(data)).data; } catch (e) { throw nice(e); }
}

const mapOffer = (id, d) => ({
  id, businessId: d.businessId, ownerId: d.ownerId, business: { id: d.businessId, ...(d.business || {}) }, title: d.title,
  description: d.description || "", category: d.category, emoji: d.emoji || "📦", photoUrl: d.photoUrl || null,
  origPrice: d.origPrice, price: d.price, quantity: d.quantity || "", endsAt: ms(d.endsAt), status: d.status,
  visible: d.visible, views: d.views || 0, createdAt: ms(d.createdAt) || Date.now(),
});
const mapSub = (d) => d && ({
  plan: d.plan, status: d.status, currentPeriodEnd: ms(d.currentPeriodEnd), provider: d.provider,
  active: ["active", "cancelled"].includes(d.status) && ms(d.currentPeriodEnd) > Date.now(),
});
const mapBiz = (id, d, c) => ({
  id, ownerId: d.ownerId, name: d.name, category: d.category, about: d.about || "", address: d.address || "", area: d.area || "",
  city: d.city || "", lat: d.lat ?? null, lng: d.lng ?? null, status: d.status, statusNote: d.statusNote || "",
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
      await setDoc(doc(F().db, "users", cred.user.uid), { name, phone, email: email.trim(), role: "user", createdAt: serverTimestamp() });
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
      await setDoc(doc(F().db, "users", id), { name: u.displayName || "", phone: "", email: u.email, role: "user", createdAt: serverTimestamp() });
    }
    return { id, name: d.name || "", phone: d.phone || "", email: d.email || F().auth.currentUser.email, role: d.role || "user" };
  },
  async updateProfile({ name, phone }) { const id = await uid(); await updateDoc(doc(F().db, "users", id), { name, phone }); },

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
    const fields = { name: b.name, category: b.category, about: b.about || "", address: b.address || "", area: b.area || "", city: b.city || "", lat: b.lat ?? null, lng: b.lng ?? null };
    const ref = doc(F().db, "businesses", id);
    const exists = (await getDoc(ref)).exists();
    if (exists) await updateDoc(ref, fields);
    else await setDoc(ref, { ...fields, ownerId: id, status: "pending", statusNote: "", createdAt: serverTimestamp() });
    await setDoc(doc(F().db, "businessContacts", id), { phone: b.phone, whatsapp: !!b.whatsapp, updatedAt: serverTimestamp() });
    return id;
  },

  // ---------- offers ----------
  async listLive() {
    const q = query(collection(F().db, "offers"), where("visible", "==", true), where("status", "==", "live"),
      where("endsAt", ">", Timestamp.now()), orderBy("endsAt"), limit(300));
    return (await getDocs(q)).docs.map((d) => mapOffer(d.id, d.data()));
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
  async uploadPhoto(file) {
    const id = await uid();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const r = sref(F().storage, `offer-photos/${id}/${Date.now()}.${ext}`);
    await uploadBytes(r, file, { contentType: file.type });
    return getDownloadURL(r);
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
        offer: { id: x.offerId, title: o.title, emoji: o.emoji, category: o.category, photoUrl: o.photoUrl, price: o.price, origPrice: o.origPrice,
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

  // ---------- admin ----------
  async adminBusinesses() {
    const bs = await getDocs(query(collection(F().db, "businesses"), orderBy("createdAt", "desc"), limit(500)));
    return Promise.all(bs.docs.map(async (b) => {
      const c = await getDoc(doc(F().db, "businessContacts", b.id));
      return mapBiz(b.id, b.data(), c.exists() ? c.data() : null);
    }));
  },
  async setBusinessStatus(id, status, note) { await updateDoc(doc(F().db, "businesses", id), { status, statusNote: note || "" }); },
  async adminReports() {
    const rs = await getDocs(query(collection(F().db, "reports"), orderBy("createdAt", "desc"), limit(300)));
    return Promise.all(rs.docs.map(async (r) => {
      const x = r.data();
      const o = await getDoc(doc(F().db, "offers", x.offerId));
      return { id: r.id, reason: x.reason, details: x.details, status: x.status, createdAt: ms(x.createdAt), offer: o.exists() ? mapOffer(o.id, o.data()) : null };
    }));
  },
  async resolveReport(id, status) { await updateDoc(doc(F().db, "reports", id), { status }); },
  async adminRemoveOffer(id) { await updateDoc(doc(F().db, "offers", id), { status: "removed" }); },
  async adminSetPlan(email, plan, months) { await call("adminSetPlan", { email, plan, months }); },
};
