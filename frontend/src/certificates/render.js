import { ensureFonts } from "./fonts.js";

export const FONTS = [
  "Great Vibes",
  "Dancing Script",
  "Playfair Display",
  "Cinzel",
  "Cormorant Garamond",
  "Lora",
  "Montserrat",
  "Poppins",
];

export const DATE_FORMATS = [
  { id: "dmy-long", label: "10 October 2026" },
  { id: "mdy-long", label: "October 10, 2026" },
  { id: "dmy-slash", label: "10/10/2026" },
  { id: "dmy-dash", label: "10-10-2026" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// value is "YYYY-MM-DD" from <input type="date">. Parsed manually to avoid timezone shifts.
export function formatDate(value, format = "dmy-long") {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  switch (format) {
    case "mdy-long": return `${MONTHS[m - 1]} ${d}, ${y}`;
    case "dmy-slash": return `${dd}/${mm}/${y}`;
    case "dmy-dash": return `${dd}-${mm}-${y}`;
    default: return `${d} ${MONTHS[m - 1]} ${y}`;
  }
}

// Loads an image from a local (blob:) URL, e.g. a file the admin just picked.
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load certificate image"));
    img.src = src;
  });
}

const fontSpec = (f, size) => `${f.bold ? 700 : 400} ${size}px "${f.fontFamily}"`;

// Downloads are always at least this many pixels on the long edge (~A4 at 340 dpi), even if the uploaded
// template image is small. Text is drawn as vector glyphs at this size, so it stays razor sharp.
export const EXPORT_LONG_EDGE = 4000;
export const PREVIEW_LONG_EDGE = 1800;
export const LOW_RES_PX = 1800; // templates below this long edge get a "upload a bigger image" warning

// Upscales in 2x steps: much smoother than one big jump.
function drawScaled(ctx, img, W, H) {
  let cw = img.naturalWidth;
  let ch = img.naturalHeight;
  let src = img;
  while (cw * 2 < W) {
    const step = document.createElement("canvas");
    step.width = cw * 2;
    step.height = ch * 2;
    const sc = step.getContext("2d");
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = "high";
    sc.drawImage(src, 0, 0, step.width, step.height);
    src = step;
    cw = step.width;
    ch = step.height;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, W, H);
}

/**
 * Draws the certificate onto `canvas`.
 * - Default (downloads): canvas long edge = max(native, EXPORT_LONG_EDGE). Small templates are upscaled.
 * - opts.maxWidth: fast on-screen preview, long edge capped at that many px (small images are upscaled to it too,
 *   so the preview is never a stretched low-res bitmap).
 * Field coordinates are fractions of the image, so preview and download place text identically.
 * Vertical position y = the visual centre of capital letters (same for every font and every name),
 * which is what the marker in the editor shows.
 */
export async function renderCertificate(canvas, img, template, values, opts = {}) {
  const fields = template.fields.filter((f) => values[f.key]);

  await ensureFonts();
  await Promise.all(fields.map((f) => document.fonts.load(fontSpec(f, 40), values[f.key]).catch(() => null)));
  if (opts.shouldCancel && opts.shouldCancel()) return false;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const long = Math.max(nw, nh);
  const targetLong = opts.maxWidth ? Math.min(opts.maxWidth, PREVIEW_LONG_EDGE) : Math.max(long, EXPORT_LONG_EDGE);
  const scale = targetLong / long;
  const W = Math.round(nw * scale);
  const H = Math.round(nh * scale);
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  drawScaled(ctx, img, W, H);

  ctx.textRendering = "geometricPrecision";
  ctx.fontKerning = "normal";
  ctx.textBaseline = "alphabetic";

  for (const f of fields) {
    const text = String(values[f.key]);
    let size = f.fontSize * W;
    ctx.font = fontSpec(f, size);
    const maxW = f.maxWidth * W;
    const measured = ctx.measureText(text).width;
    if (measured > maxW) {
      size *= maxW / measured; // shrink long names so they never overflow
      ctx.font = fontSpec(f, size);
    }
    // Name-independent vertical centring: use the height of capitals ("H") of this font, not of this text.
    const capH = ctx.measureText("H").actualBoundingBoxAscent || size * 0.7;
    ctx.fillStyle = f.color;
    ctx.textAlign = f.align;
    ctx.fillText(text, f.x * W, f.y * H + capH / 2);
  }
  return true;
}

export function canvasToBlob(canvas, type = "image/png", quality = 0.95) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), type, quality));
}

export function safeFileName(s) {
  return String(s).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "certificate";
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
