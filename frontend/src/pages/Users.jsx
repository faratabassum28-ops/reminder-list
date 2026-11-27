import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import { useToast } from "../components/Toast.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";

const empty = { name: "", email: "", password: "", role: "member", slackId: "", canRequestWorkshops: false, apps: ["reminder", "workshop", "tickets"], ordersRoles: [], emiRole: "CRM", emiCanVerify: false, certRole: "issuer", leadFmsRole: "caller", leadFmsName: "", salesFmsRole: "caller", salesFmsName: "" };

const APP_LABEL = { reminder: "Reminder List", workshop: "Workshop PMS", tickets: "Help Tickets", orders: "Order Analytics", certificates: "Certificate Studio", emi: "EMI Manager", leadfms: "Lead FMS", salesfms: "Sales FMS" };
const APPS = ["reminder", "workshop", "tickets", "orders", "certificates", "emi", "leadfms", "salesfms"];
// EMI Manager roles. Admins are EMI admins automatically.
const EMI_ROLES = ["Admin", "Manager", "CRM", "Viewer"];
const EMI_ROLE_HINT = { Admin: "Everything in EMI Manager, including users' batch access and backups", Manager: "Settings, imports, discounts, collections team", CRM: "Enrols students, records payments, logs calls", Viewer: "Read-only (can be allowed to verify payments)" };
// Order Analytics desk teams: Confirmation calls and confirms new orders, Dispatch slips / packs / hands over.
const TEAM_LABEL = { confirmation: "Confirmation team", packing: "Dispatch team", admin: "Admin" };
const TEAM_HINT = { confirmation: "Calls and confirms new orders", packing: "Prints slips, packs and hands orders to the courier", admin: "Sees and manages everything in Order Analytics" };
const TEAMS = ["confirmation", "packing", "admin"];
// Certificate Studio roles. Admin = templates, edits, approvals. Issuer (creator) = issues certificates and requests changes.
const CERT_ROLES = ["issuer", "admin"];
const CERT_LABEL = { issuer: "Certificate issuer / creator", admin: "Certificate admin" };

export default function Users({ embedded = false }) {
  const { user: currentUser } = useAuth();
  const [params] = useSearchParams();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [resetId, setResetId] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [slackEditId, setSlackEditId] = useState(null);
  const [slackEditValue, setSlackEditValue] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [q, setQ] = useState("");
  const [appTab, setAppTab] = useState(APPS.includes(params.get("app")) ? params.get("app") : "all");
  const toast = useToast();

  const load = () => api.getUsers().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (form.role !== "admin" && form.apps.length === 0) {
      toast("Pick at least one app for this user", "bad");
      return;
    }
    if (form.role !== "admin" && form.apps.includes("orders") && form.ordersRoles.length === 0) {
      toast("Order Analytics needs a role: pick Confirmation team, Dispatch team and/or Admin", "bad");
      return;
    }
    try {
      await api.createUser({ ...form, emiRole: form.apps.includes("emi") ? form.emiRole : undefined, certRole: form.apps.includes("certificates") ? form.certRole : undefined });
      setForm(empty);
      load();
      toast(`Added ${form.name} as ${form.role}`, "good");
    } catch (err) {
      setError(err.message);
      toast(err.message, "bad");
    }
  };

  const toggleActive = async (u) => {
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { active: !u.active });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} marked ${!u.active ? "active" : "inactive"}`, "default");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleRole = async (u) => {
    setBusyId(u._id);
    try {
      const nextRole = u.role === "admin" ? "member" : "admin";
      const updated = await api.updateUser(u._id, { role: nextRole });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} is now ${nextRole === "admin" ? "an Admin" : "a Member"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleApp = async (u, app) => {
    const has = u.apps.includes(app);
    const next = has ? u.apps.filter((a) => a !== app) : [...u.apps, app];
    if (next.length === 0) {
      toast("A user needs at least one app — deactivate them instead", "bad");
      return;
    }
    // Order Analytics needs a desk team. Switching it on starts with Confirmation (adjust with the team chips that appear).
    const body = { apps: next };
    if (app === "orders" && !has && !(u.ordersRoles || []).length) body.ordersRoles = ["confirmation"];
    if (app === "emi" && !has && !u.emiRole) body.emiRole = "CRM";
    if (app === "certificates" && !has && !u.certRole) body.certRole = "issuer";
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, body);
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name}: ${APP_LABEL[app]} access ${has ? "removed" : "added"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const setEmi = async (u, patch) => {
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, patch);
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name}: role updated`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleTeam = async (u, team) => {
    const cur = u.ordersRoles || [];
    const next = cur.includes(team) ? cur.filter((t) => t !== team) : [...cur, team];
    if (next.length === 0) {
      toast("Order Analytics needs at least one role — remove the app instead", "bad");
      return;
    }
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { ordersRoles: next });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name}: ${TEAM_LABEL[team]} ${cur.includes(team) ? "removed" : "added"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleCoordinator = async (u) => {
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { canRequestWorkshops: !u.canRequestWorkshops });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} ${updated.canRequestWorkshops ? "can now add new workshops" : "can no longer add new workshops"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (u) => {
    try {
      await api.removeUser(u._id);
      setUsers((prev) => prev.filter((x) => x._id !== u._id));
      toast(`Removed ${u.name}`, "bad");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const submitReset = async (e, id) => {
    e.preventDefault();
    try {
      await api.updateUser(id, { password: resetPassword });
      setResetId(null);
      setResetPassword("");
      toast("Password reset", "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const startSlackEdit = (u) => {
    setSlackEditId(u._id);
    setSlackEditValue(u.slackId || "");
  };

  const saveSlackId = async (id) => {
    setSlackSaving(true);
    try {
      const updated = await api.updateUser(id, { slackId: slackEditValue });
      setUsers((prev) => prev.map((x) => (x._id === id ? updated : x)));
      setSlackEditId(null);
      toast("Slack ID saved", "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setSlackSaving(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!users) return users;
    const byApp = appTab === "all" ? users : users.filter((u) => u.apps.includes(appTab));
    if (!needle) return byApp;
    return byApp.filter((u) =>
      u.name.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle) ||
      u.role.toLowerCase().includes(needle)
    );
  }, [users, needle, appTab]);

  return (
    <div className={embedded ? "" : "page"}>
      {embedded ? (
        <div className="toolbar" style={{ marginBottom: 6 }}>{users && <span className="chip"><strong>{users.length}</strong> accounts</span>}</div>
      ) : (
        <PageHeader
          title="Users"
          subtitle="Who can sign in, and what they're allowed to do"
          meta={users && <span className="chip"><strong>{users.length}</strong> accounts</span>}
        />
      )}
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Password (min 8 chars)" required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <input placeholder="Slack ID (optional)" value={form.slackId} onChange={(e) => setForm({ ...form, slackId: e.target.value })} />
        {form.role !== "admin" && APPS.map((app) => (
          <label key={app} className="ws-inline-check" title={`Lets this person open ${APP_LABEL[app]}`}>
            <input
              type="checkbox"
              checked={form.apps.includes(app)}
              onChange={(e) =>
                setForm({
                  ...form,
                  apps: e.target.checked ? [...form.apps, app] : form.apps.filter((a) => a !== app),
                })
              }
            /> {APP_LABEL[app]}
          </label>
        ))}
        {form.role !== "admin" && form.apps.includes("orders") && TEAMS.map((t) => (
          <label key={t} className="ws-inline-check" title={TEAM_HINT[t]}>
            <input
              type="checkbox"
              checked={form.ordersRoles.includes(t)}
              onChange={(e) => setForm({ ...form, ordersRoles: e.target.checked ? [...form.ordersRoles, t] : form.ordersRoles.filter((x) => x !== t) })}
            /> Orders: {TEAM_LABEL[t]}
          </label>
        ))}
        {form.role !== "admin" && form.apps.includes("emi") && (
          <>
            <select value={form.emiRole} onChange={(e) => setForm({ ...form, emiRole: e.target.value })} title="Role inside EMI Manager">
              {EMI_ROLES.map((r) => <option key={r} value={r}>EMI: {r}</option>)}
            </select>
            <label className="ws-inline-check" title="Accounts: may mark payments as verified in EMI Manager">
              <input type="checkbox" checked={form.emiCanVerify} onChange={(e) => setForm({ ...form, emiCanVerify: e.target.checked })} /> Verifies payments
            </label>
          </>
        )}
        {form.role !== "admin" && form.apps.includes("certificates") && (
          <select value={form.certRole} onChange={(e) => setForm({ ...form, certRole: e.target.value })} title="Role inside Certificate Studio">
            {CERT_ROLES.map((r) => <option key={r} value={r}>Certificates: {CERT_LABEL[r]}</option>)}
          </select>
        )}
        <label className="ws-inline-check" title="Lets this person fill the New Workshop form in Workshop PMS (admins approve)">
          <input type="checkbox" checked={form.canRequestWorkshops} onChange={(e) => setForm({ ...form, canRequestWorkshops: e.target.checked })} /> Workshop coordinator
        </label>
        <button type="submit">Add User</button>
      </form>
      <p className="form-hint">
        <strong>Admins</strong> can delete data, manage Settings, and manage other accounts. <strong>Members</strong> can
        do day-to-day work — add, edit, complete, export — but not delete anything or reach Settings/Users. Slack ID is
        optional; people can also set their own from the Account page. <strong>App access</strong> decides which app a
        person can open — Reminder List, Workshop PMS, Help Tickets, Certificate Studio, or any mix (admins always get all). In Certificate Studio, a <strong>Certificate admin</strong> manages templates and approves change requests; a <strong>Certificate issuer / creator</strong> issues certificates and requests corrections. <strong>Order Analytics</strong> is switched on per person with a role — Confirmation team, Dispatch team and/or Admin — which decides what they see there. <strong>EMI Manager</strong> has Admin, Manager, CRM and Viewer roles. In <strong>Lead FMS</strong> and <strong>Sales FMS</strong> a person is an Admin or a Caller, and the <strong>caller name</strong> is what leads are assigned to (blank = their account name). A person with only one app
        goes straight into it and never sees the others.
      </p>

      <div className="range-pills" role="tablist" aria-label="Filter users by app" style={{ marginBottom: 10 }}>
        {[["all", "All users"], ["reminder", "Reminder List users"], ["workshop", "Workshop PMS users"], ["tickets", "Help Tickets users"], ["orders", "Order Analytics users"], ["certificates", "Certificate Studio users"], ["emi", "EMI Manager users"], ["leadfms", "Lead FMS users"], ["salesfms", "Sales FMS users"]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={appTab === id}
            className={"range-pill" + (appTab === id ? " range-pill-active" : "")} onClick={() => setAppTab(id)}>
            {label}{users ? ` (${id === "all" ? users.length : users.filter((u) => u.apps.includes(id)).length})` : ""}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name, email, or role… (press /)" />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>S.No</th><th>Name</th><th>Email</th><th>Account role</th><th>Workshop role</th><th>App access</th><th>Slack ID</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {!users && <TableSkeleton columns={9} rows={5} />}
            {users && filteredUsers.length === 0 && (
              <tr><td colSpan={9} className="empty-state">No users match "{q}".</td></tr>
            )}
            {filteredUsers?.map((u, i) => (
              <tr key={u._id} className={u.active === false ? "row-inactive" : ""}>
                <td>{i + 1}</td>
                <td>
                  <div className="name-cell">
                    <span className="avatar" style={avatarStyleFromString(u.name)}>{initials(u.name)}</span>
                    {u.name}{u._id === currentUser?.id && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>You</span>}
                  </div>
                </td>
                <td>{u.email}</td>
                <td>
                  <button type="button" className={"role-toggle " + (u.role === "admin" ? "role-admin" : "role-member")}
                    disabled={busyId === u._id} onClick={() => toggleRole(u)} title={u.role === "admin" ? "Click to make this person a Member" : "Click to make this person an Admin"}>
                    {u.role === "admin" ? "Admin" : "Member"}
                  </button>
                </td>
                <td>
                  {u.role === "admin" ? (
                    <span className="wsrole wsrole-approver" title="Admins approve every workshop request">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.500 4.500L19 7.500" /></svg>
                      Approver
                    </span>
                  ) : (
                    <div className="wsrole-cell">
                      <ToggleSwitch
                        checked={!!u.canRequestWorkshops}
                        disabled={busyId === u._id}
                        label={`${u.name} can add new workshops`}
                        onChange={() => toggleCoordinator(u)}
                      />
                      {u.canRequestWorkshops ? (
                        <span className="wsrole wsrole-coord" title="Can add new workshops and see all requests">
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="m12 2.800 2.800 5.900 6.400.8-4.700 4.400 1.200 6.400L12 17.200 6.300 20.300l1.200-6.400L2.800 9.500l6.400-.8L12 2.800Z" /></svg>
                          Coordinator
                        </span>
                      ) : (
                        <span className="wsrole wsrole-owner" title="Only works on their assigned workshop tasks">Task owner</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  {APPS.map((app) => {
                    const on = u.apps.includes(app);
                    const locked = u.role === "admin"; // admins always have both
                    return (
                      <button key={app} type="button"
                        className={"role-toggle " + (on ? "role-admin" : "role-member")}
                        style={{ marginRight: 6 }}
                        disabled={busyId === u._id || locked}
                        onClick={() => toggleApp(u, app)}
                        title={locked ? "Admins always have every app" : `Click to ${on ? "remove" : "give"} ${APP_LABEL[app]} access`}>
                        {on ? "✓ " : "+ "}{APP_LABEL[app]}
                      </button>
                    );
                  })}
                  {u.role !== "admin" && u.apps.includes("emi") && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 12 }}>EMI role:</span>
                      <select value={u.emiRole || "CRM"} disabled={busyId === u._id} onChange={(e) => setEmi(u, { emiRole: e.target.value })} title={EMI_ROLE_HINT[u.emiRole || "CRM"]}>
                        {EMI_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <label className="ws-inline-check" title="Accounts: may mark payments as verified">
                        <input type="checkbox" checked={!!u.emiCanVerify} disabled={busyId === u._id} onChange={(e) => setEmi(u, { emiCanVerify: e.target.checked })} /> Verifies
                      </label>
                    </div>
                  )}
                  {u.role !== "admin" && [["leadfms", "leadFmsRole", "leadFmsName", "Lead FMS"], ["salesfms", "salesFmsRole", "salesFmsName", "Sales FMS"]].filter(([a]) => u.apps.includes(a)).map(([a, roleF, nameF, label]) => (
                    <div key={a} style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 12 }}>{label}:</span>
                      <select value={u[roleF] || "caller"} disabled={busyId === u._id} onChange={(e) => setEmi(u, { [roleF]: e.target.value })}>
                        <option value="caller">Caller</option><option value="admin">Admin</option>
                      </select>
                      <input defaultValue={u[nameF] || ""} placeholder="Caller name (blank = account name)" style={{ width: 210 }} disabled={busyId === u._id}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (u[nameF] || "")) setEmi(u, { [nameF]: v }); }} />
                    </div>
                  ))}
                  {u.role !== "admin" && u.apps.includes("certificates") && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Certificates:</span>
                      <select value={u.certRole || "issuer"} disabled={busyId === u._id} onChange={(e) => setEmi(u, { certRole: e.target.value })}>
                        {CERT_ROLES.map((r) => <option key={r} value={r}>{CERT_LABEL[r]}</option>)}
                      </select>
                    </div>
                  )}
                  {u.role !== "admin" && u.apps.includes("orders") && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Orders:</span>
                      {TEAMS.map((t) => {
                        const on = (u.ordersRoles || []).includes(t);
                        return (
                          <button key={t} type="button"
                            className={"role-toggle " + (on ? "role-admin" : "role-member")}
                            disabled={busyId === u._id}
                            onClick={() => toggleTeam(u, t)}
                            title={`${TEAM_HINT[t]}. Click to ${on ? "remove" : "add"}.`}>
                            {on ? "✓ " : "+ "}{TEAM_LABEL[t]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td>
                  {slackEditId === u._id ? (
                    <div className="row-actions">
                      <input className="cell-edit-input" placeholder="Slack ID" value={slackEditValue}
                        onChange={(e) => setSlackEditValue(e.target.value)} style={{ width: 120 }} />
                      <button type="button" className="link-btn" disabled={slackSaving} onClick={() => saveSlackId(u._id)}>
                        {slackSaving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="link-btn" disabled={slackSaving} onClick={() => setSlackEditId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => startSlackEdit(u)}>
                      {u.slackId || <span className="muted">— add —</span>}
                    </button>
                  )}
                </td>
                <td>
                  <div className="status-cell">
                    <ToggleSwitch
                      checked={u.active !== false}
                      disabled={busyId === u._id}
                      label={`Toggle ${u.name} active status`}
                      onChange={() => toggleActive(u)}
                    />
                    <span className={"badge " + (u.active !== false ? "badge-good" : "badge-bad")}>
                      {u.active !== false ? "Active" : "Inactive"}
                    </span>
                  </div>
                </td>
                <td>
                  {resetId === u._id ? (
                    <form className="reset-pw-form" onSubmit={(e) => submitReset(e, u._id)}>
                      <input type="password" placeholder="New password" required minLength={8}
                        value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                      <button type="submit" className="link-btn">Save</button>
                      <button type="button" className="link-btn" onClick={() => { setResetId(null); setResetPassword(""); }}>Cancel</button>
                    </form>
                  ) : (
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => setResetId(u._id)}>Reset Password</button>
                      {u._id !== currentUser?.id && <ConfirmDeleteButton onConfirm={() => remove(u)} />}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
