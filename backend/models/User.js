import mongoose from "mongoose";

// Two roles:
// - "admin": everything — delete data, manage the Doer/Task catalog,
//   Settings, and other user accounts.
// - "member": can view Dashboard, Doers, Tasks, Consolidated and
//   Submissions team-wide, but Master (the reminder occurrence list) is
//   scoped to just their own Doer record's rows (matched by email) — a
//   member never sees another member's task instances there. They can
//   mark complete / edit only Master rows assigned to their own Doer
//   record. Cannot add/edit Doers or Tasks (that's catalog/setup data),
//   cannot delete anything, and cannot reach Settings or Users.
// Enforced in the route middleware, not just hidden in the UI — see
// middleware/auth.js and the per-route checks in routes/master.js,
// routes/doers.js, routes/tasks.js.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    active: { type: Boolean, default: true },
    // Optional — lets people @-mention or DM this user from Slack-integrated
    // tooling (e.g. a future "notify on Slack" reminder). Just a plain
    // member ID/handle string, not validated against Slack's API.
    slackId: { type: String, trim: true, default: "" },
    // Workshop PMS: only people with this switched on (e.g. Tanvi) — plus
    // admins — can fill the New Workshop form. Admins (e.g. Nitin) approve.
    canRequestWorkshops: { type: Boolean, default: false },
    // Which apps this account may open: "reminder" (Reminder List) and/or
    // "workshop" (Workshop PMS) and/or "tickets" (Help Tickets) and/or "orders" (Order Analytics)
    // and/or "certificates" (Certificate Studio) and/or "emi" (EMI Manager). Accounts created before this field existed
    // have no value and are treated as having the first three (see utils/access.js), so
    // nothing changes for existing people. Admins always get both.
    apps: { type: [String], enum: ["reminder", "workshop", "tickets", "orders", "certificates", "emi"], default: undefined },
    // Order Analytics ("orders" app): which desk team(s) this person works in. Admins see the whole dashboard and
    // need none. Everyone else needs at least one: "confirmation" (calls and confirms new orders) and/or
    // "packing" (the dispatch desk: slips, packing, handover).
    ordersRoles: { type: [String], enum: ["confirmation", "packing", "admin"], default: [] },
    // Certificate Studio ("certificates" app): "admin" (templates, edits, approvals) or "issuer" (issues certificates, requests changes).
    // Hub admins are always Certificate Studio admins. No value = issuer.
    certRole: { type: String, enum: ["admin", "issuer"], default: undefined },
    // Light / dark preference. null = never asked: the person is asked once, on their next sign-in, and the answer follows them to every device.
    theme: { type: String, enum: ["light", "dark"], default: null },
    // EMI Manager ("emi" app): the role inside it. Admins are EMI admins and need none. "Admin" = everything incl. users' batch
    // access and backups, "Manager" = settings, imports, discounts above the limit; "CRM" = enrol, record payments, log calls;
    // "Viewer" = read-only (Accounts can additionally be allowed to verify payments with emiCanVerify).
    emiRole: { type: String, enum: ["Admin", "Manager", "CRM", "Viewer"], default: undefined },
    emiCanVerify: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
