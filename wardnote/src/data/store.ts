import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { useEffect, useState } from 'preact/hooks';
import type { FormRecord } from '../core/mha';
import type { Draft, Patient, Referral } from '../core/ward';
import { expiredDrafts, purge } from '../core/ward';
import { WardData } from '../core/sample';

// Everything here is pseudonymous: codes, dates and short task text. No names, ever.

interface WardDB extends DBSchema {
  patients: { key: string; value: Patient };
  forms: { key: string; value: FormRecord };
  referrals: { key: string; value: Referral };
  drafts: { key: string; value: Draft };
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<WardDB>;
type StoreName = 'patients' | 'forms' | 'referrals' | 'drafts';

export async function openWardDB(name = 'wardnote-demo'): Promise<DB> {
  return openDB<WardDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('patients', { keyPath: 'code' });
      db.createObjectStore('forms', { keyPath: 'id' });
      db.createObjectStore('referrals', { keyPath: 'id' });
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta');
    }
  });
}

export class Store {
  patients = new Map<string, Patient>();
  forms = new Map<string, FormRecord>();
  referrals = new Map<string, Referral>();
  drafts = new Map<string, Draft>();
  version = 0;
  private listeners = new Set<() => void>();

  constructor(readonly db: DB) {}

  static async open(name?: string): Promise<Store> {
    const s = new Store(await openWardDB(name));
    await s.reload();
    return s;
  }

  async reload(): Promise<void> {
    const [p, f, r, d] = await Promise.all([this.db.getAll('patients'), this.db.getAll('forms'), this.db.getAll('referrals'), this.db.getAll('drafts')]);
    this.patients = new Map(p.map((x) => [x.code, x]));
    this.forms = new Map(f.map((x) => [x.id, x]));
    this.referrals = new Map(r.map((x) => [x.id, x]));
    this.drafts = new Map(d.map((x) => [x.id, x]));
    this.bump();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  async isSeeded(): Promise<boolean> {
    return (await this.db.get('meta', 'seeded')) === true;
  }

  patientList(): Patient[] {
    return [...this.patients.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
  }
  formList(code?: string): FormRecord[] {
    return [...this.forms.values()].filter((f) => !code || f.code === code).sort((a, b) => b.signedOn.localeCompare(a.signedOn) || b.createdAt.getTime() - a.createdAt.getTime());
  }
  referralList(code?: string): Referral[] {
    return [...this.referrals.values()].filter((r) => !code || r.code === code).sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'));
  }
  draftList(code?: string): Draft[] {
    return [...this.drafts.values()].filter((d) => !code || d.code === code).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async put<S extends StoreName>(store: S, value: WardDB[S]['value'], map: Map<string, WardDB[S]['value']>, key: string) {
    await this.db.put(store, value as never);
    map.set(key, value);
    this.bump();
  }

  putPatient(p: Patient) { return this.put('patients', p, this.patients, p.code); }
  putForm(f: FormRecord) { return this.put('forms', f, this.forms, f.id); }
  putReferral(r: Referral) { return this.put('referrals', r, this.referrals, r.id); }
  putDraft(d: Draft) { return this.put('drafts', d, this.drafts, d.id); }

  async deleteForm(id: string) { await this.db.delete('forms', id); this.forms.delete(id); this.bump(); }
  async deleteReferral(id: string) { await this.db.delete('referrals', id); this.referrals.delete(id); this.bump(); }
  async deleteDraft(id: string) { await this.db.delete('drafts', id); this.drafts.delete(id); this.bump(); }

  /** Deletes the text of drafts left uncharted longer than `days`. Returns how many. */
  async expireDrafts(days: number, now = new Date()): Promise<number> {
    const old = expiredDrafts([...this.drafts.values()], now, days);
    for (const d of old) await this.db.put('drafts', purge(d, 'expired', now));
    if (old.length) await this.reload();
    return old.length;
  }

  async replaceAll(data: WardData): Promise<void> {
    const tx = this.db.transaction(['patients', 'forms', 'referrals', 'drafts', 'meta'], 'readwrite');
    for (const s of ['patients', 'forms', 'referrals', 'drafts'] as const) await tx.objectStore(s).clear();
    for (const p of data.patients) await tx.objectStore('patients').put(p);
    for (const f of data.forms) await tx.objectStore('forms').put(f);
    for (const r of data.referrals) await tx.objectStore('referrals').put(r);
    for (const d of data.drafts) await tx.objectStore('drafts').put(d);
    await tx.objectStore('meta').put(true, 'seeded');
    await tx.done;
    await this.reload();
  }
}

export function useStoreVersion(store: Store): number {
  const [v, setV] = useState(store.version);
  useEffect(() => store.subscribe(() => setV(store.version)), [store]);
  return v;
}
