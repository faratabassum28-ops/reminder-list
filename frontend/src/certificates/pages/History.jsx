import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { certApi } from "../api.js";
import { loadTemplateImage } from "../images.js";
import { useTemplates } from "../TemplatesContext.jsx";
import ChangeDialog from "../components/ChangeDialog.jsx";
import { canvasToFile } from "../export.js";
import { downloadBlob, renderCertificate, safeFileName } from "../render.js";

const PAGE = 25;
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function History() {
  const { isAdmin } = useAuth();
  const { templates } = useTemplates();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    certApi.history({ q: query, templateId, page, limit: PAGE })
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message));
  }, [query, templateId, page]);
  useEffect(load, [load]);

  const download = async (c, format) => {
    setBusy(c.id);
    try {
      const tpl = (templates || []).find((t) => t.id === c.templateId) || (await certApi.template(c.templateId));
      const img = await loadTemplateImage(tpl.imageFile);
      const canvas = document.createElement("canvas");
      await renderCertificate(canvas, img, tpl, { name: c.studentName, date: c.dateText, certId: c.certId });
      downloadBlob(await canvasToFile(canvas, format), `${safeFileName(c.studentName)}_${c.certId}.${format}`);
    } catch (e) {
      setError(e.message === "Template not found" ? "The certificate template was deleted, so it cannot be re-rendered." : e.message);
    }
    setBusy("");
  };

  const revoke = async (c) => {
    if (!window.confirm(`Remove ${c.certId} (${c.studentName} – ${c.program})? That student can then be issued this program's certificate again.`)) return;
    try { await certApi.removeCert(c.id); load(); } catch (e) { setError(e.message); }
  };

  const exportCsv = async () => {
    try {
      const { items } = await certApi.history({ q: query, templateId, page: 1, limit: 5000 });
      const head = ["Certificate ID", "Student", "Student ID", "Program", "Date on certificate", "Issued by", "Issued at"];
      const rows = items.map((c) => [c.certId, c.studentName, c.studentRef, c.program, c.dateText, c.issuedBy?.name, new Date(c.createdAt).toISOString()]);
      const csv = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
      downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), "certificate_history.csv");
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="page cs-page">
      <PageHeader
        title="Issued certificates"
        subtitle="Each student can hold one certificate per program."
        meta={<div className="cs-row cs-gap">{data && <span className="chip"><strong>{data.total}</strong> record{data.total === 1 ? "" : "s"}</span>}<button type="button" className="cs-btn" onClick={exportCsv}>Export CSV</button></div>}
      />
      {error && <p className="cs-error">{error}</p>}
      {notice && <p className="cs-ok">{notice}</p>}

      <div className="cs-row cs-gap cs-filters cs-wrap">
        <input className="cs-search cs-grow" placeholder="Search name, student ID or certificate ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="cs-select" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPage(1); }}>
          <option value="">All programs</option>
          {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="cs-panel cs-tablewrap">
        <table className="cs-table">
          <thead><tr><th>Certificate ID</th><th>Student</th><th>Program</th><th>Date</th><th>Issued by</th><th /></tr></thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id}>
                <td><code>{c.certId}</code></td>
                <td>{c.studentName}{c.studentRef && <><br /><small className="cs-muted">{c.studentRef}</small></>}</td>
                <td>{c.program}</td>
                <td>{c.dateText}<br /><small className="cs-muted">{new Date(c.createdAt).toLocaleString()}</small></td>
                <td>{c.issuedBy?.name}</td>
                <td className="cs-actions">
                  <button type="button" className="cs-btn small" disabled={busy === c.id} onClick={() => download(c, "png")}>PNG</button>
                  <button type="button" className="cs-btn small" disabled={busy === c.id} onClick={() => download(c, "pdf")}>PDF</button>
                  <button type="button" className="cs-btn small" onClick={() => setEditing(c)}>{isAdmin ? "Edit" : "Request change"}</button>
                  {isAdmin && <button type="button" className="cs-btn small danger" onClick={() => revoke(c)}>Remove</button>}
                </td>
              </tr>
            ))}
            {data && !data.items.length && <tr><td colSpan="6" className="cs-muted">No certificates found.</td></tr>}
            {!data && <tr><td colSpan="6" className="cs-muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="cs-row cs-gap cs-pager">
          <button type="button" className="cs-btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="cs-muted">Page {data.page} of {data.pages}</span>
          <button type="button" className="cs-btn small" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {editing && (
        <ChangeDialog cert={editing} isAdmin={isAdmin} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); setNotice(msg); load(); }} />
      )}
    </div>
  );
}
