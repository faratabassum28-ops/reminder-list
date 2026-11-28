import React, { useEffect, useState } from 'react';
import { api, useApi } from '../../api.js';
import { Loading } from '../../components.jsx';
import { Sheet, useToast } from '../../deskUi.jsx';
import { duration, fmtWhen, useAutoRefresh } from '../../flowUi.js';
import { inr } from '../../format.js';
import { can, useStaff } from '../../staff.jsx';
import { ProviderBadge } from '../../providers.jsx';
import { Empty, OrderDrawer, PayTag, notifyDesk, useClock, useDebounced, useLabels } from './shared.jsx';
import { CancelSheet, ResumeSheet, STEP_KEYS } from './DispatchBoard.jsx';

// Orders the packing team put on hold, chased in two follow-up calls: FU1, then FU2.
// Each column lists its cards one under another. Calling the customer at FU1 moves the order to FU2.

function CallSheet({ order: o, show, onClose, onDone }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const fu = o.dq.hold.fu === 2 ? 2 : 1;
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/hold-followup`, { note: note.trim() }); notifyDesk(); show(fu === 1 ? `${o.orderName} moved to FU2.` : `Call saved for ${o.orderName}.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`FU${fu} call · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)}. Held for: “{o.dq.hold.note}”.</p>
      <label className="sheet-label" htmlFor="fu-note">What did the customer say? (optional)</label>
      <textarea id="fu-note" className="sd-text" rows={3} maxLength={300} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: will confirm the new address by evening" />
      <button className="btn big good" disabled={busy} onClick={submit}>{busy ? 'Saving…' : fu === 1 ? 'Call done · move to FU2' : 'Call done'}</button>
    </Sheet>
  );
}

function HoldCard({ o, now, offset, canAct, onCall, onResume, onCancel, onOpen }) {
  const { L } = useLabels();
  const h = o.dq.hold;
  const ms = now + offset - new Date(h.at).getTime();
  const phone = o.phone || o.mobile || '';
  return (
    <article className="sd-card dispatch dq-card held" aria-label={`${o.orderName}, on hold`}>
      <header>
        <div className="sd-id"><button className="link" onClick={() => onOpen(o.orderId)}>{o.orderName}</button><PayTag o={o} />{o.partial && <span className="sd-pay part">{L('payPartial')}</span>}<ProviderBadge provider={o.dq.provider} /></div>
        <span className="sd-due wait" title={`On hold since ${fmtWhen(h.at)}`}>{duration(Math.max(0, ms))}</span>
      </header>
      <div className="sd-who"><b>{o.name || 'No name'}</b>{o.city ? <span className="muted"> · {o.city}</span> : null}</div>
      <div className="sd-line"><span className="sd-amt">{inr(o.total)}</span><span className="sd-items" title={o.items}>{o.items || 'Items not loaded'}</span></div>
      <div className="dq-note"><b>Note</b> “{h.note}”<span className="muted"> · {h.byName}, {fmtWhen(h.at)} · was at {L(STEP_KEYS[h.step] || 'stepSlip')}</span></div>
      {h.fuAt && <div className="dq-note"><b>Last call</b>{h.fuNote ? <> “{h.fuNote}”</> : ' done'}<span className="muted"> · {h.fuByName}, {fmtWhen(h.fuAt)}{h.calls > 1 ? ` · ${h.calls} calls` : ''}</span></div>}
      {canAct && (
        <div className="dq-row dq-actions">
          <button className="btn good dq-resume" onClick={() => onCall(o)}>{phone ? '☎ ' : ''}{h.fu === 2 ? 'Log call' : 'Call done'}</button>
          <button className="btn ghost" onClick={() => onResume(o)}>▶ Resume</button>
          <button className="btn ghost dq-cancel" onClick={() => onCancel(o)}>Cancel</button>
        </div>
      )}
    </article>
  );
}

export default function HoldOrders() {
  const { user } = useStaff();
  const { fu } = useLabels();
  const actor = can(user, 'packing');
  const [q, setQ] = useState(''); const qd = useDebounced(q);
  const { data, error, loading, reload } = useApi('/desk/dispatch/board', { q: qd });
  useAutoRefresh(reload, 20);
  useEffect(() => { const on = () => reload(); window.addEventListener('desk-refresh', on); return () => window.removeEventListener('desk-refresh', on); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { now, offset } = useClock(data && data.now);
  const [toast, show] = useToast();
  const [open, setOpen] = useState(null);
  const [calling, setCalling] = useState(null); const [resuming, setResuming] = useState(null); const [cancelling, setCancelling] = useState(null);
  const held = ((data && data.hold) || []).filter((o) => o.dq && o.dq.hold);
  const cols = [['FU1', held.filter((o) => o.dq.hold.fu !== 2)], ['FU2', held.filter((o) => o.dq.hold.fu === 2)]];
  const done = (setter) => () => { setter(null); reload(); };

  return (
    <section>
      <p className="sd-hint">Held orders have no packing deadline. Call the customer, then press Call done: the order moves from {fu('FU1')} to {fu('FU2')}. Resume sends it back to its dispatch step.</p>
      <div className="filters"><input type="search" placeholder="Search order number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /><span className="grow" />{data && <span className="muted">{held.length} on hold</span>}</div>
      <Loading error={error} loading={loading && !data}>
        {data && (
          <div className="dq-board two">
            {cols.map(([canon, items], i) => (
              <div key={canon} className={`dq-col fu${i + 1}`}>
                <div className="dq-colhead"><div className="dq-title"><h2>{fu(canon)}</h2><span className="sd-count">{items.length}</span></div>
                  <small>{i === 0 ? 'Newly held. Call the customer first.' : 'Already called once. Follow up again.'}</small></div>
                <div className="dq-cards">
                  {items.length === 0 ? <Empty title="Nothing here">{q ? 'No orders match this.' : i === 0 ? 'Orders put on hold from Dispatch appear here.' : 'Orders arrive here after the first call.'}</Empty>
                    : items.map((o) => <HoldCard key={o.orderId} o={o} now={now} offset={offset} canAct={actor} onCall={setCalling} onResume={setResuming} onCancel={setCancelling} onOpen={setOpen} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Loading>
      {calling && <CallSheet order={calling} show={show} onClose={() => setCalling(null)} onDone={done(setCalling)} />}
      {resuming && <ResumeSheet order={resuming} show={show} onClose={() => setResuming(null)} onDone={done(setResuming)} />}
      {cancelling && <CancelSheet order={cancelling} reasons={(data && data.cancelReasons) || []} show={show} onClose={() => setCancelling(null)} onDone={done(setCancelling)} />}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
      {toast}
    </section>
  );
}
