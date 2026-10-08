import { useEffect, useState } from 'preact/hooks';
import type { GoalSnapshot, SessionSnapshot } from '../core/types';
import { AuditEvent, DB, SessionRecord, StudentRecord, openTapNoteDB } from './db';

/**
 * In-memory cache over IndexedDB. Every write goes to IndexedDB first, then updates the
 * cache and notifies subscribers. Small data (one therapist's caseload), so we keep it all loaded.
 */
export class Store {
  students = new Map<string, StudentRecord>();
  sessions = new Map<string, SessionRecord>();
  version = 0;
  private listeners = new Set<() => void>();

  constructor(readonly db: DB) {}

  static async open(name?: string): Promise<Store> {
    const db = await openTapNoteDB(name);
    const store = new Store(db);
    await store.reload();
    return store;
  }

  async reload(): Promise<void> {
    const [students, sessions] = await Promise.all([this.db.getAll('students'), this.db.getAll('sessions')]);
    this.students = new Map(students.map((s) => [s.code, s]));
    this.sessions = new Map(sessions.map((s) => [s.id, s]));
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

  // Students

  studentList(): StudentRecord[] {
    return [...this.students.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async putStudent(s: StudentRecord, action = 'edited'): Promise<void> {
    await this.db.put('students', s);
    this.students.set(s.code, s);
    await this.audit('Student', s.code, action);
    this.bump();
  }

  // Sessions

  sessionList(): SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) => (a.start ?? a.date).getTime() - (b.start ?? b.date).getTime() || a.studentCode.localeCompare(b.studentCode));
  }

  group(groupKey: string): SessionRecord[] {
    return this.sessionList().filter((s) => s.groupKey === groupKey).sort((a, b) => a.studentCode.localeCompare(b.studentCode));
  }

  async putSessions(list: SessionRecord[], action?: string, detail = ''): Promise<void> {
    const tx = this.db.transaction(['sessions', 'audit'], 'readwrite');
    for (const s of list) {
      await tx.objectStore('sessions').put(s);
      if (action) await tx.objectStore('audit').add({ timestamp: new Date(), entity: 'Session', entityID: s.id, action, detail: detail || s.studentCode });
    }
    await tx.done;
    list.forEach((s) => this.sessions.set(s.id, s));
    this.bump();
  }

  /** Quiet update for in-session taps (no audit row per tap). */
  async updateSession(id: string, change: (s: SessionRecord) => void): Promise<void> {
    const current = this.sessions.get(id);
    if (!current || current.signedAt) return;
    const next: SessionRecord = structuredClone(current);
    change(next);
    this.sessions.set(id, next);
    this.bump();
    await this.db.put('sessions', next);
  }

  // Audit

  async audit(entity: string, entityID: string, action: string, detail = ''): Promise<void> {
    const e: AuditEvent = { timestamp: new Date(), entity, entityID, action, detail };
    await this.db.add('audit', e);
  }

  async auditLog(): Promise<AuditEvent[]> {
    return (await this.db.getAll('audit')).reverse();
  }

  // Bulk

  async replaceAll(students: StudentRecord[], sessions: SessionRecord[]): Promise<void> {
    const tx = this.db.transaction(['students', 'sessions'], 'readwrite');
    await tx.objectStore('students').clear();
    await tx.objectStore('sessions').clear();
    for (const s of students) await tx.objectStore('students').put(s);
    for (const s of sessions) await tx.objectStore('sessions').put(s);
    await tx.done;
    await this.reload();
  }
}

export function goalSnapshots(student: StudentRecord | undefined): GoalSnapshot[] {
  if (!student) return [];
  return student.goals
    .filter((g) => g.isActive)
    .sort((a, b) => a.number - b.number)
    .map((g) => ({ id: g.id, number: g.number, shortName: g.shortName, detail: g.detail, criterionPercent: g.criterionPercent }));
}

export function snapshot(s: SessionRecord, student: StudentRecord | undefined): SessionSnapshot {
  return {
    id: s.id,
    studentCode: s.studentCode,
    studentAlias: student?.alias ?? '',
    date: s.date,
    start: s.start,
    end: s.end,
    plannedMinutes: s.plannedMinutes,
    groupSize: s.groupSize,
    attendance: s.attendance,
    delivery: s.delivery,
    isMakeUp: s.isMakeUp,
    activities: s.activities,
    goals: goalSnapshots(student),
    observations: s.observations,
    regulation: s.regulation,
    engagement: s.engagement,
    progress: s.progress,
    comment: s.comment,
    signedAt: s.signedAt
  };
}

export const isInProgress = (s: SessionRecord) => s.attendance === 'present' && !s.end;

/** Re-render on any store change. */
export function useStoreVersion(store: Store): number {
  const [v, setV] = useState(store.version);
  useEffect(() => store.subscribe(() => setV(store.version)), [store]);
  return v;
}
