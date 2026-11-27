// Lead FMS, running INSIDE the Reminder List backend (one server, one deploy, one login).
// Mounted by ../server.js:
//   app.use("/api/lead-fms/intake", leadfms.publicRouter)                                    // Google Sheet ping + Razorpay: their own secrets
//   app.use("/api/lead-fms", requireAuth, requireApp("leadfms"), leadfms.router)               // everything people use: the hub's own login
// Background jobs (sheet import / write-back, daily share, WhatsApp retries, nightly snapshot) start with leadfms.start() once the database is connected.
import express from "express";
import leadRoutes from "./routes/leads.js";
import intakeRoutes from "./routes/intake.js";
import { Team } from "./team.js";
import { startJobs } from "./utils/leadService.js";
import { startSheetJobs } from "./utils/sheetSync.js";

const router = express.Router();
// the signed-in hub account as this app sees it (role inside the app + caller name)
router.use((req, _res, next) => { req.lu = Team.luOf(req.user); next(); });
router.use(leadRoutes);

let started = false;
export function start() {
  if (started) return;
  started = true;
  startJobs();
  startSheetJobs();
}

export default { router, publicRouter: intakeRoutes, start, Team };
