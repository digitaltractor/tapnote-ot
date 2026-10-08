import { DBSchema, IDBPDatabase, openDB } from 'idb';
import type {
  Activity, Attendance, Delivery, GoalObservation, NoteFormat, ProgressIndicator, RegulationState
} from '../core/types';

// Only pseudonymous data is stored in plain IndexedDB. Real identities live in the
// encrypted vault blob (see vault.ts) and are decrypted in memory only while unlocked.

export interface GoalRecord {
  id: string;
  number: number;
  shortName: string;
  detail: string;
  criterionPercent: number;
  isActive: boolean;
}

export interface StudentRecord {
  code: string;
  alias: string;
  gradeBand: string;
  serviceMode: 'individual' | 'group';
  weeklyMinutes: number;
  reportCadence: string;
  isActive: boolean;
  createdAt: Date;
  goals: GoalRecord[];
}

export interface Addendum {
  date: Date;
  author: string;
  text: string;
}

export interface SessionRecord {
  id: string;
  groupKey: string;
  studentCode: string;
  groupSize: number;
  plannedMinutes: number;
  date: Date;
  start?: Date;
  end?: Date;
  attendance: Attendance;
  delivery: Delivery;
  isMakeUp: boolean;
  activities: Activity[];
  observations: GoalObservation[];
  regulation?: RegulationState;
  engagement?: number;
  progress?: ProgressIndicator;
  comment: string;
  noteText?: string;
  noteFormat?: NoteFormat;
  signedAt?: Date;
  signerName?: string;
  addenda: Addendum[];
}

export interface AuditEvent {
  id?: number;
  timestamp: Date;
  entity: string;
  entityID: string;
  action: string;
  detail: string;
}

interface TapNoteDB extends DBSchema {
  students: { key: string; value: StudentRecord };
  sessions: { key: string; value: SessionRecord; indexes: { byGroup: string; byDate: Date } };
  audit: { key: number; value: AuditEvent };
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<TapNoteDB>;

export async function openTapNoteDB(name = 'tapnote'): Promise<DB> {
  return openDB<TapNoteDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('students', { keyPath: 'code' });
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('byGroup', 'groupKey');
      sessions.createIndex('byDate', 'date');
      db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta');
    }
  });
}
