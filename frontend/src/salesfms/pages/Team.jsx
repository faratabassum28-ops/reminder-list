import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader.jsx";
import TableSkeleton from "../../components/TableSkeleton.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { avatarStyleFromString, initials } from "../../utils/colorFromString.js";
import { useLeads } from "../LeadsContext.jsx";

// The people of Sales FMS are the hub's accounts: who can sign in, their password and whether they are active are managed on the hub's
// Users page. Here an admin only sets, per person, the CALLER NAME that leads are assigned to and the role inside this app.
export default function Team() {
  const { user: me } = useAuth();
  const { load: reloadLeads, toast } = useLeads();
  const [people, setPeople] = useState(null), [busy, setBusy] = useState(null), [q, setQ] = useState("");
  const [nameId, setNameId] = useState(null), [nameVal, setNameVal] = useState("");
  const [miss, setMiss] = useState([]);
  const refresh = () => api.ldTeam().then(setPeople).catch((e) => toast(e.message, "bad"));
  const loadMissing = () => api.ldMissingLogins().then(setMiss).catch(() => {});
  useEffect(() => { refresh(); loadMissing(); }, []);

  const put = async (p, patch, msg) => {
    setBusy(p._id);
    try {
      const u = await api.ldUpdatePerson(p._id, patch);
      setPeople((a) => a.map((x) => (x._id === p._id ? u : x)));
      setNameId(null);
      toast(msg, "good");
      loadMissing();
      reloadLeads().catch(() => {});
    } catch (e) { toast(e.message, "bad"); }
    setBusy(null);
  };

  const needle = q.trim().toLowerCase();
  const rows = people?.filter((p) => !needle || [p.name, p.email, p.leadName, p.role].join(" ").toLowerCase().includes(needle));
  return (
    <div className="page">
      <PageHeader title="Team" subtitle="Who works leads here, and the name leads are assigned to"
        meta={people && <span className="chip"><strong>{people.length}</strong> people</span>} />
      <p className="form-hint">
        People, passwords and who may open <strong>Sales FMS</strong> are managed on the hub's <Link to="/admin/people">Users page</Link> (tick the app for a person there).
        <strong> Admins</strong> see every lead and the Daily Board, Reports, Team and Settings. <strong>Callers</strong> see only the leads
        assigned to their <strong>caller name</strong> — it has to match “Assigned To” in the intake sheet (or whatever an admin picks when
        assigning). Leave it blank to use the person's account name. Hub admins are always admins here.
      </p>

      {miss.length > 0 && (
        <div className="ld-panel">
          <h3>Names with leads but nobody to sign in as them</h3>
          <p className="ld-small" style={{ marginTop: 0 }}>These names are in the sheet's “Assigned To”, so they have leads, but no person here has that caller name — only admins can see those leads.
            Create or find the person on the <Link to="/admin/people">Users page</Link>, tick Sales FMS for them, then set their caller name below to exactly the name shown here.</p>
          <div className="ld-chips" style={{ margin: 0 }}>
            {miss.map((m) => <span key={m.name} className="ld-chip"><b>{m.name}</b> <span className="ld-chip-n">· {m.leads} leads</span></span>)}
          </div>
        </div>
      )}

      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search by name, email, caller name… (press /)" /></div>
      <div className="table-wrap">
        <table className="table ld-sno">
          <thead><tr><th>S.No</th><th>Name</th><th>Email</th><th>Caller name (= Assigned To)</th><th>Role here</th><th>Account</th></tr></thead>
          <tbody>
            {!people && <TableSkeleton columns={6} rows={6} />}
            {people?.length === 0 && <tr><td colSpan={6} className="empty-state">Nobody has Sales FMS yet. Tick it for people on the Users page.</td></tr>}
            {people && people.length > 0 && rows?.length === 0 && <tr><td colSpan={6} className="empty-state">No one matches “{q}”.</td></tr>}
            {rows?.map((p, i) => (
              <tr key={p._id} className={p.active ? "" : "row-inactive"}>
                <td>{i + 1}</td>
                <td><div className="name-cell"><span className="avatar" style={avatarStyleFromString(p.name)}>{initials(p.name)}</span>{p.name}{p._id === me?.id && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>You</span>}</div></td>
                <td>{p.email}</td>
                <td>
                  {nameId === p._id ? (
                    <div className="row-actions">
                      <input className="cell-edit-input" value={nameVal} onChange={(e) => setNameVal(e.target.value)} style={{ width: 150 }} autoFocus />
                      <button type="button" className="link-btn" onClick={() => put(p, { leadName: nameVal }, "Caller name saved")}>Save</button>
                      <button type="button" className="link-btn" onClick={() => setNameId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => { setNameId(p._id); setNameVal(p.leadName === p.name ? "" : p.leadName); }}>
                      {p.leadName || <span className="muted">{p.name} (account name)</span>}
                    </button>
                  )}
                </td>
                <td>
                  <button type="button" className={"role-toggle " + (p.role === "admin" ? "role-admin" : "role-member")} disabled={busy === p._id || p.hubAdmin}
                    title={p.hubAdmin ? "Hub admins are always admins here" : p.role === "admin" ? "Click to make this person a Caller" : "Click to make this person an Admin"}
                    onClick={() => put(p, { role: p.role === "admin" ? "caller" : "admin" }, `${p.name} is now ${p.role === "admin" ? "a Caller" : "an Admin"}`)}>
                    {p.role === "admin" ? "Admin" : "Caller"}
                  </button>
                </td>
                <td><span className={"badge " + (p.active ? "badge-good" : "badge-bad")}>{p.active ? "Active" : "Inactive"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
