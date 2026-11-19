import { useEffect, useRef, useState } from "react";
import { api } from "../api/index.js";
import { Empty, NeedLogin, OfferCard, PlanCard, Sheet, Spinner, Toggle } from "../components.jsx";
import { APP_NAME, CATEGORIES, DURATIONS, EMOJIS, IS_OWNER_APP, PLANS, TEMPLATES, TINTS } from "../lib/config.js";
import { ago, day, errText, rupee, telLink, timeLeft, validPhone, waLink } from "../lib/format.js";
import { navigate, useApp, useNow } from "../state.jsx";

// Every owner page goes through this gate: login -> business profile -> Owner Pro -> page.
export function OwnerGate({ children, allowWithoutPlan = false }) {
  return <NeedLogin why="Log in to post offers"><Gate allowWithoutPlan={allowWithoutPlan}>{children}</Gate></NeedLogin>;
}
function Gate({ children, allowWithoutPlan }) {
  const { business, isOwner, loading } = useApp();
  if (loading) return <Spinner />;
  if (!business) return <BusinessForm first />;
  if (!isOwner && !allowWithoutPlan) return <OwnerPaywall />;
  return children;
}

function OwnerPaywall() {
  const { business } = useApp();
  return (
    <>
      <div className="page-h owner-row"><div className="avatar">{business.name[0]}</div><div><h1 className="title" style={{ fontSize: 20 }}>{business.name}</h1><div className="muted">Owner account · {business.area}</div></div></div>
      <div className="status no"><span style={{ fontSize: 24 }}>🔒</span><div><b>Subscribe to post offers</b><div className="muted small">Your offers go live to every customer near you.</div></div></div>
      <PlanCard plan="owner" />
      <div className="pad">
        <a className="btn main" href="#/subscribe/owner">Subscribe · {rupee(PLANS.owner.price)}/month</a>
        <div className="note">Turn empty rooms, seats, halls, slots and leftover stock into sales instead of losses.</div>
      </div>
    </>
  );
}

function StatusBanner() {
  const { business } = useApp();
  if (!business || business.status === "verified") return null;
  const msg = {
    pending: ["warn", "⏳ Your business is waiting for verification. You can post offers now; they become visible to customers once we verify you (usually within 24 hours)."],
    rejected: ["bad", `✖ Verification was rejected${business.statusNote ? ": " + business.statusNote : ""}. Update your business details or contact support.`],
    suspended: ["bad", `⛔ Your business is suspended${business.statusNote ? ": " + business.statusNote : ""}. Your offers are hidden. Contact support.`],
  }[business.status];
  return msg ? <div className={"banner " + msg[0]}>{msg[1]}</div> : null;
}

// ------------------------------------------------------------------ Dashboard
export function OwnerDashboard() {
  const { business, subs, setMode } = useApp();
  const [offers, setOffers] = useState(null);
  const [leads, setLeads] = useState(null);
  const now = useNow(30000);
  const load = () => { api.myOffers().then(setOffers).catch(() => setOffers([])); api.ownerLeads().then(setLeads).catch(() => setLeads([])); };
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = (offers || []).filter((o) => o.status === "live" && o.endsAt > now);
  const monthLeads = (leads || []).filter((l) => l.createdAt > now - 30 * 86400000).length;
  const newLeads = (leads || []).filter((l) => l.status === "new");
  const views = (offers || []).reduce((s, o) => s + (o.views || 0), 0);

  return (
    <>
      <div className="page-h row">
        <div><div className="muted">Owner dashboard</div><h1 className="title">{business.name}</h1></div>
        <a className="pill p-ok" href="#/owner/business">{business.status === "verified" ? "✔ Verified" : "Profile"}</a>
      </div>
      <StatusBanner />
      <div className="plan" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ opacity: .75, fontSize: 13 }}>Interested customers, last 30 days</div>
        <div className="amt" style={{ fontSize: 34 }}>{leads ? monthLeads : "…"}</div>
        <div style={{ opacity: .75, fontSize: 12.5 }}>{views} views on your offers · Owner Pro {subs.owner?.status === "cancelled" ? "ends" : "renews"} {day(subs.owner.currentPeriodEnd)}</div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="n">{offers ? live.length : "…"}</div><div className="l">Live offers</div></div>
        <div className="kpi"><div className="n">{leads ? newLeads.length : "…"}</div><div className="l">New leads to call</div></div>
      </div>
      <div className="pad gap">
        <a className="btn main" href="#/owner/post">＋ Post an offer</a>
        <a className="btn dark" href="#/owner/leads">📇 Leads</a>
      </div>
      <div className="sect"><h3>Latest interested customers</h3><a className="link small" href="#/owner/leads">See all</a></div>
      {!leads ? <Spinner /> : leads.length === 0
        ? <div className="muted pad" style={{ paddingTop: 0 }}>When a customer taps "Share my number" on your offer, they appear here.</div>
        : leads.slice(0, 4).map((l) => <LeadRow key={l.id} lead={l} onChange={load} />)}
      {!IS_OWNER_APP && <div className="pad"><button className="btn ghost" onClick={() => { setMode("customer"); navigate("/"); }}>👤 Switch to customer view</button></div>}
    </>
  );
}

function LeadRow({ lead, onChange }) {
  const { business } = useApp();
  const mark = async () => { if (lead.status === "new") { await api.setLeadStatus(lead.id, "contacted").catch(() => {}); onChange?.(); } };
  return (
    <div className="item">
      <div className="avatar" style={{ width: 40, height: 40, fontSize: 16 }}>{(lead.name || "?")[0]}</div>
      <div className="grow">
        <div className="gap" style={{ alignItems: "center", gap: 6 }}><b style={{ fontSize: 14 }}>{lead.name}</b>
          {lead.status === "new" ? <span className="pill p-new">New</span> : lead.status === "contacted" ? <span className="pill p-mute">Contacted</span> : <span className="pill p-ok">Closed</span>}</div>
        <div className="muted small">{lead.phone}</div>
        <div className="muted small ellipsis">{lead.offerEmoji} {lead.offerTitle} · {ago(lead.createdAt)}</div>
      </div>
      <a className="icon-btn" aria-label="Call" href={telLink(lead.phone)} onClick={mark}>📞</a>
      <a className="icon-btn wa" aria-label="WhatsApp" target="_blank" rel="noreferrer" onClick={mark}
        href={waLink(lead.phone, `Hi ${lead.name}, this is ${business?.name} from ${APP_NAME}, about "${lead.offerTitle}".`)}>💬</a>
    </div>
  );
}

// ------------------------------------------------------------------ Leads
export function OwnerLeads() {
  const [leads, setLeads] = useState(null);
  const [filter, setFilter] = useState("all");
  const load = () => api.ownerLeads().then(setLeads).catch(() => setLeads([]));
  useEffect(() => { load(); }, []);
  const shown = (leads || []).filter((l) => filter === "all" || l.status === filter);
  return (
    <>
      <div className="page-h"><h1 className="title">Leads</h1><div className="muted">Customers who shared their number with you</div></div>
      <div className="tabs">{[["all", "All"], ["new", "New"], ["contacted", "Contacted"]].map(([id, l]) => <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{l}</button>)}</div>
      {!leads ? <Spinner /> : shown.length === 0
        ? <Empty icon="📭" title="No leads here yet">When a customer taps "Share my number" on your offer, they appear here.</Empty>
        : shown.map((l) => <LeadRow key={l.id} lead={l} onChange={load} />)}
    </>
  );
}

// ------------------------------------------------------------------ My offers
export function OwnerOffers() {
  const { toast } = useApp();
  const [offers, setOffers] = useState(null);
  const [ending, setEnding] = useState(null);
  const now = useNow(30000);
  const load = () => api.myOffers().then(setOffers).catch(() => setOffers([]));
  useEffect(() => { load(); }, []);
  const end = async () => {
    try { await api.endOffer(ending.id); toast("Offer ended"); load(); } catch (e) { toast(errText(e)); }
    setEnding(null);
  };
  return (
    <>
      <div className="page-h row"><div><h1 className="title">My offers</h1><div className="muted">Views and status of everything you posted</div></div><a className="btn main sm" href="#/owner/post">＋ New</a></div>
      <StatusBanner />
      {!offers ? <Spinner /> : offers.length === 0 ? <Empty icon="🗂️" title="No offers yet" action={<a className="btn main" href="#/owner/post">Post your first offer</a>}>Anything you need to move: rooms, seats, halls, slots, stock…</Empty>
        : offers.map((o) => {
          const live = o.status === "live" && o.endsAt > now;
          const label = live ? (o.visible === false ? "Waiting" : "Live") : o.status === "removed" ? "Removed" : "Ended";
          return (
            <div className="item" key={o.id} style={{ alignItems: "flex-start" }}>
              <div className="ic" style={o.photoUrl ? { backgroundImage: `url("${o.photoUrl}")` } : { background: TINTS[o.category] || TINTS.other }}>{!o.photoUrl && o.emoji}</div>
              <div className="grow">
                <b style={{ fontSize: 14 }}>{o.title}</b>
                <div className="muted small">{rupee(o.price)} <s>{rupee(o.origPrice)}</s> · {o.views} views</div>
                <div className="muted small">{live ? "Ends in " + timeLeft(o.endsAt - now) : o.status === "removed" ? "Removed by LastPick for breaking the rules" : "Ended"}</div>
                {live && <div className="gap" style={{ marginTop: 8 }}><a className="chip" href={"#/offer/" + o.id}>View</a><button className="chip" onClick={() => setEnding(o)}>End now</button></div>}
              </div>
              <span className={"pill " + (label === "Live" ? "p-ok" : label === "Waiting" ? "p-warn" : label === "Removed" ? "p-bad" : "p-mute")}>{label}</span>
            </div>
          );
        })}
      {ending && (
        <Sheet onClose={() => setEnding(null)}>
          <h2 className="title" style={{ fontSize: 19 }}>End this offer?</h2>
          <p className="muted">"{ending.title}" will disappear from customers' feeds right away.</p>
          <div className="gap"><button className="btn ghost" onClick={() => setEnding(null)}>Keep it live</button><button className="btn danger" onClick={end}>End offer</button></div>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Post an offer
export function PostOffer() {
  const { business, toast } = useApp();
  const [f, setF] = useState({ category: business?.category || "other", emoji: "📦", title: "", description: "", origPrice: "", price: "", quantity: "", hours: 6 });
  const [photo, setPhoto] = useState(null); // { file, url }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef();
  const now = useNow(60000);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const useTemplate = (t) => setF((p) => ({ ...p, category: t.category, emoji: t.emoji, title: t.title, origPrice: t.origPrice, price: t.price, quantity: t.quantity, hours: t.hours }));

  const orig = Number(f.origPrice), price = Number(f.price);
  const problems = [];
  if (f.title.trim().length < 3) problems.push("a title");
  if (!(orig > 0)) problems.push("the normal price");
  if (!(price >= 0) || f.price === "") problems.push("the offer price");
  else if (orig > 0 && price >= orig) problems.push("an offer price lower than the normal price");

  const preview = {
    id: "preview", businessId: business.id, business: { name: business.name, area: business.area, lat: business.lat, lng: business.lng },
    title: f.title || "Your offer title", description: f.description, category: f.category, emoji: f.emoji, photoUrl: photo?.url || null,
    origPrice: orig || 1, price: price || 0, quantity: f.quantity, endsAt: now + f.hours * 3600000, status: "live",
  };

  const onPhoto = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose a photo");
    if (file.size > 5 * 1024 * 1024) return toast("Photo must be under 5 MB");
    setPhoto({ file, url: URL.createObjectURL(file) });
  };

  const submit = async () => {
    if (problems.length) return;
    setBusy(true); setErr("");
    try {
      const photoUrl = photo ? await api.uploadPhoto(photo.file) : null;
      await api.createOffer({
        title: f.title.trim(), description: f.description.trim(), category: f.category, emoji: f.emoji, photoUrl,
        origPrice: orig, price, quantity: f.quantity.trim(), endsAt: Date.now() + f.hours * 3600000,
      });
      toast(business.status === "verified" ? "Your offer is live 🎉" : "Offer saved. It goes live once your business is verified.");
      navigate("/owner/offers");
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  return (
    <>
      <div className="page-h"><h1 className="title">Post an offer</h1><div className="muted">Anything you need to move before it becomes a loss</div></div>
      <StatusBanner />
      <div className="chips">{TEMPLATES.map((t) => <button key={t.label} className="chip" onClick={() => useTemplate(t)}>{t.emoji} {t.label}</button>)}</div>
      <div className="form">
        <div className="fld"><label>Photo (optional)</label>
          {photo
            ? <div className="photo-prev" style={{ backgroundImage: `url("${photo.url}")` }}><button className="back" style={{ left: "auto", right: 10 }} aria-label="Remove photo" onClick={() => setPhoto(null)}>×</button></div>
            : <div className="photo-drop" onClick={() => fileRef.current.click()}>📷 Add a photo of the offer</div>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPhoto(e.target.files[0]); e.target.value = ""; }} />
        </div>
        {!photo && <div className="fld"><label>Or pick an icon</label><div className="emoji-pick">{EMOJIS.map((e) => <button key={e} className={f.emoji === e ? "on" : ""} onClick={() => set("emoji", e)}>{e}</button>)}</div></div>}
        <div className="fld"><label>Category</label>
          <select value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select></div>
        <div className="fld"><label>What are you offering?</label><input maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Marriage hall free on 24 Nov" /></div>
        <div className="fld"><label>Details</label><textarea rows="3" maxLength={1000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What's included, timings, conditions…" /></div>
        <div className="two">
          <div className="fld"><label>Normal price ₹</label><input type="number" min="1" inputMode="numeric" value={f.origPrice} onChange={(e) => set("origPrice", e.target.value)} /></div>
          <div className="fld"><label>Offer price ₹</label><input type="number" min="0" inputMode="numeric" value={f.price} onChange={(e) => set("price", e.target.value)} /></div>
        </div>
        <div className="two">
          <div className="fld"><label>How many</label><input maxLength={60} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="e.g. 3 rooms" /></div>
          <div className="fld"><label>Offer ends in</label>
            <select value={f.hours} onChange={(e) => set("hours", Number(e.target.value))}>
              {DURATIONS.map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour${h > 1 ? "s" : ""}` : `${h / 24} day${h > 24 ? "s" : ""}`}</option>)}
            </select></div>
        </div>
        <div className="muted small">Customers will contact you on <b>{business.phone}</b>. <a className="link" href="#/owner/business">Change</a></div>
      </div>
      <div className="label-up">How customers see it</div>
      <div style={{ paddingTop: 8 }}><OfferCard offer={preview} preview /></div>
      <div className="pad" style={{ paddingTop: 0 }}>
        {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
        <button className="btn main" disabled={busy || problems.length > 0} onClick={submit}>{busy ? "Posting…" : "🚀 Make offer live"}</button>
        {problems.length > 0 && <div className="note">Add {problems.join(", ")}.</div>}
        <div className="note">By posting, you confirm this offer is genuine and you will honour it. You are responsible for your offer; {APP_NAME} only connects you with customers.</div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Business profile
export function BusinessPage() {
  return <NeedLogin why="Log in to manage your business"><BusinessForm /></NeedLogin>;
}

function BusinessForm({ first = false }) {
  const { business, profile, refresh, toast } = useApp();
  const [f, setF] = useState(() => ({
    name: business?.name || "", category: business?.category || "food", about: business?.about || "", address: business?.address || "",
    area: business?.area || "", city: business?.city || "", lat: business?.lat ?? null, lng: business?.lng ?? null,
    phone: business?.phone || profile?.phone || "", whatsapp: business?.whatsapp ?? true, agree: !first,
  }));
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const locate = () => {
    if (!navigator.geolocation) return toast("Location isn't available on this device");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { set("lat", p.coords.latitude); set("lng", p.coords.longitude); setLocating(false); toast("Location saved"); },
      () => { setLocating(false); toast("Couldn't get your location. Allow location access and try again."); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const missing = [];
  if (f.name.trim().length < 2) missing.push("business name");
  if (!f.area.trim()) missing.push("area");
  if (!f.city.trim()) missing.push("city");
  if (!validPhone(f.phone)) missing.push("a valid contact number");
  if (!f.agree) missing.push("agreement to the owner terms");

  const save = async () => {
    if (missing.length) return;
    setBusy(true);
    try {
      await api.saveBusiness({ ...business, ...f, name: f.name.trim(), area: f.area.trim(), city: f.city.trim(), phone: f.phone.trim() });
      await refresh();
      toast(first ? "Business created. Next: choose your plan." : "Business details saved");
      if (!first) navigate("/owner");
    } catch (e) { toast(errText(e)); }
    setBusy(false);
  };

  return (
    <>
      <div className="page-h"><h1 className="title">{first ? "Set up your business" : "Business profile"}</h1>
        <div className="muted">{first ? "Tell customers who you are. We verify every business before its offers go live." : "Customers see these details on your offers"}</div></div>
      {!first && <StatusBanner />}
      <div className="form" style={{ paddingTop: 12 }}>
        <div className="fld"><label>Business name</label><input maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sunrise Bakery" /></div>
        <div className="fld"><label>Main category</label>
          <select value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select></div>
        <div className="fld"><label>Contact number for customers</label><input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile number" />
          <span className="hint">Only customers with the Customer Pass can see this number.</span></div>
        <Toggle on={f.whatsapp} onChange={(v) => set("whatsapp", v)} title="Customers can WhatsApp this number" />
        <div className="fld"><label>Address</label><input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Shop number, street" /></div>
        <div className="two">
          <div className="fld"><label>Area</label><input value={f.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Indiranagar" /></div>
          <div className="fld"><label>City</label><input value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Bengaluru" /></div>
        </div>
        <div className="toggle">
          <div><b style={{ fontSize: 14 }}>Map location</b><div className="muted small">{f.lat != null ? `Saved (${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)})` : "Shows your offers on the map and sorts them by distance"}</div></div>
          <button className="btn ghost sm" type="button" disabled={locating} onClick={locate}>{locating ? "Locating…" : "📍 Use my location"}</button>
        </div>
        <div className="fld"><label>About (optional)</label><textarea rows="2" maxLength={500} value={f.about} onChange={(e) => set("about", e.target.value)} placeholder="What you do, opening hours…" /></div>
        {first && (
          <label className="toggle" style={{ cursor: "pointer", justifyContent: "flex-start" }}>
            <input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small">I confirm my offers will be genuine and I'll honour them. I'm responsible for my offers; {APP_NAME} only connects me with customers. <a className="link" href="#/terms">Owner terms</a></span>
          </label>
        )}
        <button className="btn main" disabled={busy || missing.length > 0} onClick={save}>{busy ? "Saving…" : first ? "Create business" : "Save details"}</button>
        {missing.length > 0 && <div className="note" style={{ marginTop: 0 }}>Add {missing.join(", ")}.</div>}
      </div>
    </>
  );
}
