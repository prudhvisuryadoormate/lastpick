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
