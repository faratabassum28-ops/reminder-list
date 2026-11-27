// One-time helper: bring the people of the OLD standalone Lead FMS / Sales FMS over to the hub's Users page.
//
// The old apps had their own login table ("users": name, email, role admin|caller, leadName = caller name). Inside the hub, people are the
// hub's accounts. For every old person whose e-mail matches a hub account this copies the CALLER NAME and the ROLE onto that account, and
// ticks the app for them (so they can open it). Nobody is created and no password is touched: create the hub account first (Users page),
// using the same e-mail as in the old app.
//
//   cd backend
//   npm run migrate:fms-team -- --app leadfms  --from "mongodb+srv://USER:PASS@host/lead_fms"  --dry-run
//   npm run migrate:fms-team -- --app leadfms  --from "mongodb+srv://USER:PASS@host/lead_fms"
//   npm run migrate:fms-team -- --app salesfms --from "<old Sales FMS MONGO_URI>"
//
// --from defaults to LEADFMS_MONGO_URI / SALESFMS_MONGO_URI. Safe to run twice (it only sets values).
import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";

const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : undefined; };
const dry = process.argv.includes("--dry-run");
const APPS = { leadfms: { nameField: "leadFmsName", roleField: "leadFmsRole", env: "LEADFMS_MONGO_URI" }, salesfms: { nameField: "salesFmsName", roleField: "salesFmsRole", env: "SALESFMS_MONGO_URI" } };
const app = arg("app"), cfg = APPS[app];
if (!cfg) { console.error('Use --app leadfms or --app salesfms'); process.exit(1); }
const from = arg("from") || process.env[cfg.env];
if (!from) { console.error(`Give the old app's database with --from "<old MONGO_URI>" (or set ${cfg.env})`); process.exit(1); }

await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list", { serverSelectionTimeoutMS: 10_000 });
const old = await mongoose.createConnection(from, { serverSelectionTimeoutMS: 10_000 }).asPromise();
const people = await old.collection("users").find({}, { projection: { passwordHash: 0 } }).toArray();
console.log(`${people.length} people in the old ${app} database${dry ? " (dry run: nothing is written)" : ""}`);

let linked = 0; const noAccount = [];
for (const p of people) {
  const email = String(p.email || "").toLowerCase().trim();
  const u = email && (await User.findOne({ email }));
  if (!u) { noAccount.push(`${p.name} <${email}>`); continue; }
  const set = { [cfg.roleField]: p.role === "admin" ? "admin" : "caller" };
  if (p.leadName) set[cfg.nameField] = String(p.leadName).trim();
  const apps = Array.isArray(u.apps) ? u.apps : ["reminder", "workshop", "tickets"]; // an account without a list has the first three
  const needsApp = u.role !== "admin" && !apps.includes(app);
  console.log(`  ${dry ? "would link" : "linked"}  ${u.email}  role=${set[cfg.roleField]}${set[cfg.nameField] ? `  caller name="${set[cfg.nameField]}"` : ""}${needsApp ? `  + ${app} switched on` : ""}`);
  if (!dry) await User.updateOne({ _id: u._id }, { $set: set, ...(needsApp ? { $addToSet: { apps: { $each: [...new Set([...apps, app])] } } } : {}) });
  linked++;
}
if (noAccount.length) {
  console.log(`\n${noAccount.length} old people have NO hub account yet (create them on the Users page with the same e-mail, then run this again):`);
  noAccount.forEach((n) => console.log("  - " + n));
}
console.log(`\n${linked} linked.`);
await old.close(); await mongoose.disconnect();
