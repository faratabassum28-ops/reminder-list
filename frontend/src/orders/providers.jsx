import React from 'react';

// The services an order can be booked and tracked through. The packing team picks one when the packing slip is marked done.
// To add another service on the screen, add its key here (and in PROVIDER_META). Every picker, tab, board and badge in the
// Dispatch queue is built from this list, so nothing else on the page needs to change.
export const PROVIDERS = ['shipway', 'shiprocket'];
export const PROVIDER_META = {
  shipway: { label: 'Shipway', color: '#2f6fcb', soft: '#e6f0fb', ink: '#1b4f8f', hint: 'AWB, manifest and tracking from Shipway' },
  shiprocket: { label: 'Shiprocket', color: '#8a4fd6', soft: '#f1e9fb', ink: '#5b2a99', hint: 'AWB, manifest and tracking from Shiprocket' },
};
const FALLBACK = { label: '', color: '#5b6770', soft: '#eef1f3', ink: '#3a444b', hint: '' };
export const providerMeta = (p) => ({ ...FALLBACK, ...(PROVIDER_META[p] || {}), label: (PROVIDER_META[p] && PROVIDER_META[p].label) || p || 'Shipway' });
export const PROVIDER_LABEL = Object.fromEntries(Object.keys(PROVIDER_META).map((k) => [k, PROVIDER_META[k].label]));
export const providerLabel = (p) => PROVIDER_LABEL[p] || (p ? String(p).charAt(0).toUpperCase() + String(p).slice(1) : PROVIDER_LABEL.shipway);
// Inline CSS variables so one stylesheet colours every service, including ones added later.
export const providerStyle = (p) => { const m = providerMeta(p); return { '--pc': m.color, '--pc-soft': m.soft, '--pc-ink': m.ink }; };

// The coloured tag shown on every card after the choice (blue = Shipway, purple = Shiprocket). Nothing is shown while no choice was made.
export function ProviderBadge({ provider, title }) {
  if (!provider) return null;
  return <span className={`prov-tag ${provider}`} style={providerStyle(provider)} title={title || `Ships through ${providerLabel(provider)}`}>{providerLabel(provider)}</span>;
}
