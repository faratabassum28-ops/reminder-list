import React, { useEffect, useRef, useState } from "react";
import { thumbUrl } from "../images.js";

// Certificate thumbnail: loads only when scrolled into view, and degrades gracefully if the image file is missing.
export default function Thumb({ imageRef, alt = "" }) {
  const box = useRef(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState("");
  const [bad, setBad] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return undefined;
    if (!("IntersectionObserver" in window)) { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !imageRef) return undefined;
    let live = true;
    setBad(false);
    setSrc("");
    thumbUrl(imageRef).then((u) => live && setSrc(u)).catch(() => live && setBad(true));
    return () => { live = false; };
  }, [visible, imageRef]);

  if (bad) return <div className="cs-thumb-missing" title="Image file missing — open Edit and replace the image">⚠ missing</div>;
  return (
    <div className="cs-thumb-box" ref={box}>
      {src ? <img src={src} alt={alt} /> : <span className="cs-thumb-skel" aria-hidden="true" />}
    </div>
  );
}
