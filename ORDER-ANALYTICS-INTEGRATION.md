# Order Analytics — now the 4th app INSIDE this project

One repo, one backend, one deploy, one login. Nothing else to run.

| Where | What |
|---|---|
| `frontend/src/orders/` | the Order Analytics screens (opened at `/orders`, same layout as the other apps) |
| `backend/orders/` | the Order Analytics server code (sheet / Shopify / Shipway sync, Shopify desk, NDR, RTO...), mounted at `/api/orders/*` |
| `backend/orders/test/` | its tests: `cd backend && npm run test:orders` |

- **Login:** the hub login only. Roles are set on the hub's **Users** page: tick **Order Analytics**, then the desk team(s) (Confirmation / Dispatch). Admins see everything.
- **Data:** its own database (`ORDERS_DB_NAME`, default `mysoul_orders`) so it never mixes with the Reminder List. To KEEP your old Order Analytics data, set `ORDERS_MONGO_URI` to the old server's `MONGO_URI`.
- **People already in Order Analytics:** a hub user whose e-mail starts with an existing username (or has the same full name) is linked to that login, so their history stays under their name.

## Move over (once)
1. `cd backend && npm install` (new packages: multer, exceljs, csv-parse, google-auth-library), commit the updated `package-lock.json`; `cd ../frontend && npm install` (recharts).
2. Copy the settings of the OLD Order Analytics server (Render > Environment) into the hub backend's environment — the names are the same (`SHEET_*`, `SHOPIFY_*`, `SHIPWAY_*`, `CRON_SECRET`, `SYNC_INTERVAL_MIN`...). See `backend/.env.example`. `MONGO_URI` is NOT copied: use `ORDERS_MONGO_URI` instead (or leave blank). `STAFF_TOKEN_SECRET` is no longer needed.
3. Four addresses changed (now on the hub backend, under `/api/orders`). Update where they are used:
   - Shopify app redirect URL: `https://<hub-backend>/api/orders/shopify/callback`, then Settings > Connect Shopify again if asked
   - Shopify webhooks (if used): `https://<hub-backend>/api/orders/webhook/shopify`
   - Google Sheet Apps Script (`backend/orders/apps-script/`): `SERVER_URL` = hub backend, path `/api/orders/webhook/sheet`
   - cron-job.org: `https://<hub-backend>/api/orders/cron/sync?key=<CRON_SECRET>`
4. Push. After it works, the old Order Analytics repo/service can be switched off.

Extra env: `ORDERS_SYNC=0` stops the background jobs on an instance (leave at 1 on exactly one instance).

## Shiprocket (second shipping service, next to Shipway)

Orders can now ship through **Shipway or Shiprocket**. The packing team chooses per order, and everything after that follows the choice.

**How it works on the Dispatch board**
1. **Packing slip → DONE** opens a chooser: *Shipway* or *Shiprocket*. It cannot be skipped (the server refuses a slip with no choice).
2. From then on every card (Order packed, Order handover, On hold) shows a coloured **Shipway (blue) / Shiprocket (purple)** tag and a tinted card.
3. **Order packed**: the AWB and courier are read from the order's own service.
4. **Order handover** is split in two parts: a **Shipway** half and a **Shiprocket** half. Each has its own *Create manifest* button, its own manifest groups, its own loose orders and its own courier list. Shipway and Shiprocket orders can never be handed over together.
5. **In-transit orders** show a *Service* column and a Both / Shipway / Shiprocket filter. Tracking is fetched from the service the order was booked with, and is stored in the same collection, so NDR, RTO, weight cases, funnel and the Overview work for Shiprocket orders with no extra setup.
6. Orders that were already past the slip step before this change count as **Shipway**.

**Connect Shiprocket (once)**
1. Shiprocket → Settings → API → **Add New API User** (use a different email from your main login).
2. On the server set `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` (that API user's) and redeploy. See `backend/.env.example`.
3. Order Analytics → Settings → **Shiprocket** card → *Test connection*.
4. The order number in Shiprocket must equal the Shopify order number (`2919` or `#2919` both match).

`SHIPROCKET_MOCK=1` pretends to be Shiprocket for local testing (no account needed).

**Things to check against your own Shiprocket account** (their docs are a client-rendered page, so these were written from the public API and are covered by tests with a fake Shiprocket, not a live account):
- *Order lookup* uses `GET /v1/external/orders?search=<order no.>` and accepts only the exact `channel_order_id`.
- *Tracking* uses `GET /v1/external/courier/track/awb/{awb}`; numeric statuses and text are mapped onto the same codes Shipway uses (`lib/shiprocketMap.js`).
- *Manifest* uses `POST /v1/external/manifests/generate`. Shiprocket sends back a PDF link and **no manifest id**, so the app makes its own reference (`SR-<digits from the link>`) to group the orders and keeps the link on the group ("Open manifest PDF"). If Shiprocket needs a pickup to be scheduled first, the manifest call is refused and the reason is shown on each card.
- Weights are read as **kg** (`SHIPROCKET_WEIGHT_UNIT=g` to change).

Tests: `cd backend && npm run test:orders` (new: `shiprocket.test.js`, `shiprocketSync.test.js`).

### Order packed: "Check shipping status"

One button above the Order packed cards asks Shipway / Shiprocket about **every** card at once and saves the answer on each card. It also refreshes by itself every 10 minutes for cards not checked in the last 30 minutes. Each card then says one of:

| Card says | Meaning | What to do |
|---|---|---|
| ✓ **AWB ready** | The service has made the AWB | Press DONE |
| **Waiting for the shipment** | The order is there but no shipment exists (Shiprocket status NEW) | Create it in the service (weight, size, courier), then DONE |
| **Cancelled in …** | Cancelled at the service, it will never get an AWB | *Cancel here too*, or reopen it there |
| **Not in …** | The service does not have the order | *⇄ Use the other service* |

The chips above the cards (All, AWB ready, Waiting, Cancelled, Not found, Not checked) filter the column. Nothing is created or cancelled automatically: the check only reads.
