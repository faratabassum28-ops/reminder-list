import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { certApi } from "../api.js";
import { useTemplates } from "../TemplatesContext.jsx";
import Thumb from "../components/Thumb.jsx";
import { C } from "../paths.js";

export default function Gallery() {
  const { isAdmin } = useAuth();
  const { templates, error: loadError, reload } = useTemplates();
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (templates || []).filter((t) => !n || t.name.toLowerCase().includes(n) || (t.code || "").toLowerCase().includes(n));
  }, [templates, q]);

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try {
      await certApi.removeTemplate(t.id);
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loadError) return <div className="page cs-page"><p className="cs-error">{loadError}</p></div>;
  if (!templates) return <div className="page cs-page"><p className="cs-muted">Loading…</p></div>;

  return (
    <div className="page cs-page">
      <PageHeader
        title="All certificates"
        subtitle="Pick one to issue certificates: one name or a whole list, as PNG, PDF or a ZIP."
        meta={<span className="chip"><strong>{templates.length}</strong> template{templates.length === 1 ? "" : "s"}</span>}
      />
      {error && <p className="cs-error">{error}</p>}

      {templates.length > 0 && (
        <input className="cs-search" placeholder="Search by name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      {templates.length === 0 ? (
        <div className="cs-empty">
          <p>No certificate templates yet.</p>
          {isAdmin ? <Link to={`${C}/new`} className="cs-btn primary">Upload your first certificate</Link> : <p>Ask an admin to upload one.</p>}
        </div>
      ) : list.length === 0 ? (
        <div className="cs-empty"><p>No certificate matches “{q}”.</p></div>
      ) : (
        <div className="cs-grid">
          {list.map((t) => (
            <div key={t.id} className="cs-card">
              <Link to={`${C}/t/${t.id}`} className="cs-thumb"><Thumb imageRef={t.imageFile} alt={t.name} /></Link>
              <div className="cs-card-body">
                <div className="cs-card-title">
                  <strong title={t.name}>{t.name}</strong>
                  {t.code && <code className="cs-code">{t.code}</code>}
                </div>
                <div className="cs-row cs-gap cs-wrap">
                  <Link to={`${C}/t/${t.id}`} className="cs-btn small primary">Use</Link>
                  {isAdmin && <Link to={`${C}/t/${t.id}/edit`} className="cs-btn small">Edit</Link>}
                  {isAdmin && <button className="cs-btn small danger" onClick={() => remove(t)}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
