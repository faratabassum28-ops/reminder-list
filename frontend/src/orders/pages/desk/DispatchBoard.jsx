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
import { AssigneeRow, Empty, Info, MultiPhotoField, OrderDrawer, PayTag, WhoFilter, Workload, notifyDesk, peopleFor, useAssign, useClock, useDebounced, useLabels, useTeam } from './shared.jsx';

// The four steps of the Dispatch queue, in the order the team works an order. The page shows ONE step at a time.
// `hint` is what to do on this step. It sits behind the little "i" next to the step title, so it takes no room on the page.
const COLS = [
  { key: 'slip', label: 'stepSlip', num: 1, sub: 'Print the slip, choose the service', hint: (L) => `Print the slip and stick it on the box. Then press ${L('btnDone')} and choose which service ships this order (${PROVIDERS.map(providerLabel).join(' or ')}). The AWB is fetched from that service. If it has none yet, you type the AWB and courier for this order.` },
  { key: 'manifest', label: 'stepManifest', num: 2, sub: 'One manifest per courier', hint: (L, pl) => `Every order here needs an AWB and a courier name. Fetch the AWB from ${pl || 'the service'} or type it by hand. Then press Create manifest, choose the courier and tick the orders. They move on to ${L('stepPacked')}.` },
  { key: 'packed', label: 'stepPacked', num: 3, sub: 'Pack the box, press DONE', hint: (L) => `The AWB and the manifest are already known. Pack the box and press ${L('btnDone')}. A photo of the box is only needed if an admin switched that on in Settings.` },
  { key: 'handover', label: 'stepHandover', num: 4, sub: 'Hand the manifest to the courier', hint: () => 'Select the manifest the courier is taking, press Handover selected and add 1 photo of the manifest. All packed orders on that manifest are handed over together.' },
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

// The AWB of an order. Typed by the team, or fetched from the order's own service (saved on the order), else what the service last showed.
const awbOf = (o) => (o.dq.awb && o.dq.awb.awb) || o.dq.suggestedAwb || (o.dq.shipCheck && o.dq.shipCheck.state === 'awb_ready' && o.dq.shipCheck.awb) || (o.dq.packed && o.dq.packed.awb) || '';
const awbCourierOf = (o) => (o.dq.awb && o.dq.awb.awb ? o.dq.awb.courier : '') || o.dq.suggestedCourier || (o.dq.shipCheck && o.dq.shipCheck.state === 'awb_ready' && o.dq.shipCheck.courier) || (o.dq.packed && o.dq.packed.courier) || '';
const otherService = (p) => (PROVIDERS.length === 2 ? PROVIDERS.find((x) => x !== p) : null); // "switch" only makes sense with exactly two services

// Three plain groups, so nobody has to learn six statuses: AWB is here / AWB is not here yet / something is wrong.
const awbGroup = (o) => {
  if (awbOf(o)) return 'ready';
  const c = o.dq.shipCheck;
  return c && (c.state === 'cancelled' || c.state === 'not_found') ? 'problem' : 'noawb';
};
const AWB_CHIPS = [['', 'All'], ['ready', '✓ AWB ready'], ['noawb', '⏳ No AWB yet'], ['problem', '⚠ Problem']];

// What is going on with an order that has no AWB yet, in plain words, with the next thing to do. "Type AWB" is always there: when the service has none, the team types it.
function ShipLine({ o, prov, canAct, busy, fetching, onFetch, onCancel, onSwitch, onType }) {
  const c = o.dq.shipCheck; const pl = providerLabel(prov || 'shipway'); const other = otherService(prov || 'shipway');
  const when = c && c.at ? <small className="ship-when" title={new Date(c.at).toLocaleString()}>checked {agoLabel(c.at)}</small> : null;
  const fetchBtn = canAct && <button className="btn ghost ship-act" disabled={busy || fetching} onClick={() => onFetch(o)}>{fetching ? 'Fetching…' : '↻ Fetch AWB'}</button>;
  const typeBtn = canAct && onType && <button className="btn good ship-act" disabled={busy || fetching} onClick={() => onType(o)}>✎ Type AWB</button>;
  if (fetching) return <div className="ship-line wait"><span><span className="dq-spin" aria-hidden="true" /> <b>Fetching the AWB from {pl}…</b></span></div>;
  if (c && c.state === 'cancelled') return (
    <div className="ship-line bad"><span><b>Cancelled in {pl}.</b> It will never get an AWB. Cancel it here too.</span>{when}
      {canAct && <button className="btn ghost ship-act" disabled={busy} onClick={() => onCancel(o)}>Cancel here too</button>}
    </div>);
  if (c && c.state === 'not_found') return (
    <div className="ship-line bad"><span><b>This order is not in {pl}.</b>{other ? ` Was it booked with ${providerLabel(other)}?` : ' Create the shipment there, or type the AWB.'}</span>{when}
      {canAct && other && onSwitch && <button className="btn ghost ship-act" disabled={busy} onClick={() => onSwitch(o)}>⇄ Use {providerLabel(other)}</button>}
      {fetchBtn}{typeBtn}
    </div>);
  if (c && c.state === 'error') return <div className="ship-line idle"><span><b>Could not reach {pl}.</b>{c.status ? ` ${c.status}.` : ''} Try again in a minute, or type the AWB.</span>{when}{fetchBtn}{typeBtn}</div>;
  return (
    <div className="ship-line wait"><span><b>No AWB yet.</b> {pl} has none for this order. Press Fetch AWB to ask again, or type the AWB.</span>{when}{fetchBtn}{typeBtn}</div>
  );
}

// Above the Create manifest cards of one service: one button to fetch every AWB, and four simple filters with counts.
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

function Card({ o, col, title, now, offset, canAct, busy, fetching, noDone, onDone, onHold, onCancel, onSwitch, onFetch, onType, onOpen, assign }) {
  const { L } = useLabels();
  const late = o.dq.dueAt && new Date(o.dq.dueAt).getTime() < now + offset;
  const manifestCol = col.key === 'manifest'; const packedCol = col.key === 'packed'; const handoverCol = col.key === 'handover';
  const awb = awbOf(o); const courier = awbCourierOf(o);
  const prov = col.key !== 'slip' ? o.dq.provider : null; // chosen when the slip was marked done
  const pl = providerLabel(prov || 'shipway');
  const other = otherService(prov || 'shipway');
  const mid = o.dq.manifest && o.dq.manifest.id;
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
      {manifestCol && (awb
        ? <div className={`ship-line ${courier ? 'ok' : 'wait'}`}><span>{courier ? '✓' : '⚠'} <b>AWB {awb}</b>{courier ? ` · ${courier}` : ' · courier name missing'}{o.dq.awb && o.dq.awb.source === 'manual' ? ' · typed' : ''}</span>
          {canAct && onType && <button className="btn ghost ship-act" disabled={busy} onClick={() => onType(o)}>{courier ? '✎ Change' : '✎ Add courier'}</button>}</div>
        : <ShipLine o={o} prov={prov} canAct={canAct} busy={busy} fetching={fetching} onFetch={onFetch} onCancel={onCancel} onSwitch={onSwitch} onType={onType} />)}
      {packedCol && <div className="sd-foot"><span>AWB <b>{awb || '—'}</b>{courier ? ` · ${courier}` : ''}{mid ? <> · Manifest <b>{mid}</b></> : ''}</span></div>}
      {handoverCol && (awb ? <div className="sd-foot"><span>AWB <b>{awb}</b>{courier ? ` · ${courier}` : ''}</span></div> : <div className="sd-foot warn"><span>No AWB saved</span></div>)}
      {manifestCol && o.dq.manifestError && <div className="sd-foot warn" role="alert"><span>{pl} rejected it for the manifest: <b>{o.dq.manifestError.message}</b>{manifestHint(prov || 'shipway', o.dq.manifestError.message) && <span className="muted"> — {manifestHint(prov || 'shipway', o.dq.manifestError.message)}</span>}</span></div>}
      {o.collect > 0 && Math.round(o.collect) !== Math.round(o.total || 0) && <div className="sd-foot"><span className="sd-collect-tag">Collect {inr(o.collect)}</span></div>}
      {(assign || (canAct && !noDone)) && (
        <div className="dq-row">
          {assign && <AssigneeRow o={o} {...assign} />}
          {canAct && !noDone && <button className="btn good dq-done" disabled={busy} onClick={() => onDone(o, col.key)}>{busy ? 'Saving…' : L('btnDone')}</button>}
        </div>
      )}
      {canAct && (
        <div className="dq-row dq-actions">
          <button className="btn ghost dq-hold" disabled={busy} onClick={() => onHold(o)} title="Put this order on hold">⏸ Hold</button>
          <button className="btn ghost dq-cancel" disabled={busy} onClick={() => onCancel(o)} title="Cancel this order">Cancel order</button>
          {manifestCol && other && onSwitch && <button className="btn ghost dq-use" disabled={busy} onClick={() => onSwitch(o)} title="Booked with the other service? Move this order to it.">⇄ Use {providerLabel(other)}</button>}
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
export const STEP_KEYS = { slip: 'stepSlip', manifest: 'stepManifest', packed: 'stepPacked', handover: 'stepHandover' };

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

export function ResumeSheet({ order: o, show, onClose, onDone }) {
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

export function CancelSheet({ order: o, reasons, show, onClose, onDone }) {
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
// The AWB and courier fields, used when the service has no AWB for an order and the person types it. Same form on the slip sheet and on the card.
function AwbForm({ order: o, pl, initial, busy, onSave, saveText = 'Save AWB' }) {
  const [awb, setAwb] = useState((initial && initial.awb) || ''); const [courier, setCourier] = useState((initial && initial.courier) || '');
  const okAwb = awb.replace(/\s/g, '').length >= 5; const okCourier = courier.trim().length >= 2;
  return (
    <div className="awb-form">
      <div className="row">
        <div><label className="sheet-label" htmlFor={`awb-${o.orderId}`}>AWB number</label><input id={`awb-${o.orderId}`} type="text" autoCapitalize="characters" autoComplete="off" maxLength={40} value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="From the label" autoFocus /></div>
        <div><label className="sheet-label" htmlFor={`cr-${o.orderId}`}>Courier</label><input id={`cr-${o.orderId}`} type="text" autoComplete="off" maxLength={60} value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="For example Delhivery" /></div>
      </div>
      <button className="btn big good" disabled={busy || !okAwb || !okCourier} onClick={() => onSave(awb, courier)}>{busy ? 'Saving…' : !okAwb ? `Type the ${pl} AWB` : !okCourier ? 'Type the courier name' : saveText}</button>
    </div>
  );
}

// Packing slip DONE: the team says which service this order ships from. It cannot be skipped: the server refuses a slip without it.
// The moment a service is pressed, the order is saved with it and the AWB is fetched from THAT service. If the service has no AWB yet, the sheet asks for it by hand.
function ProviderSheet({ order: o, show, onClose, onDone, onGoNext }) {
  const { L } = useLabels();
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null); // after a choice: { provider, phase: 'fetching' | 'ok' | 'none' | 'err' | 'typed', awb, courier, msg }
  const [saving, setSaving] = useState(false);
  const fetchAwb = async (provider) => {
    setRes({ provider, phase: 'fetching' });
    try {
      const r = await api.get(`/desk/dispatch/${o.orderId}/awb`);
      setRes({ provider, phase: r.awb ? 'ok' : 'none', awb: r.awb || '', courier: r.courier || '', connected: r.configured !== false && r.shipwayConfigured !== false });
      notifyDesk();
    } catch (e) { setRes({ provider, phase: 'err', msg: e.message }); }
  };
  const choose = async (provider) => {
    setBusy(provider);
    try { await api.post(`/desk/dispatch/${o.orderId}/slip`, { provider }); notifyDesk(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); setBusy(''); return; }
    setBusy('');
    fetchAwb(provider);
  };
  const saveTyped = async (awb, courier) => {
    setSaving(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/awb`, { awb, courier }); notifyDesk(); setRes((r) => ({ ...r, phase: 'typed', awb: awb.replace(/\s/g, '').toUpperCase(), courier: courier.trim() })); }
    catch (e) { show(e.message, 'err'); } finally { setSaving(false); }
  };
  if (res) {
    const pl = providerLabel(res.provider); const working = res.phase === 'fetching'; const has = res.phase === 'ok' || res.phase === 'typed';
    return (
      <Sheet title={`${o.orderName} · ${pl}`} onClose={onDone}>
        <ol className="dq-progress" aria-live="polite">
          <li className="ok"><i>✓</i><span><b>Packing slip done</b> · {pl} chosen</span></li>
          <li className={working ? 'run' : has ? 'ok' : 'wait'}>
            <i>{working ? <span className="dq-spin" aria-hidden="true" /> : has ? '✓' : '⏳'}</i>
            <span>
              {working && <b>Fetching the AWB from {pl}…</b>}
              {res.phase === 'ok' && <><b>AWB found</b> · {res.awb}{res.courier ? ` · ${res.courier}` : ''}</>}
              {res.phase === 'typed' && <><b>AWB saved</b> · {res.awb} · {res.courier}</>}
              {res.phase === 'none' && <><b>{pl} has no AWB for this order yet.</b> {res.connected === false ? `${pl} is not connected on the server. ` : ''}Type it below, or fetch again after you create the shipment in {pl}.</>}
              {res.phase === 'err' && <><b>Could not reach {pl}.</b> {res.msg} Type the AWB below, or try again.</>}
            </span>
          </li>
        </ol>
        {(res.phase === 'none' || res.phase === 'err') && <>
          <AwbForm order={o} pl={pl} busy={saving} onSave={saveTyped} />
          <button className="btn ghost" disabled={saving} onClick={() => fetchAwb(res.provider)}>↻ Fetch from {pl} again</button>
        </>}
        {has && <p className="muted">The order is now in {L('stepManifest')}.</p>}
        <button className={`btn big ${has ? 'good' : 'ghost'}`} disabled={working || saving} onClick={onGoNext}>{working ? 'Please wait…' : has ? `Go to ${L('stepManifest')}` : `Skip for now · go to ${L('stepManifest')}`}</button>
        <button className="btn ghost" disabled={working || saving} onClick={onDone}>Stay here</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`${L('stepSlip')} done · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)}</p>
      <p className="sd-q">Which service is shipping this order? <Info>Press one. The AWB is fetched from that service straight away. If it has none yet you will be asked to type it. Your choice shows on the card from here on and decides where the manifest is made.</Info></p>
      <div className="prov-pick" role="group" aria-label="Shipping service">
        {PROVIDERS.map((p) => (
          <button key={p} className={p} style={providerStyle(p)} disabled={!!busy} onClick={() => choose(p)}>
            <b>{busy === p ? 'Saving…' : providerLabel(p)}</b>
            <small>{providerMeta(p).hint}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// Type (or correct) the AWB and courier of one order at Create manifest.
function AwbSheet({ order: o, show, onClose, onDone }) {
  const pl = providerLabel(o.dq.provider || 'shipway');
  const [busy, setBusy] = useState(false);
  const save = async (awb, courier) => {
    setBusy(true);
    try { await api.post(`/desk/dispatch/${o.orderId}/awb`, { awb, courier }); notifyDesk(); show(`${o.orderName}: AWB saved.`); onDone(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409 && !/already on order/.test(e.message)) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`AWB · ${o.orderName} · ${pl}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)} <Info label="Why type it?">Use this when {pl} has no AWB for the order. The AWB and the courier name are needed to create the manifest.</Info></p>
      <AwbForm order={o} pl={pl} initial={{ awb: awbOf(o), courier: awbCourierOf(o) }} busy={busy} onSave={save} />
    </Sheet>
  );
}

// Order packed: usually one tap on the card. This form opens only when an admin switched "photo of the box" on in Settings.
function PackedSheet({ order: o, show, onClose, onDone }) {
  const { L } = useLabels();
  const pl = providerLabel(o.dq.provider || 'shipway');
  const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); files.forEach((f) => fd.append('photos', f));
      await api.upload(`/desk/dispatch/${o.orderId}/packed`, fd);
      notifyDesk(); show(`${o.orderName} packed. It is now in ${L('stepHandover')}.`); onDone();
    } catch (e) { show(e.message, 'err'); if (e.status === 409) onDone(); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`${L('stepPacked')} · ${o.orderName}`} onClose={onClose}>
      <p className="muted">{o.name || 'No name'} · {inr(o.total)} · <ProviderBadge provider={o.dq.provider || 'shipway'} /></p>
      <div className="awb-box">
        <div><span>AWB number</span><b>{awbOf(o) || '—'}</b></div>
        <div><span>Courier</span><b>{awbCourierOf(o) || '—'}</b></div>
        <div><span>{pl} manifest</span><b>{(o.dq.manifest && o.dq.manifest.id) || '—'}</b></div>
      </div>
      <MultiPhotoField label="Photos of the packed box" files={files} setFiles={setFiles} required />
      <button className="btn big good" disabled={busy || !files.length} onClick={submit}>{busy ? 'Saving…' : !files.length ? 'Add a photo to save' : `Save: ${L('stepPacked').toLowerCase()}`}</button>
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
    <Sheet title={manifest ? `Handover · manifest ${manifest}` : orders.length === 1 ? `Handover · ${orders[0].orderName}` : `Handover · ${orders.length} orders`} onClose={onClose}>
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
          ? <p>{res.created.length} {res.created.length === 1 ? 'order is' : 'orders are'} on {pl} manifest <b>{res.manifestId}</b> ({res.courier}). They are now in Order packed. Pack each box and press DONE. After that, hand over this manifest.{res.manifestUrl && <> <a href={res.manifestUrl} target="_blank" rel="noreferrer">Open the manifest PDF</a></>}</p>
          : res.noId
            ? <div className="banner warn"><b>{pl} said: “{res.shipwayMessage}”</b> but it did not send a manifest ID the app can read, so no order was grouped. The manifest may now exist in {pl}, so do not press Create manifest again for these orders. Send the details below to support.</div>
            : <div className="banner">{pl} did not create a manifest, so no order was grouped.</div>}
        {res.rawReply && <details><summary className="muted">Details for support</summary><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{res.rawReply}</pre></details>}
        {bad.length > 0 && <>
          <p className="sd-q">{bad.length} {bad.length === 1 ? 'order was' : 'orders were'} left out:</p>
          <ul className="dq-list">{bad.map((r) => <li key={r.orderId}><b>#{r.orderId}</b><span>{r.reason}</span></li>)}</ul>
          <p className="muted">They stay in Create manifest with this reason on the card. Fix the cause, then create a manifest again.</p>
        </>}
        {res.leftOver > 0 && <p className="muted">{res.leftOver} more {res.leftOver === 1 ? 'order is' : 'orders are'} still waiting (at most 50 go on one manifest). Create another manifest for them.</p>}
        <button className="btn big good" onClick={onDone}>Done</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Create ${pl} manifest`} onClose={onClose}>
      <p className="muted"><ProviderBadge provider={provider} /> <Info label="How it works">Pick the courier, then tick the orders for this manifest. Unticked orders stay waiting and are not sent to {pl}. {pl} may still refuse some; those are left out and the reason is shown on the card.</Info></p>
      {!couriers.length && <div className="banner warn">No {pl} orders with an AWB and a courier name are waiting. Fetch or type the AWB on each card first.</div>}
      <p className="sd-q">Which courier?</p>
      <div className="reasons" role="radiogroup" aria-label="Courier">
        {couriers.map((c) => <button key={c.courier} role="radio" aria-checked={courier === c.courier} className={`reason-opt ${courier === c.courier ? 'on' : ''}`} onClick={() => choose(c)}>{c.courier} · {c.count}</button>)}
      </div>
      {pick && <>
        <p className="sd-q">Which orders go on this manifest? <button className="link" onClick={() => setTicked(all ? new Set() : new Set(pick.orders.map((o) => o.orderId)))}>{all ? 'Untick all' : 'Tick all'}</button></p>
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
function ManifestGroup({ g, canAct, selected, onSelect, onOpen, notPacked = 0 }) {
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
      {notPacked > 0 && <small className="muted">{notPacked} more {notPacked === 1 ? 'order' : 'orders'} on this manifest {notPacked === 1 ? 'is' : 'are'} not packed yet (see {`Order packed`}).</small>}
      {g.byName && <small className="muted">Created by {g.byName}{g.at ? `, ${fmtWhen(g.at)}` : ''}</small>}
      {g.url && <small><a href={g.url} target="_blank" rel="noreferrer">Open manifest PDF</a></small>}
    </article>
  );
}

// ---------------------------------------------------------------- page
// The numbered steps across the top. One step is open at a time. Kept slim: the longer explanation sits behind each step's "i".
function Stepper({ steps, stage, setStage }) {
  return (
    <nav className="dq-steps" aria-label="Dispatch steps">
      {steps.map((st, i) => (
        <React.Fragment key={st.key}>
          <button className={`dq-step ${st.key} ${stage === st.key ? 'on' : ''}`} aria-current={stage === st.key ? 'step' : undefined} title={st.sub} onClick={() => setStage(st.key)}>
            <span className="dq-num">{st.num}</span>
            <span className="dq-steptext"><b>{st.label}</b></span>
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
      {[['', 'All services', total], ...PROVIDERS.map((p) => [p, providerLabel(p), counts[p] || 0])].map(([key, label, n]) => (
        <button key={key || 'all'} className={`dq-ptab ${view === key ? 'on' : ''}`} style={key ? providerStyle(key) : undefined} aria-pressed={view === key} onClick={() => setView(key)}>
          {key && <i className="dq-dot" aria-hidden="true" />}{label}<b>{n}</b>
        </button>
      ))}
    </div>
  );
}

// Remember where the person was (which step, which service) so a refresh or coming back from another page lands in the same place.
function usePersisted(key, initial, allowed) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x !== null && (!allowed || allowed.includes(x)) ? x : initial; } catch (e) { return initial; } });
  const set = (x) => { setV(x); try { localStorage.setItem(key, x); } catch (e) { /* private mode: not remembered */ } };
  return [v, set];
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
  const [stage, setStage] = usePersisted('dq.stage', 'slip', COLS.map((c) => c.key)); // 'slip' | 'manifest' | 'packed' | 'handover'
  const [view, setView] = usePersisted('dq.view', '', ['', ...PROVIDERS]); // '' = every service, or one
  const [slipping, setSlipping] = useState(null); const [typing, setTyping] = useState(null); const [packing, setPacking] = useState(null); const [handing, setHanding] = useState(null); const [handingManifest, setHandingManifest] = useState(null); const [making, setMaking] = useState(null); // making = a service key | null
  const [holding, setHolding] = useState(null); const [resuming, setResuming] = useState(null); const [cancelling, setCancelling] = useState(null);
  const [picked, setPicked] = useState([]); const [selM, setSelM] = useState(''); const [busyId, setBusyId] = useState(null);
  const [fetching, setFetching] = useState(() => new Set());
  const [shipFilters, setShipFilters] = useState({}); // the filter of each service's Create manifest list is independent
  const [checking, setChecking] = useState('');
  const conf = data && data.config;
  const c = data && data.counts;
  const manifestAll = data ? data.columns.manifest : [];
  const packedAll = data ? data.columns.packed : [];
  const handoverAll = data ? data.columns.handover : [];
  const byId = new Map(handoverAll.map((o) => [o.orderId, o]));
  const provOf = (o) => o.dq.provider || 'shipway';
  // Order handover is split per service. Orders without a manifest are "loose" (only old orders); the rest sit in manifest groups.
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

  // Order packed is one tap. Only when an admin asked for a photo of the box does a form open.
  const packNow = async (o) => {
    setBusyId(o.orderId);
    try { await api.upload(`/desk/dispatch/${o.orderId}/packed`, new FormData()); notifyDesk(); show(`${o.orderName} packed. It is now in ${L('stepHandover')}.`); reload(); }
    catch (e) { show(e.message, 'err'); if (e.status === 409) reload(); } finally { setBusyId(null); }
  };
  const done = async (o, key) => {
    if (key === 'packed') return conf && conf.stages.packed.requirePhoto ? setPacking(o) : packNow(o);
    if (key === 'handover') return setHanding([o]);
    setSlipping(o); // the slip is marked done inside the sheet, once a service is chosen
  };
  // Ask one service for the AWB of one order right now.
  const fetchAwb = async (o) => {
    const pl = providerLabel(provOf(o));
    setFetching((s) => new Set(s).add(o.orderId));
    try {
      const r = await api.get(`/desk/dispatch/${o.orderId}/awb`);
      if (r.awb) show(`${o.orderName}: AWB ${r.awb} fetched from ${pl}.`);
      else show(r.configured === false ? `${pl} is not connected on the server. Type the AWB instead.` : `${pl} has no AWB for ${o.orderName} yet. Create the shipment in ${pl} and fetch again, or type the AWB.`, 'err');
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
  const cardFor = (o, col, extra) => <Card key={o.orderId} o={o} col={col} title={L(col.label)} assign={assignFor(col.key)} now={now} offset={offset} canAct={actor} busy={busyId === o.orderId} fetching={fetching.has(o.orderId)} onDone={done} onHold={setHolding} onCancel={setCancelling} onSwitch={switchService} onFetch={fetchAwb} onType={setTyping} onOpen={setOpen} {...extra} />;

  // Title, count, and one little "i" holding what to do, the deadline rule and who gets the orders. (For admins: the workload of the open step.)
  const stageHead = (col, { count, overdue, hint, workItems }) => (
    <div className="dq-stagehead compact">
      <div className="dq-title"><h2>Step {col.num} · {L(col.label)}</h2><span className={`sd-count ${overdue ? 'hot' : ''}`} title={overdue ? `${overdue} overdue` : ''}>{count}</span>
        <Info label={`About ${L(col.label)}`}>
          <span><b>What to do:</b> {hint}</span>
          <span><b>Deadline:</b> {whenLabel(conf.stages[col.key])}</span>
          {data.assign.modes[col.key] !== 'off' && <span><b>Orders:</b> {data.assign.modes[col.key] === 'auto' ? 'shared out automatically' : 'assigned by an admin'}</span>}
        </Info>
        {isAdmin && <Link className="dq-gear" to="/orders/shopify-desk/settings#dispatch" title={`${L(col.label)} settings`} aria-label={`${L(col.label)} settings`}>⚙</Link>}</div>
      {data.assign.modes[col.key] !== 'off' && isAdmin && <Workload items={workItems} />}
    </div>
  );
  const notConnected = (side, pl) => side && !side.configured && <span className="dq-off" title={`${pl} login is not set on the server`}>not connected</span>;

  // STEP 2, one service: the orders waiting for a manifest, with the AWB filter, "Fetch all", and the Create manifest button.
  const renderManifest = (pv) => {
    const pl = providerLabel(pv);
    const all = manifestAll.filter((o) => provOf(o) === pv);
    const filt = shipFilters[pv] || '';
    const list = filt ? all.filter((o) => awbGroup(o) === filt) : all;
    const ready = all.filter((o) => awbGroup(o) === 'ready').length;
    const side = data.handover ? data.handover[pv] : null;
    const couriers = (side && side.couriers) || [];
    const canMake = actor && couriers.length > 0;
    return (
      <section key={pv} className="dq-pboard" style={providerStyle(pv)} aria-label={`${pl} orders waiting for a manifest`}>
        <div className="dq-pboard-head">
          <h3><i className="dq-dot" aria-hidden="true" />{pl}</h3>
          <span className="muted">{all.length} {all.length === 1 ? 'order' : 'orders'} · {ready} with AWB</span>
          {notConnected(side, pl)}
          <span className="grow" style={{ flex: 1 }} />
          {actor && <button className="btn good" disabled={!canMake} onClick={() => setMaking(pv)} title={canMake ? '' : 'An order needs an AWB and a courier name first'}>Create {pl} manifest{canMake ? ` (${couriers.reduce((n, x) => n + x.count, 0)})` : ''}</button>}
        </div>
        {all.length > 0 && <PackedBar pl={pl} items={all} filter={filt} setFilter={(v) => setShipFilters((f) => ({ ...f, [pv]: v }))} onCheck={() => runCheck(pv)} checking={checking === pv} canCheck={actor} />}
        {list.length === 0
          ? <Empty title={filt ? 'No orders in this filter' : `No ${pl} orders here`}>{filt ? 'Pick another filter above, or press “All”.' : q ? 'No orders match this search.' : `Orders whose slip was marked ${pl} appear here.`}</Empty>
          : <div className="dq-grid">{list.map((o) => cardFor(o, COLS[1], { noDone: true }))}</div>}
      </section>
    );
  };

  // STEP 3, one service: the boxes to pack. DONE is one tap.
  const renderPacked = (pv) => {
    const pl = providerLabel(pv);
    const all = packedAll.filter((o) => provOf(o) === pv);
    const side = data.handover ? data.handover[pv] : null;
    return (
      <section key={pv} className="dq-pboard" style={providerStyle(pv)} aria-label={`${pl} orders to pack`}>
        <div className="dq-pboard-head">
          <h3><i className="dq-dot" aria-hidden="true" />{pl}</h3>
          <span className="muted">{all.length} {all.length === 1 ? 'order' : 'orders'} to pack</span>
          {notConnected(side, pl)}
        </div>
        {all.length === 0
          ? <Empty title={`No ${pl} orders to pack`}>{q ? 'No orders match this search.' : `Orders appear here once their ${pl} manifest is created.`}</Empty>
          : <div className="dq-grid">{all.map((o) => cardFor(o, COLS[2]))}</div>}
      </section>
    );
  };

  // STEP 4, one service: select the manifest the courier is taking and hand it over with 1 photo.
  const renderHandover = (pv) => {
    const pl = providerLabel(pv);
    const { side, loose } = sideOf(pv);
    const groups = side ? side.manifests || [] : [];
    const count = side ? side.count : handoverAll.filter((o) => provOf(o) === pv).length;
    const mine = picked.filter((id) => loose.some((o) => o.orderId === id));
    const allPicked = loose.length > 0 && mine.length === loose.length;
    const selGroup = groups.find((g) => g.manifestId === selM) || null;
    const n = selGroup ? selGroup.orders.length : mine.length;
    const handNow = () => { if (selGroup) { setHandingManifest(selGroup.manifestId); setHanding(selGroup.orders); } else setHanding(loose.filter((o) => mine.includes(o.orderId))); };
    const stillPacking = (g) => packedAll.filter((o) => o.dq.manifest && o.dq.manifest.id === g.manifestId).length;
    return (
      <section key={pv} className="dq-pboard" style={providerStyle(pv)} aria-label={`${pl} handover`}>
        <div className="dq-pboard-head">
          <h3><i className="dq-dot" aria-hidden="true" />{pl}</h3>
          <span className="muted">{groups.length} {groups.length === 1 ? 'manifest' : 'manifests'} · {count} packed {count === 1 ? 'order' : 'orders'}</span>
          {notConnected(side, pl)}
          <span className="grow" style={{ flex: 1 }} />
          {actor && <button className="btn good" disabled={!n} onClick={handNow}>{n ? `Handover selected (${selGroup ? '1 manifest · ' : ''}${n} ${n === 1 ? 'order' : 'orders'})` : 'Handover selected'}</button>}
        </div>
        {groups.length === 0 && loose.length === 0
          ? <Empty title="Nothing to hand over">{q ? 'No orders match this search.' : `Packed ${pl} orders wait here, grouped by manifest, for the courier.`}</Empty>
          : groups.length > 0 && <div className="dq-grid">{groups.map((g) => <ManifestGroup key={g.manifestId} g={g} canAct={actor} selected={selM === g.manifestId} onSelect={selectManifest} onOpen={setOpen} notPacked={stillPacking(g)} />)}</div>}
        {actor && loose.length > 0 && (
          <details className="dq-direct">
            <summary>Orders without a manifest ({loose.length})</summary>
            <p className="muted">Older orders that reached handover before manifests came first. Tick them, then press Handover selected.</p>
            <button className="btn ghost" onClick={() => { setSelM(''); setPicked(allPicked ? picked.filter((id) => !loose.some((o) => o.orderId === id)) : [...new Set([...picked, ...loose.map((o) => o.orderId)])]); }}>{allPicked ? 'Clear' : 'Select all'}</button>
            <ul className="dq-list">{loose.map((o) => <li key={o.orderId}><label className="dq-tick"><input type="checkbox" checked={picked.includes(o.orderId)} onChange={() => pick(o.orderId)} aria-label={`Select ${o.orderName} for handover`} /><b>{o.orderName}</b></label><span>AWB {(o.dq.packed && o.dq.packed.awb) || '—'}</span></li>)}</ul>
          </details>
        )}
      </section>
    );
  };

  const steps = data ? [
    { ...COLS[0], label: L(COLS[0].label), count: data.columns.slip.length, overdue: lateN(data.columns.slip) },
    { ...COLS[1], label: L(COLS[1].label), count: manifestAll.length, overdue: lateN(manifestAll) },
    { ...COLS[2], label: L(COLS[2].label), count: packedAll.length, overdue: lateN(packedAll) },
    { ...COLS[3], label: L(COLS[3].label), count: handoverAll.length, overdue: lateN(handoverAll) },
  ] : [];
  const countsOf = (arr) => Object.fromEntries(PROVIDERS.map((p) => [p, arr.filter((o) => provOf(o) === p).length]));
  const shownProviders = PROVIDERS.filter((pv) => !view || view === pv);
  const stageList = { manifest: manifestAll, packed: packedAll, handover: handoverAll };

  return (
    <section>
      {data && <Stepper steps={steps} stage={stage} setStage={setStage} />}
      <div className="filters"><input type="search" placeholder="Search order number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /><span className="grow" />
        <WhoFilter value={who} onChange={setWho} people={isAdmin ? people : []} show={!!data && (Object.values(data.assign.modes).some((m) => m !== 'off') || !!who)} />
        {data && held.length > 0 && <Link className="muted" to="/orders/shopify-desk/hold">{held.length} on hold →</Link>}{data && <span className="muted">{data.shown} {data.shown === 1 ? 'order' : 'orders'}{c && c.overdue ? ` · ${c.overdue} overdue` : ''}{data.collectTotal ? ` · ${inr(data.collectTotal)} to collect on delivery` : ''}</span>}</div>
      <Loading error={error} loading={loading && !data}>
        {data && stage === 'slip' && (
          <div className="dq-stage slip">
            {stageHead(COLS[0], { count: data.columns.slip.length, overdue: c.overdueBy.slip, hint: COLS[0].hint(L), workItems: data.columns.slip })}
            {data.columns.slip.length === 0
              ? <Empty title="Nothing here">{q ? 'No orders match this search.' : 'Confirmed orders appear here the moment someone taps Confirmed.'}</Empty>
              : <div className="dq-grid">{data.columns.slip.map((o) => cardFor(o, COLS[0]))}</div>}
          </div>
        )}
        {data && stage !== 'slip' && (
          <div className={`dq-stage ${stage}`}>
            {(() => {
              const col = COLS.find((x) => x.key === stage); const items = stageList[stage];
              return stageHead(col, { count: items.length, overdue: lateN(items), hint: col.hint(L, view ? providerLabel(view) : ''), workItems: items });
            })()}
            <ProviderTabs view={view} setView={setView} counts={countsOf(stageList[stage])} />
            <div className="dq-boards">{shownProviders.map(stage === 'manifest' ? renderManifest : stage === 'packed' ? renderPacked : renderHandover)}</div>
          </div>
        )}
      </Loading>
      {holding && <HoldSheet order={holding} show={show} onClose={() => setHolding(null)} onDone={finish(setHolding)} />}
      {resuming && <ResumeSheet order={resuming} show={show} onClose={() => setResuming(null)} onDone={finish(setResuming)} />}
      {cancelling && <CancelSheet order={cancelling} reasons={(data && data.cancelReasons) || []} show={show} onClose={() => setCancelling(null)} onDone={finish(setCancelling)} />}
      {slipping && <ProviderSheet order={slipping} show={show} onClose={() => setSlipping(null)} onDone={finish(setSlipping)} onGoNext={() => { setStage('manifest'); setView(''); finish(setSlipping)(); }} />}
      {typing && <AwbSheet order={typing} show={show} onClose={() => setTyping(null)} onDone={finish(setTyping)} />}
      {packing && <PackedSheet order={packing} show={show} onClose={() => setPacking(null)} onDone={finish(setPacking)} />}
      {making && <ManifestSheet provider={making} couriers={(data.handover && data.handover[making] && data.handover[making].couriers) || []} names={Object.fromEntries(manifestAll.map((o) => [o.orderId, o.orderName]))} show={show} onClose={() => setMaking(null)} onDone={() => { setMaking(null); reload(); }} />}
      {handing && <HandoverSheet orders={handing} manifest={handingManifest} conf={conf} show={show} onClose={() => { setHanding(null); setHandingManifest(null); }} onDone={finish(setHanding)} />}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
      {toast}
    </section>
  );
}
