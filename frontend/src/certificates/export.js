import { canvasToBlob } from "./render.js";

// Turns a rendered canvas into a PNG or PDF blob. The PDF library is only downloaded when a PDF is actually asked for.
export async function canvasToFile(canvas, format) {
  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const W = canvas.width;
    const H = canvas.height;
    // Real print size: 297 mm on the long edge (A4 landscape/portrait proportions kept from the image),
    // with the full-resolution lossless image embedded, so it prints sharp.
    const long = 297;
    const pw = W >= H ? long : (long * W) / H;
    const ph = W >= H ? (long * H) / W : long;
    const pdf = new jsPDF({
      orientation: W >= H ? "landscape" : "portrait",
      unit: "mm",
      format: [pw, ph],
      compress: true,
    });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, ph, undefined, "FAST");
    return pdf.output("blob");
  }
  return canvasToBlob(canvas, "image/png");
}

// "Name, Student ID" (ID optional). Comma, tab or | separates the ID.
export function parseStudentLine(line) {
  const parts = line.split(/\t|\||,/).map((s) => s.trim());
  return { name: parts[0] || "", studentRef: parts.slice(1).join(" ").trim() };
}
