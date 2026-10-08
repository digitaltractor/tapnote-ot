import { useState } from 'preact/hooks';
import { StudentIdentity, emptyIdentity } from '../core/types';
import { aliasFor, makeCode } from '../core/pseudonym';
import type { GoalRecord, StudentRecord } from '../data/db';
import { DEADLINE_KIND_LABEL, Deadline, deadlinesFor, describeDays, fromKey, toKey } from '../core/deadlines';
import { mastery } from '../core/mastery';
import { goalProgress } from '../core/progress';
import { goalSnapshots, snapshot } from '../data/store';
import { schoolCalendar, usePrefs } from '../data/prefs';
import { BackButton, Badge, Field, Icon, Svg, go, useApp, uuid, val } from '../ui/components';

export function Students() {
  const { store, vault, authenticate } = useApp();
  const prefs = usePrefs();
  const students = store.studentList();
  const today = toKey(new Date());
  const cal = schoolCalendar(prefs);
  const [showNames, setShowNames] = useState(false);
  const names = showNames && vault.isUnlocked ? vault.all() : {};

  const toggleNames = async () => {
    if (showNames) {
      setShowNames(false);
      return;
    }
    if (await authenticate('Show students’ real names')) setShowNames(true);
  };

  return (
    <div class="stack">
      <div class="row">
        <h1 class="spacer">Students</h1>
        <a class="btn primary" href="#/students/new">Add</a>
      </div>
      <button class="btn outline block" onClick={toggleNames}>
        <Svg size={18}>{Icon.lock}</Svg>
        {showNames && vault.isUnlocked ? 'Hide real names' : 'Show real names'}
      </button>
      <div class="tiny muted">Students appear by code and alias everywhere. Real names, birth dates and IDs stay in the encrypted vault on this device and are added only to files you export.</div>
      {students.length === 0 ? (
        <div class="empty">No students yet. Tap Add, or load sample students in Settings.</div>
      ) : (
        <div class="list">
          {students.map((s) => {
            const active = s.goals.filter((g) => g.isActive).length;
            const id = names[s.code];
            const next = deadlinesFor(s, today, cal).find((d) => d.status !== 'upcoming');
            const mastered = masteredGoals(store, s, prefs.masterySessions);
            return (
              <a class="list-item" href={`#/students/${encodeURIComponent(s.code)}`}>
                <div class="grow">
                  <div class="row"><span class="mono">{s.code}</span><span class="muted">{s.alias}</span>{!s.isActive && <Badge>Inactive</Badge>}</div>
                  <span class="small muted">{[s.gradeBand && `Grade ${s.gradeBand}`, `${active} goal${active === 1 ? '' : 's'}`, `${s.weeklyMinutes} min/week ${s.serviceMode}`].filter(Boolean).join(' · ')}</span>
                  {id && <div class="vault-name">{id.realName}{id.dateOfBirth ? ` · ${id.dateOfBirth}` : ''}</div>}
                  {(next || mastered > 0) && (
                    <div class="row-wrap" style="margin-top:4px">
                      {next && <DeadlineBadge d={next} />}
                      {mastered > 0 && <Badge kind="ok">{mastered} goal{mastered === 1 ? '' : 's'} mastered</Badge>}
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface GoalDraft extends GoalRecord {
  isNew: boolean;
}

export function StudentEditor({ code }: { code?: string }) {
  const { store, vault, authenticate, toast } = useApp();
  const existing = code ? store.students.get(code) : undefined;
  const isNew = !existing;
  const [initialCode] = useState(() => existing?.code ?? makeCode(new Set(store.students.keys())));
  const [studentCode, setStudentCode] = useState(initialCode);
  const [alias, setAlias] = useState(existing?.alias ?? aliasFor(initialCode));
  const [gradeBand, setGradeBand] = useState(existing?.gradeBand ?? '');
  const [serviceMode, setServiceMode] = useState<StudentRecord['serviceMode']>(existing?.serviceMode ?? 'individual');
  const [weeklyMinutes, setWeeklyMinutes] = useState(existing?.weeklyMinutes ?? 30);
  const [reportCadence, setReportCadence] = useState(existing?.reportCadence ?? 'Quarterly');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [iepDate, setIepDate] = useState(existing?.iepDate ?? '');
  const [lastEvalDate, setLastEvalDate] = useState(existing?.lastEvalDate ?? '');
  const [reevalYears, setReevalYears] = useState<2 | 3>(existing?.reevalYears ?? 3);
  const [evalConsentDate, setEvalConsentDate] = useState(existing?.evalConsentDate ?? '');
  const prefs = usePrefs();
  const [goals, setGoals] = useState<GoalDraft[]>(() =>
    existing
      ? [...existing.goals].sort((a, b) => a.number - b.number).map((g) => ({ ...g, isNew: false }))
      : [{ id: uuid(), number: 1, shortName: '', detail: '', criterionPercent: 80, isActive: true, isNew: true }]
  );
  const [identity, setIdentity] = useState<StudentIdentity | null>(() => (isNew ? emptyIdentity() : null));
  const usedSessions = new Set(store.sessionList().filter((s) => s.studentCode === initialCode).flatMap((s) => s.observations.map((o) => o.goalID)));

  if (code && !existing) {
    return <div class="stack"><div class="topbar"><BackButton to="students" /><h2>Student not found</h2></div></div>;
  }

  const setGoal = (i: number, patch: Partial<GoalDraft>) => setGoals((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGoal = () => setGoals((list) => [...list, { id: uuid(), number: Math.max(0, ...list.map((g) => g.number)) + 1, shortName: '', detail: '', criterionPercent: 80, isActive: true, isNew: true }]);

  const unlockIdentity = async () => {
    if (await authenticate('Show this student’s identity')) setIdentity(vault.get(initialCode) ?? emptyIdentity());
  };

  const save = async () => {
    const keptGoals: GoalRecord[] = goals
      .filter((g) => g.shortName.trim() || !g.isNew)
      .map(({ isNew: _isNew, ...g }) => ({ ...g, shortName: g.shortName.trim() || `Goal ${g.number}` }));
    const record: StudentRecord = {
      code: studentCode,
      alias: alias.trim(),
      gradeBand: gradeBand.trim(),
      serviceMode,
      weeklyMinutes,
      reportCadence,
      isActive,
      createdAt: existing?.createdAt ?? new Date(),
      goals: keptGoals,
      iepDate: iepDate || undefined,
      lastEvalDate: lastEvalDate || undefined,
      reevalYears,
      evalConsentDate: evalConsentDate || undefined,
      reportsExported: existing?.reportsExported
    };
    await store.putStudent(record, isNew ? 'created' : 'edited');
    if (identity) {
      if (!vault.isUnlocked) {
        const ok = await authenticate('Save this student’s identity');
        if (!ok) {
          toast('Saved, but the identity wasn’t stored: the vault stayed locked.');
          go('students');
          return;
        }
      }
      await vault.set(studentCode, identity);
    }
    toast(isNew ? 'Student added.' : 'Saved.');
    go('students');
  };

  return (
    <div class="stack">
      <div class="topbar">
        <BackButton to="students" />
        <h2 class="spacer">{isNew ? 'New student' : studentCode}</h2>
        <button class="btn primary" style="min-height:44px" disabled={!alias.trim()} onClick={save}>Save</button>
      </div>

      <section class="card stack">
        <div class="row">
          <span class="label">Code</span>
          <span class="spacer" />
          <span class="mono">{studentCode}</span>
          {isNew && (
            <button type="button" class="link" onClick={() => { const c = makeCode(new Set(store.students.keys())); setStudentCode(c); setAlias(aliasFor(c)); }}>New code</button>
          )}
        </div>
        <Field label="Alias (shown in lists)" id="alias" hint="Pick an alias that isn't the child's name or initials.">
          <input id="alias" class="input" value={alias} onInput={(e) => setAlias(val(e))} />
        </Field>
        <div class="grid2">
          <Field label="Grade band" id="grade"><input id="grade" class="input" placeholder="e.g. 1–2" value={gradeBand} onInput={(e) => setGradeBand(val(e))} /></Field>
          <Field label="Minutes / week" id="mins"><input id="mins" class="input" type="number" inputMode="numeric" min={0} step={15} value={weeklyMinutes} onInput={(e) => setWeeklyMinutes(Number(val(e)) || 0)} /></Field>
        </div>
        <div class="grid2">
          <Field label="Service" id="mode">
            <select id="mode" class="input" value={serviceMode} onChange={(e) => setServiceMode(val(e) as StudentRecord['serviceMode'])}>
              <option value="individual">Individual</option>
              <option value="group">Group</option>
            </select>
          </Field>
          <Field label="Progress reports" id="cad">
            <select id="cad" class="input" value={reportCadence} onChange={(e) => setReportCadence(val(e))}>
              {['Monthly', 'Quarterly', 'With report cards', 'Annually'].map((c) => <option value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        {!isNew && <label class="check"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive((e.currentTarget as HTMLInputElement).checked)} /> Active</label>}
      </section>

      <section class="card stack">
        <h2>IEP and evaluation dates</h2>
        <div class="grid2">
          <Field label="Current IEP meeting" id="iep"><input id="iep" class="input" type="date" value={iepDate} onInput={(e) => setIepDate(val(e))} /></Field>
          <Field label="Last ER / RR" id="er"><input id="er" class="input" type="date" value={lastEvalDate} onInput={(e) => setLastEvalDate(val(e))} /></Field>
        </div>
        <Field label="Re-evaluation cycle" id="rr">
          <select id="rr" class="input" value={String(reevalYears)} onChange={(e) => setReevalYears(val(e) === '2' ? 2 : 3)}>
            <option value="3">Every 3 years</option>
            <option value="2">Every 2 years (required for intellectual disability in PA)</option>
          </select>
        </Field>
        <Field label="Permission to evaluate received (if an evaluation is open)" id="pte" hint="Starts the 60-calendar-day clock. Summer break is skipped using the dates in Settings.">
          <input id="pte" class="input" type="date" value={evalConsentDate} onInput={(e) => setEvalConsentDate(val(e))} />
        </Field>
        {evalConsentDate && (
          <button type="button" class="btn block" onClick={() => { setLastEvalDate(toKey(new Date())); setEvalConsentDate(''); }}>Evaluation report finished today</button>
        )}
        <DueList deadlines={deadlinesFor({ code: studentCode, isActive: true, createdAt: existing?.createdAt ?? new Date(), reportCadence, iepDate: iepDate || undefined, lastEvalDate: lastEvalDate || undefined, reevalYears, evalConsentDate: evalConsentDate || undefined, reportsExported: existing?.reportsExported }, toKey(new Date()), schoolCalendar(prefs), 400)} />
        <div class="tiny muted">Dates follow PA and IDEA timelines. Check your district's internal deadlines, which are often earlier.</div>
      </section>

      <section class="stack-sm">
        <h2 class="section-title">IEP goals</h2>
        {goals.map((g, i) => (
          <div class="card stack-sm">
            <Field label={`Goal ${g.number} name`} id={`g-${g.id}`}>
              <input id={`g-${g.id}`} class="input" placeholder="e.g. Letter formation" value={g.shortName} onInput={(e) => setGoal(i, { shortName: val(e) })} />
            </Field>
            <Field label="Goal text from the IEP (optional)" id={`gd-${g.id}`}>
              <textarea id={`gd-${g.id}`} class="input" style="min-height:80px" value={g.detail} onInput={(e) => setGoal(i, { detail: val(e) })} />
            </Field>
            <div class="row">
              <Field label="Criterion %" id={`gc-${g.id}`}>
                <input id={`gc-${g.id}`} class="input" type="number" inputMode="numeric" min={10} max={100} step={5} style="width:110px" value={g.criterionPercent} onInput={(e) => setGoal(i, { criterionPercent: Math.min(100, Math.max(0, Number(val(e)) || 0)) })} />
              </Field>
              <span class="spacer" />
              {g.isNew || !usedSessions.has(g.id) ? (
                <button type="button" class="link" onClick={() => setGoals((list) => list.filter((_, j) => j !== i))}>Remove</button>
              ) : (
                <label class="check"><input type="checkbox" checked={g.isActive} onChange={(e) => setGoal(i, { isActive: (e.currentTarget as HTMLInputElement).checked })} /> Active</label>
              )}
            </div>
          </div>
        ))}
        <button type="button" class="btn block" onClick={addGoal}>Add goal</button>
        <div class="tiny muted">Goals with recorded data can be made inactive but not removed.</div>
      </section>

      <section class="card stack">
        <h2>Identity vault</h2>
        {identity ? (
          <>
            <Field label="Real name" id="rn"><input id="rn" class="input" autocomplete="off" value={identity.realName} onInput={(e) => setIdentity({ ...identity, realName: val(e) })} /></Field>
            <div class="grid2">
              <Field label="Date of birth" id="dob"><input id="dob" class="input" placeholder="MM/DD/YYYY" autocomplete="off" value={identity.dateOfBirth} onInput={(e) => setIdentity({ ...identity, dateOfBirth: val(e) })} /></Field>
              <Field label="PA Secure ID" id="psid"><input id="psid" class="input" inputMode="numeric" autocomplete="off" value={identity.paSecureID} onInput={(e) => setIdentity({ ...identity, paSecureID: val(e) })} /></Field>
            </div>
            <Field label="Diagnosis / condition (for SBAP logs)" id="dx"><input id="dx" class="input" autocomplete="off" value={identity.diagnosis} onInput={(e) => setIdentity({ ...identity, diagnosis: val(e) })} /></Field>
          </>
        ) : (
          <button type="button" class="btn outline block" onClick={unlockIdentity}><Svg size={18}>{Icon.lock}</Svg> Unlock identity</button>
        )}
        <div class="tiny muted">Encrypted on this device only. Never included in backups or sent anywhere.</div>
      </section>
    </div>
  );
}

export function DeadlineBadge({ d }: { d: Deadline }) {
  return <Badge kind={d.status === 'upcoming' ? 'neutral' : 'warn'}>{DEADLINE_KIND_LABEL[d.kind]} {describeDays(d)}</Badge>;
}

function DueList({ deadlines }: { deadlines: Deadline[] }) {
  if (!deadlines.length) return null;
  return (
    <div class="stack-sm">
      {deadlines.map((d) => (
        <div class="row small">
          <span class="spacer">{d.label}</span>
          <span>{fromKey(d.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <Badge kind={d.status === 'upcoming' ? 'neutral' : 'warn'}>{describeDays(d)}</Badge>
        </div>
      ))}
    </div>
  );
}

/** Goals whose latest N sessions (all time) are at criterion. */
function masteredGoals(store: ReturnType<typeof useApp>['store'], st: StudentRecord, needed: number): number {
  const snaps = store.sessionList().filter((s) => s.studentCode === st.code).map((s) => snapshot(s, st));
  const all = { start: new Date(0), end: new Date(8.64e15) };
  return goalSnapshots(st).filter((g) => mastery(goalProgress(g, snaps, all, 'period').points, g.criterionPercent, needed).mastered).length;
}
