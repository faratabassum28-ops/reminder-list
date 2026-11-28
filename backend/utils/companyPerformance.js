// Company-wide Team Performance: one look at how every team is doing, across every app.
// Read-only. Shown on the hub to the company managers only (see routes/company.js).
//
// Every app answers the same question in its own way, and each answer is turned into the same shape:
//   score 0-100 (null = nothing was due in the period), grade, a few numbers, and the people behind it.
//     Reminder List / Workshop PMS   tasks done on time / tasks due
//     Help Tickets                   tickets resolved by their planned time (late = half a point, still open and overdue = none)
//     Order Analytics                the task scorecard of Order Analytics > Team Performance
//     EMI Manager                    calls made against the daily call target (+ answered calls and promises kept)
//     Lead FMS / Sales FMS           follow-up calls done on time (late = half a point), as in their Team Performance
// The company score is the plain average of the apps that have a score, so a big app cannot drown a small one.
import TaskInstance from "../models/TaskInstance.js";
import WorkshopTask from "../models/WorkshopTask.js";
import Ticket from "../models/Ticket.js";
import Doer from "../models/Doer.js";
import { withTrackingFloor } from "./trackingStart.js";
import { memo } from "./cache.js";
import { getDisabledApps } from "./access.js";
import ordersTeamPerf from "../orders/src/services/teamPerfService.js";
import emi from "../emi/index.js";
import { performance as leadPerformance } from "../leadfms/utils/leadService.js";
import { performance as salesPerformance } from "../salesfms/utils/leadService.js";

// ---------------------------------------------------------------- time (India) ----
const IST = 330 * 60000, DAY = 864e5;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const istMidnight = (s) => new Date(Date.parse(`${s}T00:00:00Z`) - IST); // start of that India day
const addDaysYmd = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const mondayOf = (s) => { const dow = new Date(`${s}T00:00:00Z`).getUTCDay(); return addDaysYmd(s, -((dow + 6) % 7)); };

export const RANGES = { today: "Today", week: "This week", month: "This month" };
export function rangesFor(key, now = new Date()) {
  const today = ymd(now);
  let cur, prev, prevLabel, ordersKey, emiKey, emiPrev;
  if (key === "week") {
    const from = mondayOf(today);
    cur = { from, to: today }; prev = { from: addDaysYmd(from, -7), to: addDaysYmd(from, -1) };
    prevLabel = "last week"; ordersKey = "this_week"; emiKey = "this_week"; emiPrev = "last_week";
  } else if (key === "month") {
    const from = `${today.slice(0, 7)}-01`, lastEnd = addDaysYmd(from, -1);
    cur = { from, to: today }; prev = { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    prevLabel = "last month"; ordersKey = "this_month"; emiKey = "this_month"; emiPrev = "last_month";
  } else {
    key = "today";
    cur = { from: today, to: today }; prev = { from: addDaysYmd(today, -1), to: addDaysYmd(today, -1) };
    prevLabel = "yesterday"; ordersKey = "today"; emiKey = "today"; emiPrev = "yesterday";
  }
  const win = (r) => ({ ...r, start: istMidnight(r.from), end: istMidnight(addDaysYmd(r.to, 1)) }); // end is exclusive
  return { key, label: RANGES[key], prevLabel, today, cur: win(cur), prev: win(prev), ordersKey, emiKey, emiPrev };
}

// ---------------------------------------------------------------- scoring helpers ----
export const gradeOf = (s) => (s == null ? "none" : s >= 90 ? "excellent" : s >= 75 ? "good" : s >= 50 ? "fair" : "poor");
export const GRADE_LABEL = { excellent: "Excellent", good: "On track", fair: "Needs attention", poor: "Falling behind", none: "No data yet" };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const timeScore = (onTime, late, due) => (due > 0 ? Math.round(((onTime + late / 2) / due) * 100) : null);
const MIN_DUE = 3; // a person is only named as a star / a worry once at least this many tasks were due
const person = (name, score, due, detail) => ({ name: String(name || "—"), score, grade: gradeOf(score), due, detail });
const sortPeople = (list) => list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.due - a.due || a.name.localeCompare(b.name));

// ---------------------------------------------------------------- one function per app ----
// Each returns { score, due, metrics:[{label,value,tone?}], summary, people:[{name,score,due,detail}] }.

async function reminder(r) {
  const end = new Date(Math.min(r.end.getTime(), istMidnight(addDaysYmd(ymd(new Date()), 1)).getTime())); // only what has actually come due
  const planned = withTrackingFloor({ $gte: r.start, $lt: end });
  if (planned.$gte >= end) return emptyApp();
  const [rows, doers] = await Promise.all([
    TaskInstance.aggregate([
      { $match: { planned } },
      { $group: { _id: "$doer", total: { $sum: 1 }, onTime: { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } }, delayed: { $sum: { $cond: [{ $eq: ["$status", "Delayed"] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } } } },
    ]),
    Doer.find().select("name").lean(),
  ]);
  const names = new Map(doers.map((d) => [String(d._id), d.name]));
  const t = rows.reduce((a, x) => ({ total: a.total + x.total, onTime: a.onTime + x.onTime, delayed: a.delayed + x.delayed, pending: a.pending + x.pending }), { total: 0, onTime: 0, delayed: 0, pending: 0 });
  const people = sortPeople(rows.filter((x) => names.has(String(x._id)) && x.total > 0).map((x) => person(names.get(String(x._id)), pct(x.onTime, x.total), x.total, `${x.onTime} of ${x.total} on time`)));
  return {
    score: pct(t.onTime, t.total), due: t.total, people,
    metrics: [{ label: "Tasks due", value: t.total }, { label: "On time", value: t.onTime, tone: "good" }, { label: "Delayed", value: t.delayed, tone: t.delayed ? "warn" : "" }, { label: "Pending", value: t.pending, tone: t.pending ? "bad" : "" }],
    summary: t.total ? `${t.onTime} of ${t.total} tasks done on time` : "No tasks were due",
  };
}

async function workshop(r) {
  const end = new Date(Math.min(r.end.getTime(), istMidnight(addDaysYmd(ymd(new Date()), 1)).getTime()));
  const planned = withTrackingFloor({ $gte: r.start, $lt: end });
  if (planned.$gte >= end) return emptyApp();
  const rows = await WorkshopTask.aggregate([
    { $match: { planned } },
    { $group: { _id: { $ifNull: ["$ownerEmail", ""] }, name: { $first: "$owner" }, total: { $sum: 1 }, onTime: { $sum: { $cond: [{ $eq: ["$outcome", "On Time"] }, 1, 0] } }, delayed: { $sum: { $cond: [{ $eq: ["$outcome", "Delayed"] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ["$actual", null] }, 1, 0] } } } },
  ]);
  const t = rows.reduce((a, x) => ({ total: a.total + x.total, onTime: a.onTime + x.onTime, delayed: a.delayed + x.delayed, pending: a.pending + x.pending }), { total: 0, onTime: 0, delayed: 0, pending: 0 });
  const people = sortPeople(rows.filter((x) => x._id && x.total > 0).map((x) => person(x.name || x._id, pct(x.onTime, x.total), x.total, `${x.onTime} of ${x.total} on time`)));
  return {
    score: pct(t.onTime, t.total), due: t.total, people,
    metrics: [{ label: "Tasks due", value: t.total }, { label: "On time", value: t.onTime, tone: "good" }, { label: "Delayed", value: t.delayed, tone: t.delayed ? "warn" : "" }, { label: "Pending", value: t.pending, tone: t.pending ? "bad" : "" }],
    summary: t.total ? `${t.onTime} of ${t.total} workshop tasks on time` : "No workshop tasks were due",
  };
}

async function tickets(r) {
  const now = new Date(), end = new Date(Math.min(r.end.getTime(), now.getTime()));
  const list = await Ticket.find({ plannedResolution: { $gte: r.start, $lt: end } }).select("assignedToName status plannedResolution resolvedAt").lean();
  const by = new Map(); const tot = { onTime: 0, late: 0, missed: 0 };
  for (const k of list) {
    const x = by.get(k.assignedToName || "—") || by.set(k.assignedToName || "—", { onTime: 0, late: 0, missed: 0 }).get(k.assignedToName || "—");
    const planned = new Date(k.plannedResolution).getTime();
    const kind = k.status === "Resolved" ? (k.resolvedAt && new Date(k.resolvedAt).getTime() <= planned ? "onTime" : "late") : "missed";
    x[kind]++; tot[kind]++;
  }
  const due = tot.onTime + tot.late + tot.missed;
  const people = sortPeople([...by.entries()].map(([n, x]) => { const d = x.onTime + x.late + x.missed; return person(n, timeScore(x.onTime, x.late, d), d, `${x.onTime} on time · ${x.late} late · ${x.missed} still open`); }));
  return {
    score: timeScore(tot.onTime, tot.late, due), due, people,
    metrics: [{ label: "Tickets due", value: due }, { label: "On time", value: tot.onTime, tone: "good" }, { label: "Late", value: tot.late, tone: tot.late ? "warn" : "" }, { label: "Open & overdue", value: tot.missed, tone: tot.missed ? "bad" : "" }],
    summary: due ? `${tot.onTime} of ${due} help tickets resolved on time` : "No help tickets were due",
  };
}

async function orders(r, ctx) {
  const out = await ordersTeamPerf.report({ window: ctx.ordersKey }, new Date(), null);
  const t = out.team.tasks;
  const people = sortPeople(out.people.filter((p) => p.active && p.tasks && p.tasks.due > 0).map((p) => person(p.name, p.tasks.score, p.tasks.due, `${p.tasks.onTime} on time · ${p.tasks.late} late · ${p.tasks.missed} missed`)));
  return {
    score: t.score, prevScore: out.team.tasksPrev ? out.team.tasksPrev.score : undefined, due: t.due, people,
    metrics: [{ label: "Tasks due", value: t.due }, { label: "On time", value: t.onTime, tone: "good" }, { label: "Late", value: t.late, tone: t.late ? "warn" : "" }, { label: "Missed", value: t.missed, tone: t.missed ? "bad" : "" }],
    summary: t.due ? `${t.onTime} of ${t.due} order tasks on time` : "No order tasks were due",
  };
}

async function emiApp(r, ctx) {
  const [cur, prev] = await Promise.all([emi.teamPerformance(ctx.emiKey), emi.teamPerformance(ctx.emiPrev).catch(() => null)]);
  const t = cur.team;
  const people = sortPeople(cur.people.filter((p) => p.score != null && p.expected_calls > 0 && (p.calls > 0 || p.expected_calls > 0)).map((p) => person(p.name, p.score, Math.round(p.expected_calls), `${p.calls} calls${p.answer_pct != null ? ` · ${p.answer_pct}% answered` : ""}`)));
  return {
    score: t.score, prevScore: prev ? prev.team.score : undefined, due: t.expected_calls, people,
    metrics: [{ label: "Calls made", value: t.calls, tone: "good" }, { label: "Expected", value: Math.round(t.expected_calls) }, { label: "Answered", value: t.answer_pct == null ? "—" : `${t.answer_pct}%` }, { label: "Collected", value: `₹${Math.round(cur.totals.collected).toLocaleString("en-IN")}` }],
    summary: t.expected_calls ? `${t.calls} calls made against about ${Math.round(t.expected_calls)} expected` : "No calls were expected",
  };
}

const fmsApp = (perf, what) => async (r) => {
  const out = await perf(r.from, r.to);
  const t = out.team;
  const people = sortPeople(out.rows.filter((x) => !x.admin && x.due > 0).map((x) => person(x.name, x.score, x.due, `${x.onTime} on time · ${x.late} late · ${x.missed} missed`)));
  return {
    score: t.score, prevScore: out.prev ? out.prev.score : undefined, due: t.due, people,
    metrics: [{ label: "Calls due", value: t.due }, { label: "On time", value: t.onTime, tone: "good" }, { label: "Late", value: t.late, tone: t.late ? "warn" : "" }, { label: "Missed", value: t.missed, tone: t.missed ? "bad" : "" }],
    summary: t.due ? `${t.onTime} of ${t.due} ${what} calls on time` : `No ${what} calls were due`,
  };
};

const emptyApp = () => ({ score: null, due: 0, people: [], metrics: [], summary: "Nothing was due in this period" });

// id, name, hub link, colour (the hub card colour), how to compute it (and whether it needs the previous period as a second run)
const APPS = [
  { id: "reminder", name: "Reminder List", to: "/", tone: "#6d4fc0", run: reminder, twoRuns: true },
  { id: "workshop", name: "Workshop PMS", to: "/workshops/dashboard", tone: "#e0912b", run: workshop, twoRuns: true },
  { id: "tickets", name: "Help Tickets", to: "/tickets/raised", tone: "#0e9aa7", run: tickets, twoRuns: true },
  { id: "orders", name: "Order Analytics", to: "/orders/team-performance", tone: "#1d8a63", run: orders },
  { id: "emi", name: "EMI Manager", to: "/emi/performance", tone: "#4a6fd6", run: emiApp },
  { id: "leadfms", name: "Lead FMS", to: "/lead-fms/performance", tone: "#5b5fe0", run: fmsApp(leadPerformance, "follow-up") },
  { id: "salesfms", name: "Sales FMS", to: "/sales-fms/performance", tone: "#0d9488", run: fmsApp(salesPerformance, "sales follow-up") },
];

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);

async function computeApp(app, ctx, off) {
  const base = { id: app.id, name: app.name, to: app.to, tone: app.tone };
  if (off.has(app.id)) return { ...base, ok: true, off: true, score: null, grade: "none", due: 0, metrics: [], people: [], summary: "Switched off in Admin settings" };
  try {
    const cur = await withTimeout(app.run(ctx.cur, ctx), 25000, app.name);
    let prevScore = cur.prevScore;
    if (app.twoRuns) prevScore = (await withTimeout(app.run(ctx.prev, ctx), 25000, app.name).catch(() => ({ score: null }))).score;
    return { ...base, ok: true, score: cur.score, prevScore: prevScore ?? null, delta: cur.score != null && prevScore != null ? cur.score - prevScore : null, grade: gradeOf(cur.score), due: cur.due, metrics: cur.metrics, summary: cur.summary, people: cur.people };
  } catch (e) {
    console.error(`[company] ${app.id} failed:`, e.message);
    return { ...base, ok: false, score: null, grade: "none", due: 0, metrics: [], people: [], summary: "Could not load this app just now" };
  }
}

async function build(key) {
  const ctx = rangesFor(key), off = new Set(getDisabledApps());
  const apps = await Promise.all(APPS.map((a) => computeApp(a, ctx, off)));
  const scored = apps.filter((a) => a.score != null);
  const avg = (list) => (list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);
  const score = avg(scored.map((a) => a.score));
  const prevScored = apps.filter((a) => a.prevScore != null && a.score != null);
  const prevScore = avg(prevScored.map((a) => a.prevScore));
  const grade = gradeOf(score);

  // people who need a conversation / a thank-you, across every app
  const flat = apps.flatMap((a) => a.people.filter((p) => p.due >= MIN_DUE).map((p) => ({ ...p, app: a.name, appId: a.id, tone: a.tone })));
  const attention = flat.filter((p) => p.score < 75).sort((a, b) => a.score - b.score || b.due - a.due).slice(0, 8);
  const stars = flat.filter((p) => p.score >= 90).sort((a, b) => b.score - a.score || b.due - a.due).slice(0, 5);

  const counts = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const a of scored) counts[a.grade]++;
  const peopleTracked = new Set(apps.flatMap((a) => a.people.map((p) => p.name.toLowerCase()))).size;
  const behind = scored.filter((a) => a.score < 75).map((a) => a.name);
  let headline;
  if (!scored.length) headline = "Nothing was due in this period yet, so there is no score to show.";
  else if (!behind.length) headline = `All ${scored.length} team${scored.length === 1 ? " is" : "s are"} on track.`;
  else headline = `${scored.length - behind.length} of ${scored.length} teams on track. ${behind.length === 1 ? `${behind[0]} needs` : `${behind.slice(0, -1).join(", ")} and ${behind[behind.length - 1]} need`} attention.`;

  return {
    generatedAt: new Date().toISOString(),
    range: { key: ctx.key, label: ctx.label, from: ctx.cur.from, to: ctx.cur.to, prevLabel: ctx.prevLabel },
    company: { score, prevScore, delta: score != null && prevScore != null ? score - prevScore : null, grade, label: GRADE_LABEL[grade], headline, teams: scored.length, counts, people: peopleTracked },
    apps, attention, stars,
  };
}

// Cached for a minute: the hub asks every time it opens, and each call touches several apps.
export function companyPerformance(key = "week") {
  const k = RANGES[key] ? key : "week";
  return memo(`company-perf:${k}:${ymd(new Date())}`, 60_000, () => build(k));
}
