import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { Loading } from '../components.jsx';
import { fmtWhen, rolesOf, ROLE_LABEL } from '../flowUi.js';

// The team is managed in ONE place: the hub's Users page (Reminder List > Users). People appear here automatically, with the
// desk team(s) an admin ticked for them. This card is a read-only view of who can work orders and in which team.
export function TeamCard() {
  const { data, error, loading } = useApi('/staff/users');
  const people = (data && data.users) || [];
  return (
    <div className="card">
      <h2>Team</h2>
      <p className="muted">Everyone signs in once, on the hub, and opens Order Analytics from there. Their desk team (Confirmation, Dispatch, or Admin for everything) is set in the hub&apos;s <Link to="/admin/people">Admin Settings &rsaquo; People &amp; access</Link> page, and every action in the desks is saved with their name, the time and the status before.</p>
      <Loading error={error} loading={loading && !data}>
        {data && people.length === 0 && <div className="banner warn">No one is on the order desks yet. On the hub&apos;s Admin Settings, give a person the Order Analytics app and pick Confirmation and/or Dispatch.</div>}
        {data && people.length > 0 && (
          <div className="tablewrap"><table>
            <thead><tr><th>Person</th><th>Teams</th><th>Status</th><th>Last opened</th></tr></thead>
            <tbody>{people.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{rolesOf(u).includes('admin') ? 'Admin (everything)' : rolesOf(u).map((r) => ROLE_LABEL[r]).join(' + ')}</td>
                <td>{u.active ? <span className="tag Delivered">Active</span> : <span className="tag RTO">Switched off</span>}</td>
                <td className="muted">{u.lastLoginAt ? fmtWhen(u.lastLoginAt) : 'Never'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loading>
    </div>
  );
}

export function DeskSettingsCard() {
  const { data, error, loading } = useApi('/flow/config');
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (data) setF({ afterThree: data.afterThree, startFrom: data.startFrom || '', partialLinkUrl: data.partialLinkUrl || '' }); }, [data]);
  const save = async () => {
    setMsg(null);
    try { await api.put('/flow/config', f); setMsg({ ok: true, text: 'Saved. The desks use these settings straight away.' }); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  return (
    <div className="card">
      <h2>Confirm queue settings</h2>
      <Loading error={error} loading={(loading && !data) || !f}>
        {f && (
          <>
            <div className="field"><label htmlFor="a3">After the third unanswered call</label>
              <select id="a3" value={f.afterThree} onChange={(e) => setF({ ...f, afterThree: e.target.value })}>
                <option value="cancel">Cancel the order automatically</option>
                <option value="escalate">Escalate to a lead (stays in the queue, flagged)</option>
              </select></div>
            <div className="field"><label htmlFor="sf">Show orders placed since</label>
              <input id="sf" type="date" value={f.startFrom} onChange={(e) => setF({ ...f, startFrom: e.target.value })} />
              <span className="muted">Leave empty for the last 7 days. Older pending orders in the sheet stay out of the queue.</span></div>
            <div className="field"><label htmlFor="pl">Partial payment link</label>
              <input id="pl" type="text" value={f.partialLinkUrl} placeholder="https://pages.razorpay.com/yourpage?order={orderId}&amount={amount}" onChange={(e) => setF({ ...f, partialLinkUrl: e.target.value })} />
              <span className="muted">Used by the &quot;Payment link&quot; button. Placeholders: {'{orderId}'}, {'{amount}'} (rupees), {'{amountPaise}'}, {'{phone}'}. Must start with https://. Leave empty to switch the button off.</span></div>
            <div className="filters"><button className="btn" onClick={save}>Save settings</button></div>
          </>
        )}
      </Loading>
      {msg && <div className={`banner ${msg.ok ? '' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}
