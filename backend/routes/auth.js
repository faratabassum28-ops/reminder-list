import express from "express";
import User from "../models/User.js";
import { hashPassword, comparePassword, signToken } from "../utils/auth.js";
import { requireAuth, clearAuthCache } from "../middleware/auth.js";
import { appsOf, certRoleOf, fmsRoleOf } from "../utils/access.js";

// The profile the frontend keeps. `theme` is null until the person has picked light or dark (they are asked once, on first sign-in).
const publicUser = (u) => ({
  id: u._id, name: u.name, email: u.email, role: u.role, slackId: u.slackId, createdAt: u.createdAt,
  canRequestWorkshops: !!u.canRequestWorkshops, apps: appsOf(u), certRole: certRoleOf(u),
  leadFmsRole: fmsRoleOf(u, "leadFmsRole"), leadFmsName: u.leadFmsName || "", salesFmsRole: fmsRoleOf(u, "salesFmsRole"), salesFmsName: u.salesFmsName || "", theme: u.theme === "dark" || u.theme === "light" ? u.theme : null,
});

const router = express.Router();

// Public — no requireAuth. Checks email + password, returns a token good
// for 30 days. There's no self-registration here on purpose: accounts are
// created by an admin (Users page), not signed up for.
router.post("/login", async (req, res) => {
  try {
    const email = (req.body?.email || "").toLowerCase().trim();
    const password = req.body?.password || "";
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user || user.active === false) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restores a session on page reload — the frontend calls this once on
// load if it has a stored token, to confirm it's still valid and fetch
// the current user's name/role.
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Self-service profile edit — name and Slack ID only (not email, role, or
// active status; those stay admin-only via the Users page).
router.put("/me", requireAuth, async (req, res) => {
  try {
    const { name, slackId } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Name can't be empty" });
      updates.name = name.trim();
    }
    if (slackId !== undefined) updates.slackId = slackId.trim();
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select("-passwordHash");
    clearAuthCache();
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Light or dark mode, chosen by the person (the one-time "which do you prefer?" question, and every switch after it).
// Saved on the account so it follows them to every phone and computer.
router.put("/theme", requireAuth, async (req, res) => {
  const theme = req.body?.theme;
  if (theme !== "light" && theme !== "dark") return res.status(400).json({ error: "Theme must be light or dark" });
  try {
    await User.findByIdAndUpdate(req.user._id, { theme });
    clearAuthCache();
    res.json({ theme });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Self-service password change — available to every signed-in user for
// their own account, admin or not.
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = await User.findById(req.user._id);
    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    clearAuthCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
