import express from "express";
import User from "../models/User.js";
import { getSettings } from "../models/Settings.js";
import { clearAuthCache } from "../middleware/auth.js";
import { ALL_APPS, storedAppsOf, cleanOrdersRoles, cleanEmiRole, certRoleOf, fmsRoleOf, setDisabledApps, getDisabledApps } from "../utils/access.js";

// Overall (all eight apps) admin settings. Mounted behind requireAuth + requireAdmin in server.js, so nothing here is reachable by a
// non-admin, whatever the frontend shows.
const router = express.Router();

// One screen's worth of numbers: for every app, is it on, how many people may open it, and how those people split across its roles.
router.get("/overview", async (req, res) => {
  try {
    const [users, settings] = await Promise.all([User.find().select("-passwordHash").lean(), getSettings()]);
    const disabled = settings.appsDisabled || [];
    const active = users.filter((u) => u.active !== false);
    const apps = {};
    for (const id of ALL_APPS) {
      const withApp = active.filter((u) => storedAppsOf(u).includes(id));
      apps[id] = { id, enabled: !disabled.includes(id), people: withApp.length, admins: withApp.filter((u) => u.role === "admin").length, roles: {} };
    }
    const members = (id) => active.filter((u) => u.role !== "admin" && storedAppsOf(u).includes(id));
    // Order Analytics: Confirmation / Dispatch / Admin (hub admins count as Admin).
    const o = { confirmation: 0, packing: 0, admin: apps.orders.admins };
    for (const u of members("orders")) for (const r of cleanOrdersRoles(u.ordersRoles) || []) o[r] += 1;
    apps.orders.roles = o;
    // Certificate Studio: Admin / Issuer.
    const c = { admin: apps.certificates.admins, issuer: 0 };
    for (const u of members("certificates")) c[certRoleOf(u)] += 1;
    apps.certificates.roles = c;
    // EMI Manager: Admin / Manager / CRM / Viewer.
    const e = { Admin: apps.emi.admins, Manager: 0, CRM: 0, Viewer: 0 };
    for (const u of members("emi")) e[cleanEmiRole(u.emiRole) || "Viewer"] += 1;
    apps.emi.roles = e;
    // Lead FMS / Sales FMS: Admin / Caller.
    for (const [id, field] of [["leadfms", "leadFmsRole"], ["salesfms", "salesFmsRole"]]) {
      const r = { Admin: apps[id].admins, Caller: 0 };
      for (const u of members(id)) r[fmsRoleOf(u, field) === "admin" ? "Admin" : "Caller"] += 1;
      apps[id].roles = r;
    }
    apps.workshop.roles = { Approver: apps.workshop.admins, Coordinator: members("workshop").filter((u) => u.canRequestWorkshops).length };
    apps.workshop.roles["Task owner"] = members("workshop").length - apps.workshop.roles.Coordinator;
    apps.reminder.roles = { Admin: apps.reminder.admins, Member: members("reminder").length };
    apps.tickets.roles = { Admin: apps.tickets.admins, Member: members("tickets").length };
    const themes = { dark: 0, light: 0, notAsked: 0 };
    for (const u of active) themes[u.theme === "dark" ? "dark" : u.theme === "light" ? "light" : "notAsked"] += 1;
    res.json({ totalPeople: users.length, activePeople: active.length, apps, themes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch an app on or off for everybody (admins can always still open it). Takes effect straight away: the next request from anyone
// else is refused, and their app chooser no longer shows it.
router.put("/apps/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ALL_APPS.includes(id)) return res.status(404).json({ error: "Unknown app" });
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    const settings = await getSettings();
    const next = new Set(settings.appsDisabled || []);
    if (req.body.enabled) next.delete(id); else next.add(id);
    settings.appsDisabled = ALL_APPS.filter((a) => next.has(a));
    await settings.save();
    setDisabledApps(settings.appsDisabled);
    clearAuthCache();
    res.json({ id, enabled: req.body.enabled, appsDisabled: getDisabledApps() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
