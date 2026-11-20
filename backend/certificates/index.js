// Certificate Studio, running INSIDE the Reminder List backend (one server, one deploy, one login).
// Mounted by ../server.js:
//   app.use("/api/certificates", requireAuth, requireApp("certificates"), certificates.router)
//
//   /templates   certificate templates (list/get: everyone with the app · upload/edit/delete: admins)
//   /records     issued certificates, duplicate guard, change requests
//   /image/:ref  the private template images (the hub's Bearer token is required)
//   /summary     the small numbers shown on the app chooser card
//
// Data lives in the hub's own database under cert_* collections (+ the certimages GridFS bucket).
import express from "express";
import { certRoleOf } from "../utils/access.js";
import CertTemplate from "./models/CertTemplate.js";
import CertIssued from "./models/CertIssued.js";
import CertChangeRequest from "./models/CertChangeRequest.js";
import templatesRouter from "./routes/templates.js";
import recordsRouter from "./routes/records.js";
import { serveImage, imageExists } from "./storage.js";

const router = express.Router();

router.use("/templates", templatesRouter);
router.use("/records", recordsRouter);
router.get("/image/:ref", serveImage);

// Light "what's waiting" numbers for the app chooser. Admins see the approval queue; others see their own requests.
router.get("/summary", async (req, res, next) => {
  try {
    const admin = certRoleOf(req.user) === "admin";
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [templates, issuedThisMonth, pending] = await Promise.all([
      CertTemplate.estimatedDocumentCount(),
      CertIssued.countDocuments({ createdAt: { $gte: monthStart } }),
      CertChangeRequest.countDocuments(admin ? { status: "pending" } : { status: "pending", "requestedBy.id": String(req.user._id) }),
    ]);
    res.json({ templates, issuedThisMonth, pending });
  } catch (e) { next(e); }
});

// JSON errors in the shape the screens expect ({ error }).
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 400;
  if (status >= 500) console.error("[certificates]", err);
  const message = err.code === "LIMIT_FILE_SIZE" ? "That image is larger than 40 MB. Please use a smaller file." : err.message || "Something went wrong";
  res.status(status).json({ error: message });
});

// Warn (once, after the database is up) about templates whose image is missing, e.g. migrated without their images.
async function checkImages() {
  try {
    const all = await CertTemplate.find().select("name imageFile").lean();
    const missing = [];
    for (const t of all) if (!(await imageExists(t.imageFile))) missing.push(t);
    if (missing.length) {
      console.warn(`[certificates] ${missing.length} of ${all.length} certificate image(s) are missing:`);
      missing.forEach((t) => console.warn(`  - "${t.name}" (${t.imageFile})`));
      console.warn("[certificates] Open Edit on each one and replace the image (or re-run the migration script).");
    }
  } catch { /* purely informational */ }
}

export default { router, checkImages };
