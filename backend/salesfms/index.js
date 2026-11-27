// Sales FMS, running INSIDE the Reminder List backend (one server, one deploy, one login).
// Mounted by ../server.js:
//   app.use("/api/sales-fms/intake", salesfms.publicRouter)                                    // Google Sheet ping + Razorpay: their own secrets
//   app.use("/api/sales-fms", requireAuth, requireApp("salesfms"), salesfms.router)               // everything people use: the hub's own login
// Background jobs (sheet import / write-back, daily share, WhatsApp retries, nightly snapshot) start with salesfms.start() once the database is connected.
import express from "express";
import leadRoutes from "./routes/leads.js";
import intakeRoutes from "./routes/intake.js";
import { Team } from "./team.js";
import { startJobs } from "./utils/leadService.js";
import { startSheetJobs } from "./utils/sheetSync.js";
import salesDashboardRoutes from "./salesDashboard/router.js";
import { startSalesDashboard } from "./salesDashboard/sync.js";

const router = express.Router();
// the signed-in hub account as this app sees it (role inside the app + caller name)
router.use((req, _res, next) => { req.lu = Team.luOf(req.user); next(); });
// Revenue dashboard (admins only; the router checks).
router.use("/sales-dashboard", salesDashboardRoutes);
router.use(leadRoutes);

let started = false;
export function start() {
  if (started) return;
  started = true;
  startJobs();
  startSheetJobs();
  startSalesDashboard();
}

export default { router, publicRouter: intakeRoutes, start, Team };
