import React, { useEffect, useState } from 'react';
import { api, useApi } from '../../api.js';
import { Loading } from '../../components.jsx';
import { useToast } from '../../deskUi.jsx';
import { fmtWhen, useAutoRefresh } from '../../flowUi.js';
import { inr } from '../../format.js';
import { ProviderBadge } from '../../providers.jsx';
import { Empty, OrderDrawer, fmtPhone, notifyDesk, useDebounced, usePager } from './shared.jsx';

// Shipway groups -> the tag colours the Orders screen already uses
const TAG = { delivered: 'Delivered', transit: 'In', ndr: 'Pending', rto: 'RTO' };
const FILTERS = [['', 'All', 'all'], ['transit', 'In transit', 'transit'], ['ndr', 'NDR / undelivered', 'ndr'], ['rto', 'RTO', 'rto'], ['delivered', 'Delivered', 'delivered'], ['none', 'No courier status yet', 'none']];
const SERVICES = [['', 'Both', 'all'], ['shipway', 'Shipway', 'shipway'], ['shiprocket', 'Shiprocket', 'shiprocket']];
const PAGE = 50;

export default function TransitOrders() {
  const [group, setGroup] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState(''); const qd = useDebounced(q);
  const pager = usePager(0, PAGE, [group, provider, qd]);
  const { data, error, loading, reload } = useApi('/desk/transit', { group, provider, q: qd, page: pager.page, limit: PAGE });
  useAutoRefresh(reload, 30);
  useEffect(() => { const on = () => reload(); window.addEventListener('desk-refresh', on); return () => window.removeEventListener('desk-refresh', on); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false); const [toast, show] = useToast();
  const [open, setOpen] = useState(null);
  const items = data ? data.items : [];
  const c = data && data.counts;
  const bp = data && data.byProvider;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  const fetchStatus = async () => {
    setBusy(true);
    try {
      // Everything on this page whose status can still change (delivered and RTO-delivered orders are final).
      const ids = items.filter((o) => !(o.shipway && o.shipway.final)).map((o) => o.orderId);
      if (!ids.length) { show('Nothing to fetch: every order on this page already has a final courier status.'); return; }
      const r = await api.post('/desk/transit/refresh', { orderIds: ids });
      notifyDesk(); reload();
      show(r.failed && r.failed === r.checked ? 'The courier service could not be reached. Try again in a minute.' : `Checked ${r.checked} order${r.checked === 1 ? '' : 's'}${r.changed ? `, ${r.changed} changed` : ', no changes'}.`, r.failed && r.failed === r.checked ? 'err' : 'ok');
    } catch (e) { show(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <section>
      <p className="sd-hint">Orders handed over to the courier. Their status comes from the service you chose at the packing slip (Shipway or Shiprocket) and refreshes by itself every few minutes; press the button to fetch it right now.</p>
      <div className="prov-filter" role="tablist" aria-label="Shipping service">
        {SERVICES.map(([key, label, ck]) => <button key={key} role="tab" aria-selected={provider === key} className={provider === key ? 'on' : ''} onClick={() => setProvider(key)}>{label}<b>{bp ? bp[ck] : '–'}</b></button>)}
      </div>
      <div className="sd-chips" role="tablist" aria-label="Courier status">
        {FILTERS.map(([key, label, ck]) => <button key={key} role="tab" aria-selected={group === key} className={group === key ? 'on' : ''} onClick={() => setGroup(key)}>{label}<b>{c ? c[ck] : '–'}</b></button>)}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search order number, name, phone or AWB" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <span className="grow" />
        <button className="btn" onClick={fetchStatus} disabled={busy || (data && !data.shipwayConfigured && !data.shiprocketConfigured)} title={data && !data.shipwayConfigured && !data.shiprocketConfigured ? 'Neither Shipway nor Shiprocket is connected yet' : ''}>{busy ? 'Fetching courier status…' : 'Fetch courier status'}</button>
      </div>
      {data && !data.shipwayConfigured && ((data.byProvider || {}).shipway > 0) && <div className="banner">Shipway is not connected yet, so Shipway orders have no status. Add SHIPWAY_USERNAME and SHIPWAY_LICENSE_KEY on the server (see the README).</div>}
      {data && !data.shiprocketConfigured && (data.byProvider || {}).shiprocket > 0 && <div className="banner">Shiprocket is not connected yet, so Shiprocket orders have no status. Add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD on the server.</div>}
      <Loading error={error} loading={loading && !data}>
        {data && (items.length === 0
          ? <Empty title={q || group ? 'No orders match this' : 'No in-transit orders yet'}>{q || group ? 'Try another filter or search.' : 'When an order is handed over in the Dispatch queue it shows up here.'}</Empty>
          : (
            <>
              <div className="tablewrap"><table className="sd-table">
                <thead><tr><th>Order</th><th>Customer</th><th>Service</th><th>AWB / courier</th><th>Handed over</th><th>Courier status</th><th>Status updated</th><th className="num">Days</th><th className="num">Collect</th></tr></thead>
                <tbody>{items.map((o) => (
                  <tr key={o.orderId} className="click" onClick={() => setOpen(o.orderId)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.orderId)}>
                    <td><b>{o.orderName}</b></td>
                    <td>{o.name || '—'}<div className="muted">{[fmtPhone(o.phone), o.city].filter(Boolean).join(' · ')}</div></td>
                    <td><ProviderBadge provider={o.provider} /></td>
                    <td>{o.awb || '—'}<div className="muted">{o.courier}</div></td>
                    <td>{fmtWhen(o.handedOverAt)}<div className="muted">{o.handedOverBy}</div></td>
                    <td>{o.shipway ? <span className={`tag ${TAG[o.shipway.group] || ''}`}>{o.shipway.status}</span> : <span className="muted">Not fetched yet</span>}</td>
                    <td>{o.shipway ? fmtWhen(o.shipway.statusAt || o.shipway.checkedAt) : '—'}{o.shipway && o.shipway.checkedAt && <div className="muted">checked {fmtWhen(o.shipway.checkedAt)}</div>}</td>
                    <td className="num">{o.days == null ? '—' : o.days}</td>
                    <td className="num">{o.collect > 0 ? inr(o.collect) : 'Paid'}</td>
                  </tr>))}</tbody>
              </table></div>
              {data.total > PAGE && <div className="pager"><button className="btn ghost" disabled={pager.page <= 1} onClick={() => pager.setPage(pager.page - 1)}>Previous</button><span>Page {pager.page} of {pages}</span><button className="btn ghost" disabled={pager.page >= pages} onClick={() => pager.setPage(pager.page + 1)}>Next</button></div>}
            </>
          ))}
      </Loading>
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
      {toast}
    </section>
  );
}
