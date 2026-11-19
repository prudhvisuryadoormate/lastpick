import { useEffect, useState } from "react";
import { api, isLive } from "./api/index.js";
import { Empty, Spinner } from "./components.jsx";
import { Account, Contacts, Home, MapPage, OfferPage } from "./pages/customer.jsx";
import { BusinessPage, OwnerDashboard, OwnerGate, OwnerLeads, OwnerOffers, PostOffer } from "./pages/owner.jsx";
import { Admin, Help, Login, Privacy, Subscribe, Terms } from "./pages/account.jsx";
import { match, useApp, useRoute } from "./state.jsx";

const CUSTOMER_NAV = [["/", "🏠", "Offers"], ["/map", "🗺️", "Map"], ["/contacts", "📇", "Contacts"], ["/account", "👤", "Account"]];
const OWNER_NAV = [["/owner", "📊", "Dashboard"], ["/owner/post", "➕", "Post"], ["/owner/leads", "📇", "Leads"], ["/owner/offers", "🗂️", "My offers"], ["/account", "👤", "Account"]];

function Page({ path, query }) {
  let m;
  if (path === "/") return <Home />;
  if (path === "/map") return <MapPage />;
  if ((m = match("/offer/:id", path))) return <OfferPage id={m.id} />;
  if (path === "/contacts") return <Contacts />;
  if (path === "/account") return <Account />;
  if ((m = match("/subscribe/:plan", path))) return <Subscribe plan={m.plan} />;
  if (path === "/login") return <Login next={query.next} />;
  if (path === "/owner") return <OwnerGate><OwnerDashboard /></OwnerGate>;
  if (path === "/owner/post") return <OwnerGate><PostOffer /></OwnerGate>;
  if (path === "/owner/leads") return <OwnerGate><OwnerLeads /></OwnerGate>;
  if (path === "/owner/offers") return <OwnerGate allowWithoutPlan><OwnerOffers /></OwnerGate>;
  if (path === "/owner/business") return <BusinessPage />;
  if (path === "/admin") return <Admin />;
  if (path === "/terms") return <Terms />;
  if (path === "/privacy") return <Privacy />;
  if (path === "/help") return <Help />;
  return <Empty icon="🧭" title="Page not found" action={<a className="btn main" href="#/">Go to offers</a>}>The link may be broken.</Empty>;
}

function NewLeadsDot() {
  const { isOwner, business } = useApp();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!isOwner || !business) return;
    const load = () => api.ownerLeads().then((l) => setN(l.filter((x) => x.status === "new").length)).catch(() => {});
    load();
    const i = setInterval(load, 60000);
    return () => clearInterval(i);
  }, [isOwner, business]);
  return n > 0 ? <span className="dot">{n}</span> : null;
}

export default function App() {
  const { path, query } = useRoute();
  const { loading, mode, setMode } = useApp();
  const ownerArea = path.startsWith("/owner");

  // keep the bottom bar in sync with where the user is
  useEffect(() => {
    if (ownerArea && mode !== "owner") setMode("owner");
    if (["/", "/map", "/contacts"].includes(path) && mode !== "customer") setMode("customer");
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (ownerArea || (mode === "owner" && path === "/account")) ? OWNER_NAV : CUSTOMER_NAV;
  const showNav = path !== "/login";

  return (
    <div className="shell">
      {!isLive && <div className="demo-bar">Demo mode · data stays in this browser · no real payments</div>}
      <main className="main">{loading ? <Spinner /> : <Page path={path} query={query} />}</main>
      {showNav && (
        <nav className="nav" aria-label="Main">
          {nav.map(([to, icon, label]) => (
            <a key={to} href={"#" + to} className={path === to ? "on" : ""} aria-current={path === to ? "page" : undefined}>
              <span className="i">{icon}</span>{label}
              {to === "/owner/leads" && <NewLeadsDot />}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
