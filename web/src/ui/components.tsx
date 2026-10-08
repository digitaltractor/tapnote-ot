import { ComponentChildren, createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../data/store';
import type { Vault } from '../data/vault';

// App context

export interface AppCtx {
  store: Store;
  vault: Vault;
  toast: (msg: string) => void;
  /** Face ID (passkey) or passphrase. Every call prompts. Resolves true when the vault is unlocked. */
  authenticate: (reason: string) => Promise<boolean>;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

// Routing (hash-based so GitHub Pages needs no server config)

export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/').map(decodeURIComponent);
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  location.hash = '#/' + path;
}

// Small pieces

export function Badge({ kind = 'neutral', children }: { kind?: 'ok' | 'warn' | 'neutral'; children: ComponentChildren }) {
  return <span class={`badge ${kind === 'neutral' ? '' : kind}`}>{children}</span>;
}

export function Chip(props: { on: boolean; onClick: () => void; children: ComponentChildren; square?: boolean; style?: string; label?: string; class?: string }) {
  return (
    <button
      type="button"
      class={`chip ${props.square ? 'square' : ''} ${props.on ? 'on' : ''} ${props.class ?? ''}`}
      aria-pressed={props.on}
      aria-label={props.label}
      style={props.style}
      onClick={props.onClick}
    >
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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

/** <input type="date"> value <-> local Date */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromDateInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
/** <input type="time"> value <-> Date on a given day */
export function toTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function withTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0);
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const uuid = () => crypto.randomUUID();

/** Download a file, or hand it to the iOS share sheet when available. */
export async function shareFile(data: BlobPart, name: string, type: string): Promise<void> {
  const file = new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const Icon = {
  today: <path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />,
  review: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" /></>,
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  students: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>
};

export function Svg({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
