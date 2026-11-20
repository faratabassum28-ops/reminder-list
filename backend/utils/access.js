// Which apps a user may open. Admins always get every app; legacy accounts with no `apps` value keep the
// first three so nothing breaks for existing people. Order Analytics ("orders"), Certificate Studio
// ("certificates") and EMI Manager ("emi") are NEVER implied: a non-admin only has them when an admin ticked them on the Users page
// (Order Analytics also needs a desk team).
export const ALL_APPS = ["reminder", "workshop", "tickets", "orders", "certificates", "emi"];
const LEGACY_APPS = ["reminder", "workshop", "tickets"];

// The desk teams inside Order Analytics. Admins see everything there; everyone else needs one or both.
// "admin" = Order Analytics admin: sees and manages everything inside Order Analytics without being a hub admin.
export const ORDERS_ROLES = ["confirmation", "packing", "admin"];

// Apps an admin has switched OFF for everyone (Admin Settings > Apps). Kept in memory so every request can check it without a
// database round-trip; loaded at start-up and refreshed whenever an admin changes it. Admins themselves are never locked out.
let DISABLED_APPS = new Set();
export const setDisabledApps = (list) => { DISABLED_APPS = new Set((Array.isArray(list) ? list : []).filter((a) => ALL_APPS.includes(a))); };
export const getDisabledApps = () => ALL_APPS.filter((a) => DISABLED_APPS.has(a));

// What an account has been TICKED for (ignores the global on/off switch). The Users / Settings screens show and edit this.
export function storedAppsOf(user) {
  if (!user) return [];
  if (user.role === "admin") return ALL_APPS;
  if (!Array.isArray(user.apps)) return LEGACY_APPS;
  return ALL_APPS.filter((a) => user.apps.includes(a));
}

// What an account can actually open right now: its ticked apps minus anything switched off for everyone.
export function appsOf(user) {
  if (!user) return [];
  if (user.role === "admin") return ALL_APPS;
  return storedAppsOf(user).filter((a) => !DISABLED_APPS.has(a));
}

export const hasApp = (user, app) => appsOf(user).includes(app);

// Clean an `apps` value from a request body.
export function cleanApps(input) {
  if (!Array.isArray(input)) return undefined;
  return ALL_APPS.filter((a) => input.includes(a));
}

// Clean an `ordersRoles` value from a request body.
export function cleanOrdersRoles(input) {
  if (!Array.isArray(input)) return undefined;
  return ORDERS_ROLES.filter((r) => input.includes(r));
}

// What Order Analytics needs to know about a person (admins are covered by role, so no teams are listed for them).
export const ordersRolesOf = (user) => (user?.role === "admin" ? [] : cleanOrdersRoles(user?.ordersRoles) || []);

// Certificate Studio roles. "admin" uploads / edits / deletes templates, edits or removes issued certificates and approves change
// requests. "issuer" (the creator) picks a certificate, issues single or bulk, re-downloads and requests changes. Hub admins are always "admin".
export const CERT_ROLES = ["admin", "issuer"];
export const cleanCertRole = (input) => (CERT_ROLES.includes(input) ? input : undefined);
export const certRoleOf = (user) => (!user ? "issuer" : user.role === "admin" || user.certRole === "admin" ? "admin" : "issuer");

// EMI Manager roles (admins are always "Admin" inside it).
export const EMI_ROLES = ["Admin", "Manager", "CRM", "Viewer"];
export const cleanEmiRole = (input) => (EMI_ROLES.includes(input) ? input : undefined);
