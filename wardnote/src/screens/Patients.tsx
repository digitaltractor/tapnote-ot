import { useState } from 'preact/hooks';
import { addDays, long, relative, short, todayKey } from '../core/dates';
import { FORM_INFO, FORM_TYPES, FormRecord, FormType, calcText, expiry, formName, hearingBy, legalStatus, nextInChain, raiDue, statusLabel } from '../core/mha';
import { REFERRAL_KINDS, REFERRAL_STATUS, ROLES, Patient, Referral, ReferralStatus, Role, alcDays, isStale, newFormTasks } from '../core/ward';
import { makeCode } from '../core/codes';
import { findIdentifiers, describeHits } from '../core/identifiers';
import { BackButton, Badge, Field, Sheet, checked, go, useApp, uuid, val } from '../ui/components';

export function Patients() {
  const { store } = useApp();
  const [adding, setAdding] = useState(false);
  const today = todayKey();
  const list = store.patientList();

  return (
    <div class="stack">
      <div class="row">
        <h1 class="spacer">Patients</h1>
        <button class="btn primary" onClick={() => setAdding(true)}>Add</button>
      </div>
      <div class="tiny muted">Match each code to the Cerner banner or the bed board. WardNote never stores who a code belongs to.</div>
      <div class="list">
        {list.map((p) => {
          const st = legalStatus(store.formList(p.code));
          const alc = alcDays(p, today);
          return (
            <a class="list-item" href={`#/patients/${encodeURIComponent(p.code)}`} style={p.active ? '' : 'opacity:0.6'}>
              <div class="grow">
                <span class="mono">{p.code}</span>
                <span class="small muted">{[statusLabel(st), alc != null ? `ALC ${alc} days` : '', p.edd ? `EDD ${short(p.edd)}` : 'No EDD', p.active ? '' : 'Discharged'].filter(Boolean).join(' · ')}</span>
              </div>
              {st.expiry && <Badge kind={relDaysTo(today, st.expiry) <= 3 ? 'warn' : 'neutral'}>{short(st.expiry)}</Badge>}
            </a>
          );
        })}
      </div>
      {adding && <AddPatient onClose={() => setAdding(false)} />}
    </div>
  );
}

const relDaysTo = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function AddPatient({ onClose }: { onClose: () => void }) {
  const { store, toast } = useApp();
  const [code, setCode] = useState(() => makeCode(new Set(store.patients.keys())));
  const add = async () => {
    await store.putPatient({ code, active: true, createdAt: new Date() });
    toast(`Added ${code}.`);
    onClose();
    go(`patients/${encodeURIComponent(code)}`);
  };
  return (
    <Sheet title="Add a patient" onClose={onClose}>
      <div class="stack">
        <div class="row">
          <span class="mono" style="font-size:22px">{code}</span>
          <span class="spacer" />
          <button class="link" onClick={() => setCode(makeCode(new Set(store.patients.keys())))}>New code</button>
        </div>
        <div class="small muted">Write this code where the team can see it beside the patient, such as the bed board or a Cerner sticky note. Don't enter a name, MRN or birth date here.</div>
        <button class="btn primary block big" onClick={add}>Add {code}</button>
      </div>
    </Sheet>
  );
}

export function PatientDetail({ code }: { code: string }) {
  const { store, toast } = useApp();
  const p = store.patients.get(code);
  const [formSheet, setFormSheet] = useState<FormRecord | { type: FormType; seq?: number } | null>(null);
  const [refSheet, setRefSheet] = useState<Referral | 'new' | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const today = todayKey();

  if (!p) return <div class="stack"><div class="topbar"><BackButton to="patients" /><h2>Patient not found</h2></div></div>;

  const forms = store.formList(code);
  const st = legalStatus(forms);
  const live = forms.filter((f) => f === st.cert || f === st.cto || !['form3', 'form4', 'form4a', 'cto'].includes(f.type));
  const older = forms.filter((f) => !live.includes(f));
  const refs = store.referralList(code);
  const contacts = store.draftList(code);
  const alc = alcDays(p, today);
  const next = st.cert ? nextInChain(st.cert) : undefined;

  const toggleTask = async (f: FormRecord, id: string, done: boolean) => {
    await store.putForm({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, done } : t)) });
  };

  return (
    <div class="stack">
      <div class="topbar">
        <BackButton to="patients" />
        <div class="spacer">
          <div class="mono" style="font-size:18px">{p.code}</div>
          <div class="tiny muted">{statusLabel(st)}</div>
        </div>
        <a class="btn primary" style="min-height:44px" href={`#/note/${encodeURIComponent(p.code)}`}>Note</a>
      </div>

      <div class="row-wrap">
        {alc != null && <Badge kind={alc > 30 ? 'warn' : 'neutral'}>ALC {alc} days</Badge>}
        <Badge>{p.edd ? `EDD ${short(p.edd)}` : 'No EDD'}</Badge>
        {p.destination && <Badge>{p.destination}</Badge>}
        {p.owner && <Badge>Owner: {p.owner}</Badge>}
      </div>

      <section class="card stack-sm">
        <div class="row"><h2 class="spacer">Mental Health Act</h2><button class="link" onClick={() => setFormSheet({ type: 'form3' })}>Add form</button></div>
        {st.cert && st.expiry ? (
          <>
            <div>{FORM_INFO[st.cert.type].label.replace(/^Form \w+ · /, '')} ({formName(st.cert)})</div>
            <div class={relDaysTo(today, st.expiry) <= 3 ? 'bold' : ''} style={relDaysTo(today, st.expiry) <= 3 ? 'color:var(--amber)' : ''}>
              Expires {long(st.expiry)} ({relative(today, st.expiry)}).{st.mandatory ? ' Mandatory Consent and Capacity Board review when it is renewed.' : ''}
            </div>
            <div class="tiny muted">{calcText(st.cert)} Check against hospital policy.</div>
            {next && <button class="btn outline" onClick={() => setFormSheet(next)}>Record {formName(next)}</button>}
          </>
        ) : (
          <div class="small muted">Voluntary{st.cto && st.ctoExpiry ? `. ${formName(st.cto)} runs to ${long(st.ctoExpiry)}.` : '.'}</div>
        )}
        {live.map((f) => (
          <div class="stack-sm" style="border-top:1px solid var(--grey);padding-top:8px">
            <div class="row">
              <span class="bold spacer">{formName(f)} · signed {short(f.signedOn)}</span>
              <button class="link" onClick={() => setFormSheet(f)}>Edit</button>
            </div>
            {f.ccbAppliedOn && <div class="small" style="color:var(--amber)">CCB application {short(f.ccbAppliedOn)}: hearing must start by {short(hearingBy(f.ccbAppliedOn))}.</div>}
            {f.tasks.map((t) => (
              <label class={`task ${t.done ? 'done' : ''}`}><input type="checkbox" checked={t.done} onChange={(e) => toggleTask(f, t.id, checked(e))} /><span>{t.label}</span></label>
            ))}
          </div>
        ))}
        {older.length > 0 && <div class="tiny muted">Earlier: {older.map((f) => `${formName(f)} (${short(f.signedOn)})`).join(', ')}</div>}
      </section>

      <section class="card stack-sm">
        <div class="row"><h2 class="spacer">Discharge plan</h2><button class="link" onClick={() => setPlanSheet(true)}>Edit</button></div>
        <dl class="kv">
          <dt>Destination</dt><dd>{p.destination || '—'}</dd>
          <dt>Main barrier</dt><dd>{p.barrier || '—'}</dd>
          <dt>EDD</dt><dd>{p.edd ? long(p.edd) : 'Not set'}</dd>
          <dt>ALC since</dt><dd>{p.alcSince ? long(p.alcSince) : '—'}</dd>
          <dt>RAI-MH</dt><dd>{p.raiLast ? `Quarterly due ${short(raiDue(p.raiLast))}` : '—'}</dd>
        </dl>
        <div class="row" style="margin-top:6px"><h2 class="spacer" style="font-size:14px;color:var(--muted)">Referrals</h2><button class="link" onClick={() => setRefSheet('new')}>Add referral</button></div>
        {refs.length === 0 && <div class="small muted">No referrals yet.</div>}
        {refs.map((r) => (
          <button type="button" class="row" style="border:0;border-top:1px solid var(--grey);background:none;padding:8px 0;text-align:left;width:100%" onClick={() => setRefSheet(r)}>
            <span class="spacer" style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <span class="bold small">{r.kind}</span>
              <span class="tiny muted">{r.status}{r.sentOn ? ` · sent ${short(r.sentOn)}` : ''}{r.lastUpdate ? ` · updated ${short(r.lastUpdate)}` : ''} · {r.nextAction || 'no next step'}</span>
            </span>
            {isStale(r, today) ? <Badge kind="warn">Stale</Badge> : r.nextDue ? <Badge kind={r.nextDue < today ? 'warn' : 'neutral'}>{short(r.nextDue)}</Badge> : null}
          </button>
        ))}
      </section>

      <section class="card stack-sm">
        <h2>Contacts</h2>
        {contacts.length === 0 && <div class="small muted">No contacts logged.</div>}
        {contacts.map((d) => (
          <a class="row small" href={d.purged ? undefined : `#/note/${encodeURIComponent(d.code)}/${d.id}`} style="text-decoration:none;color:inherit;min-height:36px">
            <span class="spacer">{short(d.serviceDate)} · {d.kind === 'family' ? 'Family meeting' : `${d.with}, ${d.how.toLowerCase()}`}{d.minutes ? ` · ${d.minutes} min` : ''}</span>
            {d.purged === 'charted' ? <Badge kind="ok">Charted</Badge> : d.purged === 'expired' ? <Badge>Expired</Badge> : <Badge kind="warn">Draft</Badge>}
          </a>
        ))}
      </section>

      <button class="btn block" onClick={async () => { await store.putPatient({ ...p, active: !p.active }); toast(p.active ? 'Marked discharged.' : 'Back on the ward.'); }}>
        {p.active ? 'Mark discharged' : 'Return to ward list'}
      </button>

      {formSheet && <FormSheet code={code} start={formSheet} onClose={() => setFormSheet(null)} />}
      {refSheet && <ReferralSheet code={code} referral={refSheet === 'new' ? undefined : refSheet} onClose={() => setRefSheet(null)} />}
      {planSheet && <PlanSheet patient={p} onClose={() => setPlanSheet(false)} />}
    </div>
  );
}

function FormSheet({ code, start, onClose }: { code: string; start: FormRecord | { type: FormType; seq?: number }; onClose: () => void }) {
  const { store, toast } = useApp();
  const existing = 'id' in start ? start : undefined;
  const [type, setType] = useState<FormType>(start.type);
  const [seq, setSeq] = useState<number>(start.seq ?? (start.type === 'cto' ? 0 : 1));
  const [signedOn, setSignedOn] = useState(existing?.signedOn ?? todayKey());
  const [ccb, setCcb] = useState(existing?.ccbAppliedOn ?? '');
  const hasSeq = type === 'form4' || type === 'form4a' || type === 'cto';
  const preview = expiry({ type, seq, signedOn });

  const save = async () => {
    const tasks = existing && existing.type === type && existing.seq === (hasSeq ? seq : undefined) ? existing.tasks : newFormTasks(type, hasSeq ? seq : undefined, uuid);
    await store.putForm({ id: existing?.id ?? uuid(), code, type, seq: hasSeq ? seq : undefined, signedOn, tasks, ccbAppliedOn: ccb || undefined, createdAt: existing?.createdAt ?? new Date() });
    toast(existing ? 'Form updated.' : `${formName({ type, seq })} recorded.`);
    onClose();
  };
  const remove = async () => {
    if (!existing || !confirm('Delete this form record?')) return;
    await store.deleteForm(existing.id);
    onClose();
  };

  return (
    <Sheet title={existing ? 'Edit form' : 'Record a form'} onClose={onClose}>
      <div class="stack">
        <Field label="Form" id="f-type">
          <select id="f-type" class="input" value={type} onChange={(e) => { const t = val(e) as FormType; setType(t); setSeq(t === 'cto' ? 0 : 1); }}>
            {FORM_TYPES.map((t) => <option value={t}>{FORM_INFO[t].label}</option>)}
          </select>
        </Field>
        <div class="grid2">
          <Field label={type === 'cto' ? 'Issued on' : 'Signed on'} id="f-signed"><input id="f-signed" class="input" type="date" value={signedOn} onInput={(e) => val(e) && setSignedOn(val(e))} /></Field>
          {hasSeq && (
            <Field label={type === 'cto' ? 'Renewal number (0 = first)' : type === 'form4' ? 'Renewal number (1–3)' : 'Continuation number'} id="f-seq">
              <input id="f-seq" class="input" type="number" inputMode="numeric" min={type === 'cto' ? 0 : 1} max={type === 'form4' ? 3 : 99} value={seq} onInput={(e) => setSeq(Math.max(type === 'cto' ? 0 : 1, Number(val(e)) || 0))} />
            </Field>
          )}
        </div>
        <div class="small">{preview ? `Expires ${long(preview)}. ${calcText({ type, seq, signedOn })}` : calcText({ type, seq, signedOn })}</div>
        {FORM_INFO[type].certificate && (
          <Field label="Patient applied to the CCB (Form 16), if any" id="f-ccb" hint="The hearing must begin within 7 days of the Board receiving it.">
            <input id="f-ccb" class="input" type="date" value={ccb} onInput={(e) => setCcb(val(e))} />
          </Field>
        )}
        <button class="btn primary block big" onClick={save}>Save</button>
        {existing && <button class="btn danger block" onClick={remove}>Delete</button>}
        <div class="tiny muted">The physician signs the form in the chart. WardNote only tracks the dates and the tasks that follow.</div>
      </div>
    </Sheet>
  );
}

function ReferralSheet({ code, referral, onClose }: { code: string; referral?: Referral; onClose: () => void }) {
  const { store, toast } = useApp();
  const today = todayKey();
  const [kind, setKind] = useState(referral?.kind ?? REFERRAL_KINDS[0]);
  const [status, setStatus] = useState<ReferralStatus>(referral?.status ?? 'Planned');
  const [sentOn, setSentOn] = useState(referral?.sentOn ?? '');
  const [lastUpdate, setLastUpdate] = useState(referral?.lastUpdate ?? '');
  const [nextAction, setNextAction] = useState(referral?.nextAction ?? '');
  const [nextDue, setNextDue] = useState(referral?.nextDue ?? addDays(today, 7));
  const [owner, setOwner] = useState<Role>(referral?.owner ?? 'Social work');
  const hits = findIdentifiers(nextAction);

  const save = async () => {
    await store.putReferral({
      id: referral?.id ?? uuid(), code, kind, status, sentOn: sentOn || undefined, lastUpdate: lastUpdate || undefined,
      nextAction: nextAction.trim(), nextDue: nextDue || undefined, owner, createdAt: referral?.createdAt ?? new Date()
    });
    toast('Referral saved.');
    onClose();
  };
  const remove = async () => {
    if (!referral || !confirm('Delete this referral?')) return;
    await store.deleteReferral(referral.id);
    onClose();
  };

  return (
    <Sheet title={referral ? 'Edit referral' : 'Add referral'} onClose={onClose}>
      <div class="stack">
        <Field label="Referral" id="r-kind">
          <select id="r-kind" class="input" value={kind} onChange={(e) => setKind(val(e))}>
            {REFERRAL_KINDS.map((k) => <option value={k}>{k}</option>)}
          </select>
        </Field>
        <div class="grid2">
          <Field label="Status" id="r-status">
            <select id="r-status" class="input" value={status} onChange={(e) => setStatus(val(e) as ReferralStatus)}>
              {REFERRAL_STATUS.map((s) => <option value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Owner" id="r-owner">
            <select id="r-owner" class="input" value={owner} onChange={(e) => setOwner(val(e) as Role)}>
              {ROLES.map((r) => <option value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <div class="grid2">
          <Field label="Sent on" id="r-sent"><input id="r-sent" class="input" type="date" value={sentOn} onInput={(e) => setSentOn(val(e))} /></Field>
          <Field label="Last update" id="r-upd"><input id="r-upd" class="input" type="date" value={lastUpdate} onInput={(e) => setLastUpdate(val(e))} /></Field>
        </div>
        <button class="btn" onClick={() => setLastUpdate(today)}>Heard back or updated today</button>
        <Field label="Next step" id="r-next"><input id="r-next" class="input" placeholder="e.g. Update the application file" value={nextAction} onInput={(e) => setNextAction(val(e))} /></Field>
        {hits.length > 0 && <div class="warnbox" role="alert">Looks identifying: {describeHits(hits)}. Use roles, not names.</div>}
        <Field label="Next step due" id="r-due"><input id="r-due" class="input" type="date" value={nextDue} onInput={(e) => setNextDue(val(e))} /></Field>
        <button class="btn primary block big" onClick={save}>Save</button>
        {referral && <button class="btn danger block" onClick={remove}>Delete</button>}
        <div class="tiny muted">Applications with no update in 30 days show as stale on Today.</div>
      </div>
    </Sheet>
  );
}

function PlanSheet({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { store, toast } = useApp();
  const [edd, setEdd] = useState(patient.edd ?? '');
  const [alcSince, setAlcSince] = useState(patient.alcSince ?? '');
  const [destination, setDestination] = useState(patient.destination ?? '');
  const [barrier, setBarrier] = useState(patient.barrier ?? '');
  const [owner, setOwner] = useState<Role | ''>(patient.owner ?? '');
  const [raiLast, setRaiLast] = useState(patient.raiLast ?? '');
  const hits = findIdentifiers(`${destination}. ${barrier}`);

  const save = async () => {
    await store.putPatient({
      ...patient, edd: edd || undefined, alcSince: alcSince || undefined, destination: destination.trim() || undefined,
      barrier: barrier.trim() || undefined, owner: owner || undefined, raiLast: raiLast || undefined
    });
    toast('Plan saved.');
    onClose();
  };

  return (
    <Sheet title="Discharge plan" onClose={onClose}>
      <div class="stack">
        <div class="grid2">
          <Field label="Estimated discharge" id="p-edd"><input id="p-edd" class="input" type="date" value={edd} onInput={(e) => setEdd(val(e))} /></Field>
          <Field label="ALC since" id="p-alc"><input id="p-alc" class="input" type="date" value={alcSince} onInput={(e) => setAlcSince(val(e))} /></Field>
        </div>
        <Field label="Destination" id="p-dest"><input id="p-dest" class="input" list="dests" value={destination} onInput={(e) => setDestination(val(e))} />
          <datalist id="dests">{['Supportive housing', 'Long-term care', 'Homes for Special Care', 'Own apartment with ACT', 'Family home', 'Group home', 'To be determined'].map((d) => <option value={d} />)}</datalist>
        </Field>
        <Field label="Main barrier" id="p-bar"><input id="p-bar" class="input" value={barrier} onInput={(e) => setBarrier(val(e))} /></Field>
        {hits.length > 0 && <div class="warnbox" role="alert">Looks identifying: {describeHits(hits)}.</div>}
        <div class="grid2">
          <Field label="Owner" id="p-own">
            <select id="p-own" class="input" value={owner} onChange={(e) => setOwner(val(e) as Role)}>
              <option value="">—</option>
              {ROLES.map((r) => <option value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Last full RAI-MH" id="p-rai"><input id="p-rai" class="input" type="date" value={raiLast} onInput={(e) => setRaiLast(val(e))} /></Field>
        </div>
        <button class="btn primary block big" onClick={save}>Save</button>
      </div>
    </Sheet>
  );
}

