import { ComponentChildren, createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../data/store';

export interface AppCtx {
  store: Store;
  toast: (msg: string) => void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/').map(decodeURIComponent);
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  location.hash = '#/' + path;
}

export function Badge({ kind = 'neutral', children }: { kind?: 'ok' | 'warn' | 'neutral'; children: ComponentChildren }) {
  return <span class={`badge ${kind === 'neutral' ? '' : kind}`}>{children}</span>;
}

export function Chip(props: { on: boolean; onClick: () => void; children: ComponentChildren; label?: string }) {
  return (
    <button type="button" class={`chip square ${props.on ? 'on' : ''}`} aria-pressed={props.on} aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function BackButton({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <a class="iconbtn" href={`#/${to}`} aria-label={label}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
    </a>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    ref.current?.addEventListener('keydown', onKey);
    return () => prev?.focus();
  }, []);
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="link" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, id, children, hint }: { label: string; id: string; children: ComponentChildren; hint?: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint && <div class="tiny muted">{hint}</div>}
    </div>
  );
}

export const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
export const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
export const uuid = () => crypto.randomUUID();

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const Icon = {
  today: <path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />,
  patients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>,
  note: <><path d="M5 3h10l4 4v14H5z" /><path d="M9 12h6M9 16h6M9 8h3" /></>,
  rounds: <path d="M4 6h16M4 12h16M4 18h10" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>
};

export function Svg({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
