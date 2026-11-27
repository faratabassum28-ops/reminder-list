# Lead FMS and Sales FMS inside the Reminder List (7th and 8th app)

| | Lead FMS | Sales FMS |
|---|---|---|
| App id (Users page / `User.apps`) | `leadfms` | `salesfms` |
| Website | `/lead-fms` | `/sales-fms` (revenue dashboard at `/sales-fms/revenue`) |
| API | `/api/lead-fms` | `/api/sales-fms` |
| Public entry points (own secret, above the login) | `/api/lead-fms/intake/sheet`, `/intake/payment` | `/api/sales-fms/intake/sheet`, `/intake/payment` |
| Code | `backend/leadfms`, `frontend/src/leadfms` | `backend/salesfms`, `frontend/src/salesfms` |
| Data | `LEADFMS_MONGO_URI` or database `mysoul_leadfms` | `SALESFMS_MONGO_URI` or database `mysoul_salesfms` |

## What changed compared with the standalone apps
- **One login.** The separate sign-in and the apps' own user tables are gone. People are the hub's accounts: tick **Lead FMS** / **Sales FMS** for a person on the Users page.
- **Roles.** Hub admins are admins inside both apps. Anyone else is a **Caller** (sees only leads assigned to their caller name) unless given the app's **Admin** role on the Users page (or on the app's Team page).
- **Caller name** (what "Assigned To" in the sheet must match; blank = account name) is set on the Users page or the app's Team page. The Team page no longer creates logins or passwords.
- **Separate data.** Both apps use the collection names `leads`, `configs`... so each has its own database connection; nothing is shared with the other apps or with each other.
- **Look.** Lead FMS keeps the Reminder List look. Sales FMS keeps its teal theme, scoped to its own screens only (`.salesfms-scope`).
- Every app's sidebar has an **All apps** button (and the chooser, loading screens, Admin Settings and Users filters know about both).

## Moving your existing data and team (one time)
1. In `backend/.env` set `LEADFMS_MONGO_URI` / `SALESFMS_MONGO_URI` to the **old standalone MONGO_URI** (including the database name). Nothing is copied; the hub just reads and writes it. Leave blank to start empty.
2. Create each person on the Users page with the same e-mail they used in the old app, then:
   `cd backend && npm run migrate:fms-team -- --app leadfms --from "<old URI>" --dry-run` (drop `--dry-run` to apply). Same with `--app salesfms`.
   It copies caller name + role onto the matching hub account and switches the app on for them. Passwords are not copied (they use their hub password).
3. Open Settings in each app and check the Google Sheet link, secret key and integrations (all stored in the old database, so they come across).

## Environment variables
See the new block at the end of `backend/.env.example`. Razorpay (`RAZORPAY_WEBHOOK_SECRET`, `INTAKE_SECRET`) belongs to Lead FMS; Sales FMS uses `SALESFMS_`-prefixed versions. The AiSensy key is shared (`AISENSY_API_KEY`) unless overridden per app. **Webhook / Apps Script URLs change** to the new `/api/lead-fms/intake/...` paths: regenerate the Apps Script from each app's Settings and update the Razorpay webhook URL.
Background jobs start with the server; `LEADFMS_SYNC=0` / `SALESFMS_SYNC=0` turn them off on a second instance.

## Tests
`npm run test:leadfms`, `npm run test:salesfms` (no database needed). The end-to-end flow tests need a MongoDB: `FLOW_TEST_MONGO_URI=mongodb://127.0.0.1:27017/lead_flow_test npm run test:leadfms:flow` (and `test:salesfms:flow`).
