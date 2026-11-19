import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import CertificatesLogo from "../components/CertificatesLogo.jsx";
import PageLoader from "../components/PageLoader.jsx";
import RouteBoundary from "../components/RouteBoundary.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import { lazyRetry } from "../utils/lazyRetry.js";
import { certApi } from "./api.js";
import { ensureFonts } from "./fonts.js";
import { clearImageCaches } from "./images.js";
import { TemplatesProvider, useTemplates } from "./TemplatesContext.jsx";
import Thumb from "./components/Thumb.jsx";
import { C } from "./paths.js";
import "./certificates.css";

const Gallery = lazyRetry(() => import("./pages/Gallery.jsx"));
const NewTemplate = lazyRetry(() => import("./pages/NewTemplate.jsx"));
const Generate = lazyRetry(() => import("./pages/Generate.jsx"));
const Edit = lazyRetry(() => import("./pages/Edit.jsx"));
const History = lazyRetry(() => import("./pages/History.jsx"));
const ChangeRequests = lazyRetry(() => import("./pages/ChangeRequests.jsx"));
const Account = lazyRetry(() => import("../pages/Account.jsx"));

const I = {
  gallery: "M4 5h7v7H4V5Zm9 0h7v7h-7V5ZM4 14h7v5H4v-5Zm9 0h7v5h-7v-5Z",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  history: "M4 6h16M4 12h16M4 18h10",
  requests: "M9 11.5 11 13.500 15.500 9M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
};

// The Certificate Studio app (mounted at /certificates/*): its own sidebar + routes inside the hub.
// Hub admins are admins here (templates, direct edits, approvals); everyone else with the app is a coordinator.
export default function CertificatesApp() {
  useEffect(() => { ensureFonts(); return clearImageCaches; }, []);
  return (
    <TemplatesProvider>
      <Shell />
    </TemplatesProvider>
  );
}

function Shell() {
  const { user, logout, isAdmin, hasReminder, hasWorkshop, hasTickets, hasOrders, hasEmi } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { templates, error: tplError } = useTemplates();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cs-sidebar-collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [q, setQ] = useState("");

  useEffect(() => { localStorage.setItem("cs-sidebar-collapsed", collapsed ? "1" : "0"); }, [collapsed]);

  const loadPending = useCallback(() => {
    if (isAdmin) certApi.pendingCount().then((r) => setPending(r.count)).catch(() => {});
  }, [isAdmin]);
  useEffect(loadPending, [loadPending]);
  usePolling(loadPending, 30000);
  useEffect(() => {
    window.addEventListener("cs-changed", loadPending);
    return () => window.removeEventListener("cs-changed", loadPending);
  }, [loadPending]);

  const links = [
    { to: C, label: "All certificates", end: true, icon: "gallery" },
    ...(isAdmin ? [{ to: `${C}/new`, label: "Upload certificate", icon: "upload" }] : []),
    { to: `${C}/issued`, label: "Issued certificates", icon: "history" },
    { to: `${C}/requests`, label: isAdmin ? "Change requests" : "My change requests", icon: "requests", badge: pending },
  ];

  const needle = q.trim().toLowerCase();
  const list = (templates || []).filter((t) => !needle || t.name.toLowerCase().includes(needle) || (t.code || "").toLowerCase().includes(needle));
  const backToHub = () => { sessionStorage.removeItem("hubChosen"); navigate("/hub"); };
  const close = () => setMobileOpen(false);

  return (
    <div className={"layout cs-scope" + (collapsed ? " sidebar-collapsed" : "")}>
      <button type="button" className="mobile-menu-btn" aria-label="Toggle menu" onClick={() => setMobileOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={close} />}

      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <CertificatesLogo size={36} />
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Certificate Studio</div>
                <div className="brand-sub">Design once, issue anywhere</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">{theme === "dark" ? "☀" : "☾"}</button>
            <button type="button" className="collapse-btn" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: collapsed ? "rotate(180deg)" : "none" }}>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
        </div>

        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} title={collapsed ? l.label : undefined}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} onClick={close}>
              <span className="nav-icon-wrap">
                <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={I[l.icon]} /></svg>
                {l.badge > 0 && collapsed && <span className="nav-icon-dot" aria-hidden="true" />}
              </span>
              {!collapsed && <span>{l.label}</span>}
              {l.badge > 0 && !collapsed && <span className="nav-badge">{l.badge > 9 ? "9+" : l.badge}</span>}
            </NavLink>
          ))}

          {/* Quick pick: choose a certificate straight from the sidebar */}
          {!collapsed && (
            <div className="cs-side-picker">
              <div className="cs-side-label">Certificates{templates ? ` (${templates.length})` : ""}</div>
              <input className="cs-side-search" placeholder="Search name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="cs-side-list">
                {tplError && <p className="cs-side-note">{tplError}</p>}
                {!templates && !tplError && <p className="cs-side-note">Loading…</p>}
                {templates && list.length === 0 && <p className="cs-side-note">{templates.length === 0 ? "No certificates yet." : "No matches."}</p>}
                {list.map((t) => (
                  <NavLink key={t.id} to={`${C}/t/${t.id}`} className={({ isActive }) => "cs-side-item" + (isActive ? " active" : "")} onClick={close}>
                    <span className="cs-side-thumb"><Thumb imageRef={t.imageFile} /></span>
                    <span className="cs-side-text">
                      <span className="cs-side-name">{t.name}</span>
                      {t.code && <code className="cs-side-code">{t.code}</code>}
                    </span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}

        </nav>

        {(hasReminder || hasWorkshop || hasTickets || hasOrders || hasEmi) && (
          <button type="button" className="nav-link cs-switch" onClick={backToHub} title="Switch app">
            <span className="nav-icon-wrap">
              <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
            </span>
            {!collapsed && <span>All apps</span>}
          </button>
        )}

        <div className="sidebar-user">
          <NavLink to={`${C}/account`} className="sidebar-user-link" onClick={close} title={collapsed ? user.name : undefined}>
            <span className="avatar" style={avatarStyleFromString(user.name)}>{initials(user.name)}</span>
            {!collapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{isAdmin ? "Admin" : "Coordinator"}</div>
              </div>
            )}
          </NavLink>
          <button type="button" className="sidebar-logout" onClick={logout} title="Sign out">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      <main className="content">
        <RouteBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route index element={<Gallery />} />
              <Route path="new" element={isAdmin ? <NewTemplate /> : <Navigate to={C} replace />} />
              <Route path="t/:id" element={<Generate />} />
              <Route path="t/:id/edit" element={isAdmin ? <Edit /> : <Navigate to={C} replace />} />
              <Route path="issued" element={<History />} />
              <Route path="requests" element={<ChangeRequests />} />
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to={C} replace />} />
            </Routes>
          </Suspense>
        </RouteBoundary>
      </main>
    </div>
  );
}
