import { useEffect, useState } from 'preact/hooks';
import { serviceDelivered, minutes } from '../core/types';
import { GoalProgress, REPORT_PERIOD_LABEL, ReportPeriod, goalProgress, periodRange } from '../core/progress';
import { TimeStyle } from '../core/time';
import { goalSnapshots, snapshot } from '../data/store';
import { schoolCalendar, signature, usePrefs } from '../data/prefs';
import { GoalInsight, describeState, goalInsight, stateNextSteps, stateTrend } from '../core/mastery';
import { contactSummary } from '../core/contacts';
import { DEADLINE_KIND_LABEL, allDeadlines, describeDays, fromKey, toKey } from '../core/deadlines';
import { REGULATION_STATES, RegulationState } from '../core/types';
import { renderPdf } from '../export/pdf';
import { Badge, fromDateInput, shareFile, toDateInput, useApp, val } from '../ui/components';
import { MinutesView } from './Minutes';

const time = new TimeStyle();
const PERIODS: ReportPeriod[] = ['month', 'quarter', 'year', 'custom'];

type ReportTab = 'progress' | 'minutes' | 'due';

export function Reports({ tab = 'progress' }: { tab?: ReportTab }) {
  if (tab === 'minutes') return <MinutesView />;
  if (tab === 'due') return <DueView />;
  return <ProgressView />;
}

export function ReportTabs({ tab }: { tab: ReportTab }) {
  const tabs: [ReportTab, string, string][] = [['progress', 'Progress', '#/reports'], ['minutes', 'Minutes', '#/reports/minutes'], ['due', 'Due dates', '#/reports/due']];
  return (
    <div class="seg" role="tablist" aria-label="Report type">
      {tabs.map(([id, label, href]) => (
        <a role="tab" aria-selected={tab === id} class={`chip square ${tab === id ? 'on' : ''}`} style="display:flex;align-items:center;justify-content:center;text-decoration:none" href={href}>{label}</a>
      ))}
    </div>
  );
}

/** Beta 2: every IEP, evaluation and progress-report date in the next four months. */
function DueView() {
  const { store } = useApp();
  const prefs = usePrefs();
  const today = toKey(new Date());
  const all = allDeadlines(store.studentList(), today, schoolCalendar(prefs), 120);
  const groups: [string, typeof all][] = [
    ['Overdue', all.filter((d) => d.status === 'overdue')],
    ['Next 30 days', all.filter((d) => d.status !== 'overdue' && d.daysLeft <= 30)],
    ['Later', all.filter((d) => d.daysLeft > 30)]
  ];
  const missing = store.studentList().filter((s) => s.isActive && !s.iepDate);
  return (
    <div class="stack">
      <h1>Reports</h1>
      <ReportTabs tab="due" />
      {all.length === 0 && <div class="empty">No dates yet. Add IEP and evaluation dates on each student.</div>}
      {groups.filter(([, xs]) => xs.length).map(([title, xs]) => (
        <section class="stack-sm">
          <h2 class="section-title">{title}</h2>
          {xs.map((d) => (
            <a class="list-item" href={`#/students/${encodeURIComponent(d.code)}`}>
              <div class="grow">
                <div class="row"><span class="mono">{d.code}</span><span class="muted small">{DEADLINE_KIND_LABEL[d.kind]}</span></div>
                <span class="small">{d.label} · {time.date(fromKey(d.due))}</span>
              </div>
              <Badge kind={d.status === 'upcoming' ? 'neutral' : 'warn'}>{describeDays(d)}</Badge>
            </a>
          ))}
        </section>
      ))}
      {missing.length > 0 && <div class="tiny muted">No IEP date yet for <span class="mono">{missing.map((s) => s.code).join(', ')}</span>.</div>}
      <div class="tiny muted">Progress reports drop off the list when you export one within 3 weeks of the due date. Annual IEP reviews are due by the anniversary; re-evaluations every 3 years (2 for intellectual disability in PA); evaluation reports 60 calendar days from permission, not counting summer.</div>
    </div>
  );
}

function ProgressView() {
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
  const insights: GoalInsight[] = progress.map((p) => goalInsight(p, prefs.promptLevels, prefs.masterySessions));

  const inRange = sessions.filter((s) => s.date >= range.start && s.date <= range.end);
  const held = inRange.filter((s) => serviceDelivered(s.attendance));
  const heldMinutes = held.reduce((sum, s) => sum + (minutes(s) ?? 0), 0);
  const states = stateTrend(held);
  const stateText = describeState(states);
  const stateSteps = stateNextSteps(states);
  const collab = student ? contactSummary(store.contactList(), student.code, range) : undefined;
  const generated = [
    `Sessions held: ${held.length} (${heldMinutes} min). Sessions missed: ${inRange.length - held.length}.`,
    ...progress.map((p, i) => {
      const g = insights[i];
      const status = g.mastery.mastered ? 'Mastered' : p.status === 'Goal met' ? 'At criterion' : p.status;
      const body = p.narrative.replace(' [Add classroom observations and next steps]', ' [Add classroom observations]');
      return `Goal ${p.goal.number} · ${p.goal.shortName} — ${status}\n${body}\nSuggested next steps: ${g.nextSteps.join(' ')}`;
    }),
    ...(stateText || stateSteps.length ? [`Regulation and engagement: ${[stateText, ...stateSteps].filter(Boolean).join(' ')}`] : []),
    ...(collab ? [collab] : [])
  ].join('\n\n');

  useEffect(() => setDraft(generated), [code, period, endDate.getTime(), customStart.getTime(), store.version, prefs.masterySessions]);

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
    const day = toKey(new Date());
    if (!(student.reportsExported ?? []).includes(day)) {
      await store.putStudent({ ...student, reportsExported: [...(student.reportsExported ?? []), day] }, 'progress report exported');
    }
    toast('Report exported.');
  };

  if (!student) {
    return (
      <div class="stack">
        <h1>Reports</h1>
        <ReportTabs tab="progress" />
        <div class="empty">Add students and goals on the Students tab first.</div>
      </div>
    );
  }

  return (
    <div class="stack">
      <h1>Reports</h1>
      <ReportTabs tab="progress" />
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
      {progress.map((p, i) => {
        const g = insights[i];
        return (
          <section class="card stack-sm">
            <div class="goal-head">
              <h2>Goal {p.goal.number} · {p.goal.shortName}</h2>
              <span class="tiny muted">{p.points.length} sessions</span>
            </div>
            <GoalChart progress={p} />
            <PromptStrip progress={p} />
            <div class="row-wrap">
              {g.mastery.mastered
                ? <Badge kind="ok">Mastered · {g.mastery.streak} in a row</Badge>
                : <Badge kind={p.status === 'Goal met' || p.status === 'Progressing' ? 'ok' : p.status === 'Not enough data' ? 'neutral' : 'warn'}>{p.status === 'Goal met' ? 'At criterion' : p.status}</Badge>}
              {!g.mastery.mastered && p.goal.criterionPercent != null && p.points.length > 0 && (
                <Badge>{g.mastery.streak} of {g.mastery.needed} at criterion</Badge>
              )}
              {p.average != null && <span class="small muted">Average {p.average}%</span>}
            </div>
            {g.prompts.direction !== 'none' && (
              <div class="small">
                Prompting: {g.prompts.first} → {g.prompts.last}
                {' '}<span class={g.prompts.direction === 'increasing' ? 'bold' : 'muted'} style={g.prompts.direction === 'increasing' ? 'color:var(--amber)' : ''}>
                  ({g.prompts.direction === 'fading' ? 'fading' : g.prompts.direction === 'increasing' ? 'more support' : 'steady'})
                </span>
              </div>
            )}
            <div class="small muted">Next: {g.nextSteps.join(' ')}</div>
          </section>
        );
      })}

      {held.length > 0 && (states.rated > 0 || states.engagementAvg != null) && (
        <section class="card stack-sm">
          <h2>Regulation and engagement</h2>
          <StateStrip sessions={held} />
          {stateText && <div class="small">{stateText}</div>}
          {stateSteps.map((t) => <div class="small muted">Next: {t}</div>)}
        </section>
      )}
      {collab && <div class="card small">{collab} <a class="link" href="#/logs">Logs</a></div>}

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

const REG_VAR: Record<RegulationState, string> = { Low: 'var(--reg-low)', Calm: 'var(--reg-calm)', Heightened: 'var(--reg-heightened)', High: 'var(--reg-high)' };

/** One cell per session under the bars: prompt level short name. */
function PromptStrip({ progress }: { progress: GoalProgress }) {
  if (!progress.points.some((p) => p.promptLevelName)) return null;
  return (
    <div class="strip" aria-label={`Prompt level by session: ${progress.points.map((p) => p.promptLevelName ?? 'not recorded').join(', ')}`}>
      {progress.points.map((p) => <span title={p.promptLevelName ?? ''}>{p.promptLevelName ? p.promptLevelName.slice(0, 3) : '·'}</span>)}
    </div>
  );
}

function StateStrip({ sessions }: { sessions: { date: Date; regulation?: RegulationState; engagement?: number }[] }) {
  const sorted = [...sessions].sort((a, b) => a.date.getTime() - b.date.getTime());
  return (
    <div class="stack-sm">
      <div class="strip reg" role="img" aria-label={`Regulation by session: ${sorted.map((s) => s.regulation ?? 'not rated').join(', ')}`}>
        {sorted.map((s) => <span style={s.regulation ? `background:${REG_VAR[s.regulation]}` : ''} title={`${time.date(s.date)}: ${s.regulation ?? 'not rated'}`} />)}
      </div>
      <div class="row-wrap tiny muted">
        {REGULATION_STATES.map((r) => <span class="row" style="gap:4px"><span class="swatch" style={`background:${REG_VAR[r]}`} />{r}</span>)}
      </div>
      {sorted.some((s) => s.engagement != null) && (
        <div class="chart" style="height:56px" role="img" aria-label={`Engagement by session (1–5): ${sorted.map((s) => s.engagement ?? '–').join(', ')}`}>
          {sorted.map((s) => <div class="bar" style={`height:${s.engagement ? s.engagement * 20 : 1}%;opacity:${s.engagement ? 0.7 : 0.15}`} />)}
        </div>
      )}
    </div>
  );
}
