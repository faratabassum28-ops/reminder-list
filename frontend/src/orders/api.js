import { useEffect, useState } from 'react';

// Order Analytics lives inside the hub's own backend, under /api/orders, and uses the hub's own login token.
import { API_BASE } from '../api.js';
const BASE = `${API_BASE}/orders`;
export const getStaffToken = () => localStorage.getItem('authToken') || '';

function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function authedFetch(url, init = {}) {
  try {
    return await fetch(url, { ...init, headers: { ...(init.headers || {}), ...authHeaders() } });
  } catch (e) {
    throw new Error(navigator.onLine === false ? "You're offline. Check your internet connection and try again." : "Can't reach the server right now. Please try again in a moment.");
  }
}

const authHeaders = () => {
  const h = {};
  const t = getStaffToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};

async function request(method, path, { params, body, form, quiet401 } = {}) {
  const headers = {};
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await authedFetch(`${BASE}${path}${qs(params)}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !quiet401) throw new Error('Your session ended. Sign in again.');
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, code: data.code });
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  upload: (path, form) => request('POST', path, { form }),
  async download(path, params, filename) {
    const res = await authedFetch(`${BASE}${path}${qs(params)}`);
    if (!res.ok) throw new Error('Export failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
};

// Proof photos need the sign-in header, so an <img src> cannot load them directly: fetch, keep as an object URL, reuse.
const blobCache = new Map();
export async function proofUrl(id) {
  if (blobCache.has(id)) return blobCache.get(id);
  const res = await authedFetch(`${BASE}/flow/proofs/${id}`);
  if (!res.ok) throw new Error('Could not load this photo');
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(id, url);
  return url;
}

// Fetch on mount and whenever path/params change. Ignores out-of-order responses.
export function useApi(path, params, enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify([path, params, enabled]);
  const [tick, setTick] = useState(0);
  // When the server reports newly synced data, quietly refetch in the background (no "Loading…" flash).
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const on = () => api.get(path, params).then((data) => live && setState({ data, error: null, loading: false }), () => {});
    window.addEventListener('data-updated', on);
    return () => { live = false; window.removeEventListener('data-updated', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path, params).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error: error.message, loading: false })
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// Payment screenshots of the Shopify Desk need the sign-in header too.
export async function deskProofUrl(id) { // dispatch queue photos: package + manifest
  const k = `proof:${id}`;
  if (blobCache.has(k)) return blobCache.get(k);
  const res = await authedFetch(`${BASE}/desk/proofs/${id}`);
  if (!res.ok) throw new Error('Could not load this photo');
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(k, url);
  return url;
}

export async function deskShotUrl(id) {
  const k = `desk:${id}`;
  if (blobCache.has(k)) return blobCache.get(k);
  const res = await authedFetch(`${BASE}/desk/shots/${id}`);
  if (!res.ok) throw new Error('Could not load this screenshot');
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(k, url);
  return url;
}
