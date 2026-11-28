import React, { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../deskUi.jsx';
import { useStaff } from '../../staff.jsx';
import { hasRole, isAdmin, rolesOf } from '../../flowUi.js';
import { deskHome } from './deskHome.js';
import { Info, LabelsProvider, notifyDesk, useDeskCounts, useLabels } from './shared.jsx';
import { ConfirmQueue, PendingQueue } from './DeskQueue.jsx';
import { PartialPaid, CancelledOrders } from './DeskLists.jsx';
import DispatchBoard from './DispatchBoard.jsx';
import TransitOrders from './TransitOrders.jsx';
import DeskSettings from './DeskSettings.jsx';

// Every desk page (Confirm, Pending, Dispatch, In transit, Partial, Cancelled, Settings) now lives in the sidebar under "Shopify desk", so no tab bar takes up room here.
// This list says who may open which page; the sidebar and the routes below both follow it.
function tabsFor(user, c, L) {
  const n = (v) => (v ? v : null);
  const ALL = ['admin', 'confirmation', 'packing'];
  const all = [
    ['confirm', L('tabConfirm'), c && n(c.confirm.total), ['admin', 'confirmation'], c && c.confirm.due],
    ['pending', L('tabPending'), c && n(c.pending.total), ['admin', 'confirmation'], c && c.pending.due],
    ['dispatch', L('tabDispatch'), c && n(c.dispatch), ['admin', 'packing'], c && c.dispatchSteps && c.dispatchSteps.overdue],
    ['transit', L('tabTransit'), null, ALL],
    ['partial', L('tabPartial'), c && n(c.partial), ['admin', 'confirmation']],
    ['cancelled', L('tabCancelled'), c && n(c.cancelled), ['admin', 'confirmation']],
    ['settings', L('tabSettings'), null, ['admin']],
  ];
  const mine = rolesOf(user);
  return all.filter((t) => t[3].some((r) => mine.includes(r)));
}

export { deskHome };

function Refresh() {
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const go = async () => {
    setBusy(true);
    try { const r = await api.post('/desk/refresh'); notifyDesk(); window.dispatchEvent(new Event('desk-refresh')); show(r.added ? `${r.added} new order${r.added === 1 ? '' : 's'} added.` : 'Shopify checked. No new orders.'); }
    catch (e) { show(e.message, 'err'); } finally { setBusy(false); }
  };
  return <><button className="btn ghost" onClick={go} disabled={busy}>{busy ? 'Checking Shopify…' : 'Refresh from Shopify'}</button>{toast}</>;
}

export default function ShopifyDesk() { return <LabelsProvider><DeskInner /></LabelsProvider>; }

function DeskInner() {
  const { user } = useStaff();
  const { L } = useLabels();
  const counts = useDeskCounts();
  const tabs = tabsFor(user, counts, L);
  const allowed = new Set(tabs.map((t) => t[0]));
  const guard = (key, el) => (allowed.has(key) ? el : <Navigate to={deskHome(user)} replace />);
  return (
    <div className="sd">
      <div className="sd-top">
        <div className="sd-titleline">
          <h1>{L('deskTitle')}</h1>
          <Info>{L('deskSubtitle')}</Info>
        </div>
        <Refresh />
      </div>
      <Routes>
        {/* old bookmarks to the four pages that moved to the sidebar */}
        <Route path="overview" element={<Navigate to="/orders/desk-overview" replace />} />
        <Route path="funnel" element={<Navigate to="/orders/order-funnel" replace />} />
        <Route path="orders" element={<Navigate to="/orders/shopify-orders" replace />} />
        <Route path="analysis" element={<Navigate to="/orders/order-analysis" replace />} />
        <Route path="confirm" element={guard('confirm', <ConfirmQueue />)} />
        <Route path="pending" element={guard('pending', <PendingQueue />)} />
        <Route path="dispatch" element={guard('dispatch', <DispatchBoard />)} />
        <Route path="transit" element={guard('transit', <TransitOrders />)} />
        <Route path="partial" element={guard('partial', <PartialPaid />)} />
        <Route path="cancelled" element={guard('cancelled', <CancelledOrders />)} />
        <Route path="settings" element={guard('settings', <DeskSettings />)} />
        <Route path="*" element={<Navigate to={deskHome(user)} replace />} />
      </Routes>
    </div>
  );
}
