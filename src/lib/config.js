// ---- Change these to rebrand or reprice the app ----
export const APP_NAME = "LastPick";
export const SUPPORT_EMAIL = "support@lastpick.in";
export const WEBSITE_URL = "https://lastpick-ce569.web.app";

// Which app this build is: "web" (everything), "customer" (LastPick app) or "owner" (LastPick Business app).
export const APP_VARIANT = import.meta.env?.VITE_APP_VARIANT || "web";
export const IS_OWNER_APP = APP_VARIANT === "owner";
export const IS_CUSTOMER_APP = APP_VARIANT === "customer";

// Prices shown in the app. The amount actually charged comes from the Razorpay plans
// (RAZORPAY_PLAN_CUSTOMER / RAZORPAY_PLAN_OWNER), so keep both in sync.
export const PLANS = {
  customer: {
    id: "customer", name: "Customer Pass", price: 49,
    perks: ["See every owner's phone number", "Call or WhatsApp owners directly", "Share your number with owners in one tap", "Keep a list of owners you contacted"],
  },
  owner: {
    id: "owner", name: "Owner Pro", price: 499,
    perks: ["Post unlimited offers", "Get customers' numbers when they're interested", "Shown to every customer nearby", "See views and leads for each offer"],
  },
};

// Default map centre when the user doesn't share location.
export const DEFAULT_LOCATION = { lat: 12.9716, lng: 77.5946, label: "Bengaluru" };

// Any kind of offer can be posted; "other" covers everything not listed.
export const CATEGORIES = [
  { id: "food", label: "Food & bakery", icon: "🍰" },
  { id: "grocery", label: "Grocery", icon: "🥬" },
  { id: "stay", label: "Hotels & stays", icon: "🛏️" },
  { id: "venue", label: "Halls & venues", icon: "💒" },
  { id: "travel", label: "Bus & travel", icon: "🚌" },
  { id: "rental", label: "Rentals", icon: "🚗" },
  { id: "sports", label: "Sports & fitness", icon: "⚽" },
  { id: "beauty", label: "Salon & spa", icon: "💇" },
  { id: "health", label: "Clinics & wellness", icon: "🩺" },
  { id: "retail", label: "Shopping", icon: "🛍️" },
  { id: "electronics", label: "Electronics", icon: "📱" },
  { id: "events", label: "Movies & events", icon: "🎬" },
  { id: "services", label: "Services", icon: "🛠️" },
  { id: "education", label: "Classes", icon: "📚" },
  { id: "other", label: "Anything else", icon: "📦" },
];
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

export const TINTS = {
  food: "#fff1e6", grocery: "#ecf8e6", stay: "#e9f0ff", venue: "#fdeaf3", travel: "#e8f7f1", rental: "#eaf4ff",
  sports: "#eef8e3", beauty: "#f4ecff", health: "#e6f6f8", retail: "#fff7dc", electronics: "#eef0f6",
  events: "#ffe9e9", services: "#f1efe8", education: "#e9edff", other: "#f2f2f6",
};

export const EMOJIS = ["🍰", "🥐", "🍱", "🥬", "🛏️", "💒", "🚌", "🚗", "⚽", "💇", "🩺", "👕", "📱", "🎬", "🛠️", "📚", "📦", "🎁"];

export const DURATIONS = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336, 720]; // hours, max 30 days

export const REPORT_REASONS = [
  "Fake or misleading offer",
  "Owner did not honour the offer",
  "Wrong or fake phone number",
  "Illegal or unsafe item",
  "Asked for advance payment / scam",
  "Something else",
];

// Quick-start templates for owners. Anything can be posted; these just save typing.
export const TEMPLATES = [
  { label: "Closing-time food", category: "food", emoji: "🍰", title: "Fresh stock before closing", origPrice: 500, price: 250, quantity: "Limited stock", hours: 3 },
  { label: "Tonight's rooms", category: "stay", emoji: "🛏️", title: "Rooms available for tonight", origPrice: 3000, price: 1799, quantity: "3 rooms", hours: 6 },
  { label: "Free hall date", category: "venue", emoji: "💒", title: "Function hall free on this date", origPrice: 150000, price: 90000, quantity: "1 date", hours: 72 },
  { label: "Empty seats", category: "travel", emoji: "🚌", title: "Seats left on tonight's bus", origPrice: 1200, price: 700, quantity: "5 seats", hours: 3 },
  { label: "Empty slot", category: "sports", emoji: "⚽", title: "Slot available today", origPrice: 1500, price: 900, quantity: "1 slot", hours: 3 },
  { label: "Idle vehicle", category: "rental", emoji: "🚗", title: "Self-drive car free this weekend", origPrice: 5000, price: 2999, quantity: "1 car", hours: 24 },
  { label: "Clearance stock", category: "retail", emoji: "🛍️", title: "Clearance sale, limited stock", origPrice: 1000, price: 499, quantity: "20 pieces", hours: 48 },
];

// ---- India ----
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
];

// Suggested cities (owners can type any city). lat/lng are used to pick the nearest city for a customer.
export const MAJOR_CITIES = [
  { name: "Bengaluru", state: "Karnataka", lat: 12.9716, lng: 77.5946 },
  { name: "Mumbai", state: "Maharashtra", lat: 19.076, lng: 72.8777 },
  { name: "Delhi", state: "Delhi", lat: 28.6139, lng: 77.209 },
  { name: "Hyderabad", state: "Telangana", lat: 17.385, lng: 78.4867 },
  { name: "Chennai", state: "Tamil Nadu", lat: 13.0827, lng: 80.2707 },
  { name: "Kolkata", state: "West Bengal", lat: 22.5726, lng: 88.3639 },
  { name: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567 },
  { name: "Ahmedabad", state: "Gujarat", lat: 23.0225, lng: 72.5714 },
  { name: "Jaipur", state: "Rajasthan", lat: 26.9124, lng: 75.7873 },
  { name: "Lucknow", state: "Uttar Pradesh", lat: 26.8467, lng: 80.9462 },
  { name: "Kochi", state: "Kerala", lat: 9.9312, lng: 76.2673 },
  { name: "Coimbatore", state: "Tamil Nadu", lat: 11.0168, lng: 76.9558 },
  { name: "Visakhapatnam", state: "Andhra Pradesh", lat: 17.6868, lng: 83.2185 },
  { name: "Vijayawada", state: "Andhra Pradesh", lat: 16.5062, lng: 80.648 },
  { name: "Chandigarh", state: "Chandigarh", lat: 30.7333, lng: 76.7794 },
  { name: "Indore", state: "Madhya Pradesh", lat: 22.7196, lng: 75.8577 },
  { name: "Nagpur", state: "Maharashtra", lat: 21.1458, lng: 79.0882 },
  { name: "Mysuru", state: "Karnataka", lat: 12.2958, lng: 76.6394 },
  { name: "Goa", state: "Goa", lat: 15.4909, lng: 73.8278 },
  { name: "Surat", state: "Gujarat", lat: 21.1702, lng: 72.8311 },
];

// "Bengaluru" -> "bengaluru"; used to group offers by city
export const cityKey = (name) => String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Data retention (days). The nightly cleanup job in functions/index.js uses the same numbers.
export const RETENTION = { endedOfferVisibleDays: 7, archiveDays: 365, leadsDays: 180, contactsDays: 180, reportsDays: 365 };
