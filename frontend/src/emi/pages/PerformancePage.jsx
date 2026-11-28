import { api } from '../api';
import { inr, useFetch, useLiveReload } from '../util';
import { Kpi, Loading, ErrorBox, Empty, Avatar, Meter } from '../components/ui';
import FilterBar, { useWindow } from '../components/FilterBar';
import { HBars } from '../components/Charts';
import Icon from '../components/Icon';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function PerformancePage() {
  const win = useWindow('perf_window');
  const { data, loading, error, reload } = useFetch(() => (win.ready ? api.get(`/performance?${win.params}`) : Promise.resolve(null)), [win.params, win.ready]);
  useLiveReload(reload, 120000);
  const people = (data && data.people) || [];
  const t = data && data.totals;
  const team = data && data.team;
  const tone = (g) => (g === 'excellent' || g === 'good' ? 'good' : g === 'fair' ? 'warn' : g === 'none' ? '' : 'bad');
  const GRADE = { excellent: 'Excellent', good: 'Good', fair: 'Needs improvement', poor: 'Behind', none: 'No calls expected' };
  return (
    <>
      <FilterBar win={win} range={data && data.window} />
      <div className="page-head"><div><h1>Team Performance</h1><div className="emi-muted">Scored on the calls the team made to chase instalments, and whose promises held</div></div></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="emi-card emi-perf-hero" style={{ marginBottom: 16 }}>
            <div className={`emi-perf-score ${tone(team.grade)}`}>
              <b>{team.score == null ? '—' : team.score}</b><span>/100</span>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className={`emi-perf-grade ${tone(team.grade)}`}>{GRADE[team.grade] || GRADE.none}</div>
              <div className="emi-muted" style={{ marginTop: 4 }}>
                {team.calls} call{team.calls === 1 ? '' : 's'} made by {team.members} team member{team.members === 1 ? '' : 's'} against about {team.expected_calls} expected ({team.target_per_day} a day each over {team.working_days} working day{team.working_days === 1 ? '' : 's'}).
                {team.answer_pct != null && <> {team.answer_pct}% of calls were answered.</>}
              </div>
              <div style={{ marginTop: 10 }}><Meter pct={team.expected_calls ? Math.min(100, Math.round((team.calls / team.expected_calls) * 100)) : 0} tone={tone(team.grade)} /></div>
            </div>
          </div>
          <div className="grid kpis">
            <Kpi icon="phone" label="Calls made" value={t.calls} tone="blue" sub={`${t.followups} follow-ups in all`} />
            <Kpi icon="wallet" label="Collected" value={inr(t.collected)} tone="green" />
            <Kpi icon="target" label="Promises made" value={t.promises} />
            <Kpi icon="checkc" label="Promises kept" value={t.kept} tone="green" />
            <Kpi icon="flame" label="Promises broken" value={t.broken} tone={t.broken ? 'red' : ''} />
          </div>
          {!people.length ? <Empty icon="trophy">No activity in this period.</Empty> : (
            <>
              <div className="emi-table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead><tr><th>#</th><th>Team member</th><th>Score</th><th className="num">Calls</th><th className="num">Answered</th><th className="num">Promises</th><th>Kept rate</th><th className="num">WhatsApp</th><th className="num">Collected</th></tr></thead>
                  <tbody>{people.map((p, i) => (
                    <tr key={p.name}>
                      <td>{MEDALS[i] && p.score != null && p.calls > 0 ? MEDALS[i] : i + 1}</td>
                      <td><span className="row" style={{ gap: 8 }}><Avatar name={p.name} /><b>{p.name}</b></span></td>
                      <td style={{ minWidth: 150 }} title={`${p.calls} calls of about ${p.expected_calls} expected`}>{p.score == null ? <span className="emi-muted">—</span> : <><Meter pct={p.score} tone={tone(p.grade)} /> <b>{p.score}</b></>}</td>
                      <td className="num"><b>{p.calls}</b></td>
                      <td className="num">{p.answer_pct == null ? <span className="emi-muted">—</span> : `${p.answer_pct}%`}</td>
                      <td className="num" title={`${p.kept} kept · ${p.broken} broken · ${p.pending} still pending`}>{p.promises}</td>
                      <td style={{ minWidth: 130 }}>{p.kept_pct === null ? <span className="emi-muted">—</span> : <><Meter pct={p.kept_pct} tone={p.kept_pct >= 60 ? 'good' : 'bad'} /> <span className="emi-muted">{p.kept_pct}%</span></>}</td>
                      <td className="num">{p.whatsapps}</td>
                      <td className="num">{inr(p.collected)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <div className="emi-card" style={{ marginTop: 16 }}>
                <h2><Icon name="trophy" size={16} /> Collections leaderboard</h2>
                <HBars rows={[...people].filter((p) => p.collected > 0).sort((a, b) => b.collected - a.collected).map((p, i) => ({ label: `${MEDALS[i] || ''} ${p.name}`.trim(), value: p.collected }))} color="var(--accent)" fmt={inr} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
