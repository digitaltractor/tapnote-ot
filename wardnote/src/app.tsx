import { useRef, useState } from 'preact/hooks';
import type { Store } from './data/store';
import { useStoreVersion } from './data/store';
import { Ctx, Icon, Svg, useRoute } from './ui/components';
import { Today } from './screens/Today';
import { Patients, PatientDetail } from './screens/Patients';
import { NoteComposer } from './screens/Note';
import { Rounds } from './screens/Rounds';
import { Settings } from './screens/Settings';

export function App({ store }: { store: Store }) {
  useStoreVersion(store);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const route = useRoute();

  const toast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3200);
  };

  const [head, arg, arg2] = route;
  let screen;
  switch (head) {
    case 'patients': screen = arg ? <PatientDetail code={arg} /> : <Patients />; break;
    case 'note': screen = <NoteComposer code={arg} draftId={arg2} />; break;
    case 'rounds': screen = <Rounds code={arg} />; break;
    case 'settings': screen = <Settings />; break;
    default: screen = <Today />;
  }
  const tab = head === 'patients' || head === 'note' || head === 'rounds' || head === 'settings' ? head : 'today';

  return (
    <Ctx.Provider value={{ store, toast }}>
      <div class={`app ${head === 'rounds' ? 'wide' : ''}`}>
        <div class="demo-banner" role="note">Demo · sample patients only · never enter real patient details</div>
        <main class="main" id="main">{screen}</main>
        <nav class="tabbar" aria-label="Main">
          {([
            ['today', 'Today', Icon.today],
            ['patients', 'Patients', Icon.patients],
            ['note', 'Note', Icon.note],
            ['rounds', 'Rounds', Icon.rounds],
            ['settings', 'Settings', Icon.settings]
          ] as const).map(([id, label, icon]) => (
            <a href={`#/${id}`} aria-current={tab === id ? 'page' : undefined}>
              <Svg>{icon}</Svg>
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </div>
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}
