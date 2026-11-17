import React, { Suspense, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import OrdersLogo from "../components/OrdersLogo.jsx";
import LoadingScreen from "../components/LoadingScreen.jsx";
import PageLoader from "../components/PageLoader.jsx";
import RouteBoundary from "../components/RouteBoundary.jsx";
import Logo from "../components/Logo.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import { lazyRetry } from "../utils/lazyRetry.js";
import { api, useApi } from "./api.js";
import { StaffProvider, useStaff } from "./staff.jsx";
import { FilterProvider } from "./filters.jsx";
import { isAdmin, rolesOf, ROLE_LABEL } from "./flowUi.js";
import { deskHome } from "./pages/desk/deskHome.js";
import "./orders.css";

const Overview = lazyRetry(() => import("./pages/Overview.jsx"));
const ShopifyDesk = lazyRetry(() => import("./pages/desk/ShopifyDesk.jsx"));
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
  ["/ndr", "Non-Delivery Report (NDR)", "ndr", "sub"],
  ["/rto", "RTO & Returns", "rto", "sub"],
  ["/weight-discrepancy", "Weight Discrepancy", "weight", "sub"],
  ["/team-performance", "Team performance", "team"],
  ["/trends", "Trends", "trends"],
  ["/payment-mode", "Payment mode", "payment"],
  ["/campaigns", "Campaigns", "campaigns"],
  ["/reasons", "Reasons", "reasons"],
  ["/issues", "Data issues", "issues"],
  ["/settings", "Settings", "settings"],
];

// Which pages each team may open. Admin sees all of NAV; the others get exactly these (the server enforces the same rules).
const ROLE_PAGES = {
  confirmation: ["overview", "desk", "ndr", "rto"],
  packing: ["overview", "desk", "ndr", "rto", "weight"],
};
const pagesFor = (user) => (isAdmin(user) ? null : [...new Set(["overview", ...rolesOf(user).flatMap((r) => ROLE_PAGES[r] || [])])]);

const ICON = {
  overview: "M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z",
  desk: "M4 7l8-4 8 4v10l-8 4-8-4V7Zm0 0 8 4m0 0 8-4m-8 4v10",
  courier: "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a1.600 1.600 0 1 0 0-3.200A1.600 1.600 0 0 0 7 19Zm10 0a1.600 1.600 0 1 0 0-3.200A1.600 1.600 0 0 0 17 19Z",
  team: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3 0-8 1.500-8 4.500V21h16v-2.500c0-3-5-4.500-8-4.500Zm8.500-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-.6 0-1.500.08-2.400.3 1.500 1 2.400 2.400 2.400 4.200V21h5v-2.500c0-2.600-3-4.500-5-4.500Z",
  trends: "M3 17l6-6 4 4 7-8M15 7h5v5",
  payment: "M3 7h18v10H3V7Zm0 4h18M7 15h3",
  campaigns: "M4 13v-2l12-5v12L4 13Zm12-5h2a3 3 0 0 1 0 6h-2M7 14l1 5h3l-1-4.500",
  reasons: "M4 5h16v11H9l-5 4V5Z",
  issues: "M12 3 2.500 20h19L12 3Zm0 7v4m0 3v.01",
  settings: "M12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM19.400 13a7.400 7.400 0 0 0 .1-1 7.400 7.400 0 0 0-.1-1l2-1.600-2-3.400-2.400 1a7.600 7.600 0 0 0-1.700-1l-.4-2.500H9.100l-.4 2.500a7.600 7.600 0 0 0-1.700 1l-2.400-1-2 3.400 2 1.600a7.400 7.400 0 0 0 0 2L2.600 15l2 3.400 2.400-1a7.600 7.600 0 0 0 1.700 1l.4 2.500h5.800l.4-2.500a7.600 7.600 0 0 0 1.700-1l2.400 1 2-3.400-2-1.600Z",
};
const iconFor = (key) => ICON[key] || (["ndr", "rto", "weight"].includes(key) ? ICON.courier : ICON.overview);

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

function badgeFor(key, badges) {
  if (!badges) return null;
  if (key === "desk" && badges.shop) {
    const due = badges.shop.confirm.due + badges.shop.pending.due;
    const open = badges.shop.confirm.total + badges.shop.pending.total;
    if (open > 0) return { n: due > 0 ? due : open, bad: due > 0, title: `${due} calls due now` };
  }
  const c = badges.cases;
  if (c) {
    if (key === "ndr" && c.ndr && c.ndr.open > 0) return { n: c.ndr.due > 0 ? c.ndr.due : c.ndr.open, bad: c.ndr.due > 0, title: `${c.ndr.due} due now` };
    if (key === "rto" && c.rto && c.rto.pending > 0) return { n: c.rto.pending, title: "RTO not yet received" };
    if (key === "weight" && c.weight && c.weight.open > 0) return { n: c.weight.open, title: "Open cases" };
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
  if (!check) return <div className="oa-sync">No sheet data loaded yet</div>;
  const mins = Math.max(0, Math.round((Date.now() - new Date(check.at).getTime()) / 60000));
  const every = (data.config && data.config.autoSyncMin) || 15;
  const behind = mins > Math.max(45, every * 3);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return (
    <div className={"oa-sync" + (behind ? " oa-sync-bad" : "")}>
      {behind ? `Sync is behind: last check ${ago}` : `Sheet checked ${ago}`}
      {data.last && !data.last.ok && <div>Last attempt failed. See Settings.</div>}
    </div>
  );
}

function Shell({ user }) {
  const { logout, isAdmin: hubAdmin, hasReminder, hasWorkshop, hasTickets } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("oa-sidebar-collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const badges = useBadges();
  useEffect(() => { localStorage.setItem("oa-sidebar-collapsed", collapsed ? "1" : "0"); }, [collapsed]);

  const allowed = pagesFor(user); // null = admin: everything
  const ok = (key) => !allowed || allowed.includes(key);
  const guard = (key, el) => (ok(key) ? el : <Navigate to={O} replace />);
  const nav = NAV.filter(([, , key]) => ok(key)).map(([to, label, key, kind]) => [key === "desk" ? deskHome(user) : O + to, label, key, kind]);
  const switchApp = hasReminder || hasWorkshop || hasTickets;
  const roleText = isAdmin(user) ? "Admin" : rolesOf(user).map((r) => ROLE_LABEL[r].replace(" team", "")).join(" + ");

  return (
    <div className={"layout oa-app" + (collapsed ? " sidebar-collapsed" : "")}>
      <button type="button" className="mobile-menu-btn" aria-label="Toggle menu" onClick={() => setMobileOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <OrdersLogo size={36} />
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Order Analytics</div>
                <div className="brand-sub">Shopify · Shipway · Team</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button type="button" className="collapse-btn" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: collapsed ? "rotate(180deg)" : "none" }}>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
        </div>

        <nav>
          {nav.map(([to, label, key, kind]) => {
            const b = badgeFor(key, badges);
            return (
              <NavLink
                key={key}
                to={to}
                end={key === "overview"}
                title={collapsed ? label : undefined}
                className={({ isActive }) => "nav-link" + (kind === "sub" ? " oa-sub" : "") + (isActive ? " active" : "")}
                onClick={() => setMobileOpen(false)}
              >
                <span className="nav-icon-wrap">
                  <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconFor(key)} />
                  </svg>
                  {b && collapsed && <span className="nav-icon-dot" aria-hidden="true" />}
                </span>
                {!collapsed && <span className="oa-nav-label">{label}</span>}
                {b && !collapsed && <span className={"nav-badge" + (b.bad ? " oa-badge-bad" : "")} title={b.title}>{b.n > 99 ? "99+" : b.n}</span>}
              </NavLink>
            );
          })}
          {switchApp && (
            <button type="button" className="nav-link oa-switch" onClick={() => { sessionStorage.removeItem("hubChosen"); navigate("/hub"); }} title="Switch app">
              <span className="nav-icon-wrap">
                <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
                </svg>
              </span>
              {!collapsed && <span>All apps</span>}
            </button>
          )}
        </nav>

        {!collapsed && hubAdmin && <SyncNote />}

        <div className="sidebar-user">
          <div className="sidebar-user-link" title={collapsed ? user.name : undefined}>
            <span className="avatar" style={avatarStyleFromString(user.name)}>{initials(user.name)}</span>
            {!collapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{roleText}</div>
              </div>
            )}
          </div>
          <button type="button" className="sidebar-logout" onClick={logout} title="Sign out">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="oa-scope">
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
      </main>
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
