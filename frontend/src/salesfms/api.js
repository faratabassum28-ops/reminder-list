// Sales FMS's API helper. It lives inside the hub's backend under /api/sales-fms and uses the hub's own login token,
// so there is no separate sign-in. A 401 signs the person out exactly like every other app.
import { API_BASE, netFetch, handleUnauthorized } from "../api.js";

const BASE = `${API_BASE}/sales-fms`;
export { BASE as API_BASE }; // used to show this app's public webhook URLs in Settings

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  let token = "";
  try { token = localStorage.getItem("authToken") || ""; } catch {}
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await netFetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Request failed");
  }
  return res.json();
}

// Sales Dashboard (revenue) — admin only. Array filters travel as "a|b|c".
function sdQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    qs.set(k, Array.isArray(v) ? v.join("|") : v);
  }
  return qs.toString() ? "?" + qs : "";
}

export const api = {
  // ---- sales dashboard (revenue) ----
  sd: (path, params) => request("/sales-dashboard" + path + sdQuery(params)),
  sdSync: () => request("/sales-dashboard/sync", { method: "POST" }),
  // ---- leads & follow-ups ----
  ldStats: () => request("/stats"),
  ldConfig: () => request("/config"),
  ldSaveConfig: (data) => request("/config", { method: "PUT", body: JSON.stringify(data) }),
  ldLeads: () => request("/leads"),
  ldAddLead: (data) => request("/leads", { method: "POST", body: JSON.stringify(data) }),
  ldBulkDelete: (ids, alsoSheet = true) => request("/leads/bulk-delete", { method: "POST", body: JSON.stringify({ ids, alsoSheet }) }),
  ldBulkAssign: (ids, assignedTo) => request("/leads/bulk-assign", { method: "POST", body: JSON.stringify({ ids, assignedTo }) }),
  ldPatchLead: (id, data) => request(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  ldSaveFollowUp: (id, n, data) => request(`/leads/${id}/fu/${n}`, { method: "PATCH", body: JSON.stringify(data) }),
  ldSync: () => request("/sync", { method: "POST" }),
  ldSheetKey: () => request("/sheet-key", { method: "POST" }),
  ldSheetTest: (data) => request("/sheet-test", { method: "POST", body: JSON.stringify(data) }),
  ldSheetScript: (kind) => request("/sheet-script" + (kind ? `?kind=${kind}` : "")),
  ldBookingTest: (data) => request("/booking-test", { method: "POST", body: JSON.stringify(data) }),
  ldMarkAttendance: (day, entries) => request("/attendance", { method: "POST", body: JSON.stringify({ day, entries }) }), // phone numbers and/or emails
  ldPasteAttendance: (body) => request("/attendance", { method: "POST", body: JSON.stringify(body) }), // { day, entries, workshop, dryRun, assign: { people: [{ name, share }] } }
  ldAttendanceSheet: (url) => request("/attendance/sheet", { method: "POST", body: JSON.stringify({ url }) }), // { rows } of a Google Sheet shared as "Anyone with the link"
  ldImportLog: () => request("/import-log"),
  ldBookings: () => request("/bookings"), // bookings from the New Order FMS sheet
  ldPayments: () => request("/payments"), // Razorpay payments (admin)
  ldWaLog: () => request("/wa-log"), // AiSensy WhatsApp attempts (admin)
  ldWaResend: (id) => request(`/leads/${id}/welcome-wa`, { method: "POST" }),
  ldWaTest: (phone) => request("/aisensy/test", { method: "POST", body: JSON.stringify({ phone }) }),
  ldActivity: () => request("/activity"),
  ldToday: () => request("/today"),
  ldDaily: (days = 14) => request(`/daily?days=${days}`),
  ldSnapshot: () => request("/snapshot", { method: "POST" }),
  ldReports: (months) => request(`/reports?months=${months}`),
  ldCallers: () => request("/callers"),
  ldClearDelayed: () => request("/clear-delayed", { method: "POST" }),
  ldProgress: () => request("/progress"),
  ldAssignments: (from, to) => request(`/assignments?from=${from || ""}&to=${to || ""}`),
  ldPerformance: (from, to) => request(`/performance?from=${from}&to=${to}`),
  ldHistory: (id) => request(`/leads/${id}/history`),
  ldShare: () => request("/share"),
  ldSaveShare: (data) => request("/share", { method: "PUT", body: JSON.stringify(data) }),
  ldSpreadToday: (names) => request("/assign/spread-today", { method: "POST", body: JSON.stringify({ names }) }),
  ldReshare: (queue) => request("/assign/reshare", { method: "POST", body: JSON.stringify({ queue }) }),
  ldMissingLogins: () => request("/team/missing"),

  // ---- team (admin) ----
  ldTeam: () => request("/team"),
  ldAddPerson: (data) => request("/team", { method: "POST", body: JSON.stringify(data) }),
  ldUpdatePerson: (id, data) => request(`/team/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  ldRemovePerson: (id) => request(`/team/${id}`, { method: "DELETE" }),
};
