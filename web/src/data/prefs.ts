import { useEffect, useState } from 'preact/hooks';
import { Activity, DEFAULT_PROMPT_LEVELS, NoteFormat, PromptLevel, STARTER_ACTIVITIES } from '../core/types';

/** Therapist settings and catalogs (no student data), kept in localStorage. */
export interface Prefs {
  therapistName: string;
  credentials: string;
  noteFormat: NoteFormat;
  defaultSessionMinutes: number;
  promptLevels: PromptLevel[];
  activityCatalog: Activity[];
}

const KEY = 'tapnote.prefs.v1';

const DEFAULTS: Prefs = {
  therapistName: '',
  credentials: 'OTR/L',
  noteFormat: 'soap',
  defaultSessionMinutes: 30,
  promptLevels: DEFAULT_PROMPT_LEVELS,
  activityCatalog: STARTER_ACTIVITIES
};

let current: Prefs = load();
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage full or disabled: keep in memory */
  }
  listeners.forEach((fn) => fn());
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    const fn = () => setP(current);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return p;
}

export function signature(p: Prefs = current): string {
  const name = p.therapistName.trim();
  if (!name) return p.credentials ? `[Therapist], ${p.credentials}` : '[Therapist]';
  return p.credentials ? `${name}, ${p.credentials}` : name;
}

export function enabledPromptLevels(p: Prefs = current): PromptLevel[] {
  return p.promptLevels.filter((l) => l.isEnabled).sort((a, b) => a.rank - b.rank);
}
