import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { certApi } from "../api.js";
import { loadTemplateImage } from "../images.js";
import CertCanvas from "../components/CertCanvas.jsx";
import ColorField from "../components/ColorField.jsx";
import ChangeDialog from "../components/ChangeDialog.jsx";
import { canvasToFile, parseStudentLine } from "../export.js";
import { DATE_FORMATS, formatDate, renderCertificate, downloadBlob, safeFileName } from "../render.js";
import { C } from "../paths.js";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Generate() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [tpl, setTpl] = useState(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState("");

  const [mode, setMode] = useState("single");
  const [name, setName] = useState("");
  const [bulk, setBulk] = useState("");
  const [dateISO, setDateISO] = useState(today());
  const [dateFmt, setDateFmt] = useState("dmy-long");
  const [format, setFormat] = useState("png");
  const [busy, setBusy] = useState("");
  const [colors, setColors] = useState({}); // per-download colour overrides (not saved)
  const [showStyle, setShowStyle] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [studentRef, setStudentRef] = useState("");
  const [skipped, setSkipped] = useState([]); // already-issued certificates (duplicates)
  const [notice, setNotice] = useState("");
  const [changing, setChanging] = useState(null);

  useEffect(() => {
    let live = true;
    setTpl(null); setImg(null); setColors({}); setError(""); setImgFailed(false); setSkipped([]); setNotice("");
    certApi.template(id)
      .then(async (t) => {
        if (!live) return;
        setTpl(t);
        try {
          const i = await loadTemplateImage(t.imageFile);
          if (live) setImg(i);
        } catch {
          if (live) setImgFailed(true);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  // Template with any colour overrides applied
  const view = useMemo(() => tpl && { ...tpl, fields: tpl.fields.map((f) => ({ ...f, color: colors[f.key] || f.color })) }, [tpl, colors]);

  const dateText = formatDate(dateISO, dateFmt);
  const bulkStudents = useMemo(
    () => bulk.split("\n").map((s) => s.trim()).filter(Boolean).map(parseStudentLine).filter((s) => s.name),
    [bulk]
  );
  const previewValues = useMemo(
    () => ({
      name: mode === "bulk" ? bulkStudents[0]?.name || "" : name,
      date: dateText,
      certId: `CS-${new Date().getFullYear()}-XXXXXX`, // sample; the real ID is generated on download
    }),
    [mode, name, bulkStudents, dateText]
  );

  // Renders one certificate at the image's full native resolution.
  const makeCanvas = async (values) => {
    const canvas = document.createElement("canvas");
    await renderCertificate(canvas, img, view, values);
    return canvas;
  };

  const ext = format === "pdf" ? "pdf" : "png";
  const fileFor = (c) => `${safeFileName(c.studentName)}_${c.certId}.${ext}`;
  const valuesFor = (c) => ({ name: c.studentName, date: c.dateText, certId: c.certId });

  // Registers the certificates on the server first (assigns IDs, blocks duplicates, writes history).
  const issue = (students) => certApi.issue({ templateId: id, dateText, students });

  const reDownload = async (cert) => {
    setBusy("Rendering…");
    try {
      downloadBlob(await canvasToFile(await makeCanvas(valuesFor(cert)), format), fileFor(cert));
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  };

  const downloadSingle = async () => {
    if (!name.trim()) return;
    setBusy("Issuing…");
    setError(""); setNotice(""); setSkipped([]);
    try {
      const { results } = await issue([{ name, studentRef }]);
      const r = results[0];
      if (r.status === "duplicate") { setSkipped([r.certificate]); setBusy(""); return; }
      if (r.status !== "issued") throw new Error("Please enter a valid name.");
      setBusy("Rendering…");
      downloadBlob(await canvasToFile(await makeCanvas(valuesFor(r.certificate)), format), fileFor(r.certificate));
      setNotice(`Issued certificate ${r.certificate.certId} to ${r.certificate.studentName}.`);
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  };

  const downloadBulk = async () => {
    if (!bulkStudents.length) return;
    setError(""); setNotice(""); setSkipped([]);
    try {
      setBusy("Issuing…");
      const { results } = await issue(bulkStudents);
      const issued = results.filter((r) => r.status === "issued").map((r) => r.certificate);
      const dupes = results.filter((r) => r.status === "duplicate").map((r) => r.certificate);
      setSkipped(dupes);
      if (!issued.length) { setBusy(""); return; }

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let i = 0; i < issued.length; i++) {
        setBusy(`Rendering ${i + 1} of ${issued.length}…`);
        const canvas = await makeCanvas(valuesFor(issued[i]));
        zip.file(fileFor(issued[i]), await canvasToFile(canvas, format));
        await new Promise((r) => setTimeout(r)); // keep the UI responsive
      }
      setBusy("Zipping…");
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${safeFileName(tpl.name)}_certificates.zip`);
      setNotice(`Issued ${issued.length} certificate(s).${dupes.length ? ` Skipped ${dupes.length} already issued (listed below).` : ""}`);
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  };

  if (error && !tpl) return <div className="page cs-page"><p className="cs-error">{error}</p></div>;
  if (tpl && imgFailed) {
    return (
      <div className="page cs-page">
        <div className="cs-panel cs-narrow">
          <h2 className="cs-h2">{tpl.name}</h2>
          <p className="cs-error">The image file for this certificate is missing on the server.</p>
          {isAdmin
            ? <p><Link to={`${C}/t/${id}/edit`} className="cs-btn primary">Open Edit and replace the image</Link></p>
            : <p className="cs-muted">Please ask an admin to upload the image again.</p>}
        </div>
      </div>
    );
  }
  if (!view || !img) return <div className="page cs-page"><p className="cs-muted">Loading…</p></div>;

  return (
    <div className="page cs-page">
      <PageHeader
        title={tpl.name}
        subtitle={<>{tpl.code && <><code className="cs-code">{tpl.code}</code> · </>}Output size: {tpl.width} × {tpl.height} px</>}
        meta={isAdmin && <Link to={`${C}/t/${id}/edit`} className="cs-btn">Edit certificate</Link>}
      />
      {error && <p className="cs-error">{error}</p>}

      <div className="cs-editor">
        <div className="cs-stage"><CertCanvas img={img} template={view} values={previewValues} /></div>

        <aside className="cs-panel cs-side">
          <div className="cs-tabs">
            <button type="button" className={`cs-tab ${mode === "single" ? "on" : ""}`} onClick={() => setMode("single")}>Single</button>
            <button type="button" className={`cs-tab ${mode === "bulk" ? "on" : ""}`} onClick={() => setMode("bulk")}>Bulk (many names)</button>
          </div>

          {mode === "single" ? (
            <>
              <label className="cs-field">
                <span>Name on certificate</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
              </label>
              <label className="cs-field">
                <span>Student ID / email (optional)</span>
                <input value={studentRef} onChange={(e) => setStudentRef(e.target.value)} placeholder="e.g. STU-1023" />
                <small className="cs-muted">Use this to tell apart two students with the same name.</small>
              </label>
            </>
          ) : (
            <label className="cs-field">
              <span>One student per line: Name, Student ID (ID optional) — {bulkStudents.length} students</span>
              <textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Aarav Sharma, STU-1001\nFatima Khan, STU-1002\nJohn Doe"} />
            </label>
          )}

          <label className="cs-field">
            <span>Date</span>
            <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </label>

          <label className="cs-field">
            <span>Date format</span>
            <select value={dateFmt} onChange={(e) => setDateFmt(e.target.value)}>
              {DATE_FORMATS.map((f) => <option key={f.id} value={f.id}>{formatDate(dateISO || today(), f.id)}</option>)}
            </select>
          </label>

          <button type="button" className="cs-linklike" onClick={() => setShowStyle((s) => !s)}>{showStyle ? "▾" : "▸"} Text colour</button>
          {showStyle && (
            <div className="cs-style-box">
              {view.fields.map((f) => (
                <ColorField key={f.key} label={`${f.label || f.key} colour`} value={f.color} onChange={(c) => setColors((prev) => ({ ...prev, [f.key]: c }))} />
              ))}
              {Object.keys(colors).length > 0 && (
                <button type="button" className="cs-btn small" onClick={() => setColors({})}>Reset to saved colours</button>
              )}
              <small className="cs-muted">Applies to the certificates you download now. To change the saved default, use Edit.</small>
            </div>
          )}

          <label className="cs-field">
            <span>Download as</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="png">PNG (lossless, full resolution)</option>
              <option value="pdf">PDF (print ready)</option>
            </select>
          </label>

          {mode === "single" ? (
            <button type="button" className="cs-btn primary block" onClick={downloadSingle} disabled={!name.trim() || !!busy}>
              {busy || `Issue & download ${ext.toUpperCase()}`}
            </button>
          ) : (
            <button type="button" className="cs-btn primary block" onClick={downloadBulk} disabled={!bulkStudents.length || !!busy}>
              {busy || `Issue & download ${bulkStudents.length || ""} certificates (ZIP)`}
            </button>
          )}

          {notice && <p className="cs-ok">{notice}</p>}
          {skipped.length > 0 && (
            <div className="cs-warn">
              <strong>Already issued — not issued again ({skipped.length})</strong>
              <small>Each student gets one certificate per program. Download a copy of the existing one, or ask an admin to approve a change:</small>
              <ul>
                {skipped.map((c) => (
                  <li key={c.id}>
                    <span>{c.studentName}<br /><code>{c.certId}</code> · {new Date(c.createdAt).toLocaleDateString()}</span>
                    <span className="cs-row cs-gap">
                      <button type="button" className="cs-btn small" disabled={!!busy} onClick={() => reDownload(c)}>Download copy</button>
                      <button type="button" className="cs-btn small" onClick={() => setChanging(c)}>{isAdmin ? "Edit" : "Request change"}</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {changing && (
        <ChangeDialog
          cert={changing}
          isAdmin={isAdmin}
          onClose={() => setChanging(null)}
          onDone={(msg) => { setChanging(null); setSkipped([]); setNotice(msg); }}
        />
      )}
    </div>
  );
}
