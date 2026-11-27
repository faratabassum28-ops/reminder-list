import React, { Suspense, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useToast } from "../components/Toast.jsx";
import SchoolBrand from "../components/SchoolLogo.jsx";
import Logo from "../components/Logo.jsx";
import WorkshopLogo from "../components/WorkshopLogo.jsx";
import TicketsLogo from "../components/TicketsLogo.jsx";
import OrdersLogo from "../components/OrdersLogo.jsx";
import CertificatesLogo from "../components/CertificatesLogo.jsx";
import EmiLogo from "../components/EmiLogo.jsx";
import LeadFmsLogo from "../components/LeadFmsLogo.jsx";
import SalesFmsLogo from "../components/SalesFmsLogo.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import PageLoader from "../components/PageLoader.jsx";
import { lazyRetry } from "../utils/lazyRetry.js";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import Users from "./Users.jsx";
import "./hub.css";
import "./admin.css";

const ReminderSettings = lazyRetry(() => import("./Settings.jsx"));

// Everything an admin controls across ALL SIX apps, in one place: which apps exist for people, who gets which app and which role
// inside it, each app's own settings, and the light/dark choice people made. Admins only (the server enforces it as well).
const APPS = [
  {
    id: "reminder", name: "Reminder List", tone: "#6d4fc0", Logo, home: "/", settings: "/settings",
    blurb: "Recurring tasks, doers, the Master log and the performance dashboard.",
    roles: [["Admin", "Everything: Doer List, Settings, Users, deleting data"], ["Member", "Dashboard plus their own Master rows; can complete and edit their own tasks"]],
  },
  {
    id: "workshop", name: "Workshop PMS", tone: "#e0912b", Logo: WorkshopLogo, home: "/workshops", settings: "/workshops/templates",
    blurb: "Plan workshops, get them approved and run each one's fixed task list.",
    roles: [["Approver", "Admins approve every workshop request and edit the task lists"], ["Coordinator", "Can add new workshops and see all requests"], ["Task owner", "Works only on their assigned workshop tasks"]],
  },
  {
    id: "tickets", name: "Help Tickets", tone: "#0e9aa7", Logo: TicketsLogo, home: "/tickets", settings: null,
    blurb: "Raise a problem to a teammate and track it until it's resolved.",
    roles: [["Admin", "Sees Tickets Raised across the whole team"], ["Member", "Raises tickets and sees only the ones sent to them"]],
  },
  {
    id: "orders", name: "Order Analytics", tone: "#1d8a63", Logo: OrdersLogo, home: "/orders", settings: "/orders/settings",
    blurb: "Confirm, dispatch and track every Shopify order with live Sheet, Shopify and Shipway data.",
    roles: [["confirmation", "Confirmation team: calls and confirms new orders"], ["packing", "Dispatch team: slips, packing and courier handover"], ["admin", "Admin: sees and manages everything in Order Analytics"]],
    roleLabels: { confirmation: "Confirmation team", packing: "Dispatch team", admin: "Admin" },
  },
  {
    id: "certificates", name: "Certificate Studio", tone: "#c43d6b", Logo: CertificatesLogo, home: "/certificates", settings: "/certificates",
    blurb: "Upload a blank certificate once, then issue named, dated PNG / PDF certificates.",
    roles: [["admin", "Certificate admin: upload / edit templates, edit issued certificates, approve change requests"], ["issuer", "Certificate issuer / creator: issues single or bulk certificates and requests corrections"]],
    roleLabels: { admin: "Certificate admin", issuer: "Certificate issuer / creator" },
  },
  {
    id: "emi", name: "EMI Manager", tone: "#4a6fd6", Logo: EmiLogo, home: "/emi", settings: "/emi/settings",
    blurb: "Fees, EMI schedules and payments by program and batch, with reminders and verification.",
    roles: [["Admin", "Everything, including batch access for users and backups"], ["Manager", "Settings, imports, discounts above the limit"], ["CRM", "Enrols students, records payments, logs calls"], ["Viewer", "Read-only (can be allowed to verify payments)"]],
  },
  {
    id: "leadfms", name: "Lead FMS", tone: "#5b5fe0", Logo: LeadFmsLogo, home: "/lead-fms", settings: "/lead-fms/settings",
    blurb: "Workshop leads, follow-ups, attendee calls, bookings and payments, worked by callers.",
    roles: [["Admin", "Daily board, reports, team, settings, assigns leads (hub admins are always admins)"], ["Caller", "Works only the leads assigned to their caller name"]],
  },
  {
    id: "salesfms", name: "Sales FMS", tone: "#0d9488", Logo: SalesFmsLogo, home: "/sales-fms", settings: "/sales-fms/settings",
    blurb: "Sales leads and closers with follow-ups, plus the enrollments and revenue dashboard.",
    roles: [["Admin", "Daily board, reports, revenue dashboard, team, settings (hub admins are always admins)"], ["Caller", "Works only the leads assigned to their caller name"]],
  },
];

const TABS = [["apps", "Apps"], ["people", "People & access"], ["settings", "App settings"], ["appearance", "Appearance"]];

function AppsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const load = () => api.getAdminOverview().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const flip = async (app, enabled) => {
    setBusy(app.id);
    try {
      await api.setAppEnabled(app.id, enabled);
      await load();
      toast(enabled ? `${app.name} is on for everyone who was given it` : `${app.name} is switched off for everyone except admins`, enabled ? "good" : "default");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <PageLoader />;
  return (
    <>
      <p className="adm-lead">
        {data.activePeople} active {data.activePeople === 1 ? "person" : "people"} across {APPS.length} apps. Give each person only the apps they need
        under <Link to="/admin/people">People &amp; access</Link> — someone with two apps ticked sees exactly two. The switch below turns an app off for everyone except admins.
      </p>
      <div className="adm-grid">
        {APPS.map((app) => {
          const o = data.apps[app.id];
          const labelOf = (k) => (app.roleLabels && app.roleLabels[k]) || k;
          return (
            <section key={app.id} className={"adm-app" + (o.enabled ? "" : " adm-app-off")} style={{ "--tone": app.tone }}>
              <header className="adm-app-head">
                <app.Logo size={44} />
                <div className="adm-app-title">
                  <h3>{app.name}</h3>
                  <span className="adm-muted">{o.people} {o.people === 1 ? "person has" : "people have"} access</span>
                </div>
                <ToggleSwitch checked={o.enabled} disabled={busy === app.id} label={`${app.name} on or off for everyone`} onChange={() => flip(app, !o.enabled)} />
              </header>
              <p className="adm-blurb">{app.blurb}</p>
              {!o.enabled && <p className="adm-off-note">Switched off: only admins can open it.</p>}
              <div className="adm-roles">
                <div className="adm-roles-title">Roles</div>
                {app.roles.map(([key, desc]) => (
                  <div key={key} className="adm-role">
                    <span className="adm-role-count">{o.roles[key] ?? 0}</span>
                    <span><b>{labelOf(key)}</b><br /><span className="adm-muted">{desc.includes(": ") && app.roleLabels ? desc.split(": ").slice(1).join(": ") : desc}</span></span>
                  </div>
                ))}
              </div>
              <footer className="adm-app-foot">
                <Link className="adm-btn" to={`/admin/people?app=${app.id}`}>Manage people</Link>
                {app.settings && <Link className="adm-btn adm-btn-ghost" to={`/admin/settings?app=${app.id}`}>Settings</Link>}
                <Link className="adm-btn adm-btn-ghost" to={app.home} onClick={() => sessionStorage.setItem("hubChosen", "1")}>Open app</Link>
              </footer>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SettingsTab() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const wanted = new URLSearchParams(search).get("app");
  const current = APPS.find((a) => a.id === wanted) || APPS[0];
  const open = (to) => { sessionStorage.setItem("hubChosen", "1"); navigate(to); };
  return (
    <div className="adm-split">
      <nav className="adm-side" aria-label="Choose an app">
        {APPS.map((a) => (
          <Link key={a.id} to={`/admin/settings?app=${a.id}`} className={"adm-side-link" + (a.id === current.id ? " on" : "")} style={{ "--tone": a.tone }}>
            <span className="adm-dot" />{a.name}
          </Link>
        ))}
      </nav>
      <div className="adm-pane" style={{ "--tone": current.tone }}>
        {current.id === "reminder" ? (
          <Suspense fallback={<PageLoader />}><div className="adm-embed"><ReminderSettings /></div></Suspense>
        ) : (
          <div className="adm-card-plain">
            <current.Logo size={48} />
            <h3>{current.name} settings</h3>
            <p className="adm-muted">{current.settings
              ? `${current.name} keeps its detailed settings next to the screens they affect. Open them directly from here.`
              : `${current.name} has no settings of its own. Who can use it is managed under People & access, and it can be switched off on the Apps tab.`}</p>
            {current.settings && <button type="button" className="adm-btn" onClick={() => open(current.settings)}>Open {current.name} settings</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  useEffect(() => { api.getUsers().then(setUsers).catch((e) => setError(e.message)); }, []);
  const set = async (u, theme) => {
    setBusy(u._id);
    try {
      const updated = await api.updateUser(u._id, { theme });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(theme === null ? `${u.name} will be asked again at their next sign-in` : `${u.name} is set to ${theme} mode`, "good");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  if (error) return <p className="error">{error}</p>;
  if (!users) return <PageLoader />;
  const count = (t) => users.filter((u) => (t === null ? !u.theme : u.theme === t)).length;
  return (
    <>
      <p className="adm-lead">Every person is asked once, on their first sign-in, whether they prefer dark or light mode. Their answer is saved to their account and follows them to every device. Here you can see the choices, change one, or ask someone again.</p>
      <div className="adm-stats">
        <div className="adm-stat"><b>{count("dark")}</b><span>Dark</span></div>
        <div className="adm-stat"><b>{count("light")}</b><span>Light</span></div>
        <div className="adm-stat"><b>{count(null)}</b><span>Not asked yet</span></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Mode</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className={u.active === false ? "row-inactive" : ""}>
                <td><div className="name-cell"><span className="avatar" style={avatarStyleFromString(u.name)}>{initials(u.name)}</span>{u.name}</div></td>
                <td>{u.theme ? <span className="badge badge-neutral">{u.theme === "dark" ? "☾ Dark" : "☀ Light"}</span> : <span className="badge badge-bad" style={{ opacity: 0.85 }}>Will be asked</span>}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-btn" disabled={busy === u._id || u.theme === "dark"} onClick={() => set(u, "dark")}>Set dark</button>
                    <button type="button" className="link-btn" disabled={busy === u._id || u.theme === "light"} onClick={() => set(u, "light")}>Set light</button>
                    <button type="button" className="link-btn" disabled={busy === u._id || !u.theme} onClick={() => set(u, null)}>Ask again</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AdminSettings() {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  if (!isAdmin) return <Navigate to="/hub" replace />;
  const tab = pathname.split("/")[2] || "apps";
  if (!TABS.some(([id]) => id === tab)) return <Navigate to="/admin/apps" replace />;

  return (
    <div className="hub adm">
      <div className="hub-glow" aria-hidden="true" />
      <header className="hub-top adm-top">
        <SchoolBrand size={40} tone="dark" />
        <span className="adm-spacer" />
        <Link to="/hub" className="hub-ghost" onClick={() => sessionStorage.removeItem("hubChosen")}>← All apps</Link>
        <div className="hub-user">
          <span className="hub-user-name">{user?.name}</span>
          <span className="hub-user-role">Admin</span>
        </div>
        <button type="button" className="hub-ghost" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
        <button type="button" className="hub-ghost" onClick={logout}>Sign out</button>
      </header>
      <main className="adm-main">
        <p className="hub-eyebrow">Admins only</p>
        <h1 className="hub-title">Admin Settings</h1>
        <p className="hub-sub adm-sub">One place for all six apps: who gets which app, what role they have inside it, each app's own settings, and how it looks for them.</p>
        <nav className="adm-tabs" role="tablist" aria-label="Admin settings sections">
          {TABS.map(([id, label]) => (
            <Link key={id} to={`/admin/${id}`} role="tab" aria-selected={tab === id} className={"adm-tab" + (tab === id ? " on" : "")}>{label}</Link>
          ))}
        </nav>
        <div className="adm-body">
          {tab === "apps" && <AppsTab />}
          {tab === "people" && <Users embedded />}
          {tab === "settings" && <SettingsTab />}
          {tab === "appearance" && <AppearanceTab />}
        </div>
      </main>
    </div>
  );
}
