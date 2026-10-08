import { useState } from 'preact/hooks';
import { ATTENDANCE, ATTENDANCE_LABEL, Attendance, serviceDelivered } from '../core/types';
import { TimeStyle } from '../core/time';
import type { SessionRecord } from '../data/db';
import { isInProgress } from '../data/store';
import { getPrefs } from '../data/prefs';
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

export function Today() {
  const { store } = useApp();
  const [starting, setStarting] = useState(false);
  const now = new Date();
  const groups = groupSessions(store.sessionList().filter((s) => sameDay(s.date, now)));

  return (
    <div class="stack">
      <div>
        <div class="eyebrow">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>Today</h1>
        <div class="muted">{groups.length} session{groups.length === 1 ? '' : 's'} · {groups.filter((g) => g.sessions.every((s) => s.signedAt)).length} signed</div>
      </div>
      <button class="btn primary block big" onClick={() => setStarting(true)}>Start a session</button>

      {groups.length === 0 ? (
        <div class="empty">No sessions yet today. Start one, or log an absence, with the button above.</div>
      ) : (
        <div class="list">
          {groups.map((g) => {
            const first = g.sessions[0];
            const delivered = serviceDelivered(first.attendance);
            const allSigned = g.sessions.every((s) => s.signedAt);
            const inProgress = g.sessions.some(isInProgress);
            const kind = !delivered ? ATTENDANCE_LABEL[first.attendance] : g.sessions.length > 1 ? `Group of ${g.sessions.length}` : 'Individual';
            const aliases = g.sessions.map((s) => store.students.get(s.studentCode)?.alias ?? '').filter(Boolean).join(', ');
            return (
              <a class="list-item" href={delivered ? `#/session/${g.key}` : `#/review/${first.id}`}>
                <div class="bold" style="width:72px;flex:none">{first.start ? time.time(first.start) : '—'}</div>
                <div class="grow">
                  <span class="mono">{g.sessions.map((s) => s.studentCode).join(', ')}</span>
                  <span class="small muted">{kind}{aliases ? ` · ${aliases}` : ''}</span>
                </div>
                {allSigned ? <Badge kind="ok">Signed</Badge> : inProgress ? <Badge>In progress</Badge> : !delivered ? <Badge kind="warn">Absent</Badge> : <Badge>To review</Badge>}
              </a>
            );
          })}
        </div>
      )}
      {starting && <StartSession onClose={() => setStarting(false)} />}
    </div>
  );
}

function StartSession({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const students = store.studentList().filter((s) => s.isActive);
  const [selected, setSelected] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<Attendance>('present');
  const [makeUp, setMakeUp] = useState(false);

  const toggle = (code: string) => setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const start = async () => {
    if (selected.length === 0) return;
    const key = uuid();
    const now = new Date();
    const delivered = serviceDelivered(attendance);
    const sessions: SessionRecord[] = selected.sort().map((code) => ({
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
      activities: [],
      observations: [],
      comment: '',
      addenda: []
    }));
    await store.putSessions(sessions, delivered ? 'started' : `logged ${attendance}`);
    onClose();
    if (delivered) go(`session/${key}`);
  };

  return (
    <Sheet title="New session" onClose={onClose}>
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
            <button type="button" class={`list-item`} style="min-height:52px" aria-pressed={selected.includes(s.code)} onClick={() => toggle(s.code)}>
              <span aria-hidden="true" style={`width:22px;height:22px;border-radius:50%;flex:none;border:2px solid var(--acc);background:${selected.includes(s.code) ? 'var(--acc)' : 'transparent'}`} />
              <span class="grow"><span class="mono">{s.code}</span><span class="small muted">{s.alias}</span></span>
            </button>
          ))}
        </div>
        <div class="tiny muted">{selected.length > 1 ? 'Group session: one timer, separate trials and ratings for each student.' : 'Pick two or more students for a group session.'}</div>
        <button class="btn primary block big" disabled={selected.length === 0} onClick={start}>{attendance === 'present' ? 'Start' : 'Log absence'}</button>
      </div>
    </Sheet>
  );
}
