/**
 * Weekly caseload schedule: recurring weekday slots for one student (individual) or several (group).
 * Weekdays use ISO numbering: 1 = Monday … 7 = Sunday.
 */
export interface ScheduleSlot {
  id: string;
  weekday: number;
  /** "HH:MM", 24-hour, local time */
  start: string;
  minutes: number;
  studentCodes: string[];
  location?: string;
  active: boolean;
  /** First day this slot applies ("YYYY-MM-DD"). Days before it are never flagged as unlogged. */
  since?: string;
}

export const WEEKDAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

/** "2026-10-07" in local time */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function slotStart(slot: Pick<ScheduleSlot, 'start'>, day: Date): Date {
  const [h, m] = slot.start.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0);
}

/** Active slots for a calendar day, in time order. Empty on a no-school day. */
export function slotsForDay(slots: ScheduleSlot[], day: Date, closures: string[] = []): ScheduleSlot[] {
  if (closures.includes(dayKey(day))) return [];
  const wd = isoWeekday(day);
  return slots.filter((s) => s.active && s.weekday === wd).sort((a, b) => a.start.localeCompare(b.start));
}

/** Scheduled minutes per week for one student across active slots. */
export function scheduledWeeklyMinutes(slots: ScheduleSlot[], code: string): number {
  return slots.filter((s) => s.active && s.studentCodes.includes(code)).reduce((sum, s) => sum + s.minutes, 0);
}

export interface LoggedRef {
  slotId?: string;
  studentCode: string;
  date: Date;
}

export interface UnloggedSlot {
  day: string;
  slot: ScheduleSlot;
  studentCodes: string[];
}

/**
 * Scheduled slots on past school days in [from, to) where at least one student has nothing logged
 * (no session and no absence). These are the gaps that turn into unexplained missed minutes.
 */
export function unloggedSlots(slots: ScheduleSlot[], logged: LoggedRef[], from: Date, to: Date, closures: string[] = []): UnloggedSlot[] {
  const out: UnloggedSlot[] = [];
  const seen = new Set(logged.filter((l) => l.slotId).map((l) => `${l.slotId}|${l.studentCode}|${dayKey(l.date)}`));
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d.setDate(d.getDate() + 1)) {
    for (const slot of slotsForDay(slots, d, closures)) {
      if (slot.since && dayKey(d) < slot.since) continue;
      const missing = slot.studentCodes.filter((c) => !seen.has(`${slot.id}|${c}|${dayKey(d)}`));
      if (missing.length) out.push({ day: dayKey(d), slot, studentCodes: missing });
    }
  }
  return out;
}
