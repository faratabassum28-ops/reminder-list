import { hasRole, isAdmin } from '../../flowUi.js';

// Where a person lands: admins on the Overview, otherwise their first team's queue (Confirmation first, then Dispatch).
export const deskHome = (user) => (isAdmin(user) ? '/orders/shopify-desk/overview' : hasRole(user, 'confirmation') ? '/orders/shopify-desk/confirm' : hasRole(user, 'packing') ? '/orders/shopify-desk/dispatch' : '/orders/shopify-desk/overview');
