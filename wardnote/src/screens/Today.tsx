import { fromKey, relative, todayKey, withDay } from '../core/dates';
import { dueItems, purge } from '../core/ward';
import { usePrefs } from '../data/prefs';
import { Badge, go, useApp } from '../ui/components';

export function Today() {
  const { store, toast } = useApp();
  const prefs = usePrefs();
  const today = todayKey();
  const due = dueItems(store.patientList(), store.formList(), store.referralList(), today);
  const drafts = store.draftList().filter((d) => !d.purged);
  const urgent = due.filter((d) => d.urgent).length;

  return (
    <div class="stack">
      <div>
        <div class="eyebrow">{fromKey(today).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })} · {prefs.unit}</div>
        <h1>Today</h1>
        <div class="muted">{drafts.length} draft{drafts.length === 1 ? '' : 's'} to chart · {urgent} urgent · {due.length} due in 2 weeks</div>
      </div>

      <div class="grid2">
        <button class="btn primary big" onClick={() => go('note')}>Log a contact</button>
        <a class="btn big" href="#/rounds">Rounds board</a>
      </div>

      {drafts.length > 0 && (
        <section class="card stack-sm">
          <h2>Drafts not yet in Cerner</h2>
          {drafts.map((d) => (
            <div class="row">
              <a class="spacer" href={`#/note/${encodeURIComponent(d.code)}/${d.id}`} style="text-decoration:none;color:inherit;min-width:0">
                <div class="mono small">{d.code}</div>
                <div class="small muted">{d.kind === 'family' ? 'Family meeting' : d.with}{d.minutes ? ` · ${d.minutes} min` : ''} · written {relative(today, todayKeyOf(d.createdAt))}</div>
              </a>
              <button class="btn" style="min-height:44px" onClick={async () => { await store.putDraft(purge(d, 'charted')); toast('Marked charted. Draft text deleted.'); }}>Charted</button>
            </div>
          ))}
          <div class="tiny muted">Charting deletes a draft's text here. Uncharted drafts are deleted after {prefs.draftDays} days.</div>
        </section>
      )}

      <section class="card stack-sm" style={urgent ? 'border-color:var(--amber)' : ''}>
        <h2>Due on the ward</h2>
        {due.length === 0 && <div class="small muted">Nothing due in the next two weeks.</div>}
        {due.map((d) => (
          <a class="row small" href={`#/patients/${encodeURIComponent(d.code)}`} style="text-decoration:none;color:inherit;min-height:44px">
            <span class="mono" style="flex:none;width:92px">{d.code}</span>
            <span class="spacer" style="min-width:0">{d.text}</span>
            <Badge kind={d.urgent ? 'warn' : 'neutral'}>{d.kind === 'stale' ? `${-Math.min(0, relDays(today, d.due))}d` : d.due === today ? 'today' : d.due < today ? 'overdue' : withDay(d.due)}</Badge>
          </a>
        ))}
      </section>
    </div>
  );
}

function todayKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function relDays(today: string, k: string): number {
  return Math.round((fromKey(k).getTime() - fromKey(today).getTime()) / 86_400_000);
}
