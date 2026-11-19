// Uses the live Firebase backend when it's configured, otherwise the in-browser demo.
import { api as demo } from "./demo.js";
import { api as live } from "./firebase.js";

export const isLive = Boolean(import.meta.env?.VITE_FIREBASE_API_KEY);
export const api = isLive ? live : demo;
export { DEMO_ACCOUNTS } from "./demo.js";
