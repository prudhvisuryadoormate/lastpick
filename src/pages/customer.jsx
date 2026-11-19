import { useEffect, useMemo, useState } from "react";
import { api } from "../api/index.js";
import { BackButton, CategoryChips, Countdown, Disclaimer, Empty, MapView, NeedLogin, OfferCard, OfferImage, Sheet, Spinner, catLabel } from "../components.jsx";
import { APP_NAME, CATEGORIES, PLANS, REPORT_REASONS, TINTS } from "../lib/config.js";
import { ago, day, discount, distanceKm, errText, kmText, rupee, telLink, timeLeft, validPhone, waLink } from "../lib/format.js";
import { navigate, useApp, useNow } from "../state.jsx";

function useLiveOffers() {
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => api.listLive().then((o) => alive && setOffers(o)).catch((e) => alive && setError(errText(e)));
    load();
    const i = setInterval(load, 60000);
    return () => { alive = false; clearInterval(i); };
  }, []);
  return { offers, error };
}

// ------------------------------------------------------------------ Home
export function Home() {
  const { location, isCustomer, session } = useApp();
  const { offers, error } = useLiveOffers();
  const now = useNow(30000);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("ending");

  const shown = useMemo(() => {
    if (!offers) return [];
    const needle = q.trim().toLowerCase();
    return offers
      .filter((o) => o.endsAt > now && (cat === "all" || o.category === cat))
      .filter((o) => !needle || `${o.title} ${o.description} ${o.business?.name} ${o.business?.area}`.toLowerCase().includes(needle))
      .map((o) => ({ o, km: distanceKm(location, o.business) }))
      .sort((a, b) => sort === "near" ? (a.km ?? 1e9) - (b.km ?? 1e9) : sort === "off" ? discount(b.o) - discount(a.o) : a.o.endsAt - b.o.endsAt)
      .map((x) => x.o);
  }, [offers, cat, q, sort, location, now]);

  const usedCats = CATEGORIES.filter((c) => offers?.some((o) => o.category === c.id));

  return (
    <>
      <div className="hdr">
        <div className="row">
          <div><div className="loc">Offers near</div><div style={{ fontWeight: 700 }}>📍 {location.label}</div></div>
          <a className="logo" href="#/account" aria-label="Account">L</a>
        </div>
        <div className="search">🔎<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rooms, halls, food, seats…" aria-label="Search offers" /></div>
      </div>
      {!isCustomer && (
        <a className="banner sub" href={session ? "#/subscribe/customer" : "#/login?next=/subscribe/customer"}>
          🔓<span>Subscribe for <b>{rupee(PLANS.customer.price)}/month</b> to see owners' numbers and contact them directly</span>
        </a>
      )}
      <CategoryChips value={cat} onChange={setCat} categories={usedCats.length ? usedCats : CATEGORIES} />
      <div className="sect">
        <h3>{offers ? `${shown.length} live offer${shown.length === 1 ? "" : "s"}` : "Loading offers"}</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="ending">Ending soon</option><option value="near">Nearest</option><option value="off">Biggest discount</option>
        </select>
      </div>
      {error && <div className="pad"><div className="error">{error}</div></div>}
      {!offers && !error && <Spinner />}
      {offers && shown.length === 0 && <Empty icon="🕵️" title="No live offers here">Try another category, or check back this evening.</Empty>}
      {shown.map((o) => <OfferCard key={o.id} offer={o} />)}
    </>
  );
}

// ------------------------------------------------------------------ Map
export function MapPage() {
  const { location } = useApp();
  const { offers } = useLiveOffers();
  return (
    <>
      <div className="page-h"><h1 className="title">Offers around you</h1><div className="muted">Tap a price to open the offer</div></div>
      {offers ? <MapView offers={offers} center={location} /> : <Spinner />}
    </>
  );
}

// ------------------------------------------------------------------ Offer detail
export function OfferPage({ id }) {
  const { session, profile, isCustomer, location, toast, business } = useApp();
  const [offer, setOffer] = useState(undefined);
  const [contact, setContact] = useState(null);
  const [contactErr, setContactErr] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const now = useNow();
  const own = !!business && offer?.businessId === business.id;

  useEffect(() => {
    let alive = true;
    api.getOffer(id).then((o) => { if (!alive) return; setOffer(o); if (o) api.addView(id); }).catch(() => alive && setOffer(null));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (!offer || !session || !(isCustomer || own)) return;
    api.revealContact(offer.id).then(setContact).catch((e) => setContactErr(errText(e)));
    if (isCustomer) api.mySharedOfferIds().then((ids) => setShared(ids.includes(offer.id))).catch(() => {});
  }, [offer, session, isCustomer, own]);

  if (offer === undefined) return <Spinner />;
  if (!offer) return <><div style={{ position: "relative", height: 60 }}><BackButton to="/" /></div><Empty icon="🫥" title="Offer not available">It may have ended or been removed.</Empty></>;

  const rem = offer.endsAt - now;
  const ended = rem <= 0 || offer.status !== "live";
  const km = distanceKm(location, offer.business);
  const contactText = `Hi, I saw your offer on ${APP_NAME}: "${offer.title}". Is it still available?`;

  const share = async () => {
    if (!validPhone(profile?.phone)) { toast("Add your phone number in Account first"); navigate("/account"); return; }
    setBusy(true);
    try { await api.shareNumber(offer.id); setShared(true); toast(`Your number was sent to ${offer.business?.name}`); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  };

  return (
    <>
      <OfferImage offer={offer} className="hero">
        <BackButton to="/" />
        {!ended && <Countdown end={offer.endsAt} />}
      </OfferImage>
      <div className="pad">
        <div className="muted">{catLabel(offer.category)} · {offer.business?.area}{km != null ? " · " + kmText(km) : ""}</div>
        <h1 className="title" style={{ margin: "6px 0 6px", lineHeight: 1.2 }}>{offer.title}</h1>
        {offer.description && <div className="muted" style={{ whiteSpace: "pre-line" }}>{offer.description}</div>}

        <div className="box row" style={{ marginTop: 14 }}>
          <div className="price"><b style={{ fontSize: 26 }}>{rupee(offer.price)}</b><s>{rupee(offer.origPrice)}</s><span className="pill p-ok">{discount(offer)}% off</span></div>
          <div style={{ textAlign: "right" }}><div className="muted small">{ended ? "Status" : "Ends in"}</div><b style={{ color: rem < 3600000 ? "var(--bad)" : "var(--ink)" }}>{ended ? "Ended" : timeLeft(rem)}</b></div>
        </div>
        {offer.quantity && <div className="row" style={{ marginTop: 10 }}><span className="muted">Available</span><b>{offer.quantity}</b></div>}

        <div className="panel" style={{ margin: "14px 0 0" }}>
          <div className="owner-row">
            <div className="avatar">{(offer.business?.name || "?")[0]}</div>
            <div className="grow"><b>{offer.business?.name}</b><div className="verified">✔ Verified owner · {offer.business?.area}{offer.business?.city ? ", " + offer.business.city : ""}</div></div>
          </div>

          {own ? (
            <div className="banner ok" style={{ margin: "12px 0 0" }}>This is your offer. Customers with the Customer Pass see your number here.</div>
          ) : !session || !isCustomer ? (
            <>
              <div className="num blur" style={{ marginTop: 12 }} aria-hidden="true">+91 98••• •••••</div>
              <div className="muted" style={{ marginTop: 6 }}>Subscribe to see the owner's number, call or WhatsApp them, and share your number with them.</div>
              <a className="btn main" style={{ marginTop: 12 }} href={session ? "#/subscribe/customer" : `#/login?next=${encodeURIComponent("/offer/" + offer.id)}`}>
                🔓 Unlock with {PLANS.customer.name} · {rupee(PLANS.customer.price)}/month
              </a>
            </>
          ) : contactErr ? (
            <div className="error" style={{ marginTop: 12 }}>{contactErr}</div>
          ) : !contact ? <Spinner /> : (
            <>
              <div className="num" style={{ marginTop: 12 }}>{contact.phone}</div>
              <div className="two" style={{ marginTop: 10 }}>
                <a className="btn call" href={telLink(contact.phone)} onClick={() => api.logContact(offer.id, "Called")}>📞 Call</a>
                {contact.whatsapp
                  ? <a className="btn wa" href={waLink(contact.phone, contactText)} target="_blank" rel="noreferrer" onClick={() => api.logContact(offer.id, "WhatsApp")}>💬 WhatsApp</a>
                  : <button className="btn ghost" disabled>WhatsApp off</button>}
              </div>
              {!ended && (
                <button className="btn ghost" style={{ marginTop: 10 }} disabled={shared || busy} onClick={share}>
                  {shared ? "✓ Your number was shared with the owner" : busy ? "Sharing…" : `🙋 Share my number${profile?.phone ? ` (${profile.phone})` : ""} with the owner`}
                </button>
              )}
            </>
          )}
        </div>

        <Disclaimer />
        {session && !own && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setReporting(true)}>🚩 Report this offer</button>}
      </div>
      {reporting && <ReportSheet offerId={offer.id} onClose={() => setReporting(false)} />}
    </>
  );
}

function ReportSheet({ offerId, onClose }) {
  const { toast } = useApp();
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.report(offerId, reason, details.trim()); toast("Thanks. Our team will review this offer."); onClose(); }
    catch (e) { toast(errText(e)); setBusy(false); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2 className="title" style={{ fontSize: 19 }}>Report this offer</h2>
      <div className="form" style={{ padding: "12px 0 0" }}>
        <div className="fld"><label>What's wrong?</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="fld"><label>Details (optional)</label><textarea rows="3" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <button className="btn main" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send report"}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Contacts
export function Contacts() {
  return <NeedLogin why="Log in to see your contacts"><ContactsInner /></NeedLogin>;
}
function ContactsInner() {
  const { isCustomer } = useApp();
  const [list, setList] = useState(null);
  const [phones, setPhones] = useState({});
  useEffect(() => { if (isCustomer) api.myContacts().then(setList).catch(() => setList([])); }, [isCustomer]);
  const reveal = async (offerId) => {
    try { const c = await api.revealContact(offerId); setPhones((p) => ({ ...p, [offerId]: c })); } catch (e) { setPhones((p) => ({ ...p, [offerId]: { error: errText(e) } })); }
  };
  useEffect(() => { (list || []).forEach((c) => !phones[c.offer.id] && reveal(c.offer.id)); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-h"><h1 className="title">My contacts</h1><div className="muted">Owners you viewed, called, messaged or shared your number with</div></div>
      {!isCustomer ? (
        <Empty icon="🔒" title="Subscribe to contact owners" action={<a className="btn main" href="#/subscribe/customer">Subscribe · {rupee(PLANS.customer.price)}/month</a>}>Owners you contact will appear here.</Empty>
      ) : !list ? <Spinner /> : list.length === 0 ? (
        <Empty icon="📇" title="No contacts yet" action={<a className="btn ghost" href="#/">Browse offers</a>}>Open an offer to see the owner's number.</Empty>
      ) : list.map((c) => {
        const p = phones[c.offer.id];
        return (
          <div className="item" key={c.offer.id}>
            <a className="ic" href={"#/offer/" + c.offer.id} style={c.offer.photoUrl ? { backgroundImage: `url("${c.offer.photoUrl}")` } : { background: TINTS[c.offer.category] || TINTS.other }}>{!c.offer.photoUrl && c.offer.emoji}</a>
            <a className="grow" href={"#/offer/" + c.offer.id}>
              <b className="ellipsis" style={{ display: "block", fontSize: 14 }}>{c.offer.business?.name}</b>
              <div className="muted small ellipsis">{c.offer.title}</div>
              <div className="muted small">{p?.phone || (p?.error ? "Number unavailable" : "…")} · {c.how} · {ago(c.at)}</div>
            </a>
            {p?.phone && <a className="icon-btn" aria-label="Call" href={telLink(p.phone)} onClick={() => api.logContact(c.offer.id, "Called")}>📞</a>}
            {p?.phone && p.whatsapp && <a className="icon-btn wa" aria-label="WhatsApp" target="_blank" rel="noreferrer" href={waLink(p.phone, `Hi, about your ${APP_NAME} offer: "${c.offer.title}"`)} onClick={() => api.logContact(c.offer.id, "WhatsApp")}>💬</a>}
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ Account
export function Account() {
  return <NeedLogin why="Log in to your account"><AccountInner /></NeedLogin>;
}
function AccountInner() {
  const { profile, subs, business, isAdmin, refresh, toast, setMode } = useApp();
  const [name, setName] = useState(profile?.name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const dirty = name !== (profile?.name || "") || phone !== (profile?.phone || "");

  const save = async () => {
    if (!name.trim()) return toast("Please enter your name");
    if (!validPhone(phone)) return toast("Please enter a valid phone number");
    setSaving(true);
    try { await api.updateProfile({ name: name.trim(), phone: phone.trim() }); await refresh(); toast("Saved"); } catch (e) { toast(errText(e)); }
    setSaving(false);
  };
  const cancel = async (plan) => {
    try { await api.cancelPlan(plan); await refresh(); toast("Subscription cancelled. It stays active until the end of this period."); } catch (e) { toast(errText(e)); }
    setCancelling(null);
  };

  return (
    <>
      <div className="page-h owner-row"><div className="avatar">{(profile?.name || "?")[0]}</div><div><h1 className="title" style={{ fontSize: 20 }}>{profile?.name || "Your account"}</h1><div className="muted">{profile?.email}</div></div></div>

      {["customer", "owner"].map((plan) => {
        const s = subs[plan];
        if (plan === "owner" && !s && !business) return null;
        return (
          <div key={plan} className={"status " + (s?.active ? "ok" : "no")}>
            <span style={{ fontSize: 24 }}>{s?.active ? "✅" : "⚠️"}</span>
            <div className="grow">
              <b>{PLANS[plan].name} {s?.active ? (s.status === "cancelled" ? "· cancelled" : "· active") : "· not active"}</b>
              <div className="muted small">
                {s?.active ? `${rupee(PLANS[plan].price)}/month · ${s.status === "cancelled" ? "ends" : "renews"} ${day(s.currentPeriodEnd)}` : plan === "customer" ? "Subscribe to see owners' numbers" : "Subscribe to post offers"}
              </div>
            </div>
            {!s?.active
              ? <a className="btn main sm" href={"#/subscribe/" + plan}>Subscribe</a>
              : s.status !== "cancelled" && <button className="btn ghost sm" onClick={() => setCancelling(plan)}>Cancel</button>}
          </div>
        );
      })}

      <div className="label-up" style={{ marginTop: 10 }}>Your details</div>
      <div className="form" style={{ paddingTop: 8 }}>
        <div className="fld"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="fld"><label>Phone number</label><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />
          <span className="hint">Shared with an owner only when you tap "Share my number".</span></div>
        {dirty && <button className="btn dark" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>}
      </div>

      <div style={{ marginTop: 6 }}>
        <button className="menu-item" onClick={() => { setMode("owner"); navigate("/owner"); }}>🏪 {business ? "Switch to owner mode" : "Post offers as a business owner"}<span className="chev">›</span></button>
        {isAdmin && <a className="menu-item" href="#/admin">🛡️ Admin panel<span className="chev">›</span></a>}
        <a className="menu-item" href="#/help">🛟 Help & support<span className="chev">›</span></a>
        <a className="menu-item" href="#/terms">📜 Terms & disclaimer<span className="chev">›</span></a>
        <a className="menu-item" href="#/privacy">🔏 Privacy policy<span className="chev">›</span></a>
        <button className="menu-item" style={{ color: "var(--bad)" }} onClick={async () => { await api.signOut(); navigate("/"); }}>↩ Log out<span className="chev">›</span></button>
      </div>

      {cancelling && (
        <Sheet onClose={() => setCancelling(null)}>
          <h2 className="title" style={{ fontSize: 19 }}>Cancel {PLANS[cancelling].name}?</h2>
          <p className="muted">You keep access until {day(subs[cancelling].currentPeriodEnd)}. After that {cancelling === "customer" ? "owners' numbers are hidden again" : "your offers stop showing to customers"}.</p>
          <div className="gap"><button className="btn ghost" onClick={() => setCancelling(null)}>Keep plan</button><button className="btn danger" onClick={() => cancel(cancelling)}>Cancel plan</button></div>
        </Sheet>
      )}
    </>
  );
}
