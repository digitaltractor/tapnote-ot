import { useEffect, useState } from 'preact/hooks';
import { serviceDelivered, minutes } from '../core/types';
import { GoalProgress, REPORT_PERIOD_LABEL, ReportPeriod, goalProgress, periodRange } from '../core/progress';
import { TimeStyle } from '../core/time';
import { goalSnapshots, snapshot } from '../data/store';
import { signature, usePrefs } from '../data/prefs';
import { renderPdf } from '../export/pdf';
import { Badge, fromDateInput, shareFile, toDateInput, useApp, val } from '../ui/components';

const time = new TimeStyle();
const PERIODS: ReportPeriod[] = ['month', 'quarter', 'year', 'custom'];

export function Reports() {
  const { store, authenticate, vault, toast } = useApp();
  const prefs = usePrefs();
  const students = store.studentList().filter((s) => s.isActive);
  const [code, setCode] = useState(students[0]?.code ?? '');
  const [period, setPeriod] = useState<ReportPeriod>('quarter');
  const [endDate, setEndDate] = useState(new Date());
  const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; });
  const [draft, setDraft] = useState('');

  const student = store.students.get(code) ?? students[0];
  const range = period === 'custom'
    ? { start: new Date(customStart.getFullYear(), customStart.getMonth(), customStart.getDate()), end: new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59) }
    : periodRange(period, endDate);
  const periodLabel = period === 'custom' ? 'period' : period;
  const sessions = student ? store.sessionList().filter((s) => s.studentCode === student.code) : [];
  const snaps = sessions.map((s) => snapshot(s, student));
  const progress: GoalProgress[] = goalSnapshots(student).map((g) => goalProgress(g, snaps, range, periodLabel, time));

  const inRange = sessions.filter((s) => s.date >= range.start && s.date <= range.end);
  const held = inRange.filter((s) => serviceDelivered(s.attendance));
  const heldMinutes = held.reduce((sum, s) => sum + (minutes(s) ?? 0), 0);
  const generated = [
    `Sessions held: ${held.length} (${heldMinutes} min). Sessions missed: ${inRange.length - held.length}.`,
    ...progress.map((p) => `Goal ${p.goal.number} · ${p.goal.shortName} — ${p.status}\n${p.narrative}`)
  ].join('\n\n');

  useEffect(() => setDraft(generated), [code, period, endDate.getTime(), customStart.getTime(), store.version]);

  const exportPdf = async () => {
    if (!student) return;
    const ok = await authenticate('Add the student’s name to the report');
    if (!ok) return;
    const id = vault.get(student.code);
    const header = [
      id ? `Student: ${id.realName}${id.dateOfBirth ? ` · DOB ${id.dateOfBirth}` : ''}` : `Student: ${student.code} (no name in vault)`,
      ...(id?.paSecureID ? [`PA Secure ID: ${id.paSecureID}`] : []),
      `Period: ${time.date(range.start)} – ${time.date(range.end)}`,
      `Therapist: ${signature(prefs)}`
    ];
    const blob = await renderPdf('Occupational Therapy Progress Report', header, draft.split(/\n\n+/).map((t) => ({ text: t })), `Prepared ${time.date(new Date())}`);
    await shareFile(blob, `OT-Progress-${student.code}-${time.fileDate(range.end)}.pdf`, 'application/pdf');
    toast('Report exported.');
  };

  if (!student) {
    return (
      <div class="stack">
        <h1>Progress report</h1>
        <div class="empty">Add students and goals on the Students tab first.</div>
      </div>
    );
  }

  return (
    <div class="stack">
      <h1>Progress report</h1>
      <div class="field">
        <label for="r-student">Student</label>
        <select id="r-student" class="input mono" value={student.code} onChange={(e) => setCode(val(e))}>
          {students.map((s) => <option value={s.code}>{s.code} · {s.alias}</option>)}
        </select>
      </div>
      <div class="seg" role="radiogroup" aria-label="Period">
        {PERIODS.map((p) => (
          <button type="button" role="radio" aria-checked={period === p} class={`chip square ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>{REPORT_PERIOD_LABEL[p]}</button>
        ))}
      </div>
      <div class={period === 'custom' ? 'grid2' : ''}>
        {period === 'custom' && (
          <div class="field"><label for="r-from">From</label>
            <input id="r-from" class="input" type="date" value={toDateInput(customStart)} onInput={(e) => val(e) && setCustomStart(fromDateInput(val(e)))} /></div>
        )}
        <div class="field"><label for="r-to">{period === 'custom' ? 'To' : 'Ending'}</label>
          <input id="r-to" class="input" type="date" value={toDateInput(endDate)} onInput={(e) => val(e) && setEndDate(fromDateInput(val(e)))} /></div>
      </div>
      <div class="tiny muted">{time.date(range.start)} – {time.date(range.end)}</div>

      {progress.length === 0 && <div class="empty">This student has no active goals.</div>}
      {progress.map((p) => (
        <section class="card stack-sm">
          <div class="goal-head">
            <h2>Goal {p.goal.number} · {p.goal.shortName}</h2>
            <span class="tiny muted">{p.points.length} sessions</span>
          </div>
          <GoalChart progress={p} />
          <div class="row-wrap">
            <Badge kind={p.status === 'Goal met' || p.status === 'Progressing' ? 'ok' : p.status === 'Not enough data' ? 'neutral' : 'warn'}>{p.status}</Badge>
            {p.average != null && <span class="small muted">Average {p.average}%</span>}
          </div>
        </section>
      ))}

      <section class="stack-sm">
        <label class="label" for="r-text">Report text</label>
        <textarea id="r-text" class="input" style="min-height:280px" value={draft} onInput={(e) => setDraft(val(e))} />
        <div class="row">
          <span class="tiny muted">Built only from recorded sessions. Fill in the bracketed placeholders.</span>
          <span class="spacer" />
          <button type="button" class="link" onClick={() => setDraft(generated)}>Regenerate</button>
        </div>
      </section>
      <button class="btn primary block big" onClick={exportPdf}>Export PDF with student name</button>
      <div class="tiny muted">The real name is added on this device at export, after you unlock.</div>
    </div>
  );
}

function GoalChart({ progress }: { progress: GoalProgress }) {
  if (progress.points.length === 0) return <div class="small muted">No data in this period.</div>;
  const crit = progress.goal.criterionPercent;
  const label = `Percent correct by session: ${progress.points.map((p) => p.percent).join(', ')}${crit != null ? `. Criterion ${crit}%.` : '.'}`;
  return (
    <div>
      <div class="chart" role="img" aria-label={label}>
        {crit != null && <div class="crit" style={`bottom:${crit}%`}><span>{crit}% criterion</span></div>}
        {progress.points.map((p) => <div class="bar" style={`height:${Math.max(p.percent, 1)}%`} title={`${time.date(p.date)}: ${p.percent}%`} />)}
      </div>
      <div class="tiny muted" style="margin-top:4px">% correct per session, {time.date(progress.points[0].date)} – {time.date(progress.points[progress.points.length - 1].date)}</div>
    </div>
  );
}
