import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { certApi, notifyChanged } from "../api.js";

const FIELDS = [["studentName", "Name"], ["studentRef", "Student ID"], ["dateText", "Date"]];

function Diff({ cr }) {
  const rows = FIELDS.filter(([k]) => (cr.current[k] || "") !== (cr.proposed[k] || ""));
  return (
    <ul className="cs-diff">
      {rows.map(([k, label]) => (
        <li key={k}>
          <small className="cs-muted">{label}</small><br />
          <s>{cr.current[k] || "—"}</s> → <strong>{cr.proposed[k] || "—"}</strong>
        </li>
      ))}
    </ul>
  );
}

export default function ChangeRequests() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    certApi.changeRequests(status ? { status } : {})
      .then((d) => { setItems(d); setError(""); })
      .catch((e) => setError(e.message));
  }, [status]);
  useEffect(() => { setItems(null); load(); }, [load]);

  const decide = async (cr, approve) => {
    const note = window.prompt(approve ? "Optional note for the coordinator:" : "Reason for rejecting (optional):", "");
    if (note === null) return;
    setBusy(cr.id);
    try {
      await (approve ? certApi.approveChange(cr.id, note) : certApi.rejectChange(cr.id, note));
      load();
      notifyChanged();
    } catch (e) { setError(e.message); }
    setBusy("");
  };

  return (
    <div className="page cs-page">
      <PageHeader
        title={isAdmin ? "Change requests" : "My change requests"}
        subtitle={isAdmin
          ? "Coordinators cannot alter an issued certificate. Approve a request to apply the change; reject it to keep the certificate as issued."
          : "Issued certificates can only be changed with admin permission. Track your requests here, then re-download the certificate once approved."}
      />
      {error && <p className="cs-error">{error}</p>}

      <div className="cs-tabs cs-tabs-short">
        {[["pending", "Pending"], ["", "All"]].map(([v, l]) => (
          <button key={v} type="button" className={`cs-tab ${status === v ? "on" : ""}`} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>

      <div className="cs-panel cs-tablewrap">
        <table className="cs-table">
          <thead><tr><th>Certificate</th><th>Requested change</th><th>Reason</th><th>Requested by</th><th>Status</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {items?.map((cr) => (
              <tr key={cr.id}>
                <td><code>{cr.certId}</code><br /><small className="cs-muted">{cr.program}</small></td>
                <td><Diff cr={cr} /></td>
                <td>{cr.reason}</td>
                <td>{cr.requestedBy?.name}<br /><small className="cs-muted">{new Date(cr.createdAt).toLocaleString()}</small></td>
                <td>
                  <span className={`cs-pill ${cr.status}`}>{cr.status}</span>
                  {cr.decidedBy && <><br /><small className="cs-muted">by {cr.decidedBy.name}</small></>}
                  {cr.decisionNote && <><br /><small className="cs-muted">{cr.decisionNote}</small></>}
                </td>
                {isAdmin && (
                  <td className="cs-actions">
                    {cr.status === "pending" && (
                      <>
                        <button type="button" className="cs-btn small primary" disabled={busy === cr.id} onClick={() => decide(cr, true)}>Approve</button>
                        <button type="button" className="cs-btn small danger" disabled={busy === cr.id} onClick={() => decide(cr, false)}>Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {items && !items.length && <tr><td colSpan={isAdmin ? 6 : 5} className="cs-muted">No requests.</td></tr>}
            {!items && <tr><td colSpan="6" className="cs-muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
