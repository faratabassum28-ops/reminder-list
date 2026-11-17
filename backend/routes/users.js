import express from "express";
import User from "../models/User.js";
import { hashPassword } from "../utils/auth.js";
import { clearAuthCache } from "../middleware/auth.js";
import { appsOf, cleanApps, cleanOrdersRoles, ordersRolesOf } from "../utils/access.js";
import { syncOrdersTeam } from "../utils/ordersTeam.js";

// Attach the effective app list so the Users page shows legacy accounts
// (no stored value) as having both apps.
const withApps = (u) => {
  const o = u.toObject ? u.toObject() : u;
  delete o.passwordHash;
  return { ...o, apps: appsOf(o), ordersRoles: o.role === "admin" ? [] : cleanOrdersRoles(o.ordersRoles) || [] };
};

const router = express.Router();
// Every route here is mounted behind requireAuth + requireAdmin in
// server.js — nothing in this file is reachable by a non-admin.

router.get("/", async (req, res) => {
  const users = await User.find().select("-passwordHash").sort({ name: 1 }).lean();
  res.json(users.map(withApps));
});

router.post("/", async (req, res) => {
  try {
    const { name, email, password, role, slackId, canRequestWorkshops, apps, ordersRoles } = req.body;
    const cleaned = cleanApps(apps);
    const teams = cleanOrdersRoles(ordersRoles) || [];
    if (cleaned && cleaned.length === 0 && role !== "admin") return res.status(400).json({ error: "Pick at least one app" });
    if (role !== "admin" && cleaned?.includes("orders") && teams.length === 0) return res.status(400).json({ error: "Order Analytics needs a desk team: pick Confirmation and/or Dispatch" });
    if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role === "admin" ? "admin" : "member",
      slackId: slackId?.trim() || "",
      canRequestWorkshops: !!canRequestWorkshops,
      ...(cleaned ? { apps: cleaned } : {}),
      ordersRoles: teams,
    });
    clearAuthCache();
    syncOrdersTeam();
    res.status(201).json(withApps(user));
  } catch (err) {
    res.status(400).json({ error: err.code === 11000 ? "That email is already registered" : err.message });
  }
});

// Update role/active/name — and optionally reset the password (admin
// recovery for a teammate who's locked out), via an optional `password`
// field.
router.put("/:id", async (req, res) => {
  try {
    const { name, role, active, password, slackId, canRequestWorkshops, apps, ordersRoles } = req.body;
    const updates = {};
    const current = apps !== undefined || ordersRoles !== undefined || role !== undefined ? await User.findById(req.params.id).lean() : null;
    if (apps !== undefined) {
      const cleaned = cleanApps(apps);
      if (!cleaned || cleaned.length === 0) return res.status(400).json({ error: "Pick at least one app" });
      updates.apps = cleaned;
    }
    if (ordersRoles !== undefined) updates.ordersRoles = cleanOrdersRoles(ordersRoles) || [];
    // Whatever the account will look like after this save: Order Analytics must have a desk team (admins need none).
    {
      const nextRole = updates.role !== undefined ? updates.role : role !== undefined ? (role === "admin" ? "admin" : "member") : current?.role;
      const nextApps = updates.apps || (Array.isArray(current?.apps) ? current.apps : []);
      const nextTeams = updates.ordersRoles !== undefined ? updates.ordersRoles : cleanOrdersRoles(current?.ordersRoles) || [];
      if (nextRole !== "admin" && nextApps.includes("orders") && nextTeams.length === 0) {
        return res.status(400).json({ error: "Order Analytics needs a desk team: pick Confirmation and/or Dispatch" });
      }
    }
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role === "admin" ? "admin" : "member";
    if (active !== undefined) updates.active = active;
    if (slackId !== undefined) updates.slackId = slackId.trim();
    if (canRequestWorkshops !== undefined) updates.canRequestWorkshops = !!canRequestWorkshops;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      updates.passwordHash = await hashPassword(password);
    }

    // Guard: don't let the last active admin demote/deactivate themselves
    // (or be demoted) and lock everyone out of admin-only pages entirely.
    if (updates.role === "member" || updates.active === false) {
      const target = await User.findById(req.params.id);
      if (target?.role === "admin") {
        const otherActiveAdmins = await User.countDocuments({
          _id: { $ne: target._id },
          role: "admin",
          active: { $ne: false },
        });
        if (otherActiveAdmins === 0) {
          return res.status(400).json({ error: "Can't remove the last active admin" });
        }
      }
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "User not found" });
    clearAuthCache();
    syncOrdersTeam();
    res.json(withApps(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (String(target._id) === String(req.user._id)) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  if (target.role === "admin") {
    const otherActiveAdmins = await User.countDocuments({
      _id: { $ne: target._id },
      role: "admin",
      active: { $ne: false },
    });
    if (otherActiveAdmins === 0) return res.status(400).json({ error: "Can't delete the last admin" });
  }
  await User.findByIdAndDelete(req.params.id);
  clearAuthCache();
  syncOrdersTeam();
  res.json({ ok: true });
});

export default router;
