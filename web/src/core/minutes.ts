import { Attendance, minutes as exactMinutes } from './types';
import { dayKey } from './schedule';

/**
 * Service-minutes accounting per student: IEP-mandated vs delivered minutes by week, minutes owed
 * from missed sessions, and make-ups credited against the misses they cover.
 *
 * Owed rules (defaults; districts differ, so the second is a setting):
 * - Therapist absent / therapist not available: owed.
 * - Student not available (assembly, testing, field trip): owed only if `countStudentUnavailable`.
 * - Student absent: not owed.
 */

export interface MinutesSession {
  id: string;
  studentCode: string;
  date: Date;
  start?: Date;
  end?: Date;
  plannedMinutes: number;
  attendance: Attendance;
  isMakeUp: boolean;
  makeUpFor?: string[];
}

export interface MinutesOptions {
  countStudentUnavailable: boolean;
}

export interface OwedMiss {
  sessionId: string;
  date: Date;
  minutes: number;
  reason: Attendance;
  madeUp: number;
}

export interface WeekRow {
  weekStart: string;
  mandated: number;
  delivered: number;
}

export interface StudentMinutes {
  studentCode: string;
  mandated: number;
  delivered: number;
  owed: OwedMiss[];
  owedTotal: number;
  madeUpTotal: number;
  outstanding: number;
  weeks: WeekRow[];
}

export function isOwed(a: Attendance, opts: MinutesOptions): boolean {
  if (a === 'providerAbsent' || a === 'providerNotAvailable') return true;
  if (a === 'studentNotAvailable') return opts.countStudentUnavailable;
  return false;
}

/** Monday 00:00 local of the week containing d. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function minutesSummary(
  code: string,
  weeklyMandate: number,
  sessions: MinutesSession[],
  range: { start: Date; end: Date },
  opts: MinutesOptions = { countStudentUnavailable: false }
): StudentMinutes {
  const mine = sessions.filter((s) => s.studentCode === code);
  const inRange = mine.filter((s) => s.date >= range.start && s.date <= range.end);

  // Weeks overlapping the range.
  const weeks = new Map<string, WeekRow>();
  for (let w = weekStart(range.start); w <= range.end; w.setDate(w.getDate() + 7)) {
    weeks.set(dayKey(w), { weekStart: dayKey(w), mandated: weeklyMandate, delivered: 0 });
  }

  let delivered = 0;
  for (const s of inRange) {
    if (s.attendance !== 'present') continue;
    const m = exactMinutes(s) ?? 0;
    delivered += m;
    const row = weeks.get(dayKey(weekStart(s.date)));
    if (row) row.delivered += m;
  }

  // Misses in range, then make-ups (from any time after the miss) credited against linked misses first.
  const owed: OwedMiss[] = inRange
    .filter((s) => isOwed(s.attendance, opts))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((s) => ({ sessionId: s.id, date: s.date, minutes: s.plannedMinutes, reason: s.attendance, madeUp: 0 }));
  const byId = new Map(owed.map((o) => [o.sessionId, o]));
  const makeUps = mine.filter((s) => s.isMakeUp && s.attendance === 'present').sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const mu of makeUps) {
    let credit = exactMinutes(mu) ?? 0;
    const targets = (mu.makeUpFor ?? []).map((id) => byId.get(id)).filter((o): o is OwedMiss => !!o);
    // Unlinked make-ups pay off the oldest outstanding misses that happened before them.
    const fallback = owed.filter((o) => o.date <= mu.date && !targets.includes(o));
    for (const o of [...targets, ...fallback]) {
      if (credit <= 0) break;
      const need = o.minutes - o.madeUp;
      const pay = Math.min(need, credit);
      o.madeUp += pay;
      credit -= pay;
    }
  }

  const owedTotal = owed.reduce((s, o) => s + o.minutes, 0);
  const madeUpTotal = owed.reduce((s, o) => s + o.madeUp, 0);
  return {
    studentCode: code,
    mandated: weeklyMandate * weeks.size,
    delivered,
    owed,
    owedTotal,
    madeUpTotal,
    outstanding: owedTotal - madeUpTotal,
    weeks: [...weeks.values()]
  };
}
