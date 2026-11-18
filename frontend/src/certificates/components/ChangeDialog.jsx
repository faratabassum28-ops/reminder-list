import React, { useState } from "react";
import { certApi, notifyChanged } from "../api.js";

// Admin: edits the certificate directly. Coordinator: sends a request that an admin must approve.
export default function ChangeDialog({ cert, isAdmin, onClose, onDone }) {
  const [form, setForm] = useState({
    studentName: cert.studentName,
    studentRef: cert.studentRef || "",
    dateText: cert.dateText || "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isAdmin) {
        const { reason, ...data } = form; // eslint-disable-line no-unused-vars
        await certApi.editCert(cert.id, data);
        notifyChanged();
        onDone("Certificate updated.");
      } else {
        await certApi.requestChange(cert.id, form);
        notifyChanged();
        onDone("Change request sent. An admin must approve it before the certificate changes.");
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="cs-modal-back" onClick={onClose}>
      <form className="cs-modal cs-panel" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="cs-h2">{isAdmin ? "Edit certificate" : "Request a change"}</h2>
        <p className="cs-muted">
          <code>{cert.certId}</code> · {cert.program}
          {!isAdmin && <><br />This certificate is already issued. It stays unchanged until an admin approves your request.</>}
        </p>
        <label className="cs-field"><span>Name</span><input value={form.studentName} onChange={set("studentName")} required autoFocus /></label>
        <label className="cs-field"><span>Student ID / email</span><input value={form.studentRef} onChange={set("studentRef")} /></label>
        <label className="cs-field"><span>Date text on certificate</span><input value={form.dateText} onChange={set("dateText")} /></label>
        {!isAdmin && (
          <label className="cs-field">
            <span>Reason for change (required)</span>
            <textarea rows={3} value={form.reason} onChange={set("reason")} required maxLength={500} placeholder="e.g. Spelling mistake in the name" />
          </label>
        )}
        {error && <p className="cs-error">{error}</p>}
        <div className="cs-row cs-gap">
          <button className="cs-btn primary" disabled={busy}>{busy ? "Saving…" : isAdmin ? "Save changes" : "Send request"}</button>
          <button type="button" className="cs-btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
