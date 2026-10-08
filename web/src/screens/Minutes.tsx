import { useState } from 'preact/hooks';
import { ATTENDANCE_LABEL } from '../core/types';
import { StudentMinutes, minutesSummary, weekStart } from '../core/minutes';
import { WEEKDAY_SHORT, unloggedSlots } from '../core/schedule';
import { toCSV } from '../core/csv';
import { TimeStyle } from '../core/time';
import { setPrefs, usePrefs } from '../data/prefs';
import { checked, fromDateInput, shareFile, toDateInput, useApp, val } from '../ui/components';
import { ReportTabs } from './Reports';

const time = new TimeStyle();

/** Beta: IEP-mandated vs delivered minutes, owed minutes and make-ups, per student. */
export function MinutesView() {
  const { store } = useApp();
  const prefs = usePrefs();
  const today = new Date();
  const [from, setFrom] = useState(() => { const d = weekStart(today); d.setDate(d.getDate() - 21); return d; });
  const [to, setTo] = useState(today);
  const range = { start: new Date(from.getFullYear(), from.getMonth(), from.getDate()), end: new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59) };
  const sessions = store.sessionList();
  const students = store.studentList().filter((s) => s.isActive);
  const opts = { countStudentUnavailable: prefs.countStudentUnavailableAsOwed };
  const rows: StudentMinutes[] = students.map((s) => minutesSummary(s.code, s.weeklyMinutes, sessions, range, opts));
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const gapsTo = range.end < startOfToday ? new Date(range.end.getTime() + 1000) : startOfToday;
  const gaps = unloggedSlots(store.slotList(), sessions, range.start, gapsTo, store.closures);

  const quick = (weeksBack: number) => {
    const s = weekStart(today);
    s.setDate(s.getDate() - 7 * weeksBack);
    setFrom(s);
    setTo(today);
  };

  const exportCsv = async () => {
    const out = [['Student Code', 'Week Of', 'IEP Minutes', 'Delivered Minutes', 'Difference']];
    for (const r of rows) for (const w of r.weeks) out.push([r.studentCode, w.weekStart, String(w.mandated), String(w.delivered), String(w.delivered - w.mandated)]);
    out.push([]);
    out.push(['Student Code', 'Missed Date', 'Reason', 'Minutes Owed', 'Made Up', 'Outstanding']);
    for (const r of rows) for (const o of r.owed) out.push([r.studentCode, time.date(o.date), ATTENDANCE_LABEL[o.reason], String(o.minutes), String(o.madeUp), String(o.minutes - o.madeUp)]);
    await shareFile(toCSV(out), `Service-minutes-${time.fileDate(range.start)}-to-${time.fileDate(range.end)}.csv`, 'text/csv');
  };

  return (
    <div class="stack">
      <h1>Reports</h1>
      <ReportTabs tab="minutes" />
      <div class="row-wrap">
        <button class="chip square" onClick={() => quick(0)}>This week</button>
        <button class="chip square" onClick={() => quick(3)}>Last 4 weeks</button>
        <button class="chip square" onClick={() => quick(12)}>Last 13 weeks</button>
      </div>
      <div class="grid2">
        <div class="field"><label for="m-from">From</label><input id="m-from" class="input" type="date" value={toDateInput(from)} onInput={(e) => val(e) && setFrom(fromDateInput(val(e)))} /></div>
        <div class="field"><label for="m-to">To</label><input id="m-to" class="input" type="date" value={toDateInput(to)} onInput={(e) => val(e) && setTo(fromDateInput(val(e)))} /></div>
      </div>
      <label class="check small"><input type="checkbox" checked={prefs.countStudentUnavailableAsOwed} onChange={(e) => setPrefs({ countStudentUnavailableAsOwed: checked(e) })} />
        Count “student not available” (assemblies, testing) as owed</label>

      {gaps.length > 0 && (
        <section class="card stack-sm" style="border-color:var(--amber)">
          <h2>Scheduled but not logged ({gaps.length})</h2>
          <div class="tiny muted">Log these as delivered, absent or missed so the totals are right. Mark school closures on Today.</div>
          {gaps.slice(0, 12).map((g) => {
            const d = fromDateInput(g.day);
            return <div class="small"><span class="mono">{g.studentCodes.join(', ')}</span> · {WEEKDAY_SHORT[((d.getDay() + 6) % 7) + 1]} {time.date(d)} · {g.slot.start}</div>;
          })}
          {gaps.length > 12 && <div class="tiny muted">…and {gaps.length - 12} more.</div>}
        </section>
      )}

      {rows.length === 0 && <div class="empty">Add students with IEP minutes on the Students tab.</div>}
      {rows.map((r) => {
        const st = store.students.get(r.studentCode);
        const pct = r.mandated ? Math.round((r.delivered / r.mandated) * 100) : 100;
        const short = r.delivered < r.mandated;
        return (
          <section class="card stack-sm">
            <div class="row">
              <span class="mono">{r.studentCode}</span>
              <span class="muted small">{st?.alias}</span>
              <span class="spacer" />
              {r.outstanding > 0 ? <span class="badge warn">{r.outstanding} min owed</span> : r.owedTotal > 0 ? <span class="badge ok">Made up</span> : null}
            </div>
            <div class={`meter ${short ? 'short' : ''}`} role="img" aria-label={`Delivered ${r.delivered} of ${r.mandated} IEP minutes`}>
              <span style={`width:${Math.min(100, pct)}%`} />
            </div>
            <div class="small">Delivered <b>{r.delivered}</b> of {r.mandated} IEP min ({pct}%) · {st?.weeklyMinutes ?? 0} min/week × {r.weeks.length} week{r.weeks.length === 1 ? '' : 's'}</div>
            {r.owed.length > 0 && (
              <div class="stack-sm">
                {r.owed.map((o) => (
                  <div class="tiny">{time.date(o.date)} · {ATTENDANCE_LABEL[o.reason]} · {o.minutes} min owed{o.madeUp ? ` · ${o.madeUp} made up` : ''}</div>
                ))}
              </div>
            )}
            <details>
              <summary class="tiny muted" style="cursor:pointer">By week</summary>
              {r.weeks.map((w) => (
                <div class="row tiny"><span>Week of {time.date(fromDateInput(w.weekStart))}</span><span class="spacer" /><span>{w.delivered} / {w.mandated}</span></div>
              ))}
            </details>
          </section>
        );
      })}
      <div class="tiny muted">IEP minutes come from each student's minutes per week. Weeks start Monday; partial weeks at the ends of the range count as full weeks. Owed minutes are the planned length of missed sessions; make-ups pay off the sessions they're linked to first, then the oldest.</div>
      <button class="btn block" onClick={exportCsv}>Export minutes (CSV)</button>
    </div>
  );
}
