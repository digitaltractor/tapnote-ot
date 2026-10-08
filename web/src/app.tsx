import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from './data/store';
import { useStoreVersion } from './data/store';
import type { Vault } from './data/vault';
import { Ctx, Icon, Sheet, Svg, useApp, useRoute, val } from './ui/components';
import { Welcome } from './screens/Welcome';
import { Today } from './screens/Today';
import { Capture } from './screens/Capture';
import { Review, NoteDetail } from './screens/Review';
import { Reports } from './screens/Reports';
import { Students, StudentEditor } from './screens/Students';
import { Settings } from './screens/Settings';
import { Schedule } from './screens/Schedule';
import { IS_BETA } from './env';

interface AuthRequest {
  reason: string;
  resolve: (ok: boolean) => void;
}

export function App({ store, vault }: { store: Store; vault: Vault }) {
  useStoreVersion(store);
  const [, setVaultTick] = useState(0);
  useEffect(() => vault.subscribe(() => setVaultTick((n) => n + 1)), [vault]);
  const [configured, setConfigured] = useState(vault.isConfigured);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthRequest | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const route = useRoute();

  const toast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200);
  };

  /** Must be called first thing in a tap handler so Safari allows the Face ID prompt. */
  const authenticate = async (reason: string): Promise<boolean> => {
    if (vault.hasPasskey) {
      try {
        await vault.unlockWithPasskey();
        return true;
      } catch (e) {
        if ((e as DOMException).name !== 'NotAllowedError') toast((e as Error).message);
      }
    }
    return new Promise<boolean>((resolve) => setAuth({ reason, resolve }));
  };

  const ctx = { store, vault, toast, authenticate };

  if (!configured) {
    return (
      <Ctx.Provider value={ctx}>
        <Welcome onDone={() => setConfigured(true)} />
        {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
      </Ctx.Provider>
    );
  }

  const [head, arg] = route;
  let screen;
  switch (head) {
    case 'session': screen = <Capture groupKey={arg} />; break;
    case 'review': screen = arg ? <NoteDetail sessionId={arg} /> : <Review />; break;
    case 'reports': screen = <Reports tab={arg === 'minutes' ? 'minutes' : 'progress'} />; break;
    case 'schedule': screen = <Schedule />; break;
    case 'students': screen = arg ? <StudentEditor code={arg === 'new' ? undefined : arg} /> : <Students />; break;
    case 'settings': screen = <Settings />; break;
    default: screen = <Today />;
  }
  const tab = head === 'session' || head === 'schedule' ? 'today' : head;

  return (
    <Ctx.Provider value={ctx}>
      <div class="app">
        {IS_BETA && <div class="beta-banner" role="note">Beta · separate data from the main app</div>}
        <main class="main" id="main">{screen}</main>
        <nav class="tabbar" aria-label="Main">
          {([
            ['today', 'Today', Icon.today],
            ['review', 'Review', Icon.review],
            ['reports', 'Reports', Icon.reports],
            ['students', 'Students', Icon.students],
            ['settings', 'Settings', Icon.settings]
          ] as const).map(([id, label, icon]) => (
            <a href={`#/${id}`} aria-current={tab === id ? 'page' : undefined}>
              <Svg>{icon}</Svg>
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </div>
      {auth && (
        <PassphraseDialog
          reason={auth.reason}
          onDone={(ok) => {
            auth.resolve(ok);
            setAuth(null);
          }}
        />
      )}
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

function PassphraseDialog({ reason, onDone }: { reason: string; onDone: (ok: boolean) => void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { vault } = useApp();

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await vault.unlockWithPassphrase(pass);
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Unlock" onClose={() => onDone(false)}>
      <form class="stack" onSubmit={submit}>
        <p class="muted" style="margin:0">{reason}. Enter your vault passphrase.</p>
        <input class="input" type="password" autocomplete="current-password" aria-label="Vault passphrase" value={pass} onInput={(e) => setPass(val(e))} />
        {error && <div class="issue blocking" role="alert">{error}</div>}
        <button class="btn primary block" type="submit" disabled={!pass || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
    </Sheet>
  );
}
