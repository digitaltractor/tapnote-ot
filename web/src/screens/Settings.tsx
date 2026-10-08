import { useState } from 'preact/hooks';
import { DEFAULT_PROMPT_LEVELS, NOTE_FORMATS, NOTE_FORMAT_LABEL, NoteFormat, serviceType, StudentIdentity } from '../core/types';
import { sbapCSV, toCSV } from '../core/csv';
import { TimeStyle } from '../core/time';
import { makeBackup, readBackup } from '../data/backup';
import { setPrefs, signature, supervisorSignature, usePrefs } from '../data/prefs';
import { hasCoSignPassphrase, setCoSignPassphrase } from '../data/cosign';
import { SBAP_OT_KEYS, SBAP_OT_KEYS_SOURCE, sbapActivity } from '../core/sbapKeys';
import { snapshot } from '../data/store';
import { Vault } from '../data/vault';
import { renderPdf } from '../export/pdf';
import { Field, Sheet, checked, fromDateInput, shareFile, toDateInput, useApp, uuid, val } from '../ui/components';

const time = new TimeStyle();

export function Settings() {
  const { store, vault, authenticate, toast } = useApp();
  const prefs = usePrefs();
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; });
  const [to, setTo] = useState(new Date());
  const [includeNames, setIncludeNames] = useState(false);
  const [newActivity, setNewActivity] = useState('');
  const [newKey, setNewKey] = useState('');
  const [backupPass, setBackupPass] = useState('');
  const [backupPass2, setBackupPass2] = useState('');
  const [restoreFile, setRestoreFile] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [faceIdStep, setFaceIdStep] = useState<'idle' | 'confirm'>('idle');
  const [passChange, setPassChange] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const rangeSessions = () => {
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
    return store.sessionList().filter((s) => s.date >= start && s.date <= end);
  };

  const identities = async (needed: boolean): Promise<Record<string, StudentIdentity> | null> => {
    if (!needed) return {};
    if (!(await authenticate('Add names to the export'))) return null;
    return vault.all();
  };

  const exportCSV = async () => {
    const ids = await identities(includeNames);
    if (!ids) return;
    const rows = rangeSessions();
    const csv = sbapCSV(rows.map((s) => snapshot(s, store.students.get(s.studentCode))), {
      time,
      noteText: (snap) => rows.find((r) => r.id === snap.id)?.noteText,
      identity: includeNames ? (c) => ids[c] : undefined,
      signatures: (snap) => {
        const r = rows.find((x) => x.id === snap.id);
        return { signedBy: r?.signedAt ? r.signerName : undefined, coSignedBy: r?.coSignedAt ? r.coSignerName : undefined };
      }
    });
    await shareFile(csv, `SBAP-log-${time.fileDate(new Date())}${includeNames ? '-identified' : ''}.csv`, 'text/csv');
  };

  const exportNotes = async () => {
    const ids = await identities(includeNames);
    if (!ids) return;
    const signed = rangeSessions().filter((s) => s.signedAt);
    if (signed.length === 0) {
      toast('No signed notes in this date range.');
      return;
    }
    const blocks = signed.map((s) => {
      const who = includeNames ? ids[s.studentCode]?.realName || s.studentCode : s.studentCode;
      const snap = snapshot(s, store.students.get(s.studentCode));
      const when = s.start && s.end ? ` · ${time.time(s.start)}–${time.time(s.end)}` : '';
      let text = s.noteText ?? '';
      if (s.signedAt) text += `\nSigned ${time.date(s.signedAt)} ${time.time(s.signedAt)} by ${s.signerName ?? ''}`;
      if (s.coSignedAt) text += `\nCo-signed ${time.date(s.coSignedAt)} ${time.time(s.coSignedAt)} by ${s.coSignerName ?? ''}`;
      else if (s.signerRole === 'COTA') text += '\nAwaiting co-signature by the supervising OT';
      for (const a of s.addenda) text += `\nAddendum ${time.date(a.date)} ${time.time(a.date)} (${a.author}): ${a.text}`;
      return { heading: `${who} · ${time.date(s.date)}${when} · ${serviceType(snap)}`, text };
    });
    const blob = await renderPdf('Occupational Therapy Session Notes', [`${time.date(from)} – ${time.date(to)}`, `Therapist: ${signature(prefs)}`], blocks, `Exported ${time.date(new Date())}`);
    await shareFile(blob, `OT-notes-${time.fileDate(new Date())}${includeNames ? '-identified' : ''}.pdf`, 'application/pdf');
  };

  const exportBackup = async () => {
    const file = await makeBackup(store.studentList(), store.sessionList(), backupPass, { schedule: store.slotList(), closures: store.closures, contacts: store.contactList() });
    setBackupPass('');
    setBackupPass2('');
    await store.audit('Backup', 'export', 'exported');
    await shareFile(file, `TapNote-${time.fileDate(new Date())}.tapnotebackup`, 'application/octet-stream');
  };

  const pickRestore = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    setRestoreFile(new Uint8Array(await f.arrayBuffer()));
    (e.currentTarget as HTMLInputElement).value = '';
  };

  const restore = async () => {
    if (!restoreFile) return;
    try {
      const data = await readBackup(restoreFile, restorePass);
      if (!confirm(`Replace all data on this device with ${data.students.length} students and ${data.sessions.length} sessions from ${time.date(data.createdAt)}?`)) return;
      await store.replaceAll(data.students, data.sessions, data.schedule, data.closures, data.contacts);
      await store.audit('Backup', 'restore', 'restored', `${data.students.length} students, ${data.sessions.length} sessions`);
      setRestoreFile(null);
      setRestorePass('');
      toast('Backup restored.');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const exportNameKey = async () => {
    const ids = await identities(true);
    if (!ids) return;
    const rows = [['Student Code', 'Alias', 'Real Name', 'DOB', 'PA Secure ID', 'Diagnosis']];
    for (const s of store.studentList()) {
      const id = ids[s.code];
      rows.push([s.code, s.alias, id?.realName ?? '', id?.dateOfBirth ?? '', id?.paSecureID ?? '', id?.diagnosis ?? '']);
    }
    await shareFile(toCSV(rows), `TapNote-name-key-${time.fileDate(new Date())}.csv`, 'text/csv');
  };

  const turnOnFaceId = async () => {
    try {
      if (faceIdStep === 'confirm') {
        await vault.confirmPasskey();
        setFaceIdStep('idle');
        toast('Face ID unlock is on.');
        return;
      }
      if (!vault.isUnlocked && !(await authenticate('Turn on Face ID'))) return;
      const result = await vault.addPasskey();
      if (result === 'confirm') setFaceIdStep('confirm');
      else toast('Face ID unlock is on.');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const loadSamples = async () => {
    const samples: [string, string, string, [string, number][]][] = [
      ['K7-OTTER', 'Otter', '1–2', [['Letter formation', 90], ['Cutting a curved line', 80]]],
      ['M3-HERON', 'Heron', 'K', [['Buttoning', 80]]],
      ['P9-MAPLE', 'Maple', '3–5', [['Copying from board', 85]]]
    ];
    for (const [code, alias, band, goals] of samples) {
      await store.putStudent({
        code, alias, gradeBand: band, serviceMode: 'individual', weeklyMinutes: 30, reportCadence: 'Quarterly', isActive: true, createdAt: new Date(),
        goals: goals.map(([name, crit], i) => ({ id: uuid(), number: i + 1, shortName: name, detail: '', criterionPercent: crit, isActive: true }))
      }, 'sample created');
    }
    toast('Sample students added.');
  };

  const okBackup = backupPass.length >= 8 && backupPass === backupPass2;

  return (
    <div class="stack">
      <h1>Settings</h1>

      <section class="card stack">
        <h2>Therapist</h2>
        <div class="grid2">
          <Field label="Your name" id="tn"><input id="tn" class="input" autocomplete="name" value={prefs.therapistName} onInput={(e) => setPrefs({ therapistName: val(e) })} /></Field>
          <Field label="Credentials" id="cr"><input id="cr" class="input" value={prefs.credentials} onInput={(e) => setPrefs({ credentials: val(e) })} /></Field>
        </div>
        <div class="grid2">
          <Field label="Default session (min)" id="dm"><input id="dm" class="input" type="number" inputMode="numeric" min={5} step={5} value={prefs.defaultSessionMinutes} onInput={(e) => setPrefs({ defaultSessionMinutes: Number(val(e)) || 30 })} /></Field>
          <Field label="Note format" id="nf">
            <select id="nf" class="input" value={prefs.noteFormat} onChange={(e) => setPrefs({ noteFormat: val(e) as NoteFormat })}>
              {NOTE_FORMATS.map((f) => <option value={f}>{NOTE_FORMAT_LABEL[f]}</option>)}
            </select>
          </Field>
        </div>
        <div class="tiny muted">Notes are signed as {signature(prefs)}.</div>
      </section>

      <RoleSection />
      <CalendarSection />

      <section class="card stack-sm">
        <h2>Prompt levels</h2>
        <div class="tiny muted">Least to most assistance. Rename or turn off levels you don't use.</div>
        {prefs.promptLevels.map((l, i) => (
          <div class="row">
            <input type="checkbox" aria-label={`Use ${l.name}`} checked={l.isEnabled} style="width:22px;height:22px;accent-color:var(--acc)"
              onChange={(e) => setPrefs({ promptLevels: prefs.promptLevels.map((x, j) => (j === i ? { ...x, isEnabled: checked(e) } : x)) })} />
            <input class="input" aria-label="Level name" value={l.name} onInput={(e) => setPrefs({ promptLevels: prefs.promptLevels.map((x, j) => (j === i ? { ...x, name: val(e) } : x)) })} />
            <input class="input" aria-label="Short label" style="width:100px" value={l.shortName} onInput={(e) => setPrefs({ promptLevels: prefs.promptLevels.map((x, j) => (j === i ? { ...x, shortName: val(e) } : x)) })} />
          </div>
        ))}
        <button class="link" style="align-self:flex-start" onClick={() => setPrefs({ promptLevels: DEFAULT_PROMPT_LEVELS })}>Restore defaults</button>
      </section>

      <section class="card stack-sm">
        <h2>Activities</h2>
        <div class="tiny muted">These are your quick-tap activities. The full SBAP list is always one tap away during a session.</div>
        <button class="btn outline block" onClick={() => setBrowsing(true)}>Choose from the SBAP list ({SBAP_OT_KEYS.length})</button>
        {prefs.activityCatalog.map((a, i) => (
          <div class="row">
            <span class="spacer">{a.name}</span>
            {a.sbapKey != null && <span class="tiny mono muted">SBAP {a.sbapKey}</span>}
            <button class="link" aria-label={`Remove ${a.name}`} onClick={() => setPrefs({ activityCatalog: prefs.activityCatalog.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <div class="row">
          <input class="input" aria-label="New activity" placeholder="New activity" value={newActivity} onInput={(e) => setNewActivity(val(e))} />
          <input class="input" aria-label="SBAP key" placeholder="Key" inputMode="numeric" style="width:80px" value={newKey} onInput={(e) => setNewKey(val(e))} />
          <button class="btn" disabled={!newActivity.trim()} onClick={() => {
            const key = parseInt(newKey, 10);
            setPrefs({ activityCatalog: [...prefs.activityCatalog, { id: `custom-${uuid().slice(0, 8)}`, name: newActivity.trim(), ...(Number.isFinite(key) ? { sbapKey: key } : {}) }] });
            setNewActivity('');
            setNewKey('');
          }}>Add</button>
        </div>
      </section>

      <section class="card stack">
        <h2>Export</h2>
        <div class="grid2">
          <Field label="From" id="ef"><input id="ef" class="input" type="date" value={toDateInput(from)} onInput={(e) => val(e) && setFrom(fromDateInput(val(e)))} /></Field>
          <Field label="To" id="et"><input id="et" class="input" type="date" value={toDateInput(to)} onInput={(e) => val(e) && setTo(fromDateInput(val(e)))} /></Field>
        </div>
        <label class="check"><input type="checkbox" checked={includeNames} onChange={(e) => setIncludeNames(checked(e))} /> Include names, DOB and PA Secure ID</label>
        <button class="btn block" onClick={exportCSV}>Export SBAP-format log (CSV)</button>
        <button class="btn block" onClick={exportNotes}>Export signed notes (PDF)</button>
        <div class="tiny muted">Without names, files carry student codes only. With names you'll unlock first, and identities are added on this device.</div>
      </section>

      <section class="card stack">
        <h2>Vault</h2>
        <div class="small">{vault.hasPasskey ? 'Face ID unlock is on.' : 'Unlock with passphrase.'} {vault.isUnlocked ? 'Unlocked now (locks after 5 minutes idle).' : 'Locked.'}</div>
        {Vault.passkeysSupported() && !vault.hasPasskey && (
          <button class="btn outline block" onClick={turnOnFaceId}>{faceIdStep === 'confirm' ? 'Confirm with Face ID' : 'Turn on Face ID unlock'}</button>
        )}
        {vault.hasPasskey && <button class="btn block" onClick={async () => { await vault.removePasskey(); toast('Face ID unlock turned off.'); }}>Turn off Face ID unlock</button>}
        <button class="btn block" onClick={() => setPassChange(true)}>Change vault passphrase</button>
        {vault.isUnlocked && <button class="btn block" onClick={() => vault.lock()}>Lock now</button>}
        <button class="btn block" onClick={exportNameKey}>Export name key (CSV)</button>
        <div class="tiny muted">The name key maps codes to real names. Keep it somewhere safe, like a district drive, so you can restore names on a new device.</div>
      </section>

      <section class="card stack">
        <h2>Backup</h2>
        <div class="grid2">
          <input class="input" type="password" autocomplete="new-password" aria-label="Backup passphrase" placeholder="Backup passphrase" value={backupPass} onInput={(e) => setBackupPass(val(e))} />
          <input class="input" type="password" autocomplete="new-password" aria-label="Repeat backup passphrase" placeholder="Repeat" value={backupPass2} onInput={(e) => setBackupPass2(val(e))} />
        </div>
        <button class="btn primary block" disabled={!okBackup} onClick={exportBackup}>Export encrypted backup</button>
        <label class="btn block" for="restore">Restore from backup…</label>
        <input id="restore" type="file" class="sr-only" accept=".tapnotebackup,application/octet-stream" onChange={pickRestore} />
        <div class="tiny muted">Codes and session data, encrypted with your passphrase (8+ characters). Opens in the TapNote iPhone app too. Names are not included.</div>
      </section>

      <section class="card stack-sm">
        <h2>About</h2>
        <div class="small muted">TapNote OT web app · data stays on this device</div>
        <button class="btn block" disabled={store.students.size > 0} onClick={loadSamples}>Load sample students</button>
      </section>

      {restoreFile && (
        <Sheet title="Restore backup" onClose={() => setRestoreFile(null)}>
          <div class="stack">
            <p class="muted" style="margin:0">This replaces every student and session on this device with the backup's contents.</p>
            <input class="input" type="password" aria-label="Backup passphrase" placeholder="Backup passphrase" value={restorePass} onInput={(e) => setRestorePass(val(e))} />
            <button class="btn danger block" disabled={!restorePass} onClick={restore}>Replace all data</button>
          </div>
        </Sheet>
      )}
      {passChange && <ChangePassphrase onClose={() => setPassChange(false)} />}
      {browsing && <SbapBrowser onClose={() => setBrowsing(false)} />}
    </div>
  );
}

function ChangePassphrase({ onClose }: { onClose: () => void }) {
  const { vault, toast } = useApp();
  const [oldPass, setOld] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await vault.changePassphrase(oldPass, p1);
      toast('Passphrase changed.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet title="Change passphrase" onClose={onClose}>
      <div class="stack">
        <input class="input" type="password" autocomplete="current-password" aria-label="Current passphrase" placeholder="Current passphrase" value={oldPass} onInput={(e) => setOld(val(e))} />
        <input class="input" type="password" autocomplete="new-password" aria-label="New passphrase" placeholder="New passphrase (8+)" value={p1} onInput={(e) => setP1(val(e))} />
        <input class="input" type="password" autocomplete="new-password" aria-label="Repeat new passphrase" placeholder="Repeat new passphrase" value={p2} onInput={(e) => setP2(val(e))} />
        {error && <div class="issue blocking" role="alert">{error}</div>}
        <button class="btn primary block" disabled={!oldPass || p1.length < 8 || p1 !== p2} onClick={save}>Change</button>
      </div>
    </Sheet>
  );
}

/** Beta: the SBAP OT treatment-key list; checked keys become quick-tap activities. */
export function SbapBrowser({ onClose, onPick, title = 'SBAP activity list' }: { onClose: () => void; onPick?: (key: number) => void; title?: string }) {
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const inCatalog = new Set(prefs.activityCatalog.map((a) => a.sbapKey).filter((k): k is number => k != null));
  const shown = SBAP_OT_KEYS.filter((k) => !q.trim() || `${k.key} ${k.category} ${k.label}`.toLowerCase().includes(q.trim().toLowerCase()));
  const categories = [...new Set(shown.map((k) => k.category))];

  const toggle = (key: number) => {
    if (onPick) return onPick(key);
    if (inCatalog.has(key)) setPrefs({ activityCatalog: prefs.activityCatalog.filter((a) => a.sbapKey !== key) });
    else {
      const a = sbapActivity(key);
      if (a) setPrefs({ activityCatalog: [...prefs.activityCatalog, a] });
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <div class="stack-sm">
        <input class="input" type="search" placeholder="Search by number or name" aria-label="Search activities" value={q} onInput={(e) => setQ(val(e))} />
        <div class="tiny muted">{SBAP_OT_KEYS_SOURCE}</div>
        {categories.map((c) => (
          <div class="stack-sm" style="margin-top:6px">
            <div class="label">{c}</div>
            {shown.filter((k) => k.category === c).map((k) => (
              onPick
                ? <button type="button" class="list-item" style="min-height:48px" onClick={() => toggle(k.key)}><span class="mono" style="width:32px">{k.key}</span><span class="grow">{k.label}</span></button>
                : <label class="check"><input type="checkbox" checked={inCatalog.has(k.key)} onChange={() => toggle(k.key)} /><span class="mono" style="width:28px">{k.key}</span> {k.label}</label>
            ))}
          </div>
        ))}
        {shown.length === 0 && <div class="muted small">No match.</div>}
      </div>
    </Sheet>
  );
}

/** Beta: OT or COTA role; for a COTA, the supervising OT and her co-sign passphrase. */
function RoleSection() {
  const { store, toast } = useApp();
  const prefs = usePrefs();
  const [hasPass, setHasPass] = useState<boolean | null>(null);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  if (hasPass === null) hasCoSignPassphrase(store.db).then(setHasPass);

  const savePass = async () => {
    await setCoSignPassphrase(store.db, p1);
    setP1('');
    setP2('');
    setHasPass(true);
    await store.audit('CoSign', 'passphrase', 'set');
    toast('Co-sign passphrase saved.');
  };

  return (
    <section class="card stack">
      <h2>Role and supervision <span class="badge warn" style="margin-left:6px">Beta</span></h2>
      <div class="seg" role="radiogroup" aria-label="Role">
        {(['OT', 'COTA'] as const).map((r) => (
          <button type="button" role="radio" aria-checked={prefs.role === r} class={`chip square ${prefs.role === r ? 'on' : ''}`}
            onClick={() => setPrefs({ role: r, credentials: r === 'COTA' && prefs.credentials === 'OTR/L' ? 'COTA/L' : r === 'OT' && prefs.credentials === 'COTA/L' ? 'OTR/L' : prefs.credentials })}>
            {r === 'OT' ? 'Occupational therapist' : 'OT assistant (COTA)'}
          </button>
        ))}
      </div>
      {prefs.role === 'COTA' && (
        <>
          <div class="tiny muted">Notes you sign are marked “needs co-sign” until your supervising OT co-signs them with her own passphrase. PA requires the supervisor's signature on COTA service logs.</div>
          <div class="grid2">
            <Field label="Supervising OT" id="sup"><input id="sup" class="input" value={prefs.supervisorName} onInput={(e) => setPrefs({ supervisorName: val(e) })} /></Field>
            <Field label="Credentials" id="supcr"><input id="supcr" class="input" value={prefs.supervisorCredentials} onInput={(e) => setPrefs({ supervisorCredentials: val(e) })} /></Field>
          </div>
          <div class="stack-sm">
            <div class="label">Supervisor's co-sign passphrase {hasPass ? '(set)' : '(not set)'}</div>
            <div class="tiny muted">Hand the device to {supervisorSignature(prefs)} to {hasPass ? 'change' : 'set'} it. It's stored only as a verifier, never as text.</div>
            <div class="grid2">
              <input class="input" type="password" autocomplete="off" aria-label="New co-sign passphrase" placeholder="New passphrase (8+)" value={p1} onInput={(e) => setP1(val(e))} />
              <input class="input" type="password" autocomplete="off" aria-label="Repeat co-sign passphrase" placeholder="Repeat" value={p2} onInput={(e) => setP2(val(e))} />
            </div>
            <button class="btn block" disabled={p1.length < 8 || p1 !== p2} onClick={savePass}>{hasPass ? 'Change' : 'Set'} co-sign passphrase</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Beta 2: school calendar (60-day clock, report dates) and mastery rule. */
function CalendarSection() {
  const prefs = usePrefs();
  const [mp, setMp] = useState('');
  return (
    <section class="card stack">
      <h2>School calendar and mastery</h2>
      <div class="grid2">
        <Field label="Last day of school (spring)" id="cal-ls"><input id="cal-ls" class="input" type="date" value={prefs.lastDaySpring} onInput={(e) => setPrefs({ lastDaySpring: val(e) })} /></Field>
        <Field label="First day of school (fall)" id="cal-ff"><input id="cal-ff" class="input" type="date" value={prefs.firstDayFall} onInput={(e) => setPrefs({ firstDayFall: val(e) })} /></Field>
      </div>
      <div class="tiny muted">Summer break doesn't count toward the 60-day evaluation clock. Update these each year.</div>
      <div class="stack-sm">
        <div class="label">Marking periods end</div>
        {prefs.markingPeriodEnds.length === 0 && <div class="tiny muted">None set. Quarterly progress reports fall back to calendar quarter ends.</div>}
        {[...prefs.markingPeriodEnds].sort().map((k) => (
          <div class="row small">
            <span class="spacer">{fromDateInput(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <button class="link" aria-label={`Remove ${k}`} onClick={() => setPrefs({ markingPeriodEnds: prefs.markingPeriodEnds.filter((x) => x !== k) })}>Remove</button>
          </div>
        ))}
        <div class="row">
          <input class="input" type="date" aria-label="Marking period end date" value={mp} onInput={(e) => setMp(val(e))} />
          <button class="btn" disabled={!mp} onClick={() => { setPrefs({ markingPeriodEnds: [...new Set([...prefs.markingPeriodEnds, mp])].sort() }); setMp(''); }}>Add</button>
        </div>
      </div>
      <Field label="Sessions in a row at criterion for mastery" id="mast" hint="Used for mastery badges and suggested next steps in progress reports.">
        <input id="mast" class="input" type="number" inputMode="numeric" min={1} max={10} style="width:110px" value={prefs.masterySessions} onInput={(e) => setPrefs({ masterySessions: Math.min(10, Math.max(1, Number(val(e)) || 3)) })} />
      </Field>
    </section>
  );
}
