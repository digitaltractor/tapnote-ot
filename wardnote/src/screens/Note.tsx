import { useState } from 'preact/hooks';
import { long, todayKey } from '../core/dates';
import { CONTACT_HOW, CONTACT_WITH, Draft, DraftKind, composeDraft, purge } from '../core/ward';
import { describeHits, findIdentifiers } from '../core/identifiers';
import { usePrefs } from '../data/prefs';
import { Chip, Field, copyText, go, useApp, uuid, val } from '../ui/components';

const MINUTES = [5, 10, 15, 20, 30, 45, 60];
const REPORTED = ['Agrees with discharge plan', 'Wants to live closer to family', 'Worried about money', 'Declines group home', 'Asks about passes', 'Family can visit weekly', 'SDM agrees with plan', 'Concerned about safety at home'];
const OBSERVED = ['Calm and engaged', 'Guarded, brief answers', 'Tearful at times', 'Irritable', 'Organized and goal-directed', 'Disorganized at times'];
const PLAN = ['Update housing application', 'Call ODSP', 'Book family meeting', 'Follow up with PGT', 'Send referral', 'Review at rounds', 'Follow up in 1 week'];

export function NoteComposer({ code, draftId }: { code?: string; draftId?: string }) {
  const { store, toast } = useApp();
  const prefs = usePrefs();
  const existing = draftId ? store.drafts.get(draftId) : undefined;
  const patients = store.patientList().filter((p) => p.active);
  const [pid, setPid] = useState(existing?.code ?? code ?? patients[0]?.code ?? '');
  const [kind, setKind] = useState<DraftKind>(existing?.kind ?? 'contact');
  const [serviceDate, setServiceDate] = useState(existing?.serviceDate ?? todayKey());
  const [who, setWho] = useState(existing?.with ?? 'Family');
  const [how, setHow] = useState(existing?.how ?? 'Phone');
  const [minutes, setMinutes] = useState<number | undefined>(existing?.minutes ?? 15);
  const [reported, setReported] = useState<string[]>(existing?.reported ?? []);
  const [observed, setObserved] = useState<string[]>(existing?.observed ?? []);
  const [plan, setPlan] = useState<string[]>(existing?.plan ?? []);
  const [detail, setDetail] = useState(existing?.detail ?? '');
  const [sbar, setSbar] = useState(existing?.sbar ?? { situation: '', background: '', assessment: '', recommendation: '', attendees: '' });
  const [id] = useState(existing?.id ?? uuid());

  const draft: Draft = {
    id, code: pid, kind, serviceDate, with: kind === 'family' ? 'Family' : who, how, minutes, reported, observed, plan, detail,
    sbar: kind === 'family' ? sbar : undefined, author: prefs.role, createdAt: existing?.createdAt ?? new Date()
  };
  const text = composeDraft(draft, long(serviceDate));
  const freeText = kind === 'family' ? Object.values(sbar).join('. ') : detail;
  const hits = findIdentifiers(freeText);

  const toggle = (list: string[], set: (x: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (!pid) return <div class="stack"><h1>Note</h1><div class="empty">Add a patient first.</div></div>;

  const save = async (): Promise<boolean> => {
    if (hits.length) {
      toast('Remove names and numbers before saving. They belong in Cerner only.');
      return false;
    }
    await store.putDraft(draft);
    return true;
  };
  const copy = async () => {
    const ok = await copyText(text);
    toast(ok ? 'Copied. Paste it into Cerner.' : 'Copy failed: select the text and copy it.');
    if (!hits.length) await store.putDraft(draft);
  };
  const charted = async () => {
    await store.putDraft(purge(draft, 'charted'));
    toast('Marked charted. Draft text deleted from WardNote.');
    go('today');
  };

  return (
    <div class="stack">
      <div>
        <div class="eyebrow">{existing ? 'Draft' : 'New note'} · {long(serviceDate)}</div>
        <h1>Note</h1>
      </div>

      <div class="grid2">
        <Field label="Patient" id="n-pid">
          <select id="n-pid" class="input mono" value={pid} onChange={(e) => setPid(val(e))}>
            {patients.map((p) => <option value={p.code}>{p.code}</option>)}
          </select>
        </Field>
        <Field label="Date of service" id="n-date"><input id="n-date" class="input" type="date" value={serviceDate} onInput={(e) => val(e) && setServiceDate(val(e))} /></Field>
      </div>

      <div class="seg" role="radiogroup" aria-label="Note type">
        <button type="button" role="radio" aria-checked={kind === 'contact'} class={`chip square ${kind === 'contact' ? 'on' : ''}`} onClick={() => setKind('contact')}>Contact note</button>
        <button type="button" role="radio" aria-checked={kind === 'family'} class={`chip square ${kind === 'family' ? 'on' : ''}`} onClick={() => setKind('family')}>Family meeting</button>
      </div>

      {kind === 'contact' && (
        <>
          <ChipGroup label="With">{CONTACT_WITH.map((w) => <Chip on={who === w} onClick={() => setWho(w)}>{w}</Chip>)}</ChipGroup>
          <ChipGroup label="How">{CONTACT_HOW.map((h) => <Chip on={how === h} onClick={() => setHow(h)}>{h}</Chip>)}</ChipGroup>
        </>
      )}
      <ChipGroup label="Minutes">{MINUTES.map((m) => <Chip on={minutes === m} onClick={() => setMinutes(minutes === m ? undefined : m)}>{m}</Chip>)}</ChipGroup>

      {kind === 'contact' ? (
        <>
          <ChipGroup label="Reported">{REPORTED.map((r) => <Chip on={reported.includes(r)} onClick={() => toggle(reported, setReported, r)}>{r}</Chip>)}</ChipGroup>
          <ChipGroup label="Observed">{OBSERVED.map((o) => <Chip on={observed.includes(o)} onClick={() => toggle(observed, setObserved, o)}>{o}</Chip>)}</ChipGroup>
          <ChipGroup label="Plan">{PLAN.map((p) => <Chip on={plan.includes(p)} onClick={() => toggle(plan, setPlan, p)}>{p}</Chip>)}</ChipGroup>
          <Field label="Detail (roles, not names)" id="n-detail">
            <textarea id="n-detail" class="input" style="min-height:80px" placeholder="e.g. sister will visit Saturday" value={detail} onInput={(e) => setDetail(val(e))} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Attendees (by role)" id="s-att"><input id="s-att" class="input" placeholder="e.g. patient, mother (SDM), psychiatrist, SW, OT" value={sbar.attendees} onInput={(e) => setSbar({ ...sbar, attendees: val(e) })} /></Field>
          {(['situation', 'background', 'assessment', 'recommendation'] as const).map((k) => (
            <Field label={k.charAt(0).toUpperCase() + k.slice(1)} id={`s-${k}`}>
              <textarea id={`s-${k}`} class="input" style="min-height:70px" value={sbar[k]} onInput={(e) => setSbar({ ...sbar, [k]: val(e) })} />
            </Field>
          ))}
        </>
      )}

      {hits.length > 0 && <div class="warnbox" role="alert">This looks identifying: {describeHits(hits)}. Use roles such as “sister” here; names go only in Cerner.</div>}

      <section class="card stack-sm">
        <h2>Draft for Cerner</h2>
        <div class="draft">{text}</div>
        <div class="tiny muted">Reported and observed stay separate. Sign and date the note in Cerner with your designation.</div>
      </section>

      <div class="grid2">
        <button class="btn primary big" onClick={copy}>Copy for Cerner</button>
        <button class="btn outline big" onClick={charted}>Mark charted</button>
      </div>
      <button class="btn block" onClick={async () => { if (await save()) { toast('Draft saved. It shows on Today until charted.'); go('today'); } }}>Save draft for later</button>
      <div class="tiny muted">Marking charted deletes the note text here and keeps only who, how, how long and when. Uncharted drafts are deleted after {prefs.draftDays} days.</div>
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="stack-sm">
      <div class="label">{label}</div>
      <div class="row-wrap">{children}</div>
    </div>
  );
}
