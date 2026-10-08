import { useState } from 'preact/hooks';
import { Vault } from '../data/vault';
import { Icon, Svg, useApp, val } from '../ui/components';

/** First run: create the identity vault (passphrase), then optionally turn on Face ID. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const { vault, toast } = useApp();
  const [step, setStep] = useState<'intro' | 'passphrase' | 'faceid' | 'confirm'>('intro');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createVault = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await vault.create(pass);
      setStep(Vault.passkeysSupported() ? 'faceid' : 'intro');
      if (!Vault.passkeysSupported()) onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addFaceID = async () => {
    setError('');
    try {
      const result = await vault.addPasskey();
      if (result === 'confirm') setStep('confirm');
      else {
        toast('Face ID unlock is on.');
        onDone();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const confirmFaceID = async () => {
    setError('');
    try {
      await vault.confirmPasskey();
      toast('Face ID unlock is on.');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const strongEnough = pass.length >= 8 && pass === pass2;

  return (
    <main class="main welcome stack">
      <div class="row" style="color:var(--acc)"><Svg size={32}>{Icon.lock}</Svg></div>
      <h1>TapNote OT</h1>

      {step === 'intro' && (
        <>
          <p>Quick session capture, end-of-day notes and progress reports for school-based OT.</p>
          <div class="card stack-sm">
            <h2>How student privacy works</h2>
            <ul class="small" style="margin:0;padding-left:20px">
              <li>Students appear by code (like <span class="mono">K7-OTTER</span>) and an alias everywhere.</li>
              <li>Real names, birth dates and PA Secure IDs go in an encrypted vault on this device only.</li>
              <li>Names are added to files only when you export, after you unlock.</li>
              <li>Nothing is sent to a server. Notes are drafted on the device.</li>
            </ul>
          </div>
          <button class="btn primary block big" onClick={() => setStep('passphrase')}>Set up the vault</button>
          <p class="tiny muted">Tip: in Safari, tap Share → Add to Home Screen so TapNote opens like an app and keeps its data.</p>
        </>
      )}

      {step === 'passphrase' && (
        <form class="stack" onSubmit={createVault}>
          <p>Choose a vault passphrase. It unlocks names on this device and is the backup if Face ID isn't available. It can't be recovered if forgotten.</p>
          <div class="field">
            <label for="p1">Passphrase (8+ characters)</label>
            <input id="p1" class="input" type="password" autocomplete="new-password" value={pass} onInput={(e) => setPass(val(e))} />
          </div>
          <div class="field">
            <label for="p2">Repeat passphrase</label>
            <input id="p2" class="input" type="password" autocomplete="new-password" value={pass2} onInput={(e) => setPass2(val(e))} />
          </div>
          {pass2 && pass !== pass2 && <div class="tiny" style="color:var(--amber)">Passphrases don't match yet.</div>}
          {error && <div class="issue blocking" role="alert">{error}</div>}
          <button class="btn primary block big" type="submit" disabled={!strongEnough || busy}>{busy ? 'Creating…' : 'Create vault'}</button>
        </form>
      )}

      {step === 'faceid' && (
        <div class="stack">
          <p>Turn on Face ID to unlock names, sign notes and export without typing the passphrase. Needs iOS 18 or later.</p>
          {error && <div class="issue blocking" role="alert">{error}</div>}
          <button class="btn primary block big" onClick={addFaceID}>Turn on Face ID</button>
          <button class="btn block" onClick={onDone}>Use the passphrase only</button>
        </div>
      )}

      {step === 'confirm' && (
        <div class="stack">
          <p>One more Face ID check finishes setup.</p>
          {error && <div class="issue blocking" role="alert">{error}</div>}
          <button class="btn primary block big" onClick={confirmFaceID}>Confirm with Face ID</button>
          <button class="btn block" onClick={onDone}>Skip for now</button>
        </div>
      )}
    </main>
  );
}
