import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { DB_NAME } from '../env';
import type {
  Activity, Attendance, Delivery, GoalObservation, NoteFormat, ProgressIndicator, RegulationState
} from '../core/types';
import type { ScheduleSlot } from '../core/schedule';
import type { LogEntry } from '../core/contacts';

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
  // Beta 2: deadline dates as local day keys ("2026-10-07")
  iepDate?: string;
  lastEvalDate?: string;
  reevalYears?: 2 | 3;
  evalConsentDate?: string;
  reportsExported?: string[];
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
  // Beta (v2) fields
  /** Schedule slot this session came from, when started or logged from Today's plan. */
  slotId?: string;
  /** Missed sessions this make-up covers. */
  makeUpFor?: string[];
  /** 'COTA' notes need a supervising OT's co-signature. */
  signerRole?: 'OT' | 'COTA';
  coSignedAt?: Date;
  coSignerName?: string;
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
  schedule: { key: string; value: ScheduleSlot };
  contacts: { key: string; value: LogEntry };
}

export type DB = IDBPDatabase<TapNoteDB>;

export async function openTapNoteDB(name = DB_NAME): Promise<DB> {
  return openDB<TapNoteDB>(name, 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('students', { keyPath: 'code' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byGroup', 'groupKey');
        sessions.createIndex('byDate', 'date');
        db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        db.createObjectStore('schedule', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        db.createObjectStore('contacts', { keyPath: 'id' });
      }
    }
  });
}
