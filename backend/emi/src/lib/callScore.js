// Team Performance score for EMI Manager = how well each person does the CALLS that chase instalments.
//
//   volume   (70%)  calls made  vs  the daily call target x working days (Mon-Sat) in the period, capped at 100
//   quality  (30%)  average of: calls that were answered, and promises (from calls) that were kept
//                   (a part with no data yet is left out; with no quality data the score is the volume)
//
// The daily target is EMI_CALL_TARGET_PER_DAY (default 20 calls per person per working day).
const { addDays, diffDays } = require('./dates');

const DEFAULT_TARGET = 20;
const targetPerDay = () => {
  const n = Number(process.env.EMI_CALL_TARGET_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TARGET;
};

const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 = Sunday

// Working days (Mon-Sat) from start to end inclusive; never less than 1 so a Sunday-only window does not divide by zero.
function workingDays(start, end) {
  if (!start || !end || end < start) return 1;
  const total = diffDays(end, start) + 1;
  let n = 0;
  for (let i = 0; i < total && i < 3700; i++) if (dow(addDays(start, i)) !== 0) n++;
  return Math.max(1, n);
}

const gradeOf = (score) => (score == null ? 'none' : score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

// x = { calls, answered, kept, broken };  expected = calls that were expected of THIS person (or team) in the period
function scoreOf(x, expected) {
  if (!expected || expected <= 0) return null;
  const volume = Math.min(100, (x.calls / expected) * 100);
  const parts = [];
  const answered = pct(x.answered, x.calls);
  const kept = pct(x.kept, x.kept + x.broken);
  if (answered != null) parts.push(answered);
  if (kept != null) parts.push(kept);
  const quality = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  return Math.round(quality == null ? volume : 0.7 * volume + 0.3 * quality);
}

module.exports = { DEFAULT_TARGET, targetPerDay, workingDays, gradeOf, scoreOf, pct };
