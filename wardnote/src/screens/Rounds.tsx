import { useState } from 'preact/hooks';
import { fromKey, short, todayKey } from '../core/dates';
import { roundsLine, roundsSummary } from '../core/rounds';
import { ROLES } from '../core/ward';
import { describeHits, findIdentifiers } from '../core/identifiers';
import { usePrefs } from '../data/prefs';
import { Badge, Chip, Field, copyText, go, useApp, val } from '../ui/components';

export function Rounds({ code }: { code?: string }) {
  const { store, toast } = useApp();
  const prefs = usePrefs();
  const today = todayKey();
  const patients = store.patientList().filter((p) => p.active);
  const lines = patients.map((p) => roundsLine(p, store.formList(), store.referralList(), today));
  const sel = lines.find((l) => l.code === code) ?? lines[0];
  const [present, setPresent] = useState<string[]>([...ROLES]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const text = decisions[sel?.code ?? ''] ?? '';
  const hits = findIdentifiers(text);
  const summary = sel ? roundsSummary(sel, today, text.split('\n'), present) : '';

  const withEdd = lines.filter((l) => l.edd && l.owner).length;

  return (
    <div class="stack">
      <div>
        <div class="eyebrow">{fromKey(today).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })} · {prefs.unit}</div>
        <h1>Rounds board</h1>
        <div class="muted">{withEdd} of {lines.length} patients have an EDD and an owner.</div>
      </div>

      <div class="split">
        <div class="grow-main board-wrap">
          <table class="board">
            <thead>
              <tr><th scope="col">Patient</th><th scope="col">Legal status</th><th scope="col">EDD</th><th scope="col">Main barrier</th><th scope="col">Owner</th><th scope="col">Next step</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr class={l === sel ? 'on' : ''}>
                  <td><button class="chip square mono" style="white-space:nowrap" aria-pressed={l === sel} onClick={() => go(`rounds/${encodeURIComponent(l.code)}`)}>{l.code}</button></td>
                  <td>{l.legal}{l.legalNext && <div class="tiny muted">{l.legalNext}</div>}</td>
                  <td style="white-space:nowrap">{l.edd ? short(l.edd) : <Badge kind="warn">Not set</Badge>}{l.alc != null && <div class="tiny muted">ALC {l.alc}d</div>}</td>
                  <td>{l.barrier ?? '—'}</td>
                  <td style="white-space:nowrap">{l.owner ?? <Badge kind="warn">None</Badge>}</td>
                  <td>{l.next ? <>{l.next.nextAction}<div class={`tiny ${l.next.nextDue! < today ? 'bold' : 'muted'}`} style={l.next.nextDue! < today ? 'color:var(--amber)' : ''}>{l.next.kind} · {short(l.next.nextDue!)}</div></> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sel && (
          <section class="side card stack-sm">
            <div class="row"><h2 class="spacer">After rounds</h2><a class="mono small" href={`#/patients/${encodeURIComponent(sel.code)}`}>{sel.code}</a></div>
            <div class="label">Present</div>
            <div class="row-wrap">{ROLES.map((r) => <Chip on={present.includes(r)} onClick={() => setPresent(present.includes(r) ? present.filter((x) => x !== r) : [...present, r])}>{r}</Chip>)}</div>
            <Field label="Decisions, one per line (who does what by when)" id="rd">
              <textarea id="rd" class="input" style="min-height:110px" placeholder="Social work to update housing file by Friday" value={text} onInput={(e) => setDecisions({ ...decisions, [sel.code]: val(e) })} />
            </Field>
            {hits.length > 0 && <div class="warnbox" role="alert">Looks identifying: {describeHits(hits)}.</div>}
            <div class="draft">{summary}</div>
            <button class="btn primary block" onClick={async () => toast((await copyText(summary)) ? 'Copied. Each discipline pastes it into Cerner.' : 'Copy failed: select the text and copy it.')}>Copy for Cerner</button>
            <div class="tiny muted">Decisions aren't saved here; they go into Cerner.</div>
          </section>
        )}
      </div>
    </div>
  );
}
