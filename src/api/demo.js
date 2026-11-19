// Demo backend: same interface as supabase.js, data kept in this browser's localStorage.
// Used automatically when VITE_SUPABASE_URL is not set. No real payments happen here.
import { compressPhoto } from "../lib/image.js";

const KEY = "lastpick-demo-v2";
const H = 3600000, D = 86400000;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const listeners = new Set();

export const DEMO_ACCOUNTS = [
  { email: "customer@demo.in", password: "demo1234", label: "Customer (no plan yet)" },
  { email: "owner@demo.in", password: "demo1234", label: "Owner: Sunrise Bakery" },
  { email: "admin@demo.in", password: "demo1234", label: "Admin" },
];

function seed() {
  const n = Date.now();
  const users = [
    { id: "u-cust", email: "customer@demo.in", password: "demo1234", name: "Priya", phone: "9000012345", role: "user" },
    { id: "u-own", email: "owner@demo.in", password: "demo1234", name: "Suresh", phone: "9845011223", role: "user" },
    { id: "u-admin", email: "admin@demo.in", password: "demo1234", name: "Admin", phone: "9000000000", role: "admin" },
  ];
  const biz = [
    ["u-own", "Sunrise Bakery", "food", "Indiranagar", 12.9784, 77.6408, "9845011223"],
    ["o2", "Hotel Grand Residency", "stay", "MG Road", 12.9756, 77.6066, "8041255667"],
    ["o3", "Shubh Mangal Function Hall", "venue", "Jayanagar", 12.925, 77.5938, "9900123456"],
    ["o4", "Royal Travels", "travel", "Majestic", 12.9767, 77.5713, "9740088990"],
    ["o5", "KickOff Turf", "sports", "HSR Layout", 12.9116, 77.6474, "9008044556"],
    ["o6", "ZoomCars Point", "rental", "Koramangala", 12.9352, 77.6245, "9632077889"],
    ["o7", "Trendz Fashion", "retail", "Commercial Street", 12.9822, 77.6083, "9886133445"],
    ["o8", "Glow Salon", "beauty", "Whitefield", 12.9698, 77.75, "9812345670"],
  ].map(([owner, name, category, area, lat, lng, phone], i) => ({
    id: "b" + (i + 1), ownerId: owner, name, category, about: "", address: area + ", Bengaluru", area, city: "Bengaluru", lat, lng,
    status: "verified", statusNote: "", createdAt: n - 30 * D, phone, whatsapp: true,
  }));
  biz.push({ id: "b9", ownerId: "o9", name: "New Mobile World", category: "electronics", about: "", address: "SP Road", area: "SP Road", city: "Bengaluru", lat: 12.968, lng: 77.58, status: "pending", statusNote: "", createdAt: n - 2 * H, phone: "9988776655", whatsapp: true });
  const subs = ["u-own", "o2", "o3", "o4", "o5", "o6", "o7", "o8"].map((u) => ({ userId: u, plan: "owner", status: "active", currentPeriodEnd: n + 20 * D, provider: "demo" }));
  const o = (b, category, emoji, title, description, origPrice, price, quantity, endsIn, views) => ({
    id: rid(), businessId: b, title, description, category, emoji, photoUrl: null, origPrice, price, quantity,
    endsAt: n + endsIn, status: "live", views, createdAt: n - 2 * H,
  });
  const offers = [
    o("b1", "food", "🎂", "Fresh cakes & pastries before closing", "Today's cakes, pastries and breads at half price. Come before 10:30 PM.", 600, 299, "7 left", 95 * 60000, 142),
    o("b1", "food", "🥐", "Croissant box of 6 for tomorrow morning", "Order tonight, collect fresh at 8 AM.", 420, 260, "10 boxes", 9 * H, 63),
    o("b2", "stay", "🛏️", "Deluxe AC room for tonight", "Double bed, breakfast included. Check-in till midnight.", 3800, 1999, "3 rooms", 5 * H, 211),
    o("b3", "venue", "💒", "Marriage hall for 300 guests, free this Sunday", "Hall, dining area and 6 rooms for one day. Cancelled booking, so heavily discounted.", 180000, 95000, "1 date", 2 * D, 388),
    o("b4", "travel", "🚌", "AC sleeper to Chennai, leaves 10:45 PM", "6 seats unsold. Board at Majestic bus stand.", 1400, 799, "6 seats", 150 * 60000, 96),
    o("b5", "sports", "⚽", "5-a-side turf, 10 to 11 PM tonight", "Floodlights, bibs and ball included.", 1800, 900, "1 slot", 55 * 60000, 54),
    o("b6", "rental", "🚗", "Swift self-drive, free for the weekend", "Unlimited km within Karnataka. Licence and ID needed.", 5200, 2999, "1 car", 20 * H, 120),
    o("b7", "retail", "👕", "Last-season shirts, 3 for the price of 1", "Sizes M to XL.", 2400, 799, "18 left", 26 * H, 77),
    o("b8", "beauty", "💇", "Haircut + head massage, weekday afternoons", "Senior stylists, 2 to 5 PM slots.", 900, 449, "8 slots", 3 * D, 40),
  ];
  const leads = [
    { id: rid(), offerId: offers[0].id, businessId: "b1", customerId: "x1", name: "Ravi Kumar", phone: "9876543210", status: "new", createdAt: n - 12 * 60000 },
    { id: rid(), offerId: offers[0].id, businessId: "b1", customerId: "x2", name: "Ananya S", phone: "9123456780", status: "contacted", createdAt: n - 48 * 60000 },
    { id: rid(), offerId: offers[1].id, businessId: "b1", customerId: "x3", name: "Mohammed Irfan", phone: "9986012345", status: "new", createdAt: n - 110 * 60000 },
  ];
  return { v: 2, session: null, users, businesses: biz, subs, offers, leads, contacts: [], reports: [] };
}

function load() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { db = null; }
  // reseed when empty or when every demo offer has expired
  if (!db || db.v !== 2 || !db.offers.some((o) => o.status === "live" && o.endsAt > Date.now())) {
    const fresh = seed();
    if (db?.session) fresh.session = db.session;
    db = fresh;
    save(db);
  }
  return db;
}
function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } }
function me(db) {
  const u = db.users.find((x) => x.id === db.session);
  if (!u) throw new Error("Please log in");
  return u;
}
const hasPlan = (db, userId, plan) => db.subs.some((s) => s.userId === userId && s.plan === plan && ["active", "cancelled"].includes(s.status) && s.currentPeriodEnd > Date.now());
const isAdmin = (db) => { const u = db.users.find((x) => x.id === db.session); return u?.role === "admin"; };
const bizVisible = (db, b) => b && b.status === "verified" && hasPlan(db, b.ownerId, "owner");
const pub = (b) => b && ({ id: b.id, name: b.name, category: b.category, about: b.about, area: b.area, city: b.city, address: b.address, lat: b.lat, lng: b.lng, status: b.status });
const withBiz = (db, o) => ({ ...o, business: pub(db.businesses.find((b) => b.id === o.businessId)) });
const emit = () => listeners.forEach((cb) => cb());
const subOut = (s) => s && ({ ...s, active: ["active", "cancelled"].includes(s.status) && s.currentPeriodEnd > Date.now() });

export const api = {
  mode: "demo",

  async getSession() {
    const db = load();
    const u = db.users.find((x) => x.id === db.session);
    return u ? { user: { id: u.id, email: u.email } } : null;
  },
  onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  async signIn(email, password) {
    await wait();
    const db = load();
    const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password);
    if (!u) throw new Error("Wrong email or password");
    db.session = u.id; save(db); emit();
  },
  async signUp({ email, password, name, phone }) {
    await wait();
    const db = load();
    if (db.users.some((x) => x.email.toLowerCase() === email.trim().toLowerCase())) throw new Error("An account with this email already exists");
    const u = { id: "u-" + rid(), email: email.trim(), password, name, phone, role: "user" };
    db.users.push(u); db.session = u.id; save(db); emit();
    return { needsConfirmation: false };
  },
  async resetPassword() { await wait(); },
  async signOut() { const db = load(); db.session = null; save(db); emit(); },
  async getProfile() { const u = me(load()); return { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role }; },
  async updateProfile({ name, phone }) { const db = load(); const u = me(db); u.name = name; u.phone = phone; save(db); },

  async mySubscriptions() {
    const db = load(); const u = me(db);
    const find = (p) => subOut(db.subs.find((s) => s.userId === u.id && s.plan === p));
    return { customer: find("customer"), owner: find("owner") };
  },
  async subscribe(plan) {
    await wait(700);
    const db = load(); const u = me(db);
    let s = db.subs.find((x) => x.userId === u.id && x.plan === plan);
    if (!s) { s = { userId: u.id, plan, provider: "demo" }; db.subs.push(s); }
    s.status = "active"; s.currentPeriodEnd = Math.max(s.currentPeriodEnd || 0, Date.now()) + 30 * D;
    save(db);
  },
  async cancelPlan(plan) {
    const db = load(); const u = me(db);
    const s = db.subs.find((x) => x.userId === u.id && x.plan === plan);
    if (s) s.status = "cancelled";
    save(db);
  },

  async myBusiness() {
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.ownerId === u.id);
    return b ? { ...b } : null;
  },
  async saveBusiness(b) {
    await wait();
    const db = load(); const u = me(db);
    const fields = { name: b.name, category: b.category, about: b.about, address: b.address, area: b.area, city: b.city, lat: b.lat, lng: b.lng, phone: b.phone, whatsapp: !!b.whatsapp };
    let x = db.businesses.find((y) => y.ownerId === u.id);
    if (x) Object.assign(x, fields);
    else { x = { id: "b-" + rid(), ownerId: u.id, status: "pending", statusNote: "", createdAt: Date.now(), ...fields }; db.businesses.push(x); }
    save(db);
    return x.id;
  },

  async listLive() {
    await wait(80);
    const db = load(), now = Date.now();
    return db.offers.filter((o) => o.status === "live" && o.endsAt > now && bizVisible(db, db.businesses.find((b) => b.id === o.businessId)))
      .sort((a, b) => a.endsAt - b.endsAt).map((o) => withBiz(db, o));
  },
  async getOffer(id) {
    const db = load(); const o = db.offers.find((x) => x.id === id);
    return o ? withBiz(db, o) : null;
  },
  async myOffers() {
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.ownerId === u.id);
    return b ? db.offers.filter((o) => o.businessId === b.id).sort((a, c) => c.createdAt - a.createdAt).map((o) => withBiz(db, o)) : [];
  },
  async createOffer(o) {
    await wait();
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.ownerId === u.id);
    if (!b) throw new Error("Set up your business first");
    if (!hasPlan(db, u.id, "owner")) throw new Error("An active Owner Pro subscription is needed to post offers");
    if (!(o.price < o.origPrice)) throw new Error("Offer price must be lower than the normal price");
    db.offers.push({ id: rid(), businessId: b.id, title: o.title, description: o.description, category: o.category, emoji: o.emoji, photoUrl: o.photoUrl || null,
      origPrice: o.origPrice, price: o.price, quantity: o.quantity, endsAt: o.endsAt, status: "live", views: 0, createdAt: Date.now() });
    save(db);
  },
  async endOffer(id) { const db = load(); const o = db.offers.find((x) => x.id === id); if (o && o.status === "live") o.status = "ended"; save(db); },
  async addView(id) { const db = load(); const o = db.offers.find((x) => x.id === id); if (o) { o.views += 1; save(db); } },
  async uploadPhoto(file) { return compressPhoto(file); },

  async revealContact(offerId) {
    await wait(120);
    const db = load(); const u = me(db);
    const o = db.offers.find((x) => x.id === offerId); if (!o) throw new Error("Offer not found");
    const b = db.businesses.find((x) => x.id === o.businessId);
    const own = b.ownerId === u.id;
    if (!(hasPlan(db, u.id, "customer") || own || isAdmin(db))) throw new Error("Subscribe to the Customer Pass to see this number");
    if (!own && hasPlan(db, u.id, "customer") && !db.contacts.some((c) => c.customerId === u.id && c.offerId === offerId)) {
      db.contacts.push({ customerId: u.id, offerId, how: "viewed", at: Date.now() }); save(db);
    }
    return { phone: b.phone, whatsapp: b.whatsapp };
  },
  async logContact(offerId, how) {
    const db = load(); const u = me(db);
    if (!hasPlan(db, u.id, "customer")) return;
    const c = db.contacts.find((x) => x.customerId === u.id && x.offerId === offerId);
    if (c) { c.how = how; c.at = Date.now(); } else db.contacts.push({ customerId: u.id, offerId, how, at: Date.now() });
    save(db);
  },
  async shareNumber(offerId) {
    await wait();
    const db = load(); const u = me(db);
    if (!hasPlan(db, u.id, "customer")) throw new Error("Subscribe to the Customer Pass first");
    if (!u.phone) throw new Error("Add your phone number in Account first");
    const o = db.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "live" || o.endsAt <= Date.now()) throw new Error("This offer has ended");
    const b = db.businesses.find((x) => x.id === o.businessId);
    if (b.ownerId === u.id) throw new Error("This is your own offer");
    if (!db.leads.some((l) => l.offerId === offerId && l.customerId === u.id)) {
      db.leads.unshift({ id: rid(), offerId, businessId: b.id, customerId: u.id, name: u.name || "Customer", phone: u.phone, status: "new", createdAt: Date.now() });
    }
    const c = db.contacts.find((x) => x.customerId === u.id && x.offerId === offerId);
    if (c) { c.how = "Shared my number"; c.at = Date.now(); } else db.contacts.push({ customerId: u.id, offerId, how: "Shared my number", at: Date.now() });
    save(db);
  },
  async mySharedOfferIds() { const db = load(); const u = me(db); return db.leads.filter((l) => l.customerId === u.id).map((l) => l.offerId); },
  async myContacts() {
    const db = load(); const u = me(db);
    return db.contacts.filter((c) => c.customerId === u.id).sort((a, b) => b.at - a.at)
      .map((c) => { const o = db.offers.find((x) => x.id === c.offerId); return o && { offer: withBiz(db, o), how: c.how, at: c.at }; }).filter(Boolean);
  },
  async ownerLeads() {
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.ownerId === u.id);
    if (!b || !hasPlan(db, u.id, "owner")) return [];
    return db.leads.filter((l) => l.businessId === b.id).sort((a, c) => c.createdAt - a.createdAt).map((l) => {
      const o = db.offers.find((x) => x.id === l.offerId);
      return { ...l, offerTitle: o?.title || "", offerEmoji: o?.emoji || "📦" };
    });
  },
  async setLeadStatus(id, status) { const db = load(); const l = db.leads.find((x) => x.id === id); if (l) l.status = status; save(db); },

  async report(offerId, reason, details) {
    await wait();
    const db = load(); const u = me(db);
    db.reports.unshift({ id: rid(), offerId, reporterId: u.id, reason, details, status: "open", createdAt: Date.now() }); save(db);
  },

  async adminBusinesses() { const db = load(); if (!isAdmin(db)) throw new Error("Admins only"); return [...db.businesses].sort((a, b) => b.createdAt - a.createdAt); },
  async setBusinessStatus(id, status, note) { const db = load(); const b = db.businesses.find((x) => x.id === id); if (b) { b.status = status; b.statusNote = note || ""; } save(db); },
  async adminReports() {
    const db = load(); if (!isAdmin(db)) throw new Error("Admins only");
    return db.reports.map((r) => { const o = db.offers.find((x) => x.id === r.offerId); return { ...r, offer: o && withBiz(db, o) }; });
  },
  async resolveReport(id, status) { const db = load(); const r = db.reports.find((x) => x.id === id); if (r) r.status = status; save(db); },
  async adminRemoveOffer(id) { const db = load(); const o = db.offers.find((x) => x.id === id); if (o) o.status = "removed"; save(db); },
  async adminSetPlan(email, plan, months) {
    const db = load(); if (!isAdmin(db)) throw new Error("Admins only");
    const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) throw new Error("No user with that email");
    let s = db.subs.find((x) => x.userId === u.id && x.plan === plan);
    if (!s) { s = { userId: u.id, plan, provider: "manual" }; db.subs.push(s); }
    if (months > 0) { s.status = "active"; s.currentPeriodEnd = Math.max(s.currentPeriodEnd || 0, Date.now()) + months * 30 * D; }
    else { s.status = "expired"; s.currentPeriodEnd = Date.now(); }
    save(db);
  },
};
