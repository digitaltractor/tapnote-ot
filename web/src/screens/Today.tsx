import { useState } from 'preact/hooks';
import { ATTENDANCE, ATTENDANCE_LABEL, Attendance, serviceDelivered } from '../core/types';
import { TimeStyle } from '../core/time';
import { ScheduleSlot, dayKey, slotStart, slotsForDay, unloggedSlots } from '../core/schedule';
import { minutesSummary } from '../core/minutes';
import type { SessionRecord } from '../data/db';
import { isInProgress } from '../data/store';
import { getPrefs, schoolCalendar, usePrefs } from '../data/prefs';
import { allDeadlines, describeDays } from '../core/deadlines';
import { followUps, supervisionMonth } from '../core/contacts';
import { LogEditor } from './Logs';
import { Badge, Sheet, go, sameDay, useApp, uuid } from '../ui/components';

const time = new TimeStyle();

export interface SessionGroup {
  key: string;
  sessions: SessionRecord[];
}

export function groupSessions(list: SessionRecord[]): SessionGroup[] {
  const map = new Map<string, SessionRecord[]>();
  for (const s of list) map.set(s.groupKey, [...(map.get(s.groupKey) ?? []), s]);
  return [...map.entries()]
    .map(([key, sessions]) => ({ key, sessions: sessions.sort((a, b) => a.studentCode.localeCompare(b.studentCode)) }))
    .sort((a, b) => (a.sessions[0].start ?? a.sessions[0].date).getTime() - (b.sessions[0].start ?? b.sessions[0].date).getTime());
}

/** Outstanding owed misses (therapist-side) for these students, oldest first. */
function outstandingMisses(store: ReturnType<typeof useApp>['store'], codes: string[]) {
  const prefs = getPrefs();
  const all = store.sessionList();
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 6, end.getDate());
  return codes.flatMap((code) => {
    const st = store.students.get(code);
    const sum = minutesSummary(code, st?.weeklyMinutes ?? 0, all, { start, end }, { countStudentUnavailable: prefs.countStudentUnavailableAsOwed });
    return sum.owed.filter((o) => o.minutes > o.madeUp).map((o) => ({ ...o, code }));
  });
}

export function Today() {
  const { store } = useApp();
  const prefs = usePrefs();
  const [starting, setStarting] = useState(false);
  const [logging, setLogging] = useState(false);
  const [slotAction, setSlotAction] = useState<{ slot: ScheduleSlot; mode: 'start' | 'absent' } | null>(null);
  const now = new Date();
  const today = dayKey(now);
  const closed = store.closures.includes(today);
  const todays = store.sessionList().filter((s) => sameDay(s.date, now));
  const groups = groupSessions(todays);
  const allToday = slotsForDay(store.slotList(), now, []);
  const planned = slotsForDay(store.slotList(), now, store.closures).filter((slot) => !todays.some((s) => s.slotId === slot.id));
  const twoWeeksAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gaps = unloggedSlots(store.slotList(), store.sessionList(), twoWeeksAgo, startOfToday, store.closures);

  type Row = { at: Date; el: preact.JSX.Element };
  const rows: Row[] = [
    ...planned.map((slot) => ({ at: slotStart(slot, now), el: <PlannedRow slot={slot} onStart={() => startSlot(slot)} onAbsent={() => setSlotAction({ slot, mode: 'absent' })} /> })),
    ...groups.map((g) => ({ at: g.sessions[0].start ?? g.sessions[0].date, el: <GroupRow g={g} /> }))
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  async function startSlot(slot: ScheduleSlot) {
    if (slot.studentCodes.length > 1) {
      setSlotAction({ slot, mode: 'start' });
      return;
    }
    const key = await createFromSlot(store, slot, slot.studentCodes, 'studentAbsent');
    go(`session/${key}`);
  }

  return (
    <div class="stack">
      <div>
        <div class="eyebrow">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>Today</h1>
        <div class="muted">
          {closed ? 'No school today.' : `${planned.length} planned · ${groups.length} logged · ${groups.filter((g) => g.sessions.every((s) => s.signedAt)).length} signed`}
        </div>
      </div>

      {closed ? (
        <div class="card row">
          <span class="spacer">No school today. Scheduled sessions aren't owed.</span>
          <button class="link" onClick={() => store.setClosures(store.closures.filter((d) => d !== today))}>Undo</button>
        </div>
      ) : null}

      <div class="grid2">
        <button class="btn primary big" onClick={() => setStarting(true)}>Unscheduled session</button>
        <a class="btn big" href="#/schedule">Weekly schedule</a>
        <button class="btn" onClick={() => setLogging(true)}>Log a contact</button>
        <a class="btn" href="#/logs">Logs</a>
      </div>

      <DueSoon />
      {prefs.role === 'COTA' && <SupervisionNudge />}

      {gaps.length > 0 && (
        <a class="card row" href="#/reports/minutes" style="text-decoration:none;color:inherit;border-color:var(--amber)">
          <span class="spacer small">{gaps.length} scheduled session{gaps.length === 1 ? '' : 's'} in the last 2 weeks {gaps.length === 1 ? 'has' : 'have'} nothing logged.</span>
          <span class="badge warn">Review</span>
        </a>
      )}

      {rows.length === 0 ? (
        <div class="empty">
          {allToday.length === 0 && store.slots.size === 0
            ? 'Nothing scheduled. Set up a weekly schedule so each day fills in automatically, or start an unscheduled session.'
            : 'Nothing else on the schedule today.'}
        </div>
      ) : (
        <div class="list">{rows.map((r) => r.el)}</div>
      )}

      {!closed && allToday.length > 0 && (
        <button class="link" style="align-self:center" onClick={() => {
          if (confirm('Mark today as no school? Today’s scheduled sessions won’t count as missed.')) store.setClosures([...store.closures, today]);
        }}>No school today?</button>
      )}

      {starting && <StartSession onClose={() => setStarting(false)} />}
      {logging && <LogEditor kind="consult" onClose={() => setLogging(false)} />}
      {slotAction && <SlotSheet slot={slotAction.slot} mode={slotAction.mode} onClose={() => setSlotAction(null)} />}
    </div>
  );
}

function PlannedRow({ slot, onStart, onAbsent }: { slot: ScheduleSlot; onStart: () => void; onAbsent: () => void }) {
  const { store } = useApp();
  const aliases = slot.studentCodes.map((c) => store.students.get(c)?.alias ?? '').filter(Boolean).join(', ');
  return (
    <div class="card stack-sm" style="border-style:dashed">
      <div class="row">
        <div class="bold" style="width:72px;flex:none">{time.time(slotStart(slot, new Date()))}</div>
        <div class="spacer" style="min-width:0;display:flex;flex-direction:column;gap:2px">
          <span class="mono">{slot.studentCodes.join(', ')}</span>
          <span class="small muted">{slot.studentCodes.length > 1 ? `Group of ${slot.studentCodes.length}` : 'Individual'} · {slot.minutes} min{aliases ? ` · ${aliases}` : ''}</span>
        </div>
        <Badge>Planned</Badge>
      </div>
      <div class="grid2">
        <button class="btn primary" onClick={onStart}>Start</button>
        <button class="btn" onClick={onAbsent}>Absent / missed…</button>
      </div>
    </div>
  );
}

function GroupRow({ g }: { g: SessionGroup }) {
  const { store } = useApp();
  const first = g.sessions[0];
  const delivered = serviceDelivered(first.attendance);
  const allSigned = g.sessions.every((s) => s.signedAt);
  const needsCoSign = g.sessions.some((s) => s.signedAt && s.signerRole === 'COTA' && !s.coSignedAt);
  const inProgress = g.sessions.some(isInProgress);
  const kind = !delivered ? ATTENDANCE_LABEL[first.attendance] : g.sessions.length > 1 ? `Group of ${g.sessions.length}` : 'Individual';
  const aliases = g.sessions.map((s) => store.students.get(s.studentCode)?.alias ?? '').filter(Boolean).join(', ');
  return (
    <a class="list-item" href={delivered ? `#/session/${g.key}` : `#/review/${first.id}`}>
      <div class="bold" style="width:72px;flex:none">{(first.start ?? first.date) ? time.time(first.start ?? first.date) : '—'}</div>
      <div class="grow">
        <span class="mono">{g.sessions.map((s) => s.studentCode).join(', ')}</span>
        <span class="small muted">{kind}{first.isMakeUp ? ' · make-up' : ''}{aliases ? ` · ${aliases}` : ''}</span>
      </div>
      {needsCoSign ? <Badge kind="warn">Co-sign</Badge> : allSigned ? <Badge kind="ok">Signed</Badge> : inProgress ? <Badge>In progress</Badge> : !delivered ? <Badge kind="warn">Missed</Badge> : <Badge>To review</Badge>}
    </a>
  );
}

/** Creates sessions for a scheduled slot. Present students share one group; the rest are logged with `absentReason`. */
async function createFromSlot(store: ReturnType<typeof useApp>['store'], slot: ScheduleSlot, present: string[], absentReason: Attendance): Promise<string> {
  const now = new Date();
  const key = uuid();
  const planned = slotStart(slot, now);
  const presentSessions: SessionRecord[] = present.map((code) => ({
    id: uuid(), groupKey: key, studentCode: code, groupSize: present.length, plannedMinutes: slot.minutes,
    date: now, start: now, attendance: 'present', delivery: 'inPerson', isMakeUp: false,
    activities: [], observations: [], comment: '', addenda: [], slotId: slot.id
  }));
  const absent = slot.studentCodes.filter((c) => !present.includes(c));
  const absentSessions: SessionRecord[] = absent.map((code) => ({
    id: uuid(), groupKey: uuid(), studentCode: code, groupSize: 1, plannedMinutes: slot.minutes,
    date: planned, attendance: absentReason, delivery: 'inPerson', isMakeUp: false,
    activities: [], observations: [], comment: '', addenda: [], slotId: slot.id
  }));
  if (presentSessions.length) await store.putSessions(presentSessions, 'started from schedule');
  if (absentSessions.length) await store.putSessions(absentSessions, `logged ${absentReason} from schedule`);
  return key;
}

function SlotSheet({ slot, mode, onClose }: { slot: ScheduleSlot; mode: 'start' | 'absent'; onClose: () => void }) {
  const { store, toast } = useApp();
  const [present, setPresent] = useState<string[]>(mode === 'start' ? slot.studentCodes : []);
  const [reason, setReason] = useState<Attendance>('studentAbsent');
  const missedReasons = ATTENDANCE.filter((a) => a !== 'present');

  const submit = async () => {
    const key = await createFromSlot(store, slot, present, reason);
    onClose();
    if (present.length) go(`session/${key}`);
    else toast(`Logged: ${ATTENDANCE_LABEL[reason].toLowerCase()}.`);
  };

  return (
    <Sheet title={mode === 'start' ? 'Who’s here?' : 'Log a missed session'} onClose={onClose}>
      <div class="stack">
        {slot.studentCodes.length > 1 && (
          <div class="stack-sm">
            <div class="label">Present</div>
            {slot.studentCodes.map((c) => (
              <label class="check"><input type="checkbox" checked={present.includes(c)}
                onChange={() => setPresent(present.includes(c) ? present.filter((x) => x !== c) : [...present, c])} /> <span class="mono">{c}</span></label>
            ))}
          </div>
        )}
        {present.length < slot.studentCodes.length && (
          <div class="field">
            <label for="miss-reason">{slot.studentCodes.length > 1 ? 'Reason for students not present' : 'Reason'}</label>
            <select id="miss-reason" class="input" value={reason} onChange={(e) => setReason((e.currentTarget as HTMLSelectElement).value as Attendance)}>
              {missedReasons.map((a) => <option value={a}>{ATTENDANCE_LABEL[a]}</option>)}
            </select>
            <div class="tiny muted">Therapist absent or not available counts as minutes owed. {getPrefs().countStudentUnavailableAsOwed ? 'Student not available does too (Settings).' : 'Student absences don’t.'}</div>
          </div>
        )}
        <button class="btn primary block big" onClick={submit}>{present.length ? `Start with ${present.length}` : 'Log missed session'}</button>
      </div>
    </Sheet>
  );
}

function StartSession({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const students = store.studentList().filter((s) => s.isActive);
  const [selected, setSelected] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<Attendance>('present');
  const [makeUp, setMakeUp] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const owed = makeUp ? outstandingMisses(store, selected) : [];

  const toggle = (code: string) => setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const start = async () => {
    if (selected.length === 0) return;
    const key = uuid();
    const now = new Date();
    const delivered = serviceDelivered(attendance);
    const sessions: SessionRecord[] = [...selected].sort().map((code) => ({
      id: uuid(),
      groupKey: key,
      studentCode: code,
      groupSize: selected.length,
      plannedMinutes: getPrefs().defaultSessionMinutes,
      date: now,
      start: delivered ? now : undefined,
      attendance,
      delivery: 'inPerson',
      isMakeUp: delivered && makeUp,
      makeUpFor: delivered && makeUp ? owed.filter((o) => o.code === code && covers.includes(o.sessionId)).map((o) => o.sessionId) : undefined,
      activities: [],
      observations: [],
      comment: '',
      addenda: []
    }));
    await store.putSessions(sessions, delivered ? (makeUp ? 'started make-up' : 'started') : `logged ${attendance}`);
    onClose();
    if (delivered) go(`session/${key}`);
  };

  return (
    <Sheet title="Unscheduled session" onClose={onClose}>
      <div class="stack">
        <div class="field">
          <label for="att">Attendance</label>
          <select id="att" class="input" value={attendance} onChange={(e) => setAttendance((e.currentTarget as HTMLSelectElement).value as Attendance)}>
            {ATTENDANCE.map((a) => <option value={a}>{ATTENDANCE_LABEL[a]}</option>)}
          </select>
        </div>
        {attendance === 'present' && (
          <label class="check"><input type="checkbox" checked={makeUp} onChange={(e) => setMakeUp((e.currentTarget as HTMLInputElement).checked)} /> Make-up session</label>
        )}
        <div class="stack-sm">
          <div class="label">Students</div>
          {students.length === 0 && <div class="muted">Add students on the Students tab first.</div>}
          {students.map((s) => (
            <button type="button" class="list-item" style="min-height:52px" aria-pressed={selected.includes(s.code)} onClick={() => toggle(s.code)}>
              <span aria-hidden="true" style={`width:22px;height:22px;border-radius:50%;flex:none;border:2px solid var(--acc);background:${selected.includes(s.code) ? 'var(--acc)' : 'transparent'}`} />
              <span class="grow"><span class="mono">{s.code}</span><span class="small muted">{s.alias}</span></span>
            </button>
          ))}
        </div>
        {makeUp && selected.length > 0 && (
          <div class="card stack-sm">
            <div class="label">This make-up covers</div>
            {owed.length === 0 && <div class="small muted">No outstanding missed sessions for these students. Minutes will still count as a make-up.</div>}
            {owed.map((o) => (
              <label class="check"><input type="checkbox" checked={covers.includes(o.sessionId)}
                onChange={() => setCovers(covers.includes(o.sessionId) ? covers.filter((x) => x !== o.sessionId) : [...covers, o.sessionId])} />
                <span><span class="mono">{o.code}</span> · {time.date(o.date)} · {o.minutes - o.madeUp} min owed · {ATTENDANCE_LABEL[o.reason].toLowerCase()}</span></label>
            ))}
          </div>
        )}
        <div class="tiny muted">{selected.length > 1 ? 'Group session: one timer, separate trials and ratings for each student.' : 'Pick two or more students for a group session.'}</div>
        <button class="btn primary block big" disabled={selected.length === 0} onClick={start}>{attendance === 'present' ? 'Start' : 'Log absence'}</button>
      </div>
    </Sheet>
  );
}

/** Beta 2: overdue and due-soon IEP, evaluation and report dates, plus contact follow-ups. */
function DueSoon() {
  const { store } = useApp();
  const prefs = usePrefs();
  const today = dayKey(new Date());
  const items = [
    ...allDeadlines(store.studentList(), today, schoolCalendar(prefs)).filter((d) => d.status !== 'upcoming')
      .map((d) => ({ key: `${d.code}-${d.kind}-${d.due}`, due: d.due, overdue: d.status === 'overdue', code: d.code, text: d.label, when: describeDays(d), href: `#/students/${encodeURIComponent(d.code)}` })),
    ...followUps(store.contactList(), today).filter((f) => f.status !== 'upcoming')
      .map((f) => ({ key: f.entry.id, due: f.due, overdue: f.status === 'overdue', code: f.entry.studentCodes.join(', '), text: `Follow up: ${f.entry.topic || f.entry.who}`, when: describeDays(f), href: `#/logs/${f.entry.kind}` }))
  ].sort((a, b) => a.due.localeCompare(b.due));
  if (!items.length) return null;
  const shown = items.slice(0, 5);
  return (
    <section class="card stack-sm" style={items.some((i) => i.overdue) ? 'border-color:var(--amber)' : ''}>
      <div class="row"><h2 class="spacer">Due soon</h2><a class="link" href="#/reports/due">All dates</a></div>
      {shown.map((i) => (
        <a class="row small" href={i.href} style="text-decoration:none;color:inherit;min-height:36px">
          <span class="mono" style="flex:none">{i.code}</span>
          <span class="spacer" style="min-width:0">{i.text}</span>
          <Badge kind={i.overdue ? 'warn' : 'neutral'}>{i.when}</Badge>
        </a>
      ))}
      {items.length > shown.length && <div class="tiny muted">and {items.length - shown.length} more</div>}
    </section>
  );
}

function SupervisionNudge() {
  const { store } = useApp();
  const now = new Date();
  const m = supervisionMonth(store.contactList('supervision'), store.sessionList(), now.getFullYear(), now.getMonth());
  if (m.directMinutes === 0 || m.issues.length === 0) return null;
  return (
    <a class="card row" href="#/logs/supervision" style="text-decoration:none;color:inherit">
      <span class="spacer small">Supervision this month: {m.supervisionMinutes} of {m.requiredMinutes} min{m.onsiteObservation ? '' : ', no onsite observation yet'}.</span>
      <span class="badge warn">Check</span>
    </a>
  );
}
