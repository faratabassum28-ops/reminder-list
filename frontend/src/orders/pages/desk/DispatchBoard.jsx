import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.js';
import { Loading } from '../../components.jsx';
import { Sheet, useToast } from '../../deskUi.jsx';
import { duration, fmtWhen, useAutoRefresh } from '../../flowUi.js';
import { inr } from '../../format.js';
import { can, useStaff } from '../../staff.jsx';
import { PROVIDERS, ProviderBadge, providerLabel, providerStyle, providerMeta } from '../../providers.jsx';

// What the courier's refusal means and what to do about it. The courier decides, not this app: a manifest only works on an order
// that is ready for pickup at the courier.
function manifestHint(prov, message) {
  const m = String(message || '').toLowerCase();
  if (prov === 'shipway' && /only for processed|processed orders/.test(m)) return 'In Shipway this order is not "Processed" yet. Process it there first (assign the courier and generate the AWB / label), then create the manifest again.';
  if (prov === 'shiprocket' && /shows it as "(rto[^"]*|[^"]*(delivered|in transit|out for delivery|cancel)[^"]*)"/.test(m)) return 'This shipment has already left or is coming back, so it cannot be manifested. Do not create another manifest: wait for it, or reship it with a new AWB (new shipment in Shiprocket), or cancel the order here.';
  if (prov === 'shiprocket' && /manifest not generated/.test(m)) return 'In Shiprocket the order needs an AWB and a scheduled pickup before a manifest can be made. Generate the pickup in Shiprocket, then try again (an order already on a manifest is refused too).';
  if (/not serviceable/.test(m)) return 'The courier cannot pick up from or deliver to this pincode. Change the courier in the courier\'s dashboard.';
  return '';
}
import { AssigneeRow, Empty, MultiPhotoField, OrderDrawer, PayTag, WhoFilter, Workload, notifyDesk, peopleFor, useAssign, useClock, useDebounced, useLabels, useTeam } from './shared.jsx';

// The three steps of the Dispatch queue, in the order the team works an order. The page shows ONE step at a time.
// `hint` is the one plain sentence shown above the cards: what to do on this step.
const COLS = [
  { key: 'slip', label: 'stepSlip', num: 1, sub: 'Print the slip, choose the service', hint: (L) => `Print the slip and stick it on the box. Then press ${L('btnDone')} and choose which service ships this order (${PROVIDERS.map(providerLabel).join(' or ')}).` },
  { key: 'packed', label: 'stepPacked', num: 2, sub: 'AWB comes from the service', hint: (L, pl) => `Pack the box. The AWB is fetched from ${pl || 'the service you chose'} by itself. ${L('btnDone')} stays OFF until the AWB arrives, then it turns ON.` },
  { key: 'handover', label: 'stepHandover', num: 3, sub: 'Create manifest, then hand over', hint: () => 'Handover has 2 steps. STEP 1: create the manifest. STEP 2: hand over the selected manifest to the courier with 1 photo.' },
];
const hm = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const whenLabel = (conf) => (conf.dayOffset === 0 ? `Working day ${hm(conf.dueTime)}` : `${conf.dayOffset} working day${conf.dayOffset === 1 ? '' : 's'} later, ${hm(conf.dueTime)}`);

// "Due Mon 12:00 PM · in 2h 10m" / "Overdue 1h 05m"
function Due({ dueAt, now, offset }) {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - (now + offset);
  const when = new Date(dueAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  if (ms >= 0) return <span className="sd-due wait" title={`Due ${fmtWhen(dueAt)}`}>{when} · in {duration(ms)}</span>;
  return <span className="sd-due late" title={`Was due ${fmtWhen(dueAt)}`}>Overdue {duration(-ms)}</span>;
}

// How long ago, in plain words.
const agoLabel = (at) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// The AWB of an order at Order packed. It comes from the order's own service. Nothing is typed.
const awbOf = (o) => o.dq.suggestedAwb || (o.dq.shipCheck && o.dq.shipCheck.state === 'awb_ready' && o.dq.shipCheck.awb) || '';
const awbCourierOf = (o) => o.dq.suggestedCourier || (o.dq.shipCheck && o.dq.shipCheck.state === 'awb_ready' && o.dq.shipCheck.courier) || '';
const otherService = (p) => (PROVIDERS.length === 2 ? PROVIDERS.find((x) => x !== p) : null); // "switch" only makes sense with exactly two services

// Three plain groups, so nobody has to learn six statuses: AWB is here / AWB is not here yet / something is wrong.
const awbGroup = (o) => {
  if (awbOf(o)) return 'ready';
  const c = o.dq.shipCheck;
  return c && (c.state === 'cancelled' || c.state === 'not_found') ? 'problem' : 'noawb';
};
const AWB_CHIPS = [['', 'All'], ['ready', '✓ AWB ready'], ['noawb', '⏳ No AWB yet'], ['problem', '⚠ Problem']];

// What is going on with an order that has no AWB yet, in plain words, with the next thing to do.
function ShipLine({ o, prov, canAct, busy, fetching, onFetch, onCancel, onSwitch }) {
  const c = o.dq.shipCheck; const pl = providerLabel(prov || 'shipway'); const other = otherService(prov || 'shipway');
  const when = c && c.at ? <small className="ship-when" title={new Date(c.at).toLocaleString()}>checked {agoLabel(c.at)}</small> : null;
  const fetchBtn = canAct && <button className="btn ghost ship-act" disabled={busy || fetching} onClick={() => onFetch(o)}>{fetching ? 'Fetching…' : '↻ Fetch AWB'}</button>;
  if (fetching) return <div className="ship-line wait"><span><span className="dq-spin" aria-hidden="true" /> <b>Fetching the AWB from {pl}…</b></span></div>;
  if (c && c.state === 'cancelled') return (
    <div className="ship-line bad"><span><b>Cancelled in {pl}.</b> It will never get an AWB. Cancel it here too.</span>{when}
      {canAct && <button className="btn ghost ship-act" disabled={busy} onClick={() => onCancel(o)}>Cancel here too</button>}
    </div>);
  if (c && c.state === 'not_found') return (
    <div className="ship-line bad"><span><b>This order is not in {pl}.</b>{other ? ` Was it booked with ${providerLabel(other)}?` : ' Create the shipment there.'}</span>{when}
      {canAct && other && onSwitch && <button className="btn ghost ship-act" disabled={busy} onClick={() => onSwitch(o)}>⇄ Use {providerLabel(other)}</button>}
      {fetchBtn}
    </div>);
  if (c && c.state === 'error') return <div className="ship-line idle"><span><b>Could not reach {pl}.</b>{c.status ? ` ${c.status}.` : ''} Try again in a minute.</span>{when}{fetchBtn}</div>;
  return (
    <div className="ship-line wait"><span><b>No AWB yet.</b> Create the shipment in {pl} (weight, size, courier). The AWB will come here by itself, or press Fetch AWB.</span>{when}{fetchBtn}</div>
  );
}

// Above the Order packed cards of one service: one button to fetch every AWB, and four simple filters with counts.
function PackedBar({ pl, items, filter, setFilter, onCheck, checking, canCheck }) {
  const counts = items.reduce((m, o) => { const k = awbGroup(o); m[k] = (m[k] || 0) + 1; return m; }, {});
  const latest = items.reduce((t, o) => (o.dq.shipCheck && o.dq.shipCheck.at && new Date(o.dq.shipCheck.at) > t ? new Date(o.dq.shipCheck.at) : t), new Date(0));
  return (
    <div className="ship-bar">
      <div className="dq-filterrow">
        <span className="dq-filterlabel">Show:</span>
        <div className="ship-chips" role="group" aria-label={`Filter ${pl} orders`}>
          {AWB_CHIPS.map(([key, label]) => { const n = key === '' ? items.length : counts[key] || 0; return <button key={key || 'all'} className={`ship-chip ${key} ${filter === key ? 'on' : ''} ${n === 0 && key ? 'zero' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<b>{n}</b></button>; })}
        </div>
        {canCheck && <button className="btn good ship-check" disabled={checking || !items.length} onClick={onCheck}>{checking ? 'Fetching…' : `↻ Fetch all AWBs from ${pl}`}</button>}
      </div>
      {latest.getTime() > 0 && <small className="muted">Last checked {agoLabel(latest)}. It also refreshes by itself.</small>}
    </div>
  );
}

function Card({ o, col, title, now, offset, canAct, busy, fetching, noDone, onDone, onHold, onCancel, onSwitch, onFetch, onOpen, assign }) {
  const { L } = useLabels();
  const late = o.dq.dueAt && new Date(o.dq.dueAt).getTime() < now + offset;
  const packedCol = col.key === 'packed';
  const awb = packedCol ? awbOf(o) : col.key === 'handover' && o.dq.packed ? o.dq.packed.awb : '';
  const courier = packedCol ? awbCourierOf(o) : col.key === 'handover' && o.dq.packed ? o.dq.packed.courier : '';
  const prov = col.key !== 'slip' ? o.dq.provider : null; // chosen when the slip was marked done
  const pl = providerLabel(prov || 'shipway');
  const ready = !packedCol || !!awb; // DONE at Order packed works only once the AWB has been fetched
  const other = otherService(prov || 'shipway');
  const doneText = packedCol && !ready ? (fetching ? 'Fetching AWB…' : 'Waiting for AWB') : L('btnDone');
  return (
    <article className={`sd-card dispatch dq-card ${late ? 'late' : ''} ${prov ? `prov-${prov}` : ''}`} style={prov ? providerStyle(prov) : undefined} aria-label={`${o.orderName}, ${title}${prov ? `, ${pl}` : ''}`}>
      <header>
        <div className="sd-id">
          <button className="link" onClick={() => onOpen(o.orderId)}>{o.orderName}</button>
          <PayTag o={o} />{o.partial && <span className="sd-pay part">{L('payPartial')}</span>}<ProviderBadge provider={prov} />
        </div>
        <Due dueAt={o.dq.dueAt} now={now} offset={offset} />
      </header>
      <div className="sd-who"><b>{o.name || 'No name'}</b>{o.city ? <span className="muted"> · {o.city}</span> : null}</div>
      <div className="sd-line"><span className="sd-amt">{inr(o.total)}</span><span className="sd-items" title={o.items}>{o.items || 'Items not loaded'}</span></div>
      {packedCol && (awb
        ? <div className="ship-line ok"><span>✓ <b>AWB ready</b> · {awb}{courier ? ` · ${courier}` : ''}. Press {L('btnDone')}.</span></div>
        : <ShipLine o={o} prov={prov} canAct={canAct} busy={busy} fetching={fetching} onFetch={onFetch} onCancel={onCancel} onSwitch={onSwitch} />)}
      {col.key === 'handover' && (awb ? <div className="sd-foot"><span>AWB <b>{awb}</b>{courier ? ` · ${courier}` : ''}</span></div> : <div className="sd-foot warn"><span>AWB not in {pl} yet</span></div>)}
      {col.key === 'handover' && o.dq.manifestError && <div className="sd-foot warn" role="alert"><span>{pl} rejected it for the manifest: <b>{o.dq.manifestError.message}</b>{manifestHint(prov || 'shipway', o.dq.manifestError.message) && <span className="muted"> — {manifestHint(prov || 'shipway', o.dq.manifestError.message)}</span>}</span></div>}
      {o.collect > 0 && Math.round(o.collect) !== Math.round(o.total || 0) && <div className="sd-foot"><span className="sd-collect-tag">Collect {inr(o.collect)}</span></div>}
      {(assign || (canAct && !noDone)) && (
        <div className="dq-row">
          {assign && <AssigneeRow o={o} {...assign} />}
          {canAct && !noDone && <button className={`btn good dq-done ${ready ? '' : 'locked'}`} disabled={busy || !ready} title={ready ? '' : `${L('btnDone')} turns on when ${pl} gives the AWB`} onClick={() => onDone(o, col.key)}>{doneText}</button>}
        </div>
      )}
      {canAct && (
        <div className="dq-row dq-actions">
          <button className="btn ghost dq-hold" disabled={busy} onClick={() => onHold(o)} title="Put this order on hold">⏸ Hold</button>
          <button className="btn ghost dq-cancel" disabled={busy} onClick={() => onCancel(o)} title="Cancel this order">Cancel order</button>
          {packedCol && other && onSwitch && <button className="btn ghost dq-use" disabled={busy} onClick={() => onSwitch(o)} title="Booked with the other service? Move this order to it.">⇄ Use {providerLabel(other)}</button>}
        </div>
      )}
    </article>
  );
}

// A card in the "On hold" section: why it is held, who held it, and the way out (Resume or Cancel).
function HeldCard({ o, now, offset, canAct, busy, onResume, onCancel, onOpen }) {
  const { L } = useLabels();
  const h = o.dq.hold;
  const ms = now + offset - new Date(h.at).getTime();
  return (
    <article className={`sd-card dispatch dq-card held ${o.dq.provider ? `prov-${o.dq.provider}` : ''}`} aria-label={`${o.orderName}, on hold`}>
      <header>
        <div className="sd-id"><button className="link" onClick={() => onOpen(o.orderId)}>{o.orderName}</button><PayTag o={o} />{o.partial && <span className="sd-pay part">{L('payPartial')}</span>}<ProviderBadge provider={o.dq.provider} /></div>
        <span className="sd-due wait" title={`On hold since ${fmtWhen(h.at)}`}>On hold {duration(Math.max(0, ms))}</span>
      </header>
      <div className="sd-who"><b>{o.name || 'No name'}</b>{o.city ? <span className="muted"> · {o.city}</span> : null}</div>
      <div className="sd-line"><span className="sd-amt">{inr(o.total)}</span><span className="sd-items" title={o.items}>{o.items || 'Items not loaded'}</span></div>
      <div className="dq-note"><b>Note</b> “{h.note}”<span className="muted"> · {h.byName}, {fmtWhen(h.at)} · was at {L(STEP_KEYS[h.step] || 'stepSlip')}</span></div>
      {canAct && (
        <div className="dq-row dq-actions">
          <button className="btn good dq-resume" disabled={busy} onClick={() => onResume(o)}>▶ Resume</button>
          <button className="btn ghost dq-cancel" disabled={busy} onClick={() => onCancel(o)}>Cancel order</button>
        </div>
      )}
    </article>
  );
}
const STEP_KEYS = { slip: 'stepSlip', packed: 'stepPacked', handover: 'stepHandover' };

// ---------------------------------------------------------------- hold and cancel forms
function HoldSheet({ order: o, show, onClose, onDone }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/hold`, { note: note.trim() }); notifyDesk(); show(`${o.orderName} is on hold. Its deadline is paused.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Put on hold · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)}. The order stays at its step but moves to “On hold”, and its deadline stops until someone resumes it.</p>
      <label className="sheet-label" htmlFor="hold-note">Why is it on hold? (required)</label>
      <textarea id="hold-note" className="sd-text" rows={3} maxLength={300} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: customer asked to change the address; item out of stock" />
      <button className="btn big good" disabled={busy || note.trim().length < 3} onClick={submit}>{busy ? 'Saving…' : note.trim().length < 3 ? 'Write a note to put on hold' : 'Put on hold'}</button>
    </Sheet>
  );
}

function ResumeSheet({ order: o, show, onClose, onDone }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/resume`, { note: note.trim() }); notifyDesk(); show(`${o.orderName} resumed. Its deadline starts again now.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Resume · ${o.orderName}`} onClose={onClose}>
      <p className="muted">Held for: “{o.dq.hold.note}”. After resuming it goes back to its column and the deadline counts from now.</p>
      <label className="sheet-label" htmlFor="resume-note">Note (optional)</label>
      <textarea id="resume-note" className="sd-text" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know" />
      <button className="btn big good" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Resume order'}</button>
    </Sheet>
  );
}

function CancelSheet({ order: o, reasons, show, onClose, onDone }) {
  const [pick, setPick] = useState(''); const [typed, setTyped] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const other = pick === 'Other';
  const reason = other ? typed.trim() : pick;
  const ok = reason.length >= 2 && note.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/cancel`, { reason, note: note.trim() }); notifyDesk(); show(`${o.orderName} cancelled.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Cancel order · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)}. The order leaves the dispatch queue and goes to Cancelled.{o.partial ? ` ${inr(o.partial.amount)} was already received: a refund will show as due.` : ''}</p>
      <p className="sd-q">Why is {o.orderName} being cancelled?</p>
      <div className="reasons" role="radiogroup" aria-label="Cancellation reason">
        {reasons.map((r) => <button key={r} role="radio" aria-checked={pick === r} className={`reason-opt ${pick === r ? 'on' : ''}`} onClick={() => setPick(r)}>{r}</button>)}
        {!reasons.includes('Other') && <button role="radio" aria-checked={other} className={`reason-opt ${other ? 'on' : ''}`} onClick={() => setPick('Other')}>Other</button>}
      </div>
      {other && <input type="text" placeholder="Type the reason" value={typed} maxLength={120} onChange={(e) => setTyped(e.target.value)} autoFocus />}
      <label className="sheet-label" htmlFor="dc-note">Note (required)</label>
      <textarea id="dc-note" className="sd-text" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? The next person will read this" />
      <button className="btn big danger" disabled={busy || !ok} onClick={submit}>{busy ? 'Saving…' : !reason ? 'Choose a reason' : note.trim().length < 3 ? 'Write a note to cancel' : 'Cancel this order'}</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- forms
// Packing slip DONE: the team says which service this order ships from. It cannot be skipped: the server refuses a slip without it.
// The moment a service is pressed, the order is saved with it and the AWB is fetched from THAT service, so the next step is ready sooner.
function ProviderSheet({ order: o, show, onClose, onDone, onGoPacked }) {
  const { L } = useLabels();
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null); // after a choice: { provider, phase: 'fetching' | 'ok' | 'none' | 'err', awb, courier, msg }
  const choose = async (provider) => {
    setBusy(provider);
    try { await api.post(`/desk/dispatch/${o.orderId}/slip`, { provider }); notifyDesk(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); setBusy(''); return; }
    setBusy('');
    setRes({ provider, phase: 'fetching' });
    try {
      const r = await api.get(`/desk/dispatch/${o.orderId}/awb`);
      setRes({ provider, phase: r.awb ? 'ok' : 'none', awb: r.awb || '', courier: r.courier || '', connected: r.configured !== false && r.shipwayConfigured !== false });
      notifyDesk();
    } catch (e) { setRes({ provider, phase: 'err', msg: e.message }); }
  };
  if (res) {
    const pl = providerLabel(res.provider); const working = res.phase === 'fetching';
    return (
      <Sheet title={`${o.orderName} · ${pl}`} onClose={onDone}>
        <ol className="dq-progress" aria-live="polite">
          <li className="ok"><i>✓</i><span><b>Packing slip done</b> · {pl} chosen</span></li>
          <li className={working ? 'run' : res.phase === 'ok' ? 'ok' : 'wait'}>
            <i>{working ? <span className="dq-spin" aria-hidden="true" /> : res.phase === 'ok' ? '✓' : '⏳'}</i>
            <span>
              {working && <><b>Fetching the AWB from {pl}…</b></>}
              {res.phase === 'ok' && <><b>AWB found</b> · {res.awb}{res.courier ? ` · ${res.courier}` : ''}</>}
              {res.phase === 'none' && <><b>No AWB in {pl} yet.</b> {res.connected === false ? `${pl} is not connected on the server.` : `Create the shipment in ${pl} (weight, size, courier).`}</>}
              {res.phase === 'err' && <><b>Could not reach {pl}.</b> {res.msg}</>}
            </span>
          </li>
        </ol>
        {res.phase === 'ok'
          ? <p className="muted">The order is now in {L('stepPacked')} and {L('btnDone')} is ON there.</p>
          : !working && <p className="muted">The order is now in {L('stepPacked')}. {L('btnDone')} stays OFF there until the AWB arrives. It is fetched again by itself, or press <b>Fetch AWB</b> on the card.</p>}
        <button className="btn big good" disabled={working} onClick={onGoPacked}>{working ? 'Please wait…' : `Go to ${L('stepPacked')}`}</button>
        <button className="btn ghost" disabled={working} onClick={onDone}>Stay here</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`${L('stepSlip')} done · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)}</p>
      <p className="sd-q">Which service is shipping this order?</p>
      <div className="prov-pick" role="group" aria-label="Shipping service">
        {PROVIDERS.map((p) => (
          <button key={p} className={p} style={providerStyle(p)} disabled={!!busy} onClick={() => choose(p)}>
            <b>{busy === p ? 'Saving…' : providerLabel(p)}</b>
            <small>{providerMeta(p).hint}</small>
          </button>
        ))}
      </div>
      <p className="muted">Press one. The AWB is fetched from that service straight away. Your choice shows on the card from here on, and decides where the manifest is made.</p>
    </Sheet>
  );
}

// Order packed: the AWB and courier are read from Shipway and shown, not typed. No photos are needed.
function PackedSheet({ order: o, conf, show, onClose, onDone }) {
  const { L } = useLabels();
  const pl = providerLabel(o.dq.provider || 'shipway');
  const other = (o.dq.provider || 'shipway') === 'shiprocket' ? 'shipway' : 'shiprocket';
  const [switching, setSwitching] = useState(false);
  const switchTo = async () => {
    setSwitching(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/provider`, { provider: other }); notifyDesk(); show(`${o.orderName} now ships through ${providerLabel(other)}. Press ${L('btnDone')} again to fetch its AWB.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setSwitching(false); }
  };
  const [live, setLive] = useState({ awb: o.dq.suggestedAwb || '', courier: o.dq.suggestedCourier || '', looking: true, allowManual: !!conf.allowManualAwb, shipwayConfigured: true });
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const look = async () => { // ask Shipway again right now: the label may have been made a minute ago
    setLive((x) => ({ ...x, looking: true }));
    try { const r = await api.get(`/desk/dispatch/${o.orderId}/awb`); setLive({ awb: r.awb || '', courier: r.courier || '', looking: false, allowManual: r.allowManual, shipwayConfigured: r.configured !== undefined ? r.configured : r.shipwayConfigured }); }
    catch { setLive((x) => ({ ...x, looking: false })); }
  };
  useEffect(() => { look(); }, [o.orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const awb = live.awb || (live.allowManual ? manual : '');
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      if (!live.awb) fd.append('awb', manual); // only used when Shipway has none
      await api.upload(`/desk/dispatch/${o.orderId}/packed`, fd);
      notifyDesk(); show(`${o.orderName} packed. It is now in ${L('stepHandover')}.`); onDone();
    } catch (e) { show(e.message, 'err'); if (e.status === 409 && !/AWB/.test(e.message)) onDone(); } finally { setBusy(false); }
  };
  const ready = awb.replace(/\s/g, '').length >= 5;
  return (
    <Sheet title={`${L('stepPacked')} · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)} · <ProviderBadge provider={o.dq.provider || 'shipway'} /></p>
      <div className="awb-box">
        <div><span>AWB number</span><b>{live.awb || (live.looking ? `Checking ${pl}…` : '—')}</b></div>
        <div><span>Courier</span><b>{live.courier || (live.looking ? '' : '—')}</b></div>
        <small className="muted">{live.awb ? `Filled from ${pl}. Nothing to type.` : live.looking ? `Asking ${pl} for this order…` : !live.shipwayConfigured ? `${pl} is not connected on the server.` : `${pl} has no AWB for this order yet.`}</small>
        {!live.awb && !live.looking && <button className="btn ghost" onClick={look}>Fetch from {pl} again</button>}
        {!live.awb && !live.looking && <button className="btn ghost" disabled={switching} onClick={switchTo}>{switching ? 'Switching…' : `Booked with ${providerLabel(other)}? Use ${providerLabel(other)} instead`}</button>}
      </div>
      {!live.awb && !live.looking && (live.allowManual
        ? <><label className="sheet-label" htmlFor="pk-awb">Type the AWB from the label (only because {pl} has none yet)</label><input id="pk-awb" type="text" autoCapitalize="characters" autoComplete="off" maxLength={40} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="AWB number" /></>
        : <div className="banner">Wait for the shipment to be created in {pl}, then press “Fetch from {pl} again”.</div>)}
      <button className="btn big good" disabled={busy || !ready} onClick={submit}>{busy ? 'Saving…' : !awb.trim() ? `Waiting for the AWB from ${pl}` : `Save: ${L('stepPacked').toLowerCase()}`}</button>
    </Sheet>
  );
}

// Order handover: photos of the manifest. One manifest can cover several orders.
function HandoverSheet({ orders, manifest, conf, show, onClose, onDone }) {
  const { L } = useLabels();
  const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false);
  const courier = useMemo(() => { const c = [...new Set(orders.map((o) => (o.dq.packed && o.dq.packed.courier) || '').filter(Boolean))]; return c.length === 1 ? c[0] : ''; }, [orders]);
  const need = conf.stages.handover.requirePhoto;
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('orderIds', JSON.stringify(orders.map((o) => o.orderId))); fd.append('courier', courier); if (manifest) fd.append('manifestId', manifest); files.forEach((f) => fd.append('manifests', f));
      const r = await api.upload('/desk/dispatch/handover', fd);
      notifyDesk();
      if (r.failed && r.failed.length) show(`${r.done.length} handed over. ${r.failed.length} could not be saved: ${r.failed.map((f) => `#${f.orderId}`).join(', ')}.`, 'err');
      else show(`${r.done.length === 1 ? orders[0].orderName : `${r.done.length} orders`} handed over. See ${L('tabTransit')}.`);
      onDone();
    } catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={manifest ? `STEP 2 of 2 · Handover · manifest ${manifest}` : orders.length === 1 ? `STEP 2 of 2 · Handover · ${orders[0].orderName}` : `STEP 2 of 2 · Handover · ${orders.length} orders`} onClose={onClose}>
      <p className="muted"><ProviderBadge provider={orders[0] && orders[0].dq.provider} /></p>
      {manifest && <p className="muted">One photo of the manifest hands over all {orders.length} {orders.length === 1 ? 'order' : 'orders'} below.</p>}
      <ul className="dq-list">{orders.map((o) => <li key={o.orderId}><b>{o.orderName}</b><span>{o.dq.packed ? `AWB ${o.dq.packed.awb}` : ''}</span></li>)}</ul>
      <MultiPhotoField label="Photos of the manifest" files={files} setFiles={setFiles} required={need} />
      <p className="muted">After this the {orders.length === 1 ? 'order moves' : 'orders move'} to {L('tabTransit')}, where {providerLabel((orders[0] && orders[0].dq.provider) || 'shipway')} tracking is fetched.</p>
      <button className="btn big good" disabled={busy || (need && !files.length)} onClick={submit}>{busy ? 'Saving…' : need && !files.length ? 'Add a manifest photo to save' : 'Save: handed over to the courier'}</button>
    </Sheet>
  );
}

// Create manifest: pick a courier, one tap creates the manifest in Shipway for every packed order of that courier.
function ManifestSheet({ provider, couriers, names, show, onClose, onDone }) {
  const pl = providerLabel(provider);
  const [courier, setCourier] = useState(couriers.length === 1 ? couriers[0].courier : '');
  const pick = couriers.find((c) => c.courier === courier);
  const [ticked, setTicked] = useState(() => new Set(couriers.length === 1 ? couriers[0].orders.map((o) => o.orderId) : []));
  const [busy, setBusy] = useState(false); const [res, setRes] = useState(null);
  const choose = (c) => { setCourier(c.courier); setTicked(new Set(c.orders.map((o) => o.orderId))); }; // everything starts ticked; untick what is not packed
  const flip = (id) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = pick ? pick.orders.every((o) => ticked.has(o.orderId)) : false;
  const n = pick ? pick.orders.filter((o) => ticked.has(o.orderId)).length : 0;
  const submit = async () => {
    setBusy(true);
    try { const r = await api.post('/desk/dispatch/manifest', { provider, courier, orderIds: pick.orders.filter((o) => ticked.has(o.orderId)).map((o) => o.orderId) }); notifyDesk(); setRes(r); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  if (res) {
    const bad = [...res.rejected, ...(res.failed || []), ...(res.skipped || [])];
    return (
      <Sheet title={res.manifestId ? `Manifest ${res.manifestId} created` : 'No manifest created'} onClose={onDone}>
        {res.manifestId
          ? <p>{res.created.length} {res.created.length === 1 ? 'order is' : 'orders are'} on {pl} manifest <b>{res.manifestId}</b> ({res.courier}). Next is STEP 2: select this manifest and press Handover selected (1 photo).{res.manifestUrl && <> <a href={res.manifestUrl} target="_blank" rel="noreferrer">Open the manifest PDF</a></>}</p>
          : res.noId
            ? <div className="banner warn"><b>{pl} said: “{res.shipwayMessage}”</b> but it did not send a manifest ID the app can read, so no order was grouped. The manifest may now exist in {pl}, so do not press Create manifest again for these orders. Send the details below to support.</div>
            : <div className="banner">{pl} did not create a manifest, so no order was grouped.</div>}
        {res.rawReply && <details><summary className="muted">Details for support</summary><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{res.rawReply}</pre></details>}
        {bad.length > 0 && <>
          <p className="sd-q">{bad.length} {bad.length === 1 ? 'order was' : 'orders were'} left out:</p>
          <ul className="dq-list">{bad.map((r) => <li key={r.orderId}><b>#{r.orderId}</b><span>{r.reason}</span></li>)}</ul>
          <p className="muted">They stay in Order handover, outside the group, with this reason on the card. Fix the cause, then create a manifest again.</p>
        </>}
        {res.leftOver > 0 && <p className="muted">{res.leftOver} more {res.leftOver === 1 ? 'order is' : 'orders are'} still waiting (at most 50 go on one manifest). Create another manifest for them.</p>}
        <button className="btn big good" onClick={onDone}>Done</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`STEP 1 of 2 · Create ${pl} manifest`} onClose={onClose}>
      <p className="muted"><ProviderBadge provider={provider} /> Pick the courier, then tick only the orders that are really packed and ready. Unticked orders stay waiting and are not sent to {pl}. {pl} may still refuse some; those are left out and the reason is shown.</p>
      {!couriers.length && <div className="banner warn">No packed {pl} orders with a courier name are waiting for a manifest.</div>}
      <p className="sd-q">Which courier?</p>
      <div className="reasons" role="radiogroup" aria-label="Courier">
        {couriers.map((c) => <button key={c.courier} role="radio" aria-checked={courier === c.courier} className={`reason-opt ${courier === c.courier ? 'on' : ''}`} onClick={() => choose(c)}>{c.courier} · {c.count}</button>)}
      </div>
      {pick && <>
        <p className="sd-q">Which orders are packed? <button className="link" onClick={() => setTicked(all ? new Set() : new Set(pick.orders.map((o) => o.orderId)))}>{all ? 'Untick all' : 'Tick all'}</button></p>
        <ul className="dq-list" aria-label="Orders to put on the manifest">
          {pick.orders.map((o) => (
            <li key={o.orderId}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', cursor: 'pointer' }}>
                <input type="checkbox" checked={ticked.has(o.orderId)} onChange={() => flip(o.orderId)} />
                <b>{names[o.orderId] || `#${o.orderId}`}</b><span>AWB {o.awb || '—'}</span>
              </label>
            </li>
          ))}
        </ul>
      </>}
      <button className="btn big good" disabled={busy || !pick || n === 0} onClick={submit}>{busy ? `Asking ${pl}…` : !pick ? 'Pick a courier' : n === 0 ? 'Tick at least one order' : `Create manifest for ${n} ticked ${n === 1 ? 'order' : 'orders'}`}</button>
    </Sheet>
  );
}

// One group per manifest id. Tick it in STEP 2, then press "Handover selected": one photo covers every order in the group.
function ManifestGroup({ g, canAct, selected, onSelect, onOpen }) {
  return (
    <article className={`sd-card dispatch dq-card manifest-group ${selected ? 'selected' : ''} ${g.provider ? `prov-${g.provider}` : ''}`} style={providerStyle(g.provider)} aria-label={`Manifest ${g.manifestId}, ${providerLabel(g.provider)}`}>
      <header>
        <label className="sd-id dq-selectlabel">
          {canAct && <input type="radio" name={`manifest-${g.provider}`} className="dq-pick" checked={selected} onChange={() => onSelect(g.manifestId)} aria-label={`Select manifest ${g.manifestId} for handover`} />}
          <b>Manifest {g.manifestId}</b><ProviderBadge provider={g.provider} />
        </label>
        <span className="sd-due wait">{g.orders.length} {g.orders.length === 1 ? 'order' : 'orders'}{g.courier ? ` · ${g.courier}` : ''}</span>
      </header>
      <ul className="dq-list">
        {g.orders.map((o) => <li key={o.orderId}><button className="link" onClick={() => onOpen(o.orderId)}>{o.orderName}</button><span>AWB {(o.dq.packed && o.dq.packed.awb) || '—'}</span></li>)}
      </ul>
      {g.byName && <small className="muted">Created by {g.byName}{g.at ? `, ${fmtWhen(g.at)}` : ''}</small>}
      {g.url && <small><a href={g.url} target="_blank" rel="noreferrer">Open manifest PDF</a></small>}
    </article>
  );
}

// ---------------------------------------------------------------- page
// Big numbered steps across the top. One step is open at a time, so nobody has to read three columns at once.
function Stepper({ steps, stage, setStage }) {
  return (
    <nav className="dq-steps" aria-label="Dispatch steps">
      {steps.map((st, i) => (
        <React.Fragment key={st.key}>
          <button className={`dq-step ${st.key} ${stage === st.key ? 'on' : ''}`} aria-current={stage === st.key ? 'step' : undefined} onClick={() => setStage(st.key)}>
            <span className="dq-num">{st.num}</span>
            <span className="dq-steptext"><b>{st.label}</b><small>{st.sub}</small></span>
            <span className={`sd-count ${st.overdue ? 'hot' : ''}`} title={st.overdue ? `${st.overdue} overdue` : ''}>{st.count}</span>
          </button>
          {i < steps.length - 1 && <span className="dq-arrow" aria-hidden="true">➜</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// Which service to look at. Built from the PROVIDERS list, so a new service appears here by itself.
function ProviderTabs({ view, setView, counts }) {
  const total = PROVIDERS.reduce((n, p) => n + (counts[p] || 0), 0);
  return (
    <div className="dq-ptabs" role="group" aria-label="Show which service">
      <span className="dq-filterlabel">Service:</span>
      {[['', 'All services', total], ...PROVIDERS.map((p) => [p, providerLabel(p), counts[p] || 0])].map(([key, label, n]) => (
        <button key={key || 'all'} className={`dq-ptab ${view === key ? 'on' : ''}`} style={key ? providerStyle(key) : undefined} aria-pressed={view === key} onClick={() => setView(key)}>
          {key && <i className="dq-dot" aria-hidden="true" />}{label}<b>{n}</b>
        </button>
      ))}
    </div>
  );
}

export default function DispatchBoard() {
  const { user } = useStaff();
  const { L } = useLabels();
  const actor = can(user, 'packing');
  const isAdmin = user.role === 'admin';
  const team = useTeam(); const people = peopleFor(team, 'dispatch');
  const [q, setQ] = useState(''); const qd = useDebounced(q);
  const [who, setWho] = useState('');
  const { data, error, loading, reload } = useApi('/desk/dispatch/board', { q: qd, assignee: who });
  useAutoRefresh(reload, 20);
  useEffect(() => { const on = () => reload(); window.addEventListener('desk-refresh', on); return () => window.removeEventListener('desk-refresh', on); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { now, offset } = useClock(data && data.now);
  const [toast, show] = useToast();
  const [open, setOpen] = useState(null);
  const assign = useAssign({ reload, show });
  const [stage, setStage] = useState('slip'); // 'slip' | 'packed' | 'handover'
  const [view, setView] = useState(''); // '' = every service, or one
  const [slipping, setSlipping] = useState(null); const [packing, setPacking] = useState(null); const [handing, setHanding] = useState(null); const [handingManifest, setHandingManifest] = useState(null); const [making, setMaking] = useState(null); // making = a service key | null
  const [holding, setHolding] = useState(null); const [resuming, setResuming] = useState(null); const [cancelling, setCancelling] = useState(null);
  const [picked, setPicked] = useState([]); const [selM, setSelM] = useState(''); const [busyId, setBusyId] = useState(null);
  const [fetching, setFetching] = useState(() => new Set());
  const [shipFilters, setShipFilters] = useState({}); // the filter of each service's Order packed list is independent
  const [checking, setChecking] = useState('');
  const conf = data && data.config;
  const c = data && data.counts;
  const handoverAll = data ? data.columns.handover : [];
  const packedAll = data ? data.columns.packed : [];
  const byId = new Map(handoverAll.map((o) => [o.orderId, o]));
  const provOf = (o) => o.dq.provider || 'shipway';
  // Order handover is split per service. Orders without a manifest are "loose"; the rest sit in manifest groups.
  const sideOf = (provider) => {
    const side = data && data.handover ? data.handover[provider] : null;
    const loose = side ? side.loose.map((id) => byId.get(id)).filter(Boolean) : [];
    return { provider, side, loose };
  };
  const allLoose = data && data.handover ? PROVIDERS.flatMap((p) => sideOf(p).loose) : [];
  const allGroups = data && data.handover ? PROVIDERS.flatMap((p) => (data.handover[p] && data.handover[p].manifests) || []) : [];
  useEffect(() => { setPicked((p) => p.filter((id) => allLoose.some((o) => o.orderId === id))); setSelM((m) => (m && allGroups.some((g) => g.manifestId === m) ? m : '')); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id) => { setSelM(''); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const selectManifest = (id) => { setPicked([]); setSelM(id); };

  const done = async (o, key) => {
    if (key === 'packed') return setPacking(o);
    if (key === 'handover') return setHanding([o]);
    setSlipping(o); // the slip is marked done inside the sheet, once a service is chosen
  };
  // Ask one service for the AWB of one order right now. The card turns ON its DONE button when the AWB is found.
  const fetchAwb = async (o) => {
    const pl = providerLabel(provOf(o));
    setFetching((s) => new Set(s).add(o.orderId));
    try {
      const r = await api.get(`/desk/dispatch/${o.orderId}/awb`);
      if (r.awb) show(`${o.orderName}: AWB ${r.awb} fetched from ${pl}. ${L('btnDone')} is now ON.`);
      else show(r.configured === false ? `${pl} is not connected on the server.` : `${pl} has no AWB for ${o.orderName} yet. Create the shipment in ${pl}, then press Fetch AWB again.`, 'err');
      notifyDesk(); reload();
    } catch (e) { show(e.message, 'err'); } finally { setFetching((s) => { const n = new Set(s); n.delete(o.orderId); return n; }); }
  };
  const runCheck = async (provider) => {
    setChecking(provider);
    try {
      const r = await api.post('/desk/dispatch/check', { provider });
      const a = r.summary.all;
      const parts = [`${a.awb_ready} AWB ready`, `${a.waiting} waiting for AWB`, `${a.cancelled} cancelled`, a.not_found ? `${a.not_found} not found` : '', a.error ? `${a.error} could not be checked` : ''].filter(Boolean);
      if (r.problems && r.problems.length) show(`Checked ${r.checked}. ${r.problems.join(' | ')}`, 'err');
      else if (r.notConnected && r.notConnected.length) show(`Checked ${r.checked}: ${parts.join(' · ')}. ${r.notConnected.join(' and ')} is not connected, so ${r.skipped} order${r.skipped === 1 ? ' was' : 's were'} skipped.`, 'err');
      else show(`Checked ${r.checked} orders: ${parts.join(' · ')}.`);
      reload();
    } catch (e) { show(e.message, 'err'); } finally { setChecking(''); }
  };
  const switchService = async (o) => {
    const to = otherService(provOf(o));
    if (!to) return;
    if (!window.confirm(`Move ${o.orderName} to ${providerLabel(to)}? Its AWB will then be read from ${providerLabel(to)}.`)) return;
    setBusyId(o.orderId);
    try { await api.post(`/desk/dispatch/${o.orderId}/provider`, { provider: to }); notifyDesk(); show(`${o.orderName} now ships through ${providerLabel(to)}.`); reload(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) reload(); } finally { setBusyId(null); }
  };
  const finish = (setter) => () => { setter(null); setHandingManifest(null); setPicked([]); setSelM(''); reload(); };
  const held = data ? data.hold || [] : [];

  const lateN = (arr) => arr.filter((o) => o.dq.dueAt && new Date(o.dq.dueAt).getTime() < now + offset).length;
  const assignFor = (key) => (data.assign.modes[key] !== 'off' ? { mode: data.assign.modes[key], isAdmin, me: user.id, people, onAssign: assign } : null);
  const cardFor = (o, col, extra) => <Card key={o.orderId} o={o} col={col} title={L(col.label)} assign={assignFor(col.key)} now={now} offset={offset} canAct={actor} busy={busyId === o.orderId} fetching={fetching.has(o.orderId)} onDone={done} onHold={setHolding} onCancel={setCancelling} onSwitch={switchService} onFetch={fetchAwb} onOpen={setOpen} {...extra} />;

  // Title, deadline rule, the one-line "what to do" and (for admins) the workload of the open step.
  const stageHead = (col, { count, overdue, hint, workItems }) => (
    <div className="dq-stagehead">
      <div className="dq-title"><h2>Step {col.num} · {L(col.label)}</h2><span className={`sd-count ${overdue ? 'hot' : ''}`} title={overdue ? `${overdue} overdue` : ''}>{count}</span>
        <span className="dq-when">{whenLabel(conf.stages[col.key])}</span>
        {data.assign.modes[col.key] !== 'off' && <span className="dq-when asg">{data.assign.modes[col.key] === 'auto' ? 'Shared out automatically' : 'Assigned by an admin'}</span>}
        {isAdmin && <Link className="dq-gear" to="/orders/shopify-desk/settings#dispatch" title={`${L(col.label)} settings`} aria-label={`${L(col.label)} settings`}>⚙</Link>}</div>
      <p className="dq-guide"><b>What to do:</b> {hint}</p>
      {data.assign.modes[col.key] !== 'off' && isAdmin && <Workload items={workItems} />}
    </div>
  );

  // STEP 2 of the queue, one service: the AWB list with its own filter and "Fetch all" button.
  const renderPacked = (pv) => {
    const pl = providerLabel(pv);
    const all = packedAll.filter((o) => provOf(o) === pv);
    const filt = shipFilters[pv] || '';
    const list = filt ? all.filter((o) => awbGroup(o) === filt) : all;
    const ready = all.filter((o) => awbGroup(o) === 'ready').length;
    const side = data.handover ? data.handover[pv] : null;
    return (
      <section key={pv} className="dq-pboard" style={providerStyle(pv)} aria-label={`${pl} orders at Order packed`}>
        <div className="dq-pboard-head">
          <h3><i className="dq-dot" aria-hidden="true" />{pl}</h3>
          <span className="muted">{all.length} {all.length === 1 ? 'order' : 'orders'} · {ready} AWB ready</span>
          {side && !side.configured && <span className="dq-off" title={`${pl} login is not set on the server`}>not connected</span>}
        </div>
        {all.length > 0 && <PackedBar pl={pl} items={all} filter={filt} setFilter={(v) => setShipFilters((f) => ({ ...f, [pv]: v }))} onCheck={() => runCheck(pv)} checking={checking === pv} canCheck={actor} />}
        {list.length === 0
          ? <Empty title={filt ? 'No orders in this filter' : `No ${pl} orders`}>{filt ? 'Pick another filter above, or press “All”.' : q ? 'No orders match this search.' : `Orders whose slip was marked ${pl} appear here.`}</Empty>
          : <div className="dq-grid">{list.map((o) => cardFor(o, COLS[1]))}</div>}
      </section>
    );
  };

  // STEP 3 of the queue, one service. Handover is TWO steps: 1) create the manifest, 2) hand over the selected manifest.
  const renderHandover = (pv) => {
    const pl = providerLabel(pv);
    const { side, loose } = sideOf(pv);
    const groups = side ? side.manifests || [] : [];
    const count = side ? side.count : handoverAll.filter((o) => provOf(o) === pv).length;
    const mine = picked.filter((id) => loose.some((o) => o.orderId === id));
    const allPicked = loose.length > 0 && mine.length === loose.length;
    const selGroup = groups.find((g) => g.manifestId === selM) || null;
    const n = selGroup ? selGroup.orders.length : mine.length;
    const canMake = actor && (loose.length > 0 || (side && (side.couriers || []).length > 0));
    const handNow = () => { if (selGroup) { setHandingManifest(selGroup.manifestId); setHanding(selGroup.orders); } else setHanding(loose.filter((o) => mine.includes(o.orderId))); };
    return (
      <section key={pv} className="dq-pboard" style={providerStyle(pv)} aria-label={`${pl} handover`}>
        <div className="dq-pboard-head">
          <h3><i className="dq-dot" aria-hidden="true" />{pl}</h3>
          <span className="muted">{loose.length} waiting for a manifest · {groups.length} {groups.length === 1 ? 'manifest' : 'manifests'} ready · {count} {count === 1 ? 'order' : 'orders'} in all</span>
          {side && !side.configured && <span className="dq-off" title={`${pl} login is not set on the server`}>not connected</span>}
        </div>
        <div className="dq-two">
          <div className={`dq-hstep one ${loose.length ? 'todo' : 'idle'}`}>
            <div className="dq-hhead">
              <span className="dq-big">1</span>
              <div><h4>Create {pl} manifest</h4><p>Group the packed orders of one courier into one manifest. {loose.length ? `${loose.length} ${loose.length === 1 ? 'order is' : 'orders are'} waiting.` : 'Nothing is waiting right now.'}</p></div>
              {canMake && <button className="btn good big" disabled={!loose.length} onClick={() => setMaking(pv)}>Create {pl} manifest</button>}
            </div>
            {loose.length === 0
              ? <Empty title="No orders waiting for a manifest">{q ? 'No orders match this search.' : `Packed ${pl} orders appear here after Order packed. Then create their manifest.`}</Empty>
              : <div className="dq-grid">{loose.map((o) => cardFor(o, COLS[2], { noDone: true }))}</div>}
          </div>
          <div className={`dq-hstep two ${groups.length || mine.length ? 'todo' : 'idle'}`}>
            <div className="dq-hhead">
              <span className="dq-big">2</span>
              <div><h4>Handover selected</h4><p>{groups.length ? 'Select the manifest the courier is taking, then press Handover selected and add 1 photo.' : 'Create a manifest in Step 1 first. It will show up here.'}</p></div>
              {actor && <button className="btn good big" disabled={!n} onClick={handNow}>{n ? `Handover selected (${selGroup ? `1 manifest · ` : ''}${n} ${n === 1 ? 'order' : 'orders'})` : 'Handover selected'}</button>}
            </div>
            {groups.length === 0 && loose.length === 0
              ? <Empty title="Nothing to hand over">Manifests you create in Step 1 wait here for the courier.</Empty>
              : groups.length > 0 && <div className="dq-grid">{groups.map((g) => <ManifestGroup key={g.manifestId} g={g} canAct={actor} selected={selM === g.manifestId} onSelect={selectManifest} onOpen={setOpen} />)}</div>}
            {actor && loose.length > 0 && (
              <details className="dq-direct">
                <summary>Hand over orders without a manifest ({loose.length})</summary>
                <p className="muted">Only if the courier takes them without a manifest. Tick the orders, then press Handover selected above.</p>
                <button className="btn ghost" onClick={() => { setSelM(''); setPicked(allPicked ? picked.filter((id) => !loose.some((o) => o.orderId === id)) : [...new Set([...picked, ...loose.map((o) => o.orderId)])]); }}>{allPicked ? 'Clear' : 'Select all'}</button>
                <ul className="dq-list">{loose.map((o) => <li key={o.orderId}><label className="dq-tick"><input type="checkbox" checked={picked.includes(o.orderId)} onChange={() => pick(o.orderId)} aria-label={`Select ${o.orderName} for handover`} /><b>{o.orderName}</b></label><span>AWB {(o.dq.packed && o.dq.packed.awb) || '—'}</span></li>)}</ul>
              </details>
            )}
          </div>
        </div>
      </section>
    );
  };

  const steps = data ? [
    { ...COLS[0], label: L(COLS[0].label), count: data.columns.slip.length, overdue: lateN(data.columns.slip) },
    { ...COLS[1], label: L(COLS[1].label), count: packedAll.length, overdue: lateN(packedAll) },
    { ...COLS[2], label: L(COLS[2].label), count: handoverAll.length, overdue: lateN(handoverAll) },
  ] : [];
  const packedCounts = Object.fromEntries(PROVIDERS.map((p) => [p, packedAll.filter((o) => provOf(o) === p).length]));
  const handCounts = Object.fromEntries(PROVIDERS.map((p) => [p, handoverAll.filter((o) => provOf(o) === p).length]));
  const shownProviders = PROVIDERS.filter((pv) => !view || view === pv);

  return (
    <section>
      {data && <Stepper steps={steps} stage={stage} setStage={setStage} />}
      <div className="filters"><input type="search" placeholder="Search order number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /><span className="grow" />
        <WhoFilter value={who} onChange={setWho} people={isAdmin ? people : []} show={!!data && (Object.values(data.assign.modes).some((m) => m !== 'off') || !!who)} />
        {data && <span className="muted">{data.shown} {data.shown === 1 ? 'order' : 'orders'}{c && c.overdue ? ` · ${c.overdue} overdue` : ''}{held.length ? ` · ${held.length} on hold` : ''}{data.collectTotal ? ` · ${inr(data.collectTotal)} to collect on delivery` : ''}</span>}</div>
      <Loading error={error} loading={loading && !data}>
        {data && stage === 'slip' && (
          <div className="dq-stage slip">
            {stageHead(COLS[0], { count: data.columns.slip.length, overdue: c.overdueBy.slip, hint: COLS[0].hint(L), workItems: data.columns.slip })}
            {data.columns.slip.length === 0
              ? <Empty title="Nothing here">{q ? 'No orders match this search.' : 'Confirmed orders appear here the moment someone taps Confirmed.'}</Empty>
              : <div className="dq-grid">{data.columns.slip.map((o) => cardFor(o, COLS[0]))}</div>}
          </div>
        )}
        {data && stage === 'packed' && (
          <div className="dq-stage packed">
            {stageHead(COLS[1], { count: packedAll.length, overdue: lateN(packedAll), hint: COLS[1].hint(L, view ? providerLabel(view) : ''), workItems: packedAll })}
            <ProviderTabs view={view} setView={setView} counts={packedCounts} />
            <div className="dq-boards">{shownProviders.map(renderPacked)}</div>
          </div>
        )}
        {data && stage === 'handover' && (
          <div className="dq-stage handover">
            {stageHead(COLS[2], { count: handoverAll.length, overdue: lateN(handoverAll), hint: COLS[2].hint(), workItems: handoverAll })}
            <ProviderTabs view={view} setView={setView} counts={handCounts} />
            <div className="dq-boards">{shownProviders.map(renderHandover)}</div>
          </div>
        )}
        {data && held.length > 0 && (
          <div className="dq-col hold dq-holdbox">
            <div className="dq-colhead">
              <div className="dq-title"><h2>On hold</h2><span className="sd-count">{held.length}</span></div>
              <small>Paused orders. Their deadline is stopped. Resume to send one back to its step, or cancel it. Every hold and cancel needs a note.</small>
            </div>
            <div className="dq-cards dq-holdcards">
              {held.filter((o) => o.dq && o.dq.hold).map((o) => <HeldCard key={o.orderId} o={o} now={now} offset={offset} canAct={actor} busy={busyId === o.orderId} onResume={setResuming} onCancel={setCancelling} onOpen={setOpen} />)}
            </div>
          </div>
        )}
      </Loading>
      {holding && <HoldSheet order={holding} show={show} onClose={() => setHolding(null)} onDone={finish(setHolding)} />}
      {resuming && <ResumeSheet order={resuming} show={show} onClose={() => setResuming(null)} onDone={finish(setResuming)} />}
      {cancelling && <CancelSheet order={cancelling} reasons={(data && data.cancelReasons) || []} show={show} onClose={() => setCancelling(null)} onDone={finish(setCancelling)} />}
      {slipping && <ProviderSheet order={slipping} show={show} onClose={() => setSlipping(null)} onDone={finish(setSlipping)} onGoPacked={() => { setStage('packed'); setView(''); finish(setSlipping)(); }} />}
      {packing && <PackedSheet order={packing} conf={conf} show={show} onClose={() => setPacking(null)} onDone={finish(setPacking)} />}
      {making && <ManifestSheet provider={making} couriers={(data.handover && data.handover[making] && data.handover[making].couriers) || []} names={Object.fromEntries(handoverAll.map((o) => [o.orderId, o.orderName]))} show={show} onClose={() => setMaking(null)} onDone={() => { setMaking(null); reload(); }} />}
      {handing && <HandoverSheet orders={handing} manifest={handingManifest} conf={conf} show={show} onClose={() => { setHanding(null); setHandingManifest(null); }} onDone={finish(setHanding)} />}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
      {toast}
    </section>
  );
}
