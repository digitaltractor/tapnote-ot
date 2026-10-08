import { useState } from 'preact/hooks';
import {
  CONSULT_ROLES, CONTACT_METHODS, CONTACT_METHOD_LABEL, ContactMethod, LOG_KINDS, LOG_KIND_LABEL, LogEntry, LogKind, PARENT_ROLES,
  SUPERVISION_METHODS, SUPERVISION_METHOD_LABEL, SupervisionMethod, followUps, supervisionMonth, supervisionPaperwork
} from '../core/contacts';
import { toKey } from '../core/deadlines';
import { scrubNames } from '../core/pseudonym';
import { setPrefs, usePrefs } from '../data/prefs';
import { BackButton, Badge, Chip, Field, Sheet, checked, fromDateInput, toDateInput, useApp, uuid, val } from '../ui/components';

const methodLabel = (e: LogEntry) =>
  ((e.kind === 'supervision' ? SUPERVISION_METHOD_LABEL : CONTACT_METHOD_LABEL) as Record<string, string>)[e.method] ?? e.method;

/** Beta 2: consult, parent-contact and supervision logs. */
export function Logs({ kind = 'consult' }: { kind?: LogKind }) {
  const { store } = useApp();
  const [editing, setEditing] = useState<LogEntry | 'new' | null>(null);
  const entries = store.contactList(kind);
  const today = toKey(new Date());
  const open = followUps(store.contactList(), today).filter((f) => f.entry.kind === kind && f.status !== 'upcoming');

  return (
    <div class="stack">
      <div class="topbar">
        <BackButton to="today" />
        <h2 class="spacer">Logs</h2>
        <button class="btn primary" style="min-height:44px" onClick={() => setEditing('new')}>Add</button>
      </div>
      <div class="seg" role="tablist" aria-label="Log type">
        {LOG_KINDS.map((k) => (
          <a role="tab" aria-selected={k === kind} class={`chip square ${k === kind ? 'on' : ''}`} style="display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:14px" href={`#/logs/${k}`}>
            {k === 'parent' ? 'Parents' : LOG_KIND_LABEL[k]}
          </a>
        ))}
      </div>

      {kind === 'supervision' && <SupervisionSummary />}

      {open.length > 0 && (
        <div class="card stack-sm" style="border-color:var(--amber)">
          <h2>Follow-ups due</h2>
          {open.map((f) => (
            <button type="button" class="row small" style="border:0;background:none;padding:4px 0;text-align:left;color:inherit" onClick={() => setEditing(f.entry)}>
              <span class="spacer">{f.entry.topic || f.entry.who}{f.entry.studentCodes.length ? <> · <span class="mono">{f.entry.studentCodes.join(', ')}</span></> : null}</span>
              <Badge kind="warn">{f.daysLeft < 0 ? `${-f.daysLeft}d overdue` : f.daysLeft === 0 ? 'today' : `in ${f.daysLeft}d`}</Badge>
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <div class="empty">
          {kind === 'consult' && 'No consults yet. Log teacher and staff check-ins here; they show up in progress reports.'}
          {kind === 'parent' && 'No parent contacts yet. Log calls, emails and notes home here.'}
          {kind === 'supervision' && 'No supervision contacts yet. Log each contact with your supervising OT.'}
        </div>
      ) : (
        <div class="list">
          {entries.map((e) => (
            <button type="button" class="list-item" onClick={() => setEditing(e)}>
              <div class="bold" style="width:64px;flex:none">{e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              <div class="grow">
                <span>{e.topic || <span class="muted">No topic</span>}</span>
                <span class="small muted">
                  {[e.who, methodLabel(e), e.minutes ? `${e.minutes} min` : '', e.kind === 'supervision' && e.onsite ? (e.observed ? 'onsite + observed' : 'onsite') : ''].filter(Boolean).join(' · ')}
                </span>
                {e.studentCodes.length > 0 && <span class="small mono">{e.studentCodes.join(', ')}</span>}
              </div>
              {e.followUp && !e.followUpDone && <Badge kind="warn">Follow up</Badge>}
            </button>
          ))}
        </div>
      )}

      {editing && <LogEditor kind={kind} entry={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupervisionSummary() {
  const { store } = useApp();
  const prefs = usePrefs();
  const now = new Date();
  const months = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() - 1, 1)];
  const entries = store.contactList('supervision');
  const sessions = store.sessionList();
  const paperwork = supervisionPaperwork(toKey(now), prefs.supervisionPlanDate || undefined, prefs.appraisalDate || undefined);

  return (
    <section class="card stack">
      <h2>Supervision check · 49 Pa. Code § 42.22</h2>
      {prefs.role !== 'COTA' && (
        <div class="small muted">Direct-care minutes come from your sessions when your role is COTA (Settings). As the OT, you can still log contacts here.</div>
      )}
      {months.map((m, i) => {
        const s = supervisionMonth(entries, sessions, m.getFullYear(), m.getMonth());
        const pct = s.requiredMinutes ? Math.min(100, Math.round((s.supervisionMinutes * 100) / s.requiredMinutes)) : s.supervisionMinutes ? 100 : 0;
        return (
          <div class="stack-sm">
            <div class="row">
              <span class="bold spacer">{m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}{i === 0 ? ' (to date)' : ''}</span>
              {s.issues.length === 0 && s.directMinutes > 0 ? <Badge kind="ok">Meets rule</Badge> : s.directMinutes === 0 ? <Badge>No direct care</Badge> : <Badge kind="warn">{s.issues.length} to fix</Badge>}
            </div>
            <div class={`meter ${s.supervisionMinutes < s.requiredMinutes ? 'short' : ''}`} role="img" aria-label={`${s.supervisionMinutes} of ${s.requiredMinutes} supervision minutes`}><span style={`width:${pct}%`} /></div>
            <div class="small muted">
              {s.supervisionMinutes} min supervision / {s.directMinutes} min direct care{s.percent != null ? ` = ${s.percent}%` : ''} (10% needed: {s.requiredMinutes} min)
              {' · '}{s.onsiteObservation ? 'onsite observation ✓' : 'no onsite observation'}
              {s.methods.length ? ` · ${s.methods.map((x) => SUPERVISION_METHOD_LABEL[x].toLowerCase()).join(', ')}` : ''}
            </div>
            {s.issues.map((t) => <div class="issue blocking small">● {t}</div>)}
          </div>
        );
      })}
      <div class="grid2">
        <Field label="Supervisory plan dated" id="sp"><input id="sp" class="input" type="date" value={prefs.supervisionPlanDate} onInput={(e) => setPrefs({ supervisionPlanDate: val(e) })} /></Field>
        <Field label="Last written appraisal" id="ap"><input id="ap" class="input" type="date" value={prefs.appraisalDate} onInput={(e) => setPrefs({ appraisalDate: val(e) })} /></Field>
      </div>
      {paperwork.map((t) => <div class="issue small">○ {t}</div>)}
      <div class="tiny muted">Checks follow 49 Pa. Code § 42.22 as written. Your district or the supervising OT may require more.</div>
    </section>
  );
}

export function LogEditor({ kind: initialKind, entry, presetCodes, onClose }: { kind: LogKind; entry?: LogEntry; presetCodes?: string[]; onClose: () => void }) {
  const { store, vault, toast } = useApp();
  const students = store.studentList().filter((s) => s.isActive || entry?.studentCodes.includes(s.code));
  const [kind, setKind] = useState<LogKind>(entry?.kind ?? initialKind);
  const roles = kind === 'parent' ? PARENT_ROLES : kind === 'consult' ? CONSULT_ROLES : ['Supervising OT', 'Substitute supervising OT'];
  const [day, setDay] = useState(entry ? toDateInput(entry.date) : toDateInput(new Date()));
  const [minutes, setMinutes] = useState(entry?.minutes ? String(entry.minutes) : '');
  const [codes, setCodes] = useState<string[]>(entry?.studentCodes ?? presetCodes ?? []);
  const [who, setWho] = useState(entry?.who ?? roles[0]);
  const [method, setMethod] = useState<LogEntry['method']>(entry?.method ?? (initialKind === 'supervision' ? 'faceToFace' : initialKind === 'parent' ? 'phone' : 'inPerson'));
  const [topic, setTopic] = useState(entry?.topic ?? '');
  const [outcome, setOutcome] = useState(entry?.outcome ?? '');
  const [followUp, setFollowUp] = useState(entry?.followUp ?? '');
  const [followUpDone, setFollowUpDone] = useState(entry?.followUpDone ?? false);
  const [onsite, setOnsite] = useState(entry?.onsite ?? true);
  const [observed, setObserved] = useState(entry?.observed ?? false);
  const methods: readonly string[] = kind === 'supervision' ? SUPERVISION_METHODS : CONTACT_METHODS;
  const label = (m: string) => (kind === 'supervision' ? SUPERVISION_METHOD_LABEL[m as SupervisionMethod] : CONTACT_METHOD_LABEL[m as ContactMethod]);

  const switchKind = (k: LogKind) => {
    setKind(k);
    setMethod(k === 'supervision' ? 'faceToFace' : k === 'parent' ? 'phone' : 'inPerson');
    setWho(k === 'parent' ? PARENT_ROLES[0] : k === 'consult' ? CONSULT_ROLES[0] : 'Supervising OT');
  };

  const save = async () => {
    const names = vault.namesForScrubbing();
    const clean = (t: string) => scrubNames(t.trim(), names).text;
    const record: LogEntry = {
      id: entry?.id ?? uuid(),
      kind,
      date: fromDateInput(day),
      minutes: Number(minutes) > 0 ? Math.round(Number(minutes)) : undefined,
      studentCodes: [...codes].sort(),
      who: clean(who) || roles[0],
      method,
      topic: clean(topic),
      outcome: clean(outcome),
      followUp: followUp || undefined,
      followUpDone: followUp ? followUpDone : undefined,
      onsite: kind === 'supervision' && method === 'faceToFace' ? onsite : undefined,
      observed: kind === 'supervision' && method === 'faceToFace' ? observed : undefined,
      createdAt: entry?.createdAt ?? new Date()
    };
    await store.putContact(record, entry ? 'edited' : 'created');
    toast(entry ? 'Log updated.' : 'Logged.');
    onClose();
  };

  const remove = async () => {
    if (!entry || !confirm('Delete this log entry?')) return;
    await store.deleteContact(entry.id);
    onClose();
  };

  const toggle = (c: string) => setCodes(codes.includes(c) ? codes.filter((x) => x !== c) : [...codes, c]);

  return (
    <Sheet title={entry ? 'Edit log entry' : 'New log entry'} onClose={onClose}>
      <div class="stack">
        {!entry && (
          <div class="seg" role="radiogroup" aria-label="Log type">
            {LOG_KINDS.map((k) => (
              <button type="button" role="radio" aria-checked={k === kind} class={`chip square ${k === kind ? 'on' : ''}`} style="font-size:14px" onClick={() => switchKind(k)}>
                {k === 'consult' ? 'Consult' : k === 'parent' ? 'Parent' : 'Supervision'}
              </button>
            ))}
          </div>
        )}
        <div class="grid2">
          <Field label="Date" id="lg-day"><input id="lg-day" class="input" type="date" value={day} onInput={(e) => val(e) && setDay(val(e))} /></Field>
          <Field label="Minutes" id="lg-min"><input id="lg-min" class="input" type="number" inputMode="numeric" min={0} step={5} placeholder="optional" value={minutes} onInput={(e) => setMinutes(val(e))} /></Field>
        </div>
        <Field label="With (role, not name)" id="lg-who">
          <input id="lg-who" class="input" list="lg-roles" value={who} onInput={(e) => setWho(val(e))} />
          <datalist id="lg-roles">{roles.map((r) => <option value={r} />)}</datalist>
        </Field>
        <div class="stack-sm">
          <div class="label">How</div>
          <div class="row-wrap">
            {methods.map((m) => <Chip square on={method === m} onClick={() => setMethod(m as LogEntry['method'])}>{label(m)}</Chip>)}
          </div>
        </div>
        {kind === 'supervision' && method === 'faceToFace' && (
          <div class="stack-sm">
            <label class="check"><input type="checkbox" checked={onsite} onChange={(e) => setOnsite(checked(e))} /> Onsite at school</label>
            <label class="check"><input type="checkbox" checked={observed} onChange={(e) => setObserved(checked(e))} /> Included observing me with a student</label>
          </div>
        )}
        <div class="stack-sm">
          <div class="label">Students {kind === 'supervision' ? '(optional)' : ''}</div>
          {students.length === 0 && <div class="small muted">No students yet.</div>}
          <div class="row-wrap">
            {students.map((s) => <Chip square on={codes.includes(s.code)} onClick={() => toggle(s.code)}><span class="mono">{s.code}</span></Chip>)}
          </div>
        </div>
        <Field label="Topic" id="lg-topic">
          <input id="lg-topic" class="input" placeholder={kind === 'supervision' ? 'e.g. Reviewed handwriting plan' : kind === 'parent' ? 'e.g. Home practice for buttoning' : 'e.g. Pencil grip carryover in class'} value={topic} onInput={(e) => setTopic(val(e))} />
        </Field>
        <Field label={kind === 'supervision' ? 'Feedback and plan changes' : 'Outcome / follow-up'} id="lg-out">
          <textarea id="lg-out" class="input" style="min-height:90px" value={outcome} onInput={(e) => setOutcome(val(e))} />
        </Field>
        <div class="grid2">
          <Field label="Follow up by" id="lg-fu"><input id="lg-fu" class="input" type="date" value={followUp} onInput={(e) => setFollowUp(val(e))} /></Field>
          {followUp && <label class="check" style="align-self:end"><input type="checkbox" checked={followUpDone} onChange={(e) => setFollowUpDone(checked(e))} /> Done</label>}
        </div>
        <div class="tiny muted">Use roles and student codes, not names. If the vault is unlocked, real names typed here are replaced with codes when you save.</div>
        <button class="btn primary block big" onClick={save}>Save</button>
        {entry && <button class="btn danger block" onClick={remove}>Delete</button>}
      </div>
    </Sheet>
  );
}
