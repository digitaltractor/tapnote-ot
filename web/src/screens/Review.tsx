import { useEffect, useState } from 'preact/hooks';
import { ATTENDANCE_LABEL, NOTE_FORMATS, NOTE_FORMAT_LABEL, NoteFormat, minutes, serviceDelivered, serviceType } from '../core/types';
import { composeNote, plainText } from '../core/notes';
import { checkSession, isReadyToSign } from '../core/audit';
import { scrubNames } from '../core/pseudonym';
import { TimeStyle } from '../core/time';
import type { SessionRecord } from '../data/db';
import { isInProgress, snapshot } from '../data/store';
import { signature, supervisorSignature, usePrefs } from '../data/prefs';
import { hasCoSignPassphrase, verifyCoSignPassphrase } from '../data/cosign';
import { Badge, BackButton, Sheet, fromDateInput, sameDay, toDateInput, useApp, val } from '../ui/components';

const time = new TimeStyle();

export function Review() {
  const { store, authenticate, vault, toast } = useApp();
  const prefs = usePrefs();
  const [day, setDay] = useState(new Date());
  const daySessions = store.sessionList().filter((s) => sameDay(s.date, day));
  const snaps = daySessions.map((s) => snapshot(s, store.students.get(s.studentCode)));
  const issuesFor = (s: SessionRecord) => checkSession(snapshot(s, store.students.get(s.studentCode)), snaps);
  const ready = daySessions.filter((s) => !s.signedAt && !isInProgress(s) && isReadyToSign(issuesFor(s)));
  const signedCount = daySessions.filter((s) => s.signedAt).length;

  const signAll = async () => {
    const ok = await authenticate(`Sign ${ready.length} notes`);
    if (!ok) return;
    const names = vault.namesForScrubbing();
    const now = new Date();
    const next = ready.map((s) => {
      const draft = s.noteText ?? plainText(composeNote(snapshot(s, store.students.get(s.studentCode)), s.noteFormat ?? prefs.noteFormat, time));
      return { ...s, noteText: scrubNames(draft, names).text, noteFormat: s.noteFormat ?? prefs.noteFormat, signedAt: now, signerName: signature(prefs), signerRole: prefs.role };
    });
    await store.putSessions(next, 'signed and locked', `by ${signature(prefs)}`);
    toast(`Signed ${next.length} notes.`);
  };

  return (
    <div class="stack">
      <div>
        <h1>Review</h1>
        <div class="muted">{signedCount} of {daySessions.length} signed. Drafts are written from your taps.</div>
      </div>
      <div class="field">
        <label for="day">Day</label>
        <input id="day" class="input" type="date" value={toDateInput(day)} onInput={(e) => val(e) && setDay(fromDateInput(val(e)))} />
      </div>
      {ready.length > 0 && (
        <button class="btn primary block big" onClick={signAll}>Sign all ready ({ready.length})</button>
      )}
      {daySessions.length === 0 ? (
        <div class="empty">No sessions on this day.</div>
      ) : (
        <div class="list">
          {daySessions.map((s) => {
            const issues = issuesFor(s);
            const blocking = issues.find((i) => i.severity === 'blocking');
            const m = minutes(s);
            const sub = !serviceDelivered(s.attendance)
              ? `${ATTENDANCE_LABEL[s.attendance]} · log entry only`
              : `${s.groupSize > 1 ? `Group of ${s.groupSize}` : 'Individual'}${m != null ? ` · ${m} min` : ''}`;
            return (
              <a class="list-item" href={`#/review/${s.id}`}>
                <div class="grow">
                  <span class="mono">{s.start ? time.time(s.start) : '—'} · {s.studentCode}</span>
                  <span class="small muted">{sub}</span>
                </div>
                {s.signedAt && s.signerRole === 'COTA' && !s.coSignedAt ? <Badge kind="warn">Needs co-sign</Badge>
                  : s.signedAt ? <Badge kind="ok">Signed</Badge>
                  : isInProgress(s) ? <Badge>In progress</Badge>
                  : blocking ? <Badge kind="warn">{blocking.message.length > 22 ? 'Needs fixes' : blocking.message}</Badge>
                  : <Badge>Ready</Badge>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NoteDetail({ sessionId }: { sessionId: string }) {
  const { store, authenticate, vault, toast } = useApp();
  const prefs = usePrefs();
  const s = store.sessions.get(sessionId);
  const [format, setFormat] = useState<NoteFormat>(s?.noteFormat ?? prefs.noteFormat);
  const [draft, setDraft] = useState('');
  const [addendum, setAddendum] = useState<string | null>(null);
  const [coSigning, setCoSigning] = useState(false);

  const student = s ? store.students.get(s.studentCode) : undefined;
  const snap = s ? snapshot(s, student) : undefined;
  const composed = snap ? composeNote(snap, format, time) : undefined;

  useEffect(() => {
    if (s && composed) setDraft(s.noteText ?? plainText(composed));
  }, [sessionId]);

  // Save the draft as it's edited (unsigned notes only).
  useEffect(() => {
    if (!s || s.signedAt || !draft) return;
    const t = setTimeout(() => store.updateSession(s.id, (x) => { x.noteText = draft; x.noteFormat = format; }), 400);
    return () => clearTimeout(t);
  }, [draft, format]);

  if (!s || !snap || !composed) {
    return <div class="stack"><div class="topbar"><BackButton to="review" /><h2>Note not found</h2></div></div>;
  }

  const sameDaySnaps = store.sessionList().filter((x) => sameDay(x.date, s.date)).map((x) => snapshot(x, store.students.get(x.studentCode)));
  const issues = checkSession(snap, sameDaySnaps);
  const extraMissing = composed.missing.filter((m) => !issues.some((i) => i.message.toLowerCase().includes(m.toLowerCase())));

  const sign = async () => {
    const ok = await authenticate('Sign this note');
    if (!ok) return;
    const text = scrubNames(draft, vault.namesForScrubbing()).text;
    await store.putSessions([{ ...s, noteText: text, noteFormat: format, signedAt: new Date(), signerName: signature(prefs), signerRole: prefs.role }], 'signed and locked', `by ${signature(prefs)}`);
    toast('Signed and locked.');
  };

  const addAddendum = async () => {
    const text = (addendum ?? '').trim();
    if (!text) return;
    const scrubbed = scrubNames(text, vault.namesForScrubbing()).text;
    const next = { ...s, addenda: [...s.addenda, { date: new Date(), author: signature(prefs), text: scrubbed }] };
    await store.putSessions([next], 'addendum added');
    setAddendum(null);
    toast('Addendum added.');
  };

  return (
    <div class="stack">
      <div class="topbar">
        <BackButton to="review" />
        <div class="spacer"><div class="mono">{s.studentCode}</div><div class="tiny muted">{student?.alias}</div></div>
        {serviceDelivered(s.attendance) && !s.signedAt && <a class="btn" style="min-height:44px" href={`#/session/${s.groupKey}`}>Edit taps</a>}
      </div>

      <div class="card stack-sm small">
        <div class="row"><span class="muted">Date</span><span class="spacer" />{time.date(s.date)}</div>
        {s.start && <div class="row"><span class="muted">Time</span><span class="spacer" />{time.time(s.start)} – {s.end ? time.time(s.end) : '…'}</div>}
        <div class="row"><span class="muted">Service type</span><span class="spacer" /><span class="mono">{serviceType(snap)}</span></div>
      </div>

      {s.signedAt ? (
        <>
          <section class="card stack-sm">
            <h2>Signed note</h2>
            <div class="note-text">{s.noteText}</div>
            <div class="tiny muted">Signed {time.date(s.signedAt)} {time.time(s.signedAt)} by {s.signerName}. Locked.</div>
          </section>
          {s.addenda.length > 0 && (
            <section class="card stack-sm">
              <h2>Addenda</h2>
              {s.addenda.map((a) => (
                <div>
                  <div class="tiny muted">{time.date(a.date)} {time.time(a.date)} · {a.author}</div>
                  <div class="note-text">{a.text}</div>
                </div>
              ))}
            </section>
          )}
          {s.signerRole === 'COTA' && (
            s.coSignedAt
              ? <div class="card small">Co-signed {time.date(s.coSignedAt)} {time.time(s.coSignedAt)} by {s.coSignerName}.</div>
              : <button class="btn primary block" onClick={() => setCoSigning(true)}>Co-sign as supervising OT</button>
          )}
          <button class="btn outline block" onClick={() => setAddendum('')}>Add addendum</button>
        </>
      ) : (
        <>
          {(issues.length > 0 || extraMissing.length > 0) && (
            <section class="card stack-sm">
              <h2>Check before signing</h2>
              {issues.map((i) => <div class={`issue ${i.severity}`}>{i.severity === 'blocking' ? '●' : '○'} {i.message}</div>)}
              {extraMissing.map((m) => <div class="issue">○ Not recorded: {m.toLowerCase()}</div>)}
            </section>
          )}
          <section class="stack-sm">
            <div class="seg" role="radiogroup" aria-label="Note format">
              {NOTE_FORMATS.map((f) => (
                <button type="button" role="radio" aria-checked={format === f} class={`chip square ${format === f ? 'on' : ''}`}
                  onClick={() => { setFormat(f); if (snap) setDraft(plainText(composeNote(snap, f, time))); }}>{NOTE_FORMAT_LABEL[f]}</button>
              ))}
            </div>
            <label class="sr-only" for="note">Note text</label>
            <textarea id="note" class="input" value={draft} onInput={(e) => setDraft(val(e))} />
            <div class="row">
              <span class="tiny muted">Bracketed text is a placeholder to fill in or delete.</span>
              <span class="spacer" />
              <button type="button" class="link" onClick={() => setDraft(plainText(composeNote(snap, format, time)))}>Regenerate from data</button>
            </div>
          </section>
          <button class="btn primary block big" disabled={!isReadyToSign(issues) || isInProgress(s)} onClick={sign}>Sign and lock</button>
          <div class="tiny muted">Signs as {signature(prefs)}. After signing, the note can't be edited; add a dated addendum instead.</div>
        </>
      )}

      {coSigning && <CoSignSheet session={s} onClose={() => setCoSigning(false)} />}
      {addendum !== null && (
        <Sheet title="Addendum" onClose={() => setAddendum(null)}>
          <div class="stack">
            <textarea class="input" aria-label="Addendum text" value={addendum} onInput={(e) => setAddendum(val(e))} />
            <button class="btn primary block" disabled={!addendum.trim()} onClick={addAddendum}>Add</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Beta: the supervising OT co-signs a COTA's signed note with her own co-sign passphrase. */
function CoSignSheet({ session, onClose }: { session: SessionRecord; onClose: () => void }) {
  const { store, toast } = useApp();
  const prefs = usePrefs();
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    if (!(await hasCoSignPassphrase(store.db))) {
      setError('The supervising OT needs to set a co-sign passphrase in Settings first.');
      setBusy(false);
      return;
    }
    if (!(await verifyCoSignPassphrase(store.db, pass))) {
      setError('That co-sign passphrase didn’t match.');
      setBusy(false);
      return;
    }
    const by = supervisorSignature(prefs);
    await store.putSessions([{ ...session, coSignedAt: new Date(), coSignerName: by }], 'co-signed', `by ${by}`);
    toast('Co-signed.');
    onClose();
  };

  return (
    <Sheet title="Co-sign note" onClose={onClose}>
      <form class="stack" onSubmit={submit}>
        <p class="muted" style="margin:0">Co-signing as {supervisorSignature(prefs)}. The note text doesn't change; the co-signature is added to the record and exports.</p>
        <input class="input" type="password" autocomplete="off" aria-label="Supervisor co-sign passphrase" placeholder="Supervisor co-sign passphrase" value={pass} onInput={(e) => setPass(val(e))} />
        {error && <div class="issue blocking" role="alert">{error}</div>}
        <button class="btn primary block" type="submit" disabled={!pass || busy}>{busy ? 'Checking…' : 'Co-sign'}</button>
      </form>
    </Sheet>
  );
}
