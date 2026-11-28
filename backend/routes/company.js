import express from "express";
import { companyPerformance, RANGES } from "../utils/companyPerformance.js";

// Company-wide Team Performance for the hub. ONLY the people named below may open it: Nitin (company manager) and Fara.
// This is a real permission check on the server (the hub also hides the section from everybody else, but hiding is not security).
// Override with COMPANY_VIEW_EMAILS=a@x.com,b@y.com in backend/.env if it ever has to change.
export const COMPANY_VIEWERS = (process.env.COMPANY_VIEW_EMAILS || "fara.tabassum09@gmail.com,nitin@mysoulschool.in")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
export const canViewCompany = (user) => !!user && user.active !== false && COMPANY_VIEWERS.includes(String(user.email || "").trim().toLowerCase());

export function requireCompanyViewer(req, res, next) {
  if (!canViewCompany(req.user)) return res.status(403).json({ error: "Company Team Performance is only for the company managers" });
  next();
}

const router = express.Router();
router.get("/team-performance", async (req, res) => {
  try {
    const range = RANGES[req.query.range] ? String(req.query.range) : "week";
    res.json(await companyPerformance(range));
  } catch (err) {
    console.error("[company] team performance failed:", err);
    res.status(500).json({ error: "Could not load Team Performance right now" });
  }
});
export default router;
