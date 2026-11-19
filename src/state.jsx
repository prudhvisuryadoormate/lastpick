import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api/index.js";
import { DEFAULT_LOCATION } from "./lib/config.js";

// ---------------- tiny hash router ----------------
const readHash = () => {
  const h = (typeof window !== "undefined" && window.location.hash.slice(1)) || "/";
  const [path, qs] = h.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs || "")) };
};
export function navigate(to, { replace = false } = {}) {
  if (replace) window.location.replace("#" + to);
  else window.location.hash = to;
}
export function useRoute() {
  const [r, setR] = useState(readHash);
  useEffect(() => {
    const on = () => { setR(readHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}
// match("/offer/:id", "/offer/abc") -> { id: "abc" } | null
export function match(pattern, path) {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// ---------------- clock ----------------
export function useNow(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}

// ---------------- app state ----------------
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const readMode = () => { try { return localStorage.getItem("lastpick-mode") || "customer"; } catch { return "customer"; } };

export function AppProvider({ children }) {
  const [state, setState] = useState({ loading: true, session: null, profile: null, subs: { customer: null, owner: null }, business: null });
  const [mode, setModeState] = useState(readMode);
  const [toastMsg, setToastMsg] = useState("");
  const [location, setLocation] = useState({ ...DEFAULT_LOCATION, exact: false });

  const refresh = useCallback(async () => {
    try {
      const session = await api.getSession();
      if (!session) { setState({ loading: false, session: null, profile: null, subs: { customer: null, owner: null }, business: null }); return; }
      const [profile, subs, business] = await Promise.all([api.getProfile(), api.mySubscriptions(), api.myBusiness()]);
      setState({ loading: false, session, profile, subs, business });
    } catch (e) {
      console.error(e);
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => { refresh(); return api.onAuthChange(refresh); }, [refresh]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation({ lat: p.coords.latitude, lng: p.coords.longitude, label: "Your location", exact: true }),
      () => {}, { maximumAge: 600000, timeout: 8000 },
    );
  }, []);

  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(""), 2600); return () => clearTimeout(t); }, [toastMsg]);

  const setMode = (m) => { setModeState(m); try { localStorage.setItem("lastpick-mode", m); } catch { /* ignore */ } };

  const value = {
    ...state, refresh, mode, setMode, location, toast: setToastMsg,
    isCustomer: !!state.subs.customer?.active,
    isOwner: !!state.subs.owner?.active,
    isAdmin: state.profile?.role === "admin",
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}
