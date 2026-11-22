// The two courier-booking providers an order can be shipped through. Chosen by the packing team when the packing slip is marked done.
// Pure: no database, no network.
const PROVIDERS = ['shipway', 'shiprocket'];
const PROVIDER_LABEL = { shipway: 'Shipway', shiprocket: 'Shiprocket' };
const DEFAULT_PROVIDER = 'shipway'; // orders that were already past the slip step before Shiprocket existed were all Shipway

const isProvider = (p) => PROVIDERS.includes(String(p || '').toLowerCase());
const norm = (p) => (isProvider(p) ? String(p).toLowerCase() : null);
// The provider of a DeskOrder: what the team chose, else Shipway (older orders).
const providerOf = (doc) => norm(doc && doc.dq && doc.dq.provider && doc.dq.provider.name) || DEFAULT_PROVIDER;
const labelOf = (p) => PROVIDER_LABEL[norm(p) || DEFAULT_PROVIDER];

module.exports = { PROVIDERS, PROVIDER_LABEL, DEFAULT_PROVIDER, isProvider, norm, providerOf, labelOf };
