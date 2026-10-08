import { todayKey } from '../core/dates';
import { sampleWard } from '../core/sample';
import { ROLES, Role } from '../core/ward';
import { setPrefs, usePrefs } from '../data/prefs';
import { Field, useApp, uuid, val } from '../ui/components';

export function Settings() {
  const { store, toast } = useApp();
  const prefs = usePrefs();

  const reset = async () => {
    if (!confirm('Reset the demo? Everything you added is replaced with the sample ward.')) return;
    await store.replaceAll(sampleWard(todayKey(), uuid));
    toast('Sample ward restored.');
  };
  const clear = async () => {
    if (!confirm('Remove every patient, form, referral and draft from this device?')) return;
    await store.replaceAll({ patients: [], forms: [], referrals: [], drafts: [] });
    toast('Cleared.');
  };

  return (
    <div class="stack">
      <h1>Settings</h1>
      <section class="card stack">
        <div class="grid2">
          <Field label="Unit" id="s-unit"><input id="s-unit" class="input" value={prefs.unit} onInput={(e) => setPrefs({ unit: val(e) })} /></Field>
          <Field label="Your discipline" id="s-role">
            <select id="s-role" class="input" value={prefs.role} onChange={(e) => setPrefs({ role: val(e) as Role })}>
              {ROLES.map((r) => <option value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Delete uncharted drafts after (days)" id="s-days" hint="Drafts that never reach Cerner must be destroyed (OCSWSSW standard 4.1.2).">
          <input id="s-days" class="input" type="number" inputMode="numeric" min={1} max={7} style="width:110px" value={prefs.draftDays} onInput={(e) => setPrefs({ draftDays: Math.min(7, Math.max(1, Number(val(e)) || 3)) })} />
        </Field>
      </section>

      <section class="card stack-sm">
        <h2>About this demo</h2>
        <p class="small" style="margin:0">WardNote is a sample for an Ontario inpatient mental health team. Patients are codes only; nothing identifies a person. It works out Mental Health Act and referral dates, drafts notes to paste into Cerner, and deletes the drafts once they're charted.</p>
        <p class="small" style="margin:0">Everything stays in this browser on this device. There is no server, no sign-in and no sharing between devices. Any real use would need the hospital privacy office's approval first.</p>
        <p class="small muted" style="margin:0">Dates follow the Mental Health Act and Consent and Capacity Board timelines as summarized in Ministry and Board guides. Check them against hospital policy before relying on them.</p>
      </section>

      <section class="card stack-sm">
        <h2>Demo data</h2>
        <button class="btn block" onClick={reset}>Reset to the sample ward</button>
        <button class="btn danger block" onClick={clear}>Clear everything</button>
      </section>
    </div>
  );
}
