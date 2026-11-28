import React, { Suspense, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import LoadingScreen from "../components/LoadingScreen.jsx";
import PageLoader from "../components/PageLoader.jsx";
import RouteBoundary from "../components/RouteBoundary.jsx";
import Logo from "../components/Logo.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { lazyRetry } from "../utils/lazyRetry.js";
import { api, useApi } from "./api.js";
import { StaffProvider, useStaff } from "./staff.jsx";
import { FilterProvider } from "./filters.jsx";
import { isAdmin, rolesOf, ROLE_LABEL } from "./flowUi.js";
import { deskHome } from "./pages/desk/deskHome.js";
import { LabelsProvider } from "./pages/desk/shared.jsx";
import "./orders.css";

const Overview = lazyRetry(() => import("./pages/Overview.jsx"));
const ShopifyDesk = lazyRetry(() => import("./pages/desk/ShopifyDesk.jsx"));
// The four Shopify desk report pages now live in the sidebar, under "Shopify desk".
const DeskOverview = lazyRetry(() => import("./pages/desk/DeskOverview.jsx"));
const OrderFunnel = lazyRetry(() => import("./pages/desk/OrderFunnel.jsx"));
const DeskOrders = lazyRetry(() => import("./pages/desk/DeskOrders.jsx"));
const OrderAnalysis = lazyRetry(() => import("./pages/desk/OrderAnalysis.jsx"));
const TeamDashboard = lazyRetry(() => import("./pages/TeamDashboard.jsx"));
const NdrPage = lazyRetry(() => import("./pages/courier/NdrPage.jsx"));
const RtoPage = lazyRetry(() => import("./pages/courier/RtoPage.jsx"));
const WeightPage = lazyRetry(() => import("./pages/courier/WeightPage.jsx"));
const Trends = lazyRetry(() => import("./pages/Trends.jsx"));
const PaymentMode = lazyRetry(() => import("./pages/PaymentMode.jsx"));
const Campaigns = lazyRetry(() => import("./pages/Campaigns.jsx"));
const Reasons = lazyRetry(() => import("./pages/Reasons.jsx"));
const Issues = lazyRetry(() => import("./pages/Issues.jsx"));
const Settings = lazyRetry(() => import("./pages/Settings.jsx"));

const O = "/orders";
// Third item 'sub' = an indented entry that lives under the item above it.
const NAV = [
  ["", "Overview", "overview"],
  ["/shopify-desk", "Shopify desk", "desk"],
  ["/desk-overview", "Desk overview", "deskOverview", "sub"],
  ["/order-funnel", "Order funnel", "deskFunnel", "sub"],
  ["/shopify-orders", "Shopify orders", "deskOrders", "sub"],
  ["/order-analysis", "Order analysis", "deskAnalysis", "sub"],
  ["/ndr", "Non-Delivery Report (NDR)", "ndr", "sub"],
  ["/rto", "RTO & Returns", "rto", "sub"],
  ["/weight-discrepancy", "Weight Discrepancy", "weight", "sub"],
  ["/team-performance", "Team Performance", "team"],
  ["/trends", "Trends", "trends"],
  ["/payment-mode", "Payment mode", "payment"],
  ["/campaigns", "Campaigns", "campaigns"],
  ["/reasons", "Reasons", "reasons"],
  ["/issues", "Data issues", "issues"],
  ["/settings", "Settings", "settings"],
];

// Which pages each team may open. Admin sees all of NAV; the others get exactly these (the server enforces the same rules).
const ROLE_PAGES = {
  confirmation: ["overview", "desk", "deskOrders", "deskAnalysis", "ndr", "rto"],
  packing: ["overview", "desk", "deskOrders", "deskAnalysis", "ndr", "rto", "weight"],
};
// These pages read the desk's own labels, so each one is wrapped in the same provider the desk uses.
const Desk = ({ title, children }) => <LabelsProvider><div className="sd"><div className="sd-top"><h1>{title}</h1></div><div className="sd-body">{children}</div></div></LabelsProvider>;
const pagesFor = (user) => (isAdmin(user) ? null : [...new Set(["overview", ...rolesOf(user).flatMap((r) => ROLE_PAGES[r] || [])])]);

// Small live counts next to the two desks: what is waiting, and what is overdue.
function useBadges() {
  const [b, setB] = useState(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        // each count is fetched on its own: a role that may not read one of them still gets the others
        const [s, c] = await Promise.all([api.get("/desk/counts").catch(() => null), api.get("/desk/cases/counts").catch(() => null)]);
        if (live) setB({ shop: s, cases: c });
      } catch (e) { /* offline: no badges */ }
    };
    load();
    const t = setInterval(load, 60000);
    window.addEventListener("desk-changed", load);
    return () => { live = false; clearInterval(t); window.removeEventListener("desk-changed", load); };
  }, []);
  return b;
}

// Live counts next to the desks (red = calls due now, grey = how many are open).
function Badge({ keyName, badges }) {
  if (!badges) return null;
  if (keyName === "desk" && badges.shop) {
    const due = badges.shop.confirm.due + badges.shop.pending.due;
    const open = badges.shop.confirm.total + badges.shop.pending.total;
    if (open > 0) return <span className={`nav-badge ${due > 0 ? "bad" : ""}`} title={`${due} calls due now`}>{due > 0 ? due : open}</span>;
  }
  const c = badges.cases;
  if (c) {
    if (keyName === "ndr" && c.ndr && c.ndr.open > 0) return <span className={`nav-badge ${c.ndr.due > 0 ? "bad" : ""}`} title={`${c.ndr.due} due now`}>{c.ndr.due > 0 ? c.ndr.due : c.ndr.open}</span>;
    if (keyName === "rto" && c.rto && c.rto.pending > 0) return <span className="nav-badge" title="RTO not yet received">{c.rto.pending}</span>;
    if (keyName === "weight" && c.weight && c.weight.open > 0) return <span className="nav-badge" title="Open cases">{c.weight.open}</span>;
  }
  return null;
}

// "Sheet checked N min ago" for admins; turns red if the sync falls behind. Also tells every open screen when new data landed.
function SyncNote() {
  const { data, reload } = useApi("/sync/status");
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let seen = null;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const s = await api.get("/sync/status");
        const at = s.lastOk && s.lastOk.at;
        if (seen && at && at !== seen) window.dispatchEvent(new Event("data-updated"));
        if (at) seen = at;
      } catch (e) { /* offline or locked: try again next tick */ }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, []);
  const check = data && data.lastCheck;
  if (!check) return <div className="sync-note">No sheet data loaded yet</div>;
  const mins = Math.max(0, Math.round((Date.now() - new Date(check.at).getTime()) / 60000));
  const every = (data.config && data.config.autoSyncMin) || 15;
  const behind = mins > Math.max(45, every * 3);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return (
    <div className="sync-note" style={behind ? { color: "#b42318" } : undefined}>
      {behind ? `Sync is behind: last check ${ago}` : `Sheet checked ${ago}`}
      {data.last && !data.last.ok && <div>Last attempt failed. See Settings.</div>}
    </div>
  );
}

function Shell({ user }) {
  const { logout, hasReminder, hasWorkshop, hasTickets, hasCertificates, hasEmi, hasLeadFms, hasSalesFms } = useAuth();
  const navigate = useNavigate();
  // The menu folds away as soon as you pick something, to give the page the whole screen; the ☰ button brings it back.
  const [collapsed, setCollapsed] = useState(false);
  // Order Analytics opens in its LIGHT look. (Its own switch; the hub's theme does not change it.)
  const [theme, setTheme] = useState(() => (localStorage.getItem("oa-theme") === "dark" ? "dark" : "light"));
  useEffect(() => { localStorage.setItem("oa-theme", theme); }, [theme]);
  const badges = useBadges();

  const allowed = pagesFor(user); // null = admin: everything
  const ok = (key) => !allowed || allowed.includes(key);
  const guard = (key, el) => (ok(key) ? el : <Navigate to={O} replace />);
  const nav = NAV.filter(([, , key]) => ok(key)).map(([to, label, key, kind]) => [key === "desk" ? deskHome(user) : O + to, label, key, kind]);
  const switchApp = hasReminder || hasWorkshop || hasTickets || hasCertificates || hasEmi || hasLeadFms || hasSalesFms;
  const roleText = isAdmin(user) ? "Admin" : rolesOf(user).map((r) => ROLE_LABEL[r].replace(" team", "")).join(" + ");
  const toApps = (e) => { e.preventDefault(); sessionStorage.removeItem("hubChosen"); navigate("/hub"); };

  return (
    <div className="oa-scope" data-oa-theme={theme}>
      <div className={"shell" + (collapsed ? " collapsed" : "")}>
        {collapsed ? (
          <nav className="side oa-rail" aria-label="Order Analytics">
            <button type="button" className="oa-iconbtn" onClick={() => setCollapsed(false)} aria-label="Open menu" title="Open menu">☰</button>
            <div className="spacer" />
            {switchApp && <button type="button" className="oa-iconbtn" onClick={toApps} aria-label="All apps" title="All apps">▦</button>}
          </nav>
        ) : (
          <nav className="side" aria-label="Order Analytics">
            <div className="oa-sidehead">
              <div className="brand">MySoul Orders<small>Sheet analytics</small></div>
              <button type="button" className="oa-iconbtn" onClick={() => setCollapsed(true)} aria-label="Hide menu" title="Hide menu">«</button>
            </div>
            {nav.map(([to, label, key, kind]) => (
              <NavLink
                key={key}
                to={to}
                end={key === "overview"}
                className={({ isActive }) => `${kind === "sub" ? "sub " : ""}${isActive ? "active" : ""}`}
                onClick={() => setCollapsed(true)}
              >
                {label}<Badge keyName={key} badges={badges} />
              </NavLink>
            ))}
            <div className="spacer" />
            {isAdmin(user) && <SyncNote />}
            <div className="oa-foot">
              <div className="sync-note">Signed in as <b>{user.name}</b> · {roleText}</div>
              {switchApp && <a href="#apps" onClick={toApps}>← All apps</a>}
              <a href="#theme" onClick={(e) => { e.preventDefault(); setTheme(theme === "dark" ? "light" : "dark"); }}>{theme === "dark" ? "Light theme" : "Dark theme"}</a>
              <a href="#out" onClick={(e) => { e.preventDefault(); logout(); }}>Sign out</a>
            </div>
          </nav>
        )}
        <div className="main">
          <RouteBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/team-performance" element={guard("team", <TeamDashboard />)} />
                <Route path="/trends" element={guard("trends", <Trends />)} />
                <Route path="/payment-mode" element={guard("payment", <PaymentMode />)} />
                <Route path="/campaigns" element={guard("campaigns", <Campaigns />)} />
                <Route path="/reasons" element={guard("reasons", <Reasons />)} />
                <Route path="/shopify-desk/*" element={guard("desk", <ShopifyDesk />)} />
                <Route path="/desk-overview" element={guard("deskOverview", <Desk title="Desk overview"><DeskOverview /></Desk>)} />
                <Route path="/order-funnel" element={guard("deskFunnel", <Desk title="Order funnel"><OrderFunnel /></Desk>)} />
                <Route path="/shopify-orders" element={guard("deskOrders", <Desk title="Shopify orders"><DeskOrders /></Desk>)} />
                <Route path="/order-analysis" element={guard("deskAnalysis", <Desk title="Order analysis"><OrderAnalysis /></Desk>)} />
                <Route path="/ndr" element={guard("ndr", <NdrPage />)} />
                <Route path="/rto" element={guard("rto", <RtoPage />)} />
                <Route path="/weight-discrepancy" element={guard("weight", <WeightPage />)} />
                <Route path="/issues" element={guard("issues", <Issues />)} />
                <Route path="/settings" element={guard("settings", <Settings />)} />
                <Route path="*" element={<Navigate to={O} replace />} />
              </Routes>
            </Suspense>
          </RouteBoundary>
        </div>
      </div>
    </div>
  );
}

// Opens Order Analytics once the hub's sign-in has been exchanged for an Order Analytics session.
function Gate() {
  const { user, loading, slow, error, retry } = useStaff();
  const { logout } = useAuth();
  const navigate = useNavigate();
  if (loading) return <LoadingScreen app="orders" message={slow ? undefined : "Opening Order Analytics"} slow={slow} />;
  if (!user) {
    return (
      <div className="auth-loading">
        <Logo size={56} className="auth-logo" />
        <div className="auth-loading-text">Couldn't open Order Analytics</div>
        <div className="auth-loading-hint">{error?.message || "Something went wrong."}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={retry}>Try again</button>
          <button type="button" onClick={() => { sessionStorage.removeItem("hubChosen"); navigate("/hub"); }}>Back to apps</button>
          <button type="button" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }
  return <Shell user={user} />;
}

export default function OrdersApp() {
  return (
    <StaffProvider>
      <FilterProvider>
        <Gate />
      </FilterProvider>
    </StaffProvider>
  );
}
