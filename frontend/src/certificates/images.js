import { fetchImageBlob } from "./api.js";

// Template images need the sign-in header, so they are fetched as blobs and shown through object URLs.
// An image id never changes (replacing an image stores a new id), so caching by id is safe.

// ---- small thumbnails (gallery, sidebar) ----
// A full certificate can be several MB; thumbnails are shrunk once and only a few are fetched at a time.
const thumbs = new Map(); // ref -> Promise<string>
let active = 0;
const waiting = [];
const MAX_PARALLEL = 3;
const pump = () => {
  while (active < MAX_PARALLEL && waiting.length) {
    active++;
    waiting.shift()();
  }
};
const slot = () => new Promise((resolve) => { waiting.push(resolve); pump(); });
const release = () => { active--; pump(); };

function shrink(blob, maxW) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const cx = c.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("thumb"))), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("thumb")); };
    img.src = url;
  });
}

export function thumbUrl(ref, maxW = 420) {
  if (!thumbs.has(ref)) {
    const p = (async () => {
      await slot();
      try { return await shrink(await fetchImageBlob(ref), maxW); } finally { release(); }
    })();
    p.catch(() => thumbs.delete(ref)); // let a later attempt retry
    thumbs.set(ref, p);
  }
  return thumbs.get(ref);
}

// ---- full-resolution image (editor, generator, downloads) ----
const FULL_KEEP = 3;
const full = new Map(); // ref -> Promise<HTMLImageElement>  (insertion order = recency)

export function loadTemplateImage(ref) {
  if (full.has(ref)) {
    const p = full.get(ref);
    full.delete(ref);
    full.set(ref, p); // mark as most recent
    return p;
  }
  const p = (async () => {
    const url = URL.createObjectURL(await fetchImageBlob(ref));
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load certificate image"));
        img.src = url;
      });
    } finally {
      // the decoded bitmap stays usable after the URL is released
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  })();
  p.catch(() => full.delete(ref));
  full.set(ref, p);
  while (full.size > FULL_KEEP) full.delete(full.keys().next().value);
  return p;
}

// Drops everything (called when leaving the app so big images don't stay in memory).
export function clearImageCaches() {
  thumbs.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
  thumbs.clear();
  full.clear();
}
