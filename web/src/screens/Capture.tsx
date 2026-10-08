import { useEffect, useState } from 'preact/hooks';
import {
  ATTENDANCE, ATTENDANCE_LABEL, Attendance, DELIVERY, DELIVERY_LABEL, Delivery,
  PROGRESS_INDICATORS, PROGRESS_LABEL, REGULATION_STATES, percent, serviceDelivered
} from '../core/types';
import { scrubNames } from '../core/pseudonym';
import { TimeStyle } from '../core/time';
import type { GoalObservation } from '../core/types';
import type { SessionRecord } from '../data/db';
import { enabledPromptLevels, usePrefs } from '../data/prefs';
import { BackButton, Chip, Sheet, go, toTimeInput, useApp, val, withTime } from '../ui/components';

const time = new TimeStyle();
const REG_FILL: Record<string, string> = { Low: 'var(--reg-low)', Calm: 'var(--reg-calm)', Heightened: 'var(--reg-heightened)', High: 'var(--reg-high)' };

export function Capture({ groupKey }: { groupKey: string }) {
  const { store, vault, toast } = useApp();
  const prefs = usePrefs();
  const sessions = store.group(groupKey);
  const [code, setCode] = useState<string | undefined>(sessions[0]?.studentCode);
  const [details, setDetails] = useState(false);
  const current = sessions.find((s) => s.studentCode === code) ?? sessions[0];

  // Scrub names from comments when leaving the screen or switching student.
  const scrub = async () => {
    const names = vault.namesForScrubbing();
    if (!Object.keys(names).length) return;
    for (const s of store.group(groupKey)) {
      if (s.signedAt || !s.comment) continue;
      const r = scrubNames(s.comment, names);
      if (r.replacements > 0) {
        await store.updateSession(s.id, (x) => { x.comment = r.text; });
        await store.audit('Session', s.id, 'scrubbed names', `${r.replacements} replaced`);
      }
    }
  };
  useEffect(() => () => { scrub(); }, [groupKey]);

  if (!current) {
    return <div class="stack"><div class="topbar"><BackButton to="today" /><h2>Session not found</h2></div></div>;
  }

  const student = store.students.get(current.studentCode);
  const goals = (student?.goals ?? []).filter((g) => g.isActive).sort((a, b) => a.number - b.number);
  const locked = !!current.signedAt;
  const update = (change: (s: SessionRecord) => void) => store.updateSession(current.id, change);
  const updateObs = (goalID: string, change: (o: GoalObservation) => void) =>
    update((s) => {
      let o = s.observations.find((x) => x.goalID === goalID);
      if (!o) {
        o = { goalID, correct: 0, total: 0 };
        s.observations.push(o);
      }
      change(o);
    });

  const end = async () => {
    const now = new Date();
    const open = sessions.filter((s) => !s.end && serviceDelivered(s.attendance));
    await store.putSessions(open.map((s) => ({ ...s, end: now })), 'ended');
    await scrub();
    toast(`Session ended at ${time.time(now)}.`);
    go('today');
  };

  return (
    <div class="stack with-actionbar">
      <div class="topbar">
        <BackButton to="today" />
        <div class="spacer" style="min-width:0">
          <div class="mono">{sessions.length > 1 ? `Group of ${sessions.length}` : current.studentCode}</div>
          <div class="tiny muted">{student?.alias}{current.start ? ` · started ${time.time(current.start)}` : ''}</div>
        </div>
        <button class="btn" style="min-height:44px" onClick={() => setDetails(true)}>Details</button>
      </div>

      {sessions.length > 1 && (
        <div class="row-wrap" role="tablist" aria-label="Students in this group">
          {sessions.map((s) => (
            <Chip square on={s.id === current.id} onClick={() => { scrub(); setCode(s.studentCode); }}>
              <span class="mono">{s.studentCode}</span>
            </Chip>
          ))}
        </div>
      )}

      {locked && <div class="card small muted">This note is signed and locked. Changes go in an addendum on the Review tab.</div>}

      {!serviceDelivered(current.attendance) ? (
        <div class="card" style="color:var(--amber)">{ATTENDANCE_LABEL[current.attendance]}. No service is recorded for this session.</div>
      ) : (
        <fieldset disabled={locked} style="border:0;padding:0;margin:0;min-width:0" class="stack">
          <section class="stack-sm">
            <h2 class="section-title">Activities</h2>
            <div class="row-wrap">
              {prefs.activityCatalog.map((a) => (
                <Chip on={current.activities.some((x) => x.id === a.id)} onClick={() => update((s) => {
                  s.activities = s.activities.some((x) => x.id === a.id) ? s.activities.filter((x) => x.id !== a.id) : [...s.activities, a];
                })}>{a.name}</Chip>
              ))}
            </div>
          </section>

          {goals.length === 0 && <div class="small muted">No goals yet. Add IEP goals for this student on the Students tab.</div>}
          {goals.map((g) => {
            const o = current.observations.find((x) => x.goalID === g.id) ?? { goalID: g.id, correct: 0, total: 0 };
            const pct = percent(o);
            return (
              <section class="card stack-sm">
                <div class="goal-head">
                  <h2>Goal {g.number} · {g.shortName}</h2>
                  <button type="button" class="link" onClick={() => updateObs(g.id, (x) => { x.correct = 0; x.total = 0; })}>Reset</button>
                </div>
                <div class="row">
                  <button type="button" class="btn primary big" style="flex:1" onClick={() => updateObs(g.id, (x) => { x.correct++; x.total++; })}>Correct</button>
                  <button type="button" class="btn outline big" style="flex:1" onClick={() => updateObs(g.id, (x) => { x.total++; })}>Miss</button>
                  <div class="score" aria-live="polite">
                    <div class="pct">{pct == null ? '—' : `${pct}%`}</div>
                    <div class="tiny muted">{o.correct} / {o.total}</div>
                  </div>
                </div>
                <div class="tiny muted">Prompt level</div>
                <div class="row-wrap" style="gap:6px">
                  {enabledPromptLevels(prefs).map((l) => (
                    <Chip square label={l.name} on={o.promptLevelName === l.name} onClick={() => updateObs(g.id, (x) => {
                      x.promptLevelName = x.promptLevelName === l.name ? undefined : l.name;
                    })}>{l.shortName}</Chip>
                  ))}
                </div>
              </section>
            );
          })}

          <section class="stack-sm">
            <h2 class="section-title">Regulation</h2>
            <div class="grid4">
              {REGULATION_STATES.map((r) => (
                <Chip square class="reg" style={`background:${REG_FILL[r]};min-height:48px`} on={current.regulation === r}
                  onClick={() => update((s) => { s.regulation = s.regulation === r ? undefined : r; })}>{r}</Chip>
              ))}
            </div>
          </section>

          <section class="stack-sm">
            <h2 class="section-title">Engagement (1 low – 5 high)</h2>
            <div class="grid5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip square style="min-height:48px;font-size:17px" on={current.engagement === n}
                  onClick={() => update((s) => { s.engagement = s.engagement === n ? undefined : n; })}>{n}</Chip>
              ))}
            </div>
          </section>

          <section class="stack-sm">
            <h2 class="section-title">Session progress</h2>
            <div class="row-wrap" style="gap:6px">
              {PROGRESS_INDICATORS.map((p) => (
                <Chip square on={current.progress === p} onClick={() => update((s) => { s.progress = s.progress === p ? undefined : p; })}>{PROGRESS_LABEL[p]}</Chip>
              ))}
            </div>
          </section>

          <section class="field">
            <label for="comment">Quick comment (optional)</label>
            <input id="comment" class="input" placeholder="e.g. used slant board" value={current.comment}
              onInput={(e) => update((s) => { s.comment = val(e); })} />
            <div class="tiny muted">{vault.isUnlocked ? 'Any student name typed here is replaced with the code when you leave.' : 'Avoid typing names here; unlock the vault on the Students tab to have them replaced automatically.'}</div>
          </section>
        </fieldset>
      )}

      <div class="actionbar">
        <div class="inner">
          <span class="small muted">{current.start ? `Started ${time.time(current.start)}` : ''}{current.end ? ` · ended ${time.time(current.end)}` : ''}</span>
          <span class="spacer" />
          {!current.end && serviceDelivered(current.attendance) ? (
            <button class="btn primary" onClick={end}>End session</button>
          ) : (
            <a class="btn outline" href={`#/review/${current.id}`}>Review note</a>
          )}
        </div>
      </div>

      {details && <DetailsSheet sessions={sessions} onClose={() => setDetails(false)} />}
    </div>
  );
}

function DetailsSheet({ sessions, onClose }: { sessions: SessionRecord[]; onClose: () => void }) {
  const { store } = useApp();
  const first = sessions[0];
  const day = first.start ?? first.date;
  const [attendance, setAttendance] = useState<Attendance>(first.attendance);
  const [delivery, setDelivery] = useState<Delivery>(first.delivery);
  const [makeUp, setMakeUp] = useState(first.isMakeUp);
  const [start, setStart] = useState(toTimeInput(first.start ?? first.date));
  const [hasEnd, setHasEnd] = useState(!!first.end);
  const [end, setEnd] = useState(toTimeInput(first.end ?? new Date(day.getTime() + 30 * 60_000)));
  const startDate = withTime(day, start);
  const endDate = withTime(day, end);
  const bad = hasEnd && endDate <= startDate;

  const save = async () => {
    const delivered = serviceDelivered(attendance);
    const next = sessions.filter((s) => !s.signedAt).map((s) => ({
      ...s,
      attendance,
      delivery,
      isMakeUp: delivered && makeUp,
      start: delivered ? startDate : undefined,
      end: delivered && hasEnd ? endDate : undefined
    }));
    await store.putSessions(next, 'edited details', `${attendance} ${delivery}`);
    onClose();
  };

  return (
    <Sheet title="Session details" onClose={onClose}>
      <div class="stack">
        <div class="field">
          <label for="d-att">Attendance</label>
          <select id="d-att" class="input" value={attendance} onChange={(e) => setAttendance(val(e) as Attendance)}>
            {ATTENDANCE.map((a) => <option value={a}>{ATTENDANCE_LABEL[a]}</option>)}
          </select>
        </div>
        <div class="field">
          <label for="d-del">Delivery</label>
          <select id="d-del" class="input" value={delivery} onChange={(e) => setDelivery(val(e) as Delivery)}>
            {DELIVERY.map((d) => <option value={d}>{DELIVERY_LABEL[d]}</option>)}
          </select>
        </div>
        <label class="check"><input type="checkbox" checked={makeUp} onChange={(e) => setMakeUp((e.currentTarget as HTMLInputElement).checked)} /> Make-up session</label>
        <div class="grid2">
          <div class="field"><label for="d-start">Start</label><input id="d-start" class="input" type="time" value={start} onInput={(e) => setStart(val(e))} /></div>
          <div class="field"><label for="d-end">End</label><input id="d-end" class="input" type="time" value={end} disabled={!hasEnd} onInput={(e) => setEnd(val(e))} /></div>
        </div>
        <label class="check"><input type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd((e.currentTarget as HTMLInputElement).checked)} /> Session has ended</label>
        <div class="tiny muted">Exact times only. Minutes are never rounded up.</div>
        {bad && <div class="issue blocking">End time must be after start time.</div>}
        <button class="btn primary block" disabled={bad} onClick={save}>Save</button>
      </div>
    </Sheet>
  );
}
