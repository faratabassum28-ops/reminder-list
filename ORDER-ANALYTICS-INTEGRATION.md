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
