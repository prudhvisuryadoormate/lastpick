import { useEffect, useState } from "react";
import { DEMO_ACCOUNTS, api, isLive } from "../api/index.js";
import { BackButton, Empty, NeedLogin, PlanCard, Spinner } from "../components.jsx";
import { APP_NAME, INDIAN_STATES, IS_OWNER_APP, PLANS, SUPPORT_EMAIL } from "../lib/config.js";
import { ago, day, errText, prettyPhone, rupee, validPhone } from "../lib/format.js";
import { navigate, useApp } from "../state.jsx";

// ------------------------------------------------------------------ Subscribe
export function Subscribe({ plan }) {
  return <NeedLogin why="Log in to subscribe"><SubscribeInner plan={plan} /></NeedLogin>;
}
function SubscribeInner({ plan }) {
  const { subs, profile, refresh, toast, setMode } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  if (!PLANS[plan]) return <Empty icon="🤔" title="Unknown plan" />;
  const p = PLANS[plan], s = subs[plan];

  const pay = async () => {
    if (plan === "customer" && !validPhone(profile?.phone)) { setErr("Add your phone number in Account first, so owners can reach you."); return; }
    setBusy(true); setErr("");
    try { await api.subscribe(plan, profile); await refresh(); setDone(true); }
    catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  if (done || (s?.active && !busy)) {
    return (
      <div className="pad center" style={{ paddingTop: 50 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--ok)", color: "#fff", fontSize: 40, display: "grid", placeItems: "center", margin: "0 auto 14px" }}>✓</div>
        <h1 className="title">{done ? "You're subscribed!" : `${p.name} is active`}</h1>
        <p className="muted">{p.name} is active till {day(subs[plan]?.currentPeriodEnd || Date.now() + 30 * 86400000)}. It renews monthly; cancel anytime in Account.</p>
        <button className="btn main" style={{ marginTop: 10 }} onClick={() => { if (plan === "owner") { setMode("owner"); navigate("/owner"); } else { setMode("customer"); navigate("/"); } }}>
          {plan === "owner" ? "Start posting offers" : "Start exploring offers"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="page-h" style={{ paddingTop: 0 }}><h1 className="title">{plan === "owner" ? "Owner subscription" : "Customer subscription"}</h1><div className="muted">Monthly plan · cancel anytime</div></div>
      <PlanCard plan={plan} />
      <div className="pad">
        {!isLive && <div className="banner warn" style={{ margin: "0 0 12px" }}>Demo mode: no real payment is taken.</div>}
        {err && <div className="error" style={{ marginBottom: 12 }}>{err} {err.includes("phone") && <a className="link" href="#/account">Open Account</a>}</div>}
        <button className="btn main" disabled={busy} onClick={pay}>{busy ? "Opening payment…" : `Subscribe for ${rupee(p.price)}/month`}</button>
        <div className="note">Pay with UPI AutoPay, cards or net banking through Razorpay. You can cancel anytime; the plan stays active until the end of the paid month.
          {" "}{APP_NAME} only connects customers and owners; offers and services are between them.</div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Login / sign up
export function Login({ next = "/" }) {
  const { session, toast } = useApp();
  const [tab, setTab] = useState("login");
  const [f, setF] = useState({ name: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const go = () => navigate(next || "/", { replace: true });

  if (session) { setTimeout(go, 0); return <Spinner />; }

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr("Please enter a valid email");
    if (tab === "reset") {
      setBusy(true);
      try { await api.resetPassword(f.email); toast("Password reset link sent to your email"); setTab("login"); } catch (x) { setErr(errText(x)); }
      setBusy(false); return;
    }
    if (f.password.length < 6) return setErr("Password must be at least 6 characters");
    if (tab === "signup") {
      if (!f.name.trim()) return setErr("Please enter your name");
      if (!validPhone(f.phone)) return setErr("Please enter a valid Indian mobile number (+91)");
    }
    setBusy(true);
    try {
      if (tab === "login") await api.signIn(f.email, f.password);
      else {
        const r = await api.signUp({ email: f.email.trim(), password: f.password, name: f.name.trim(), phone: f.phone.trim() });
        if (r?.needsConfirmation) { toast("Check your email to confirm your account"); setBusy(false); setTab("login"); return; }
      }
      toast(tab === "login" ? "Welcome back!" : `Welcome to ${APP_NAME}!`);
    } catch (x) { setErr(errText(x)); }
    setBusy(false);
  };

  const demoLogin = async (a) => { setBusy(true); try { await api.signIn(a.email, a.password); } catch (x) { setErr(errText(x)); } setBusy(false); };

  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="hdr" style={{ padding: "34px 20px 26px" }}>
        <div className="brand"><span className="logo">L</span>{APP_NAME}{IS_OWNER_APP ? " Business" : ""}</div>
        <p style={{ opacity: .8, margin: "14px 0 0", lineHeight: 1.5 }}>{IS_OWNER_APP
          ? "Turn empty rooms, halls, seats, slots and leftover stock into sales. Post an offer in a minute and get calls from customers nearby."
          : "Last-minute offers from businesses near you: rooms, halls, seats, food, slots and more. Talk to the owner directly."}</p>
      </div>
      {tab !== "reset" && <div className="tabs" style={{ marginTop: 16 }}>
        <button className={tab === "login" ? "on" : ""} onClick={() => { setTab("login"); setErr(""); }}>Log in</button>
        <button className={tab === "signup" ? "on" : ""} onClick={() => { setTab("signup"); setErr(""); }}>Sign up</button>
      </div>}
      <form className="form" onSubmit={submit} style={{ paddingTop: tab === "reset" ? 20 : 4 }}>
        {tab === "reset" && <div><h2 className="title" style={{ fontSize: 19 }}>Reset password</h2><div className="muted">We'll email you a link to set a new password.</div></div>}
        {tab === "signup" && <>
          <div className="fld"><label>Your name</label><input autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="fld"><label>Mobile number (India)</label><input inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" /></div>
        </>}
        <div className="fld"><label>Email</label><input type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        {tab !== "reset" && <div className="fld"><label>Password</label><input type="password" autoComplete={tab === "login" ? "current-password" : "new-password"} value={f.password} onChange={(e) => set("password", e.target.value)} /></div>}
        {err && <div className="error">{err}</div>}
        <button className="btn main" disabled={busy}>{busy ? "Please wait…" : tab === "login" ? "Log in" : tab === "signup" ? "Create account" : "Send reset link"}</button>
        {tab === "login" && <button type="button" className="link" onClick={() => setTab("reset")}>Forgot password?</button>}
        {tab === "reset" && <button type="button" className="link" onClick={() => setTab("login")}>Back to log in</button>}
        {tab === "signup" && <div className="note" style={{ marginTop: 0 }}>By signing up you agree to our <a className="link" href="#/terms">terms</a>, <a className="link" href="#/privacy">privacy policy</a> and <a className="link" href="#/refund">refund policy</a>. {APP_NAME} is available in India only.</div>}
      </form>
      {!isLive && (
        <div className="pad">
          <div className="label-up" style={{ padding: "0 0 8px" }}>Demo accounts (demo mode only)</div>
          {DEMO_ACCOUNTS.map((a) => <button key={a.email} className="btn ghost" style={{ marginBottom: 8, justifyContent: "space-between" }} disabled={busy} onClick={() => demoLogin(a)}><span>{a.label}</span><span className="muted small">{a.email}</span></button>)}
        </div>
      )}
      {!IS_OWNER_APP && <div className="pad center"><a className="link" href="#/">← Browse offers without logging in</a></div>}
      <div className="center small muted" style={{ paddingBottom: 24 }}>
        <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a> · <a href="#/refund">Refunds</a> · <a href="#/contact">Contact</a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Legal & help
export function Terms() {
  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="legal">
        <h1 className="title">Terms of use & disclaimer</h1>
        <p className="muted">Template text: have a lawyer review it before launch.</p>
        <h2>1. What {APP_NAME} is</h2>
        <p>{APP_NAME} is a listing platform. Businesses ("owners") post offers. Customers with an active Customer Pass can see an owner's contact number and contact them, or share their own number with the owner. {APP_NAME} does not sell, book, deliver or guarantee any offer.</p>
        <h2>2. The deal is between customer and owner</h2>
        <p>Any agreement, payment, delivery or service happens directly between the customer and the owner. {APP_NAME} is not a party to it and is not responsible for the quality, safety, legality or availability of any offer, or for any loss, dispute or misuse arising from it.</p>
        <h2>3. Subscriptions</h2>
        <p>The Customer Pass ({rupee(PLANS.customer.price)}/month) and Owner Pro ({rupee(PLANS.owner.price)}/month) renew monthly until cancelled. Cancelling stops the next renewal; the plan stays active until the end of the paid period. Fees are for access to the platform and are not refundable for partial months, except where the law requires.</p>
        <h2>4. Owners' responsibilities</h2>
        <p>Owners must post only genuine offers they can honour, keep their contact number correct, hold any licences their business needs, and not post illegal, unsafe, misleading or prohibited items. Owners are responsible for their offers and for how they use customers' numbers. Customer numbers may be used only to respond about the offer they were shared for, never for spam or resale.</p>
        <h2>5. Customers' responsibilities</h2>
        <p>Customers should verify an offer and the owner before paying anything. Never pay an advance to someone you haven't verified. Use owners' numbers only to ask about their offers.</p>
        <h2>6. Verification, reports and removal</h2>
        <p>We verify businesses before their offers are shown, but verification is not a guarantee. Anyone can report an offer. We may remove offers or suspend accounts that break these terms, without refund of subscription fees.</p>
        <h2>7. Contact</h2>
        <p>Grievances and questions: see <a className="link" href="#/help">Help & support</a>.</p>
      </div>
    </>
  );
}

export function Privacy() {
  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="legal">
        <h1 className="title">Privacy policy</h1>
        <p className="muted">Template text: have a lawyer review it against India's Digital Personal Data Protection Act before launch.</p>
        <h2>What we collect</h2>
        <p>Your name, email and phone number; for owners, business details, location and contact number; your subscriptions; offers you view or contact; and reports you make. Payments are processed by Razorpay; we don't store card or UPI details.</p>
        <h2>Who sees your number</h2>
        <p>A customer's phone number is shared with an owner only when the customer taps "Share my number" on that owner's offer. An owner's contact number is shown only to customers with an active Customer Pass.</p>
        <h2>How we use data</h2>
        <p>To run the platform, show nearby offers, process subscriptions, prevent misuse and provide support. We don't sell personal data.</p>
        <h2>Your choices</h2>
        <p>You can edit your details in Account at any time. To delete your account and data, contact us through Help & support.</p>
      </div>
    </>
  );
}

export function Help() {
  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="legal">
        <h1 className="title">Help & support</h1>
        <h2>How does {APP_NAME} work?</h2>
        <p>Owners post offers on things they need to move fast. Customers browse for free; with the Customer Pass they can see the owner's number, call or WhatsApp them, or share their own number so the owner calls back.</p>
        <h2>The owner didn't honour the offer</h2>
        <p>Open the offer and tap "Report this offer". Our team reviews every report and can remove offers or suspend businesses.</p>
        <h2>Cancel a subscription</h2>
        <p>Account → your plan → Cancel. You keep access until the end of the paid month.</p>
        <h2>Contact us</h2>
        <p>Email <a className="link" href={"mailto:" + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a>. We reply within 2 working days.</p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Refund & contact (needed for payment-gateway KYC)
export function Refund() {
  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="legal">
        <h1 className="title">Refund & cancellation policy</h1>
        <p className="muted">Template text: have a lawyer review it before launch.</p>
        <h2>Subscriptions</h2>
        <p>The Customer Pass ({rupee(PLANS.customer.price)}/month) and Owner Pro ({rupee(PLANS.owner.price)}/month) are monthly subscriptions that renew automatically through UPI AutoPay, card or net-banking mandates.</p>
        <h2>Cancelling</h2>
        <p>You can cancel anytime in Account. Cancelling stops the next renewal and cancels the mandate; your plan stays active until the end of the month you already paid for.</p>
        <h2>Refunds</h2>
        <p>Fees already paid are not refunded for partial months. If you were charged by mistake (for example a duplicate charge, or a renewal after you cancelled), contact us within 7 days and we will refund the full amount to the original payment method within 7 working days.</p>
        <h2>Offers and deals</h2>
        <p>{APP_NAME} does not sell, collect payment for, or deliver any offer listed in the app. Payments for offers are made directly to the business, so refunds for offers must be requested from that business.</p>
        <h2>Contact</h2>
        <p>Email <a className="link" href={"mailto:" + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a> with your registered email and payment details.</p>
      </div>
    </>
  );
}

export function Contact() {
  return (
    <>
      <div style={{ position: "relative", height: 62 }}><BackButton /></div>
      <div className="legal">
        <h1 className="title">Contact us</h1>
        <p>We usually reply within 2 working days.</p>
        <h2>Support and grievances</h2>
        <p>Email: <a className="link" href={"mailto:" + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a></p>
        <p className="muted">Add your registered business name, address, phone number and grievance officer here before launch (required for Indian e-commerce rules and payment-gateway KYC).</p>
        <h2>Report an offer</h2>
        <p>Open the offer and tap "Report this offer". Our team reviews every report.</p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Admin & moderators
export function Admin() {
  return <NeedLogin why="Log in as admin"><AdminInner /></NeedLogin>;
}
function AdminInner() {
  const { isStaff, isAdmin, profile, toast } = useApp();
  const [tab, setTab] = useState("overview");
  if (!isStaff) return <Empty icon="⛔" title="Admins only">Your account doesn't have admin access.</Empty>;
  const tabs = isAdmin
    ? [["overview", "Overview"], ["businesses", "Businesses"], ["reports", "Reports"], ["users", "Users"], ["plans", "Plans"], ["team", "Team"]]
    : [["overview", "Overview"], ["businesses", "Businesses"], ["reports", "Reports"]];
  return (
    <>
      <div className="page-h">
        <h1 className="title">{isAdmin ? "Admin" : "Moderator"}</h1>
        <div className="muted">{isAdmin ? "All of India" : `Your regions: ${(profile?.regions || []).join(", ") || "none assigned yet"}`}</div>
      </div>
      <div className="chips" style={{ paddingTop: 4 }}>{tabs.map(([id, l]) => <button key={id} className={"chip " + (tab === id ? "on" : "")} onClick={() => setTab(id)}>{l}</button>)}</div>
      {tab === "overview" && <AdminOverview toast={toast} go={setTab} />}
      {tab === "businesses" && <AdminBusinesses toast={toast} />}
      {tab === "reports" && <AdminReports toast={toast} />}
      {tab === "users" && isAdmin && <AdminUsers toast={toast} />}
      {tab === "plans" && isAdmin && <AdminPlans toast={toast} />}
      {tab === "team" && isAdmin && <AdminTeam toast={toast} />}
    </>
  );
}

function AdminOverview({ toast, go }) {
  const [data, setData] = useState(null);
  const [stateFilter, setStateFilter] = useState("");
  useEffect(() => { api.adminStats().then(setData).catch((e) => { toast(errText(e)); setData({ totals: {}, cities: [] }); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Spinner />;
  const t = data.totals;
  const mrr = (t.customers || 0) * PLANS.customer.price + (t.owners || 0) * PLANS.owner.price;
  const cities = data.cities.filter((c) => !stateFilter || c.state === stateFilter);
  const states = [...new Set(data.cities.map((c) => c.state).filter(Boolean))].sort();
  const Kpi = ({ n, l, onClick }) => <div className="kpi" onClick={onClick} style={onClick ? { cursor: "pointer" } : null}><div className="n">{n ?? "…"}</div><div className="l">{l}</div></div>;
  return (
    <>
      <div className="plan" style={{ padding: 16, marginTop: 4 }}>
        <div style={{ opacity: .75, fontSize: 13 }}>Monthly recurring revenue (active plans)</div>
        <div className="amt" style={{ fontSize: 32 }}>{rupee(mrr)}</div>
        <div style={{ opacity: .75, fontSize: 12.5 }}>{t.customers} Customer Pass × {rupee(PLANS.customer.price)} + {t.owners} Owner Pro × {rupee(PLANS.owner.price)}</div>
      </div>
      <div className="kpis">
        <Kpi n={t.users} l="Registered users" onClick={() => go("users")} />
        <Kpi n={t.liveOffers} l="Live offers" />
        <Kpi n={t.verified} l="Verified businesses" onClick={() => go("businesses")} />
        <Kpi n={t.pending} l="Waiting for verification" onClick={() => go("businesses")} />
        <Kpi n={t.openReports} l="Open reports" onClick={() => go("reports")} />
        <Kpi n={t.leads30} l="Numbers shared (30 days)" />
        <Kpi n={t.suspended} l="Suspended businesses" />
        <Kpi n={t.archived} l="Archived offers" />
      </div>
      <div className="sect"><h3>By city</h3>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by state"><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      {cities.length === 0 ? <div className="muted pad" style={{ paddingTop: 0 }}>No cities yet. Cities appear when businesses there post offers.</div> : (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <table className="admin">
            <thead><tr style={{ background: "#f6f7fb", textAlign: "left" }}><th style={{ padding: 10 }}>City</th><th>State</th><th style={{ textAlign: "right" }}>Live offers</th><th style={{ textAlign: "right", paddingRight: 10 }}>Verified businesses</th></tr></thead>
            <tbody>{cities.map((c) => <tr key={c.key} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: 10, fontWeight: 600 }}>{c.name}</td><td className="muted">{c.state}</td><td style={{ textAlign: "right" }}>{c.liveOffers}</td><td style={{ textAlign: "right", paddingRight: 10 }}>{c.verifiedBusinesses ?? "-"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AdminBusinesses({ toast }) {
  const [list, setList] = useState(null);
  const [status, setStatus] = useState("pending");
  const [state, setState] = useState("");
  const [note, setNote] = useState("");
  const load = () => { setList(null); api.adminBusinesses({ status: status === "all" ? null : status, state: state || null }).then(setList).catch((e) => { toast(errText(e)); setList([]); }); };
  useEffect(() => { load(); }, [status, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (b, st) => {
    try { await api.setBusinessStatus(b.id, st, st === "verified" ? "" : note.trim()); toast(`${b.name}: ${st}`); setNote(""); load(); } catch (e) { toast(errText(e)); }
  };
  return (
    <>
      <div className="chips" style={{ paddingTop: 0 }}>{["pending", "verified", "rejected", "suspended", "all"].map((s) => <button key={s} className={"chip " + (status === s ? "on" : "")} onClick={() => setStatus(s)}>{s}</button>)}</div>
      <div className="form" style={{ paddingBottom: 8 }}>
        <div className="fld"><select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">All states</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="fld"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to owner when rejecting or suspending" /></div>
      </div>
      {!list ? <Spinner /> : list.length === 0 ? <Empty icon="✅" title="Nothing here" /> : list.map((b) => (
        <div className="panel" key={b.id}>
          <div className="row"><b>{b.name}</b><span className={"pill " + (b.status === "verified" ? "p-ok" : b.status === "pending" ? "p-warn" : "p-bad")}>{b.status}</span></div>
          <div className="muted small">{b.category} · {b.address || "-"}, {b.area}, {b.city}, {b.state || "state missing"}</div>
          <div className="muted small">📞 {b.phone ? prettyPhone(b.phone) : "no number"} · {b.lat != null ? "📍 location set" : "no map location"}{b.createdAt ? " · joined " + ago(b.createdAt) : ""}</div>
          {b.flags?.length > 0 && <div className="gap" style={{ flexWrap: "wrap", marginTop: 6 }}>{b.flags.map((f) => <span key={f} className="pill p-bad">⚠️ {f}</span>)}</div>}
          {b.statusNote && <div className="muted small">Note: {b.statusNote}</div>}
          <div className="gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
            {b.phone && <a className="btn ghost sm" href={"tel:" + b.phone}>📞 Call to verify</a>}
            {b.status !== "verified" && <button className="btn main sm" onClick={() => act(b, "verified")}>Verify</button>}
            {b.status === "pending" && <button className="btn ghost sm" onClick={() => act(b, "rejected")}>Reject</button>}
            {b.status === "verified" && <button className="btn danger sm" onClick={() => act(b, "suspended")}>Suspend</button>}
          </div>
        </div>
      ))}
    </>
  );
}

function AdminReports({ toast }) {
  const [list, setList] = useState(null);
  const load = () => api.adminReports().then(setList).catch((e) => { toast(errText(e)); setList([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = async (r, status, removeOffer) => {
    try { await api.resolveReport(r.id, status, removeOffer); toast(removeOffer ? "Offer removed" : "Report " + status); load(); } catch (e) { toast(errText(e)); }
  };
  return !list ? <Spinner /> : list.length === 0 ? <Empty icon="🎉" title="No open reports" /> : list.map((r) => (
    <div className="panel" key={r.id}>
      <div className="row"><b>{r.reason}</b><span className="muted small">{r.createdAt ? ago(r.createdAt) : ""}</span></div>
      <div className="muted small">{[r.city, r.state].filter(Boolean).join(", ")}</div>
      {r.details && <div className="muted small" style={{ marginTop: 4 }}>{r.details}</div>}
      <div className="box small" style={{ marginTop: 8 }}>{r.offer ? <><a className="link" href={"#/offer/" + r.offer.id}>{r.offer.title}</a> · {r.offer.business?.name} · {r.offer.status}</> : "Offer already archived"}</div>
      <div className="gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
        {r.offer && r.offer.status !== "removed" && <button className="btn danger sm" onClick={() => resolve(r, "actioned", true)}>Remove offer</button>}
        <button className="btn ghost sm" onClick={() => resolve(r, "dismissed", false)}>Dismiss</button>
      </div>
    </div>
  ));
}

function AdminUsers({ toast }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const search = (term) => { setList(null); api.adminFindUsers(term).then(setList).catch((e) => { toast(errText(e)); setList([]); }); };
  useEffect(() => { search(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = (s) => !s ? <span className="pill p-mute">none</span> : s.active ? <span className="pill p-ok">till {day(s.until)}</span> : <span className="pill p-bad">{s.status}</span>;
  return (
    <>
      <form className="form" style={{ paddingBottom: 8 }} onSubmit={(e) => { e.preventDefault(); search(q.trim()); }}>
        <div className="gap"><input style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 12, padding: "11px 12px" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, phone number or name" aria-label="Search users" />
          <button className="btn dark sm">Search</button></div>
        <div className="muted small">Leave empty to see the newest 50 sign-ups.</div>
      </form>
      {!list ? <Spinner /> : list.length === 0 ? <Empty icon="🔍" title="No users found" /> : list.map((u) => (
        <div className="panel" key={u.id}>
          <div className="row"><b>{u.name || "(no name)"}</b>{u.role !== "user" && <span className="pill p-new">{u.role}</span>}</div>
          <div className="muted small">{u.email} · {u.phone ? prettyPhone(u.phone) : "no phone"}{u.createdAt ? " · joined " + day(u.createdAt) : ""}</div>
          <div className="gap" style={{ marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small">Customer Pass:</span> {plan(u.customer)}
            <span className="small">Owner Pro:</span> {plan(u.owner)}
          </div>
          {u.business && <div className="muted small" style={{ marginTop: 6 }}>🏪 {u.business.name} · {u.business.city}, {u.business.state} · {u.business.status}</div>}
        </div>
      ))}
    </>
  );
}

function AdminPlans({ toast }) {
  const [f, setF] = useState({ email: "", plan: "customer", months: 1 });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.adminSetPlan(f.email.trim(), f.plan, Number(f.months)); toast(Number(f.months) > 0 ? "Plan activated" : "Plan ended"); setF({ ...f, email: "" }); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  };
  return (
    <div className="form">
      <div className="muted">Activate or extend a plan manually, e.g. for testers or when someone paid outside the app. Set months to 0 to end a plan.</div>
      <div className="fld"><label>User's email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="two">
        <div className="fld"><label>Plan</label><select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="customer">{PLANS.customer.name}</option><option value="owner">{PLANS.owner.name}</option></select></div>
        <div className="fld"><label>Months</label><input type="number" min="0" max="24" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>
      </div>
      <button className="btn dark" disabled={busy || !f.email} onClick={submit}>{busy ? "Saving…" : "Apply"}</button>
    </div>
  );
}

function AdminTeam({ toast }) {
  const [f, setF] = useState({ email: "", role: "moderator", regions: [] });
  const [busy, setBusy] = useState(false);
  const toggle = (st) => setF((p) => ({ ...p, regions: p.regions.includes(st) ? p.regions.filter((x) => x !== st) : [...p.regions, st] }));
  const submit = async () => {
    if (f.role === "moderator" && f.regions.length === 0) return toast("Pick at least one state for the moderator");
    setBusy(true);
    try { await api.adminSetRole(f.email.trim(), f.role, f.regions); toast(`Saved: ${f.email} is now ${f.role}`); setF({ email: "", role: "moderator", regions: [] }); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  };
  return (
    <div className="form">
      <div className="muted">Moderators can verify businesses and handle reports only in the states you give them. Admins see all of India. The person must have signed up first.</div>
      <div className="fld"><label>Email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="fld"><label>Role</label>
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="moderator">Moderator (selected states)</option><option value="admin">Admin (all of India)</option><option value="user">Normal user (remove access)</option>
        </select></div>
      {f.role === "moderator" && (
        <div className="fld"><label>States ({f.regions.length} selected)</label>
          <div className="emoji-pick" style={{ gap: 6 }}>{INDIAN_STATES.map((st) => <button type="button" key={st} className={"chip " + (f.regions.includes(st) ? "on" : "")} onClick={() => toggle(st)}>{st}</button>)}</div></div>
      )}
      <button className="btn dark" disabled={busy || !f.email} onClick={submit}>{busy ? "Saving…" : "Save role"}</button>
    </div>
  );
}
