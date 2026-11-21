import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader.jsx";
import { certApi } from "../api.js";
import { useTemplates } from "../TemplatesContext.jsx";
import { C } from "../paths.js";

export default function NewTemplate() {
  const nav = useNavigate();
  const { reload } = useTemplates();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [size, setSize] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pick = (f) => {
    if (!f) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setError("Please choose a PNG, JPG or WEBP image.");
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => setSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    setFile(f);
    setPreview(url);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file || !size) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("width", size.width);
      fd.append("height", size.height);
      fd.append("image", file);
      const t = await certApi.createTemplate(fd);
      await reload();
      nav(`${C}/t/${t.id}/edit`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="page cs-page">
      <PageHeader title="Upload a certificate" subtitle="Use the blank certificate: leave the name and date areas empty." />
      <form onSubmit={submit} className="cs-panel cs-narrow">
        <p className="cs-muted">Use the highest resolution you have — downloads are exported at up to 4000 px, but the artwork can only be as sharp as the file you upload.</p>
        <label className="cs-drop">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files[0])} hidden />
          {preview ? <img src={preview} alt="Preview" /> : <span>Click to choose an image (PNG / JPG / WEBP)</span>}
        </label>
        {size && <p className="cs-muted">{size.width} × {size.height} px</p>}

        <label className="cs-field">
          <span>Certificate name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workshop Participation" required />
        </label>

        {error && <p className="cs-error">{error}</p>}
        <button className="cs-btn primary" disabled={!file || !size || busy}>{busy ? "Uploading…" : "Save & position name/date"}</button>
      </form>
    </div>
  );
}
