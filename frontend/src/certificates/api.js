import { API_BASE, netFetch, handleUnauthorized } from "../api.js";

// Certificate Studio lives inside the hub's backend, under /api/certificates, and uses the hub's own login token.
const BASE = `${API_BASE}/certificates`;
const token = () => localStorage.getItem("authToken") || "";
const authHeaders = () => (token() ? { Authorization: `Bearer ${token()}` } : {});

async function request(method, path, { body, form } = {}) {
  const headers = { ...authHeaders() };
  let payload;
  if (form) payload = form; // multipart: the browser sets the boundary
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await netFetch(`${BASE}${path}`, { method, headers, body: payload });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

const qs = (params = {}) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : "";
};

// Template images are private, so an <img src> can't load them (no Authorization header): fetch as a blob instead.
export async function fetchImageBlob(ref) {
  const res = await netFetch(`${BASE}/image/${encodeURIComponent(ref)}`, { headers: authHeaders() });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) throw new Error("Could not load the certificate image");
  return res.blob();
}

export const certApi = {
  // certificate templates
  templates: () => request("GET", "/templates"),
  template: (id) => request("GET", `/templates/${id}`),
  createTemplate: (form) => request("POST", "/templates", { form }),
  updateTemplate: (id, form) => request("PUT", `/templates/${id}`, { form }),
  removeTemplate: (id) => request("DELETE", `/templates/${id}`),

  // issued certificates (history + duplicate protection)
  issue: (data) => request("POST", "/records/issue", { body: data }),
  history: (params) => request("GET", `/records${qs(params)}`),
  removeCert: (id) => request("DELETE", `/records/${id}`),
  editCert: (id, data) => request("PUT", `/records/${id}`, { body: data }), // admin: direct edit
  requestChange: (id, data) => request("POST", `/records/${id}/change-request`, { body: data }), // coordinator
  changeRequests: (params) => request("GET", `/records/change-requests${qs(params)}`),
  pendingCount: () => request("GET", "/records/change-requests/pending-count"),
  approveChange: (rid, note) => request("POST", `/records/change-requests/${rid}/approve`, { body: { note } }),
  rejectChange: (rid, note) => request("POST", `/records/change-requests/${rid}/reject`, { body: { note } }),

  // the small numbers on the app chooser card
  summary: () => request("GET", "/summary"),
};

// Tells the sidebar badge to refresh right away (after approving / rejecting / filing a request).
export const notifyChanged = () => window.dispatchEvent(new Event("cs-changed"));
