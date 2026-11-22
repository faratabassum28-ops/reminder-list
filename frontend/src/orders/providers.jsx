import React from 'react';

// The two services an order can be booked and tracked through. The packing team picks one when the packing slip is marked done.
export const PROVIDERS = ['shipway', 'shiprocket'];
export const PROVIDER_LABEL = { shipway: 'Shipway', shiprocket: 'Shiprocket' };
export const providerLabel = (p) => PROVIDER_LABEL[p] || PROVIDER_LABEL.shipway;

// The coloured tag shown on every card after the choice (blue = Shipway, purple = Shiprocket). Nothing is shown while no choice was made.
export function ProviderBadge({ provider, title }) {
  if (!provider) return null;
  return <span className={`prov-tag ${provider}`} title={title || `Ships through ${providerLabel(provider)}`}>{providerLabel(provider)}</span>;
}
