// Which apps a user may open. Admins always get every app; legacy accounts with no `apps` value keep the
// first three so nothing breaks for existing people. Order Analytics ("orders") is NEVER implied: a non-admin
// only has it when an admin ticked it (and picked a desk team) on the Users page.
export const ALL_APPS = ["reminder", "workshop", "tickets", "orders"];
const LEGACY_APPS = ["reminder", "workshop", "tickets"];

// The desk teams inside Order Analytics. Admins see everything there; everyone else needs one or both.
export const ORDERS_ROLES = ["confirmation", "packing"];

export function appsOf(user) {
  if (!user) return [];
  if (user.role === "admin") return ALL_APPS;
  if (!Array.isArray(user.apps)) return LEGACY_APPS;
  return ALL_APPS.filter((a) => user.apps.includes(a));
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
