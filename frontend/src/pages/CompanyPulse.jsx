import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import "./companypulse.css";

// Company-wide Team Performance on the hub. Built to be understood in one glance:
//   1. one big score + one plain verdict ("On track" / "Needs attention" / "Falling behind")
//   2. one tile per team, coloured by how it is doing, worst problems first in "Needs attention"
//   3. the people to thank and the people to talk to
// Shown to the company managers only (see utils/companyView.js); the server enforces it too.

const RANGES = [["today", "Today"], ["week", "This week"], ["month", "This month"]];
const GRADE_LABEL = { excellent: "Excellent", good: "On track", fair: "Needs attention", poor: "Falling behind", none: "No data yet" };
const toneOf = (g) => (g === "excellent" || g === "good" ? "good" : g === "fair" ? "warn" : g === "poor" ? "bad" : "none");

function Delta({ delta, label }) {
  if (delta == null) return <span className="cp-delta cp-delta-none">no {label} to compare</span>;
  if (delta === 0) return <span className="cp-delta cp-delta-flat">▬ same as {label}</span>;
  return <span className={"cp-delta " + (delta > 0 ? "cp-delta-up" : "cp-delta-down")}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} pt{Math.abs(delta) === 1 ? "" : "s"} vs {label}</span>;
}

function Gauge({ score, grade }) {
  const R = 62, C = 2 * Math.PI * R, shown = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className={"cp-gauge cp-" + toneOf(grade)} role="img" aria-label={score == null ? "No score yet" : `Company score ${score} out of 100`}>
      <svg viewBox="0 0 150 150" width="168" height="168">
        <circle className="cp-gauge-track" cx="75" cy="75" r={R} fill="none" strokeWidth="13" />
        <circle className="cp-gauge-arc" cx="75" cy="75" r={R} fill="none" strokeWidth="13" strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * C} ${C}`} transform="rotate(-90 75 75)" />
      </svg>
      <div className="cp-gauge-num"><b>{score == null ? "—" : score}</b><span>out of 100</span></div>
    </div>
  );
}

function Bar({ score, grade }) {
  return <span className={"cp-bar cp-" + toneOf(grade)}><i style={{ width: `${score == null ? 0 : Math.max(score, 3)}%` }} /></span>;
}

function AppTile({ a, prevLabel, onOpen }) {
  const [open, setOpen] = useState(false);
  const tone = toneOf(a.grade);
  return (
    <article className={"cp-tile cp-" + tone} style={{ "--app": a.tone }}>
      <header className="cp-tile-head">
        <h3>{a.name}</h3>
        <span className={"cp-status cp-" + tone}>{a.off ? "Off" : GRADE_LABEL[a.grade]}</span>
      </header>
      <div className="cp-tile-score">
        <b>{a.score == null ? "—" : a.score}</b>{a.score != null && <small>/100</small>}
        <Delta delta={a.delta} label={prevLabel} />
      </div>
      <Bar score={a.score} grade={a.grade} />
      <p className="cp-tile-sum">{a.summary}</p>
      {a.metrics.length > 0 && (
        <dl className="cp-metrics">
          {a.metrics.map((m) => (
            <div key={m.label} className={m.tone ? "cp-m-" + m.tone : ""}><dt>{m.label}</dt><dd>{typeof m.value === "number" ? m.value.toLocaleString("en-IN") : m.value}</dd></div>
          ))}
        </dl>
      )}
      <footer className="cp-tile-foot">
        {a.people.length > 0
          ? <button type="button" className="cp-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide people" : `People (${a.people.length})`}</button>
          : <span />}
        <button type="button" className="cp-link cp-link-strong" onClick={() => onOpen(a.to)}>Open →</button>
      </footer>
      {open && (
        <ul className="cp-people">
          {a.people.map((p) => (
            <li key={p.name} title={p.detail}>
              <span className="cp-pname">{p.name}</span>
              <Bar score={p.score} grade={p.grade} />
              <b className={"cp-pscore cp-" + toneOf(p.grade)}>{p.score == null ? "—" : p.score}</b>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PersonRow({ p, rank }) {
  return (
    <li className="cp-row" title={p.detail}>
      <span className="cp-rank">{rank}</span>
      <span className="cp-row-main"><b>{p.name}</b><small><i style={{ background: p.tone }} />{p.app} · {p.detail}</small></span>
      <b className={"cp-pscore cp-" + toneOf(p.grade)}>{p.score}</b>
    </li>
  );
}

export default function CompanyPulse({ onOpen }) {
  const [range, setRange] = useState(() => sessionStorage.getItem("cp-range") || "week");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback((r, quiet) => {
    const mine = ++seq.current;
    if (!quiet) setBusy(true);
    return api.getCompanyPerformance(r)
      .then((d) => { if (mine === seq.current) { setData(d); setError(""); } })
      .catch((e) => { if (mine === seq.current) setError(e.message || "Could not load Team Performance"); })
      .finally(() => { if (mine === seq.current) setBusy(false); });
  }, []);

  useEffect(() => { setData((d) => (d && d.range.key === range ? d : null)); load(range); }, [range, load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(range, true); }, 90000);
    return () => clearInterval(t);
  }, [range, load]);

  const pick = (k) => { sessionStorage.setItem("cp-range", k); setRange(k); };
  const c = data && data.company;
  const tone = c ? toneOf(c.grade) : "none";
  const updated = data ? new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";
  const total = c ? c.counts.excellent + c.counts.good + c.counts.fair + c.counts.poor : 0;

  return (
    <section className="cp" aria-label="Company Team Performance">
      <div className="cp-top">
        <div>
          <p className="cp-eyebrow">Company view</p>
          <h2 className="cp-title">Team Performance</h2>
        </div>
        <div className="cp-controls">
          <div className="cp-seg" role="tablist" aria-label="Period">
            {RANGES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>)}
          </div>
          <button type="button" className="cp-refresh" onClick={() => load(range)} disabled={busy} title="Refresh now" aria-label="Refresh">{busy ? "…" : "↻"}</button>
        </div>
      </div>

      {error && !data && (
        <div className="cp-empty cp-bad">{error} <button type="button" className="cp-link cp-link-strong" onClick={() => load(range)}>Try again</button></div>
      )}
      {!data && !error && (
        <div className="cp-skel" aria-busy="true"><div className="cp-skel-hero" /><div className="cp-skel-grid"><i /><i /><i /><i /></div></div>
      )}

      {data && c && (
        <>
          <div className={"cp-hero cp-" + tone}>
            <Gauge score={c.score} grade={c.grade} />
            <div className="cp-hero-text">
              <div className={"cp-verdict cp-" + tone}>{c.label}</div>
              <p className="cp-headline">{c.headline}</p>
              <div className="cp-hero-meta">
                <Delta delta={c.delta} label={data.range.prevLabel} />
                {c.people > 0 && <span className="cp-pill">{c.people} people tracked</span>}
                <span className="cp-pill">{data.range.label}</span>
              </div>
              {total > 0 && (
                <div className="cp-dist" aria-label="Teams by status">
                  <div className="cp-dist-bar">
                    {["excellent", "good", "fair", "poor"].map((g) => c.counts[g] > 0 && <i key={g} className={"cp-" + toneOf(g) + " cp-g-" + g} style={{ flex: c.counts[g] }} title={`${c.counts[g]} ${GRADE_LABEL[g]}`} />)}
                  </div>
                  <div className="cp-dist-key">
                    {["excellent", "good", "fair", "poor"].map((g) => c.counts[g] > 0 && <span key={g}><i className={"cp-" + toneOf(g) + " cp-g-" + g} />{c.counts[g]} {GRADE_LABEL[g]}</span>)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="cp-grid">
            {data.apps.map((a) => <AppTile key={a.id} a={a} prevLabel={data.range.prevLabel} onOpen={onOpen} />)}
          </div>

          <div className="cp-cols">
            <div className="cp-box cp-box-bad">
              <h3>Needs attention <small>lowest scores right now</small></h3>
              {data.attention.length === 0
                ? <p className="cp-none">Nobody is below 75. 🎉</p>
                : <ol className="cp-list">{data.attention.map((p, i) => <PersonRow key={p.appId + p.name} p={p} rank={i + 1} />)}</ol>}
            </div>
            <div className="cp-box cp-box-good">
              <h3>Top performers <small>90 and above</small></h3>
              {data.stars.length === 0
                ? <p className="cp-none">Nobody is at 90 or above yet in this period.</p>
                : <ol className="cp-list">{data.stars.map((p, i) => <PersonRow key={p.appId + p.name} p={p} rank={i + 1} />)}</ol>}
            </div>
          </div>

          <p className="cp-foot">
            Score = work done on time ÷ work due (a late finish earns half). EMI Manager is scored on calls made against the daily call target. The company score is the average of the teams above. Updated {updated}.
            <span className="cp-legend"><i className="cp-good" /> 75+ on track <i className="cp-warn" /> 50–74 needs attention <i className="cp-bad" /> under 50 falling behind</span>
          </p>
        </>
      )}
    </section>
  );
}
