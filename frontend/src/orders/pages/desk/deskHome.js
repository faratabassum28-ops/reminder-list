import { hasRole, isAdmin } from '../../flowUi.js';

// Where a person lands inside the Shopify desk: their first team's queue (Confirmation first, then Dispatch). Admins start at Confirm calls.
// The report pages (overview, funnel, orders, analysis) are in the sidebar now, not in the desk's tab bar.
export const deskHome = (user) => (isAdmin(user) || hasRole(user, 'confirmation') ? '/orders/shopify-desk/confirm' : hasRole(user, 'packing') ? '/orders/shopify-desk/dispatch' : '/orders');
