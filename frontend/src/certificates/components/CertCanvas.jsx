import React, { useEffect, useRef } from "react";
import { renderCertificate, PREVIEW_LONG_EDGE } from "../render.js";

// Sharp on-screen preview of a certificate (rendered at up to 1800px, upscaled if the template is small).
export default function CertCanvas({ img, template, values }) {
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (ref.current && img) {
      renderCertificate(ref.current, img, template, values, { maxWidth: PREVIEW_LONG_EDGE, shouldCancel: () => cancelled });
    }
    return () => { cancelled = true; };
  }, [img, template, values]);

  return <canvas ref={ref} className="cs-canvas" />;
}
