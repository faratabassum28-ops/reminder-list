# Certificate Studio — now the 5th app INSIDE this project

One repo, one backend, one deploy, **one login**. The standalone Certificate Studio server, its own login and its own
Vercel/Render setup are no longer needed.

| Where | What |
|---|---|
| `frontend/src/certificates/` | the screens (opened at `/certificates`, same layout as Help Tickets / Workshop PMS, follows the hub's light + dark theme) |
| `backend/certificates/` | the API, mounted at `/api/certificates/*` |
| `backend/certificates/migrate-standalone.js` | one-time copy of an existing standalone database (see below) |

## Access and roles — managed on the hub's **Users** page
- Tick **Certificate Studio** for a person. It is opt-in: existing accounts do **not** get it automatically.
- **Hub admin = Certificate Studio admin**: upload / edit / delete templates, edit or remove issued certificates, approve or reject change requests.
- **Any other person with the app = coordinator**: pick a certificate, issue single or bulk (PNG / PDF / ZIP), re-download, and *request* a change.
- The old Certificate Studio **Team** page and its separate sign-up are gone: people, passwords and roles live in one place.
- The app chooser card shows live numbers: pending change requests (admins: all, others: their own) or "N issued this month".

## Data
Stored in the hub's own database: `cert_templates`, `cert_issued`, `cert_change_requests` and the `certimages` GridFS bucket
(template images). Nothing else is touched. Template images are private: they are only served with the hub's login token.
Rules are unchanged and enforced by the database: **one certificate per student per program** (race-safe unique index);
issued certificates change only through an admin-approved change request.

## Moving your existing Certificate Studio data (once, optional)
Only needed if the old app has templates / history you want to keep.
1. In the hub, **Users**: create (or already have) an account with the *same e-mail* for each old person, tick Certificate Studio.
2. `cd backend && npm install`
3. Try it without writing anything, then run it for real (old = the old app's `MONGODB_URI`, new = this project's `MONGO_URI` from `.env`):
```
npm run migrate:certificates -- --from "mongodb+srv://USER:PASS@host/certificate-generator" --dry-run
npm run migrate:certificates -- --from "mongodb+srv://USER:PASS@host/certificate-generator"
```
It copies templates, their images, issued certificates and change requests, keeping every id. "Issued by / requested by"
are re-pointed to the hub account with the same e-mail (people without one keep their old name as written, and are listed).
Template IDs (`CS-0001`…) already in use here are renumbered and reported. Existing records are never overwritten, so running it twice is harmless.
Images uploaded by *very* old versions to the server's disk (`server/uploads/`) are not in the database: open **Edit** on such a template and replace its image.

## Setup / deploy
- `cd frontend && npm install` (new packages: `jspdf`, `jszip`; both load only when a PDF / ZIP is actually made), `cd ../backend && npm install` (no new packages).
- **No new environment variables.** Fonts come from Google Fonts and load only when Certificate Studio is opened.
- Retire the old Certificate Studio Render service / Vercel project once you have checked everything here.

## Tests run during the integration
Against a real MongoDB and the real hub server: 107 API checks (permissions per role, upload / replace / delete with images,
duplicate guard including 8 simultaneous requests, change-request workflow, history search, summary, 41 MB upload refusal,
Users page accepting the new app) and 24 browser checks (app chooser, upload → place → issue → PNG / PDF / ZIP, duplicate warning,
light/dark, coordinator restrictions, redirect for people without the app). The migration was run on a simulated old database.
The existing Order Analytics suite gives the same result as before (239 / 244; the same 5 tests fail in the untouched original).
