import express from "express";
import multer from "multer";
import path from "path";
import CertTemplate from "../models/CertTemplate.js";
import { requireAdmin } from "../../middleware/auth.js";
import { saveImage, deleteImage } from "../storage.js";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

// Images are held in memory just long enough to be written to MongoDB (GridFS).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Only PNG, JPG or WEBP images are allowed"), { status: 400 }));
  },
});

// Mounted behind the hub's requireAuth + requireApp("certificates"):
// everyone with the app can list/get; only hub admins can change.
const router = express.Router();

const defaultFields = () => [
  { key: "name", label: "Name", x: 0.5, y: 0.5, fontFamily: "Great Vibes", fontSize: 0.06, color: "#1a1a1a", align: "center", bold: false, maxWidth: 0.6 },
  { key: "date", label: "Date", x: 0.5, y: 0.75, fontFamily: "Montserrat", fontSize: 0.02, color: "#1a1a1a", align: "center", bold: false, maxWidth: 0.3 },
  { key: "certId", label: "Certificate ID", x: 0.85, y: 0.94, fontFamily: "Montserrat", fontSize: 0.012, color: "#1a1a1a", align: "right", bold: false, maxWidth: 0.25 },
];

const CODE_PREFIX = "CS-";
const formatCode = (n) => CODE_PREFIX + String(n).padStart(4, "0");

// Highest numeric part among existing codes (CS-0007 -> 7).
async function maxCodeNumber() {
  const rows = await CertTemplate.find({ code: { $exists: true, $ne: null } }, "code").lean();
  return rows.reduce((m, r) => {
    const n = parseInt(String(r.code).replace(CODE_PREFIX, ""), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
}

// Give every template that has no ID yet the next number, oldest first.
async function backfillCodes() {
  const missing = await CertTemplate.find({ $or: [{ code: { $exists: false } }, { code: null }] })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();
  if (!missing.length) return;
  let n = await maxCodeNumber();
  for (const t of missing) {
    n += 1;
    await CertTemplate.updateOne({ _id: t._id }, { $set: { code: formatCode(n) } }, { timestamps: false });
  }
}

// `fields` arrives as a JSON string (multipart) or a plain array (JSON body).
function parseFields(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw Object.assign(new Error("The text layout could not be read. Please try saving again."), { status: 400 });
  }
}

router.get("/", async (req, res, next) => {
  try {
    await backfillCodes();
    res.json(await CertTemplate.find().sort({ createdAt: -1 }));
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    await backfillCodes();
    const item = await CertTemplate.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Template not found" });
    res.json(item);
  } catch (e) { next(e); }
});

router.post("/", requireAdmin, upload.single("image"), async (req, res, next) => {
  let imageRef = null;
  try {
    if (!req.file) return res.status(400).json({ error: "Image is required" });
    const width = Number(req.body.width);
    const height = Number(req.body.height);
    if (!width || !height) return res.status(400).json({ error: "Image width/height missing" });

    imageRef = await saveImage(req.file.buffer, req.file.mimetype, req.file.originalname);
    await backfillCodes();
    const code = formatCode((await maxCodeNumber()) + 1);
    const item = await CertTemplate.create({
      code,
      name: (req.body.name || "").trim() || path.parse(req.file.originalname).name,
      imageFile: imageRef,
      width,
      height,
      fields: defaultFields(),
    });
    res.status(201).json(item);
  } catch (e) {
    await deleteImage(imageRef);
    next(e);
  }
});

// Edit: rename, change layout/colours, and optionally replace the image.
router.put("/:id", requireAdmin, upload.single("image"), async (req, res, next) => {
  let newRef = null;
  try {
    const item = await CertTemplate.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Template not found" });

    if (typeof req.body.name === "string" && req.body.name.trim()) item.name = req.body.name.trim();
    if (req.body.fields) item.fields = parseFields(req.body.fields);

    let oldRef = null;
    if (req.file) {
      const width = Number(req.body.width);
      const height = Number(req.body.height);
      if (!width || !height) return res.status(400).json({ error: "Image width/height missing" });
      newRef = await saveImage(req.file.buffer, req.file.mimetype, req.file.originalname);
      oldRef = item.imageFile;
      item.imageFile = newRef;
      item.width = width;
      item.height = height;
    }

    await item.save();
    if (oldRef) await deleteImage(oldRef);
    res.json(item);
  } catch (e) {
    await deleteImage(newRef);
    next(e);
  }
});

router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const item = await CertTemplate.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Template not found" });
    await deleteImage(item.imageFile);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
