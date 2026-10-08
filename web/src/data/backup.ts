import type { Activity, GoalObservation } from '../core/types';
import { ATTENDANCE, DELIVERY, NOTE_FORMATS, PROGRESS_INDICATORS, REGULATION_STATES } from '../core/types';
import type { SessionRecord, StudentRecord } from './db';
import type { ScheduleSlot } from '../core/schedule';
import type { LogEntry } from '../core/contacts';
import { LOG_KINDS } from '../core/contacts';
import { isDayKey } from '../core/deadlines';
import { dec, enc, pbkdf2Key, randomBytes } from './crypto';

/**
 * Passphrase-encrypted backup, byte-compatible with the iOS app (BackupService.swift):
 * "TNB1" | salt (16) | iterations (UInt32 BE) | nonce (12) | AES-GCM ciphertext + tag.
 * The JSON payload uses the same field names and ISO-8601 dates (no fractional seconds).
 * Names are never included; the vault stays on the device.
 */

const MAGIC = enc.encode('TNB1');
const ITERATIONS = 310_000;

interface StudentDTO {
  code: string; alias: string; gradeBand: string; serviceMode: string; reportCadence: string;
  weeklyMinutes: number; isActive: boolean;
  goals: { id: string; number: number; shortName: string; detail: string; criterionPercent: number; isActive: boolean }[];
  // beta 2 (web); ignored by the iOS app
  iepDate?: string; lastEvalDate?: string; reevalYears?: number; evalConsentDate?: string; reportsExported?: string[];
}

interface ContactDTO {
  id: string; kind: string; date: string; minutes?: number; studentCodes: string[]; who: string; method: string;
  topic: string; outcome: string; followUp?: string; followUpDone?: boolean; onsite?: boolean; observed?: boolean; createdAt: string;
}

interface SessionDTO {
  id: string; groupKey: string; studentCode: string; groupSize: number; plannedMinutes: number;
  date: string; start?: string; end?: string;
  attendanceRaw: string; deliveryRaw: string; isMakeUp: boolean;
  activities: Activity[]; observations: GoalObservation[];
  regulationRaw?: string; progressRaw?: string; engagement?: number; comment: string;
  noteText?: string; noteFormatRaw?: string; signerName?: string; signedAt?: string;
  addenda: { date: string; author: string; text: string }[];
  // v2 (web beta); ignored by older readers and the iOS app
  slotId?: string; makeUpFor?: string[]; signerRole?: string; coSignedAt?: string; coSignerName?: string;
}

interface Payload {
  version: number;
  createdAt: string;
  students: StudentDTO[];
  sessions: SessionDTO[];
  schedule?: ScheduleSlot[];
  closures?: string[];
  contacts?: ContactDTO[];
}

/** ISO-8601 without milliseconds, which Swift's .iso8601 strategy requires. */
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const isoOpt = (d?: Date) => (d ? iso(d) : undefined);
const date = (s: string) => new Date(s);
const dateOpt = (s?: string | null) => (s ? new Date(s) : undefined);

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}
function oneOfOpt<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return list.includes(v as T) ? (v as T) : undefined;
}

export async function makeBackup(
  students: StudentRecord[],
  sessions: SessionRecord[],
  passphrase: string,
  extra: { schedule?: ScheduleSlot[]; closures?: string[]; contacts?: LogEntry[] } = {}
): Promise<Uint8Array<ArrayBuffer>> {
  const payload: Payload = {
    version: 2,
    schedule: extra.schedule,
    closures: extra.closures,
    contacts: extra.contacts?.map((c) => ({ ...c, date: iso(c.date), createdAt: iso(c.createdAt) })),
    createdAt: iso(new Date()),
    students: students.map((s) => ({
      code: s.code, alias: s.alias, gradeBand: s.gradeBand, serviceMode: s.serviceMode, reportCadence: s.reportCadence,
      weeklyMinutes: s.weeklyMinutes, isActive: s.isActive,
      goals: s.goals.map((g) => ({ id: g.id, number: g.number, shortName: g.shortName, detail: g.detail, criterionPercent: g.criterionPercent, isActive: g.isActive })),
      iepDate: s.iepDate, lastEvalDate: s.lastEvalDate, reevalYears: s.reevalYears, evalConsentDate: s.evalConsentDate, reportsExported: s.reportsExported
    })),
    sessions: sessions.map((r) => ({
      id: r.id, groupKey: r.groupKey, studentCode: r.studentCode, groupSize: r.groupSize, plannedMinutes: r.plannedMinutes,
      date: iso(r.date), start: isoOpt(r.start), end: isoOpt(r.end),
      attendanceRaw: r.attendance, deliveryRaw: r.delivery, isMakeUp: r.isMakeUp,
      activities: r.activities, observations: r.observations,
      regulationRaw: r.regulation, progressRaw: r.progress, engagement: r.engagement, comment: r.comment,
      noteText: r.noteText, noteFormatRaw: r.noteFormat, signerName: r.signerName, signedAt: isoOpt(r.signedAt),
      addenda: r.addenda.map((a) => ({ date: iso(a.date), author: a.author, text: a.text })),
      slotId: r.slotId, makeUpFor: r.makeUpFor, signerRole: r.signerRole, coSignedAt: isoOpt(r.coSignedAt), coSignerName: r.coSignerName
    }))
  };
  const plain = enc.encode(JSON.stringify(payload));
  const salt = randomBytes(16);
  const key = await pbkdf2Key(passphrase, salt, ITERATIONS, ['encrypt']);
  const nonce = randomBytes(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const out = new Uint8Array(new ArrayBuffer(4 + 16 + 4 + 12 + sealed.length));
  out.set(MAGIC, 0);
  out.set(salt, 4);
  new DataView(out.buffer).setUint32(20, ITERATIONS, false);
  out.set(nonce, 24);
  out.set(sealed, 36);
  return out;
}

export async function readBackup(
  file: Uint8Array<ArrayBuffer>,
  passphrase: string
): Promise<{ students: StudentRecord[]; sessions: SessionRecord[]; createdAt: Date; schedule?: ScheduleSlot[]; closures?: string[]; contacts?: LogEntry[] }> {
  if (file.length <= 36 + 16 || MAGIC.some((b, i) => file[i] !== b)) throw new Error('This isn’t a TapNote backup file.');
  const salt = file.slice(4, 20);
  const iterations = new DataView(file.buffer, file.byteOffset).getUint32(20, false);
  const nonce = file.slice(24, 36);
  const key = await pbkdf2Key(passphrase, salt, iterations, ['decrypt']);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, file.slice(36));
  } catch {
    throw new Error('The passphrase didn’t match this backup.');
  }
  const p = JSON.parse(dec.decode(plain)) as Payload;
  const students: StudentRecord[] = p.students.map((s) => ({
    code: s.code, alias: s.alias, gradeBand: s.gradeBand ?? '', serviceMode: s.serviceMode === 'group' ? 'group' : 'individual',
    weeklyMinutes: s.weeklyMinutes ?? 30, reportCadence: s.reportCadence ?? 'Quarterly', isActive: s.isActive !== false, createdAt: new Date(),
    goals: (s.goals ?? []).map((g) => ({ ...g })),
    iepDate: isDayKey(s.iepDate) ? s.iepDate : undefined,
    lastEvalDate: isDayKey(s.lastEvalDate) ? s.lastEvalDate : undefined,
    reevalYears: s.reevalYears === 2 ? 2 : s.reevalYears === 3 ? 3 : undefined,
    evalConsentDate: isDayKey(s.evalConsentDate) ? s.evalConsentDate : undefined,
    reportsExported: Array.isArray(s.reportsExported) ? s.reportsExported.filter(isDayKey) : undefined
  }));
  const contacts: LogEntry[] | undefined = Array.isArray(p.contacts)
    ? p.contacts.filter((c) => LOG_KINDS.includes(c.kind as LogEntry['kind'])).map((c) => ({
      id: c.id, kind: c.kind as LogEntry['kind'], date: date(c.date), minutes: c.minutes ?? undefined, studentCodes: c.studentCodes ?? [],
      who: c.who ?? '', method: c.method as LogEntry['method'], topic: c.topic ?? '', outcome: c.outcome ?? '',
      followUp: isDayKey(c.followUp) ? c.followUp : undefined, followUpDone: !!c.followUpDone,
      onsite: c.onsite ?? undefined, observed: c.observed ?? undefined, createdAt: dateOpt(c.createdAt) ?? date(c.date)
    }))
    : undefined;
  const sessions: SessionRecord[] = p.sessions.map((r) => ({
    id: r.id, groupKey: r.groupKey, studentCode: r.studentCode, groupSize: r.groupSize, plannedMinutes: r.plannedMinutes,
    date: date(r.date), start: dateOpt(r.start), end: dateOpt(r.end),
    attendance: oneOf(ATTENDANCE, r.attendanceRaw, 'present'),
    delivery: oneOf(DELIVERY, r.deliveryRaw, 'inPerson'),
    isMakeUp: !!r.isMakeUp,
    activities: r.activities ?? [],
    observations: r.observations ?? [],
    regulation: oneOfOpt(REGULATION_STATES, r.regulationRaw),
    progress: oneOfOpt(PROGRESS_INDICATORS, r.progressRaw),
    engagement: r.engagement ?? undefined,
    comment: r.comment ?? '',
    noteText: r.noteText ?? undefined,
    noteFormat: oneOfOpt(NOTE_FORMATS, r.noteFormatRaw),
    signerName: r.signerName ?? undefined,
    signedAt: dateOpt(r.signedAt),
    addenda: (r.addenda ?? []).map((a) => ({ date: date(a.date), author: a.author, text: a.text })),
    slotId: r.slotId ?? undefined,
    makeUpFor: Array.isArray(r.makeUpFor) ? r.makeUpFor : undefined,
    signerRole: r.signerRole === 'COTA' ? 'COTA' : r.signerRole === 'OT' ? 'OT' : undefined,
    coSignedAt: dateOpt(r.coSignedAt),
    coSignerName: r.coSignerName ?? undefined
  }));
  return {
    students,
    sessions,
    createdAt: date(p.createdAt),
    schedule: Array.isArray(p.schedule) ? p.schedule : undefined,
    closures: Array.isArray(p.closures) ? p.closures : undefined,
    contacts
  };
}
