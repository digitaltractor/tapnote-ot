import { useState } from 'preact/hooks';
import { ScheduleSlot, WEEKDAY_LABEL, WEEKDAY_SHORT, dayKey, scheduledWeeklyMinutes } from '../core/schedule';
import { BackButton, Chip, Field, Sheet, useApp, uuid, val } from '../ui/components';

function fmt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Weekly caseload schedule: recurring slots that pre-fill Today. */
export function Schedule() {
  const { store } = useApp();
  const slots = store.slotList();
  const [editing, setEditing] = useState<ScheduleSlot | 'new' | null>(null);
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || slots.some((s) => s.weekday === d));
  const students = store.studentList().filter((s) => s.isActive);

  return (
    <div class="stack">
      <div class="topbar">
        <BackButton to="today" />
        <h2 class="spacer">Weekly schedule</h2>
        <button class="btn primary" style="min-height:44px" onClick={() => setEditing('new')}>Add</button>
      </div>
      <div class="small muted">Recurring sessions fill in Today each morning. Tap one there to start it or mark an absence.</div>

      {days.map((d) => {
        const daySlots = slots.filter((s) => s.weekday === d);
        return (
          <section class="stack-sm">
            <h2 class="section-title">{WEEKDAY_LABEL[d]}</h2>
            {daySlots.length === 0 && <div class="tiny muted">Nothing scheduled.</div>}
            {daySlots.map((s) => (
              <button type="button" class="list-item" onClick={() => setEditing(s)} style={s.active ? '' : 'opacity:0.55'}>
                <div class="bold" style="width:76px;flex:none">{fmt(s.start)}</div>
                <div class="grow">
                  <span class="mono">{s.studentCodes.join(', ')}</span>
                  <span class="small muted">{s.minutes} min · {s.studentCodes.length > 1 ? `group of ${s.studentCodes.length}` : 'individual'}{s.location ? ` · ${s.location}` : ''}{s.active ? '' : ' · paused'}</span>
                </div>
              </button>
            ))}
          </section>
        );
      })}

      {students.length > 0 && (
        <section class="card stack-sm">
          <h2>Scheduled vs. IEP minutes per week</h2>
          {students.map((st) => {
            const sched = scheduledWeeklyMinutes(slots, st.code);
            const diff = sched - st.weeklyMinutes;
            return (
              <div class="row small">
                <span class="mono">{st.code}</span>
                <span class="spacer" />
                <span>{sched} / {st.weeklyMinutes} min</span>
                {diff < 0 && <span class="badge warn">{-diff} short</span>}
                {diff > 0 && <span class="badge">{diff} over</span>}
              </div>
            );
          })}
        </section>
      )}

      {editing && <SlotEditor slot={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SlotEditor({ slot, onClose }: { slot?: ScheduleSlot; onClose: () => void }) {
  const { store, toast } = useApp();
  const students = store.studentList().filter((s) => s.isActive);
  const [days, setDays] = useState<number[]>(slot ? [slot.weekday] : []);
  const [start, setStart] = useState(slot?.start ?? '09:00');
  const [minutes, setMinutes] = useState(slot?.minutes ?? 30);
  const [codes, setCodes] = useState<string[]>(slot?.studentCodes ?? []);
  const [location, setLocation] = useState(slot?.location ?? '');
  const [active, setActive] = useState(slot?.active ?? true);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ok = days.length > 0 && codes.length > 0 && /^\d{2}:\d{2}$/.test(start) && minutes > 0;

  const save = async () => {
    const base = { start, minutes, studentCodes: [...codes].sort(), location: location.trim() || undefined, active };
    if (slot) {
      await store.putSlot({ ...slot, ...base, weekday: days[0] });
    } else {
      for (const d of days) await store.putSlot({ id: uuid(), weekday: d, since: dayKey(new Date()), ...base });
    }
    toast(slot ? 'Schedule updated.' : `Added to ${days.length} day${days.length === 1 ? '' : 's'}.`);
    onClose();
  };

  const remove = async () => {
    if (!slot || !confirm('Remove this recurring session? Past sessions are kept.')) return;
    await store.deleteSlot(slot.id);
    onClose();
  };

  return (
    <Sheet title={slot ? 'Edit recurring session' : 'Add recurring session'} onClose={onClose}>
      <div class="stack">
        <div class="stack-sm">
          <div class="label">{slot ? 'Day' : 'Days (pick one or more)'}</div>
          <div class="row-wrap">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <Chip square on={days.includes(d)} label={WEEKDAY_LABEL[d]} onClick={() => setDays(slot ? [d] : toggle(days, d))}>{WEEKDAY_SHORT[d]}</Chip>
            ))}
          </div>
        </div>
        <div class="grid2">
          <Field label="Start" id="sl-start"><input id="sl-start" class="input" type="time" value={start} onInput={(e) => setStart(val(e))} /></Field>
          <Field label="Minutes" id="sl-min"><input id="sl-min" class="input" type="number" inputMode="numeric" min={5} step={5} value={minutes} onInput={(e) => setMinutes(Number(val(e)) || 0)} /></Field>
        </div>
        <div class="stack-sm">
          <div class="label">Students {codes.length > 1 ? `(group of ${codes.length})` : ''}</div>
          {students.length === 0 && <div class="muted small">Add students first.</div>}
          <div class="row-wrap">
            {students.map((s) => (
              <Chip square on={codes.includes(s.code)} onClick={() => setCodes(toggle(codes, s.code))}><span class="mono">{s.code}</span></Chip>
            ))}
          </div>
        </div>
        <Field label="Location (optional)" id="sl-loc"><input id="sl-loc" class="input" placeholder="e.g. OT room, Rm 104" value={location} onInput={(e) => setLocation(val(e))} /></Field>
        {slot && <label class="check"><input type="checkbox" checked={active} onChange={(e) => setActive((e.currentTarget as HTMLInputElement).checked)} /> Active (uncheck to pause)</label>}
        <button class="btn primary block" disabled={!ok} onClick={save}>Save</button>
        {slot && <button class="btn danger block" onClick={remove}>Remove</button>}
      </div>
    </Sheet>
  );
}
