// EMI Manager's API helper. It lives inside the hub's backend under /api/emi and uses the hub's own login token,
// so there is no separate EMI sign-in. A 401 signs the person out exactly like every other app.
import { API_BASE, netFetch, handleUnauthorized } from '../api.js';

const BASE = `${API_BASE}/emi`;
const token = () => localStorage.getItem('authToken') || '';

async function request(method, path, body, { raw } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const t = token();
  const res = await netFetch(BASE + path, {
    method,
    headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401) handleUnauthorized();
  if (raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  // any successful write tells every open EMI screen to refresh itself (badges, lists, history)
  if (method !== 'GET' && path !== '/payments/preview' && path !== '/uploads') window.dispatchEvent(new Event('data-changed'));
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  put: (p, b) => request('PUT', p, b || {}),
  async upload(file) {
    const fd = new FormData();
    fd.append('file', file);
    return (await request('POST', '/uploads', fd)).file;
  },
  postForm: (p, fd) => request('POST', p, fd),
  async text(path) { return (await request('GET', path, null, { raw: true })).text(); },
  async blobUrl(path) {
    const res = await request('GET', path, null, { raw: true });
    return URL.createObjectURL(await res.blob());
  },
  async download(path, filename) {
    const res = await request('GET', path, null, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
