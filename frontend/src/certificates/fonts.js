// Certificate text is drawn on a canvas, so the fonts must be loaded in the page first. They are only needed inside
// Certificate Studio, so the stylesheet is added the first time it is opened instead of slowing down every other app.
const HREF =
  "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Playfair+Display:wght@400;700&family=Poppins:wght@400;700&display=swap";

let ready = null;

// Resolves once the font stylesheet has loaded (or failed / timed out: drawing then falls back to a system font).
export function ensureFonts() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (typeof document === "undefined") return resolve();
    const link = document.createElement("link");
    link.id = "cs-fonts";
    link.rel = "stylesheet";
    link.href = HREF;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
    setTimeout(resolve, 8000);
  });
  return ready;
}
