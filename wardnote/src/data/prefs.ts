import { useEffect, useState } from 'preact/hooks';
import type { Role } from '../core/ward';

/** Device settings (no patient data). */
export interface Prefs {
  unit: string;
  role: Role;
  /** Days an uncharted draft is kept before its text is deleted. */
  draftDays: number;
}

const KEY = 'wardnote.demo.prefs.v1';
const DEFAULTS: Prefs = { unit: '4 East', role: 'Social work', draftDays: 3 };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set<() => void>();

export const getPrefs = () => current;

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* memory only */ }
  listeners.forEach((fn) => fn());
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    const fn = () => setP(current);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return p;
}
