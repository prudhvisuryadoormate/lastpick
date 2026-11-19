// Demo backend: same interface as firebase.js, data kept in this browser's localStorage.
// Used automatically when VITE_FIREBASE_API_KEY is not set. No real payments happen here.
import { compressPhoto } from "../lib/image.js";
import { CONSENT_VERSION, cityKey } from "../lib/config.js";
import { distanceKm, indianPhone } from "../lib/format.js";

const KEY = "lastpick-demo-v5";
const H = 3600000, D = 86400000;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const listeners = new Set();

export const DEMO_ACCOUNTS = [
  { email: "customer@demo.in", password: "demo1234", label: "Customer (no plan yet)" },
  { email: "owner@demo.in", password: "demo1234", label: "Owner: Sunrise Bakery" },
  { email: "admin@demo.in", password: "demo1234", label: "Admin (all India)" },
  { email: "moderator@demo.in", password: "demo1234", label: "Moderator (Telangana)" },
];

const PINS = {"Indiranagar": "560038", "MG Road": "560001", "Jayanagar": "560041", "Majestic": "560009", "HSR Layout": "560102", "Koramangala": "560034", "Commercial Street": "560001", "Whitefield": "560066", "Banjara Hills": "500034", "Andheri East": "400069", "T. Nagar": "600017"};

function seed() {
  const n = Date.now();
  const users = [
    { id: "u-cust", email: "customer@demo.in", password: "demo1234", name: "Priya", phone: "9000012345", role: "user" },
    { id: "u-own", email: "owner@demo.in", password: "demo1234", name: "Suresh", phone: "9845011223", role: "user" },
    { id: "u-admin", email: "admin@demo.in", password: "demo1234", name: "Admin", phone: "9000000000", role: "admin" },
    { id: "u-mod", email: "moderator@demo.in", password: "demo1234", name: "Kavya (Hyderabad)", phone: "9000000001", role: "moderator", regions: ["Telangana"] },
  ].map((u) => ({ ...u, phone: indianPhone(u.phone), createdAt: n - 10 * D, consent: CONSENT_VERSION, partnerConsent: CONSENT_VERSION }));
  const biz = [
    ["u-own", "Sunrise Bakery", "food", "Indiranagar", 12.9784, 77.6408, "9845011223"],
    ["o2", "Hotel Grand Residency", "stay", "MG Road", 12.9756, 77.6066, "8041255667"],
    ["o3", "Shubh Mangal Function Hall", "venue", "Jayanagar", 12.925, 77.5938, "9900123456"],
    ["o4", "Royal Travels", "travel", "Majestic", 12.9767, 77.5713, "9740088990"],
    ["o5", "KickOff Turf", "sports", "HSR Layout", 12.9116, 77.6474, "9008044556"],
    ["o6", "ZoomCars Point", "rental", "Koramangala", 12.9352, 77.6245, "9632077889"],
    ["o7", "Trendz Fashion", "retail", "Commercial Street", 12.9822, 77.6083, "9886133445"],
    ["o8", "Glow Salon", "beauty", "Whitefield", 12.9698, 77.75, "9812345670"],
    ["o10", "Paradise Banquets", "venue", "Banjara Hills", 17.4156, 78.4347, "9849012345", "Hyderabad", "Telangana"],
    ["o11", "Hotel Sea Breeze", "stay", "Andheri East", 19.1136, 72.8697, "9820012345", "Mumbai", "Maharashtra"],
    ["o12", "Chennai Sweets", "food", "T. Nagar", 13.0418, 80.2341, "9840012345", "Chennai", "Tamil Nadu"],
  ].map(([owner, name, category, area, lat, lng, phone, city = "Bengaluru", state = "Karnataka"], i) => ({
    id: "b" + (i + 1), ownerId: owner, name, category, categories: [category], about: "", address: `${area}, ${city}`, area, city, state, cityKey: cityKey(city), lat, lng,
    pincode: PINS[area] || "",
    status: "verified", statusNote: "", reportCount: 0, createdAt: n - 30 * D, phone: indianPhone(phone), whatsapp: true,
  }));
  biz.push({ id: "b99", ownerId: "o9", name: "New Mobile World", category: "electronics", about: "", address: "SP Road", area: "SP Road", city: "Bengaluru", state: "Karnataka", cityKey: "bengaluru", pincode: "560002", lat: 12.968, lng: 77.58, status: "pending", statusNote: "", reportCount: 0, createdAt: n - 2 * H, phone: indianPhone("9988776655"), whatsapp: true });
  biz.push({ id: "b98", ownerId: "o13", name: "Quick Deals Hyd", category: "electronics", about: "", address: "Ameerpet", area: "Ameerpet", city: "Hyderabad", state: "Telangana", cityKey: "hyderabad", pincode: "500016", lat: 17.4375, lng: 78.4482, status: "pending", statusNote: "", reportCount: 0, createdAt: n - 5 * H, phone: indianPhone("9849012345"), whatsapp: true });
  const subs = ["u-own", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o10", "o11", "o12"].map((u) => ({ userId: u, plan: "owner", status: "active", currentPeriodEnd: n + 20 * D, provider: "demo" }));
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
    o("b9", "venue", "💒", "Banquet hall for 500, free on Saturday", "AC hall with parking. Cancelled booking.", 250000, 140000, "1 date", 3 * D, 210),
    o("b10", "stay", "🛏️", "Business rooms near the airport tonight", "Free airport pickup after 10 PM.", 4500, 2499, "5 rooms", 6 * H, 133),
    o("b11", "food", "🍬", "Sweets and savouries at closing time", "Mixed boxes, 40% off after 8 PM.", 800, 480, "20 boxes", 3 * H, 88),
  ];
  const leads = [
    { id: rid(), offerId: offers[0].id, businessId: "b1", customerId: "x1", name: "Ravi Kumar", phone: "9876543210", status: "new", createdAt: n - 12 * 60000 },
    { id: rid(), offerId: offers[0].id, businessId: "b1", customerId: "x2", name: "Ananya S", phone: "9123456780", status: "contacted", createdAt: n - 48 * 60000 },
    { id: rid(), offerId: offers[1].id, businessId: "b1", customerId: "x3", name: "Mohammed Irfan", phone: "9986012345", status: "new", createdAt: n - 110 * 60000 },
  ];
  const archive = [
    { id: rid(), ownerId: "u-own", businessName: "Sunrise Bakery", title: "Diwali sweets box", category: "food", emoji: "🪔", origPrice: 900, price: 540, views: 410, leads: 23, status: "live", createdAt: n - 25 * D, endsAt: n - 20 * D },
    { id: rid(), ownerId: "u-own", businessName: "Sunrise Bakery", title: "Birthday cakes, 30% off", category: "food", emoji: "🎂", origPrice: 1200, price: 840, views: 176, leads: 9, status: "ended", createdAt: n - 14 * D, endsAt: n - 12 * D },
  ];
  const reviews = [
    { id: "b1_x1", businessId: "b1", customerId: "x1", name: "Ravi", rating: 5, text: "Cakes were fresh and the owner kept them aside for me. Great deal.", offerTitle: offers[0].title, status: "published", createdAt: n - 3 * D, reply: { text: "Thank you Ravi, see you again!", at: n - 2 * D } },
    { id: "b1_x2", businessId: "b1", customerId: "x2", name: "Ananya", rating: 4, text: "Good pastries. Came a bit late so fewer choices.", offerTitle: offers[0].title, status: "published", createdAt: n - 6 * D, reply: null },
  ];
  biz[0].rating = { avg: 4.5, count: 2 };
  return { v: 5, config: { freeMode: true }, session: null, users, businesses: biz, subs, offers, leads, contacts: [], reports: [], photos: {}, archive, reviews, grievances: [], consentLog: [] };
}

function load() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { db = null; }
  // reseed when empty or when every demo offer has expired
  if (!db || db.v !== 5 || !db.offers.some((o) => o.status === "live" && o.endsAt > Date.now())) {
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
const hasPlan = (db, userId, plan) => db.config?.freeMode !== false || db.subs.some((s) => s.userId === userId && s.plan === plan && ["active", "cancelled"].includes(s.status) && s.currentPeriodEnd > Date.now());
const isAdmin = (db) => { const u = db.users.find((x) => x.id === db.session); return u?.role === "admin"; };
function staff(db, superOnly = false) {
  const u = db.users.find((x) => x.id === db.session);
  if (u?.role === "admin") return { role: "admin", regions: null, canSee: () => true };
  if (u?.role === "moderator" && !superOnly) return { role: "moderator", regions: u.regions || [], canSee: (st) => (u.regions || []).includes(st) };
  throw new Error(superOnly ? "Super admins only" : "Admins only");
}
const bizVisible = (db, b) => b && b.status === "verified" && hasPlan(db, b.ownerId, "owner");
const pub = (b) => b && ({ id: b.id, name: b.name, category: b.category, rating: b.rating?.count ? b.rating : null, about: b.about, area: b.area, city: b.city, state: b.state, cityKey: b.cityKey, pincode: b.pincode, address: b.address, lat: b.lat, lng: b.lng, status: b.status });
const withBiz = (db, o) => ({ ...o, business: pub(db.businesses.find((b) => b.id === o.businessId)) });
const emit = () => listeners.forEach((cb) => cb());
function rerate(db, businessId) {
  const b = db.businesses.find((x) => x.id === businessId); if (!b) return;
  const rs = db.reviews.filter((r) => r.businessId === businessId && r.status === "published");
  b.rating = { avg: rs.length ? Math.round((rs.reduce((n, r) => n + r.rating, 0) / rs.length) * 10) / 10 : 0, count: rs.length };
}
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
  async signUp({ email, password, name, phone, consent }) {
    await wait();
    const db = load();
    if (db.users.some((x) => x.email.toLowerCase() === email.trim().toLowerCase())) throw new Error("An account with this email already exists");
    const u = { id: "u-" + rid(), email: email.trim(), password, name, phone: indianPhone(phone) || phone, role: "user", createdAt: Date.now(), consent: consent ? CONSENT_VERSION : null };
    if (consent) db.consentLog.push({ userId: u.id, kind: "user", version: CONSENT_VERSION, items: consent.items || [], at: Date.now() });
    db.users.push(u); db.session = u.id; save(db); emit();
    return { needsConfirmation: false };
  },
  async resetPassword() { await wait(); },
  async signOut() { const db = load(); db.session = null; save(db); emit(); },
  async getProfile() {
    const u = me(load());
    return { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role, regions: u.regions || [], consentVersion: u.consent || null, partnerConsentVersion: u.partnerConsent || null };
  },
  async updateProfile({ name, phone }) { const db = load(); const u = me(db); u.name = name; u.phone = indianPhone(phone) || phone; save(db); },

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
    const fields = { name: b.name, category: b.category, categories: [...new Set([b.category, ...(b.categories || [])].filter(Boolean))].slice(0, 3), about: b.about, address: b.address, area: b.area, city: b.city, state: b.state, cityKey: cityKey(b.city),
      pincode: String(b.pincode || "").trim(),
      lat: b.lat, lng: b.lng, phone: indianPhone(b.phone) || b.phone, whatsapp: !!b.whatsapp };
    let x = db.businesses.find((y) => y.ownerId === u.id);
    if (x) Object.assign(x, fields);
    else { x = { id: "b-" + rid(), ownerId: u.id, status: "pending", statusNote: "", reportCount: 0, createdAt: Date.now(), ...fields }; db.businesses.push(x); }
    save(db);
    return x.id;
  },

  async listLive(city) {
    await wait(80);
    const db = load(), now = Date.now();
    return db.offers.filter((o) => o.status === "live" && o.endsAt > now)
      .map((o) => withBiz(db, o)).filter((o) => o.business?.cityKey === city && bizVisible(db, db.businesses.find((b) => b.id === o.businessId)))
      .sort((a, b) => a.endsAt - b.endsAt);
  },
  async listNearby(lat, lng, radiusKm) {
    await wait(80);
    const db = load(), now = Date.now();
    return db.offers.filter((o) => o.status === "live" && o.endsAt > now).map((o) => withBiz(db, o))
      .filter((o) => bizVisible(db, db.businesses.find((b) => b.id === o.businessId)) && o.business?.lat != null && distanceKm({ lat, lng }, o.business) <= radiusKm)
      .sort((a, b) => a.endsAt - b.endsAt);
  },
  async listByPincode(pin) {
    await wait(80);
    const db = load(), now = Date.now();
    return db.offers.filter((o) => o.status === "live" && o.endsAt > now).map((o) => withBiz(db, o))
      .filter((o) => o.business?.pincode === String(pin) && bizVisible(db, db.businesses.find((b) => b.id === o.businessId)))
      .sort((a, b) => a.endsAt - b.endsAt);
  },
  async getConfig() { return { freeMode: load().config?.freeMode !== false }; },
  async adminSetConfig(cfg) { const db = load(); staff(db, true); db.config = { ...(db.config || {}), freeMode: cfg.freeMode !== false }; save(db); return db.config; },
  async listCities() {
    const db = load(), now = Date.now(), map = {};
    db.businesses.forEach((b) => { if (b.cityKey && !map[b.cityKey]) map[b.cityKey] = { key: b.cityKey, name: b.city, state: b.state, lat: b.lat, lng: b.lng, liveOffers: 0 }; });
    db.offers.forEach((o) => {
      const b = db.businesses.find((x) => x.id === o.businessId);
      if (b && map[b.cityKey] && o.status === "live" && o.endsAt > now && bizVisible(db, b)) map[b.cityKey].liveOffers++;
    });
    return Object.values(map).sort((a, b) => b.liveOffers - a.liveOffers);
  },
  async getOfferPhoto(id) { return load().photos?.[id] || null; },
  async myArchive() {
    const db = load(); const u = me(db);
    return (db.archive || []).filter((a) => a.ownerId === u.id).sort((a, b) => b.endsAt - a.endsAt);
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
    if (!b.city || !b.state || !b.pincode) throw new Error("Add your city, state and pincode in Business profile first");
    const allowed = b.categories?.length ? b.categories : [b.category];
    if (!allowed.includes(o.category)) throw new Error("Your business can post only in its registered categories. Add this category in Business profile first.");
    const id = rid();
    db.offers.push({ id, businessId: b.id, title: o.title, description: o.description, category: o.category, emoji: o.emoji, photoUrl: o.photoThumb || null,
      hasPhoto: !!o.photo, origPrice: o.origPrice, price: o.price, quantity: o.quantity, endsAt: o.endsAt, status: "live", views: 0, createdAt: Date.now(),
      flags: 1 - o.price / o.origPrice >= 0.9 ? ["very-high-discount"] : [] });
    if (o.photo) { db.photos = db.photos || {}; db.photos[id] = o.photo; }
    save(db);
  },
  async endOffer(id) { const db = load(); const o = db.offers.find((x) => x.id === id); if (o && o.status === "live") o.status = "ended"; save(db); },
  async addView(id) { const db = load(); const o = db.offers.find((x) => x.id === id); if (o) { o.views += 1; save(db); } },
  async uploadPhoto(file) {
    const [thumb, photo] = await Promise.all([compressPhoto(file, 360, 28000), compressPhoto(file, 1000, 190000)]);
    return { thumb, photo };
  },

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
    const o = db.offers.find((x) => x.id === offerId);
    const b = o && db.businesses.find((x) => x.id === o.businessId);
    if (b) b.reportCount = (b.reportCount || 0) + 1;
    db.reports.unshift({ id: rid(), offerId, reporterId: u.id, reason, details, status: "open", createdAt: Date.now(), state: b?.state || "", city: b?.city || "" });
    save(db);
  },

  // ---------- admin & moderators ----------
  async adminStats() {
    const db = load(); const s = staff(db);
    const now = Date.now();
    const cities = (await this.listCities()).filter((c) => s.canSee(c.state))
      .map((c) => ({ ...c, verifiedBusinesses: db.businesses.filter((b) => b.cityKey === c.key && b.status === "verified").length }));
    const active = (p) => db.subs.filter((x) => x.plan === p && ["active", "cancelled"].includes(x.status) && x.currentPeriodEnd > now).length;
    return {
      role: s.role, regions: s.regions, freeMode: db.config?.freeMode !== false,
      totals: {
        users: db.users.length, verified: db.businesses.filter((b) => b.status === "verified").length,
        pending: db.businesses.filter((b) => b.status === "pending").length, suspended: db.businesses.filter((b) => b.status === "suspended").length,
        customers: active("customer"), owners: active("owner"), leads30: db.leads.filter((l) => l.createdAt > now - 30 * D).length,
        openReports: db.reports.filter((r) => r.status === "open").length, archived: (db.archive || []).length,
        openGrievances: s.role === "admin" ? db.grievances.filter((g) => ["open", "acknowledged"].includes(g.status)).length : null,
        reviews: db.reviews.filter((r) => r.status === "published").length,
        liveOffers: cities.reduce((n, c) => n + c.liveOffers, 0),
      },
      cities,
    };
  },
  async adminFindUsers(q) {
    const db = load(); staff(db, true);
    const t = String(q || "").trim().toLowerCase(), d = t.replace(/\D/g, "");
    const list = !t ? db.users : db.users.filter((u) => u.email.toLowerCase().includes(t) || (d.length >= 6 && (u.phone || "").includes(d)) || (u.name || "").toLowerCase().startsWith(t));
    const sub = (u, p) => { const x = subOut(db.subs.find((s) => s.userId === u.id && s.plan === p)); return x && { status: x.status, until: x.currentPeriodEnd, active: x.active }; };
    return list.slice(0, 50).map((u) => {
      const b = db.businesses.find((x) => x.ownerId === u.id);
      return { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role || "user", regions: u.regions || [], createdAt: u.createdAt || null,
        customer: sub(u, "customer"), owner: sub(u, "owner"), business: b ? { name: b.name, city: b.city, state: b.state, status: b.status } : null };
    });
  },
  async adminSetRole(email, role, regions) {
    const db = load(); const s = staff(db, true);
    const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) throw new Error("No user with that email");
    if (u.id === db.session && role !== "admin") throw new Error("You can't remove your own admin access");
    u.role = role; u.regions = role === "moderator" ? regions || [] : []; save(db);
    return s;
  },
  async adminBusinesses({ status, state } = {}) {
    const db = load(); const s = staff(db);
    const list = db.businesses.filter((b) => (!status || b.status === status) && (!state || b.state === state) && s.canSee(b.state))
      .sort((a, b) => b.createdAt - a.createdAt);
    return list.map((b) => {
      const flags = [];
      if ((b.reportCount || 0) >= 2) flags.push(`Reported ${b.reportCount}×`);
      if (db.businesses.filter((x) => x.phone === b.phone).length > 1) flags.push("Same phone as another business");
      if (Date.now() - b.createdAt < 2 * D) flags.push("New in last 48 h");
      return { ...b, flags };
    });
  },
  async setBusinessStatus(id, status, note) {
    const db = load(); const s = staff(db);
    const b = db.businesses.find((x) => x.id === id);
    if (!b) throw new Error("Business not found");
    if (!s.canSee(b.state)) throw new Error("This business is outside your region");
    b.status = status; b.statusNote = note || ""; save(db);
  },
  async adminReports() {
    const db = load(); const s = staff(db);
    return db.reports.filter((r) => r.status === "open" && s.canSee(r.state))
      .map((r) => {
        const o = r.offerId && db.offers.find((x) => x.id === r.offerId);
        const rv = r.reviewId && db.reviews.find((x) => x.id === r.reviewId);
        return { ...r, type: r.type || "offer", offer: o && withBiz(db, o), review: rv && { ...rv, businessName: db.businesses.find((b) => b.id === rv.businessId)?.name || "" } };
      });
  },
  async resolveReport(id, status, removeOffer = false) {
    const db = load(); const s = staff(db);
    const r = db.reports.find((x) => x.id === id);
    if (!r) throw new Error("Report not found");
    if (!s.canSee(r.state)) throw new Error("This report is outside your region");
    if (removeOffer && r.offerId) { const o = db.offers.find((x) => x.id === r.offerId); if (o) o.status = "removed"; }
    if (removeOffer && r.reviewId) { const rv = db.reviews.find((x) => x.id === r.reviewId); if (rv) { rv.status = "hidden"; rerate(db, rv.businessId); } }
    r.status = status; save(db);
  },
  async adminSetPlan(email, plan, months) {
    const db = load(); staff(db, true);
    const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) throw new Error("No user with that email");
    let s = db.subs.find((x) => x.userId === u.id && x.plan === plan);
    if (!s) { s = { userId: u.id, plan, provider: "manual" }; db.subs.push(s); }
    if (months > 0) { s.status = "active"; s.currentPeriodEnd = Math.max(s.currentPeriodEnd || 0, Date.now()) + months * 30 * D; }
    else { s.status = "expired"; s.currentPeriodEnd = Date.now(); }
    save(db);
  },

  // ---------- reviews ----------
  async listReviews(businessId) {
    await wait(60);
    return load().reviews.filter((r) => r.businessId === businessId && r.status === "published").sort((a, b) => b.createdAt - a.createdAt);
  },
  async myReview(businessId) { const db = load(); const u = me(db); return db.reviews.find((r) => r.businessId === businessId && r.customerId === u.id) || null; },
  async ownerReviews() {
    const db = load(); const u = me(db); const b = db.businesses.find((x) => x.ownerId === u.id);
    return b ? db.reviews.filter((r) => r.businessId === b.id).sort((a, c) => c.createdAt - a.createdAt) : [];
  },
  async submitReview(businessId, rating, text) {
    await wait();
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.id === businessId);
    if (!b) throw new Error("Business not found");
    if (b.ownerId === u.id) throw new Error("You can't review your own business");
    if (!(rating >= 1 && rating <= 5)) throw new Error("Pick 1 to 5 stars");
    if (/[6-9]\d{9}/.test(text.replace(/[\s().+-]/g, "")) || /https?:\/\/|www\.|\S+@\S+\.\S+/i.test(text)) throw new Error("Please don't include phone numbers, e-mails or links in a review");
    const contacted = db.contacts.find((c) => c.customerId === u.id && db.offers.find((o) => o.id === c.offerId)?.businessId === businessId)
      || db.leads.find((l) => l.customerId === u.id && l.businessId === businessId);
    if (!contacted) throw new Error("You can review a business after you contact it through LastPick");
    const id = `${businessId}_${u.id}`;
    const prev = db.reviews.find((r) => r.id === id);
    const offerTitle = db.offers.find((o) => o.id === contacted.offerId)?.title || "";
    if (prev) Object.assign(prev, { rating, text: text.trim(), edited: true, updatedAt: Date.now() });
    else db.reviews.unshift({ id, businessId, customerId: u.id, name: (u.name || "Customer").split(" ")[0], rating, text: text.trim(), offerTitle, status: "published", createdAt: Date.now(), reply: null });
    rerate(db, businessId); save(db);
    return { ok: true };
  },
  async replyReview(reviewId, text) {
    const db = load(); const u = me(db);
    const r = db.reviews.find((x) => x.id === reviewId);
    const b = r && db.businesses.find((x) => x.id === r.businessId);
    if (!b || b.ownerId !== u.id) throw new Error("Only the business owner can reply");
    r.reply = text.trim() ? { text: text.trim(), at: Date.now() } : null; save(db);
  },
  async reportReview(reviewId, reason, details) {
    await wait();
    const db = load(); const u = me(db);
    const r = db.reviews.find((x) => x.id === reviewId); if (!r) throw new Error("Review not found");
    const b = db.businesses.find((x) => x.id === r.businessId);
    db.reports.unshift({ id: rid(), type: "review", reviewId, businessId: r.businessId, reporterId: u.id, reason, details, status: "open", createdAt: Date.now(), state: b?.state || "", city: b?.city || "" });
    save(db);
  },

  // ---------- privacy & complaints ----------
  async recordConsent(kind) {
    const db = load(); const u = me(db);
    if (kind === "partner") u.partnerConsent = CONSENT_VERSION; else u.consent = CONSENT_VERSION;
    db.consentLog.push({ userId: u.id, kind, version: CONSENT_VERSION, at: Date.now() }); save(db);
  },
  async exportMyData() {
    await wait(300);
    const db = load(); const u = me(db);
    const b = db.businesses.find((x) => x.ownerId === u.id);
    const { password, ...profile } = u; // eslint-disable-line no-unused-vars
    return {
      exportedAt: new Date().toISOString(), app: "LastPick (demo)", profile, business: b || null,
      contacts: db.contacts.filter((c) => c.customerId === u.id), numbersShared: db.leads.filter((l) => l.customerId === u.id),
      leadsReceived: b ? db.leads.filter((l) => l.businessId === b.id) : [], reviewsWritten: db.reviews.filter((r) => r.customerId === u.id),
      grievances: db.grievances.filter((g) => g.userId === u.id), consents: db.consentLog.filter((c) => c.userId === u.id),
    };
  },
  async deleteMyAccount() {
    await wait(300);
    const db = load(); const u = me(db);
    if (["admin", "moderator"].includes(u.role)) throw new Error("Staff accounts must have their admin role removed by another admin before they can be deleted");
    const b = db.businesses.find((x) => x.ownerId === u.id);
    if (b) { db.offers = db.offers.filter((o) => o.businessId !== b.id); db.leads = db.leads.filter((l) => l.businessId !== b.id); db.reviews = db.reviews.filter((r) => r.businessId !== b.id); db.businesses = db.businesses.filter((x) => x !== b); }
    db.contacts = db.contacts.filter((c) => c.customerId !== u.id); db.leads = db.leads.filter((l) => l.customerId !== u.id);
    const touched = db.reviews.filter((r) => r.customerId === u.id).map((r) => r.businessId);
    db.reviews = db.reviews.filter((r) => r.customerId !== u.id); touched.forEach((id) => rerate(db, id));
    db.subs = db.subs.filter((x) => x.userId !== u.id); db.users = db.users.filter((x) => x !== u); db.session = null;
    save(db); emit();
  },
  async submitGrievance(g) {
    await wait();
    const db = load(); const u = me(db);
    if ((g.subject || "").trim().length < 3 || (g.details || "").trim().length < 10) throw new Error("Please add a subject and some details");
    const ticket = "LP" + Date.now().toString(36).toUpperCase().slice(-6) + Math.floor(10 + Math.random() * 89);
    db.grievances.unshift({ ticket, userId: u.id, email: u.email, type: g.type, subject: g.subject.trim(), details: g.details.trim(), status: "open", reply: "", createdAt: Date.now(), updatedAt: Date.now() });
    save(db);
    return { ticket };
  },
  async myGrievances() { const db = load(); const u = me(db); return db.grievances.filter((g) => g.userId === u.id); },
  async adminGrievances(status = "open") { const db = load(); staff(db, true); return db.grievances.filter((g) => g.status === status).map((g) => ({ ...g, id: g.ticket })); },
  async adminUpdateGrievance(ticket, status, reply) {
    const db = load(); staff(db, true);
    const g = db.grievances.find((x) => x.ticket === ticket); if (!g) throw new Error("Ticket not found");
    Object.assign(g, { status, reply: reply || "", updatedAt: Date.now() }); save(db);
  },
  async logClientError(e) { console.warn("[client error]", e?.message); },
};
