# EMI Manager — the 6th app inside Reminder List

EMI Manager (fees, EMI schedules, payments, verification, reminders, backups) now runs inside this project, next to Reminder List,
Workshop PMS, Help Tickets, Order Analytics and Certificate Studio: **one server, one deploy, one login**. Open it from the app
chooser (card "EMI Manager") or at `/emi`.

## Bring over ALL the existing EMI data

EMI Manager keeps its data on its **own database connection**, in the same `emi_*` collections the standalone app used.
Nothing is copied — this server simply reads and writes the old database.

1. In the backend environment (Render etc.) add **`EMI_MONGO_URI`** = the old EMI Manager's `MONGODB_URI`.
2. Redeploy. Students, enrolments, instalments, payments, proofs, activity log, settings and backup history are all there.

Without `EMI_MONGO_URI`, a database called `EMI_DB_NAME` (default `mysoul_emi`) on the hub's own cluster is used (starts empty).
Other new variables: `EMI_SYNC=0` (disable the Google Sheet backup scheduler on a second instance), optional `BACKUP_SHEET_URL`,
`BACKUP_SECRET`, `UPLOAD_DIR` (see `backend/.env.example`). The old `JWT_SECRET`, `CLIENT_ORIGIN` etc. are no longer needed.

## People and roles (hub login)

There is no separate EMI sign-in or password any more.
* On the hub **Users** page tick **EMI Manager** for a person and pick **Manager / CRM / Viewer** (+ "Verifies payments" for Accounts).
  Hub admins are EMI admins automatically.
* The first time a person opens EMI, they are linked to the **old EMI user with the same e-mail**, so everything they recorded stays
  under their name. Create their hub account with the same e-mail as in the old app. Old users without a hub login stay in the
  list ("no hub login yet") and keep their history; they just cannot sign in.
* Which batches a restricted CRM may see is still set inside EMI Manager → Settings → Users & roles → *Batches*.

## What changed technically

* `backend/emi/` — the EMI server as a router mounted at `/api/emi` (after hub login + the `emi` app check). Models live on their own
  connection (`src/db.js`) with the original collection names, so they never mix with the hub's. Team mirror: `src/lib/hubUsers.js`.
  Its 61 original tests pass: `cd backend && npm run test:emi`. Seed (programs/adjustments/settings): `npm run seed:emi [-- --demo]`.
* `frontend/src/emi/` — the EMI screens, unchanged in look. Styles are scoped under `.emi-scope` (`emi.css`) and the class names that
  clash with the hub's stylesheet are prefixed `emi-`, so no other app is affected. Links are served under `/emi`; light/dark follows the hub switch.
* Hub touch points: `User` model (`apps` + `emiRole`, `emiCanVerify`), `utils/access.js`, `routes/users.js`, `utils/emiTeam.js`,
  `server.js`, `AuthContext`, `App.jsx`, `Hub.jsx` card, Users page, logo, loading screen, and the "All apps" switchers of every app.

## Not verified here

No MongoDB was available in the build sandbox, so the live-database path (connecting with `EMI_MONGO_URI`, the first-login e-mail
linking) was exercised only against stand-in models. Please smoke-test once after deploy: open `/emi`, check Home numbers match the old app.


## Fixed 10-EMI plan for SUPER (matches the PMS)

The PMS gives every SUPER student the same plan: EMI 0 (upfront) then EMI 1–10. EMI Manager now enforces this:
* New enrolment, CSV import and "Restructure plan" must produce exactly **10 EMIs** for SUPER (the number box is locked at 10, rows can't be removed).
  Set per program under Settings → Programs → *Fixed EMIs*; SUPER is pinned to 10 in code, so no setting is needed. RGM stays flexible.
* Students already saved with 6/7/8 EMIs are fixed once with: `cd backend && npm run fix:emi-count` (dry run, writes `emi-normalize-report.csv`),
  then `npm run fix:emi-count -- --apply`. Paid / part-paid EMIs are untouched; the unpaid EMIs keep their combined amount and are re-split equally
  over the remaining slots, monthly. Each change is logged (plan history + activity). Anything unsafe is listed as MANUAL and left alone.
* A fixed-EMI program's limit is its fixed count: an old, lower **Max EMIs** saved on SUPER (6/7/8) no longer blocks the 10-EMI plan
  (new enrolment, import, restructure and `fix:emi-count` all use `maxEmiCount`).
