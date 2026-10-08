// Beta 2: consult, parent-contact and COTA supervision logs.
// Supervision checks follow 49 Pa. Code § 42.22(d)–(e): supervisory contact of at least 10% of the
// assistant's direct-care time, onsite face-to-face contact with observation at least monthly, a mix of
// face-to-face, phone and written contact each month, a supervisory plan, and an annual written appraisal (42.22(b)).

import { daysBetween, isDayKey } from './deadlines';

export type LogKind = 'consult' | 'parent' | 'supervision';
export const LOG_KINDS: LogKind[] = ['consult', 'parent', 'supervision'];
export const LOG_KIND_LABEL: Record<LogKind, string> = { consult: 'Consults', parent: 'Parent contacts', supervision: 'Supervision' };

export const CONTACT_METHODS = ['inPerson', 'phone', 'video', 'email', 'note', 'meeting'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  inPerson: 'In person', phone: 'Phone', video: 'Video', email: 'Email', note: 'Note home', meeting: 'Team meeting'
};

/** The four kinds of supervisory contact named in § 42.22(d). */
export const SUPERVISION_METHODS = ['faceToFace', 'phone', 'written', 'group'] as const;
export type SupervisionMethod = (typeof SUPERVISION_METHODS)[number];
export const SUPERVISION_METHOD_LABEL: Record<SupervisionMethod, string> = {
  faceToFace: 'Face to face', phone: 'Phone / video', written: 'Written report', group: 'Group conference'
};

export const CONSULT_ROLES = ['Teacher', 'Special ed teacher', 'Paraprofessional', 'SLP', 'PT', 'School psychologist', 'Nurse', 'Administrator', 'Other staff'];
export const PARENT_ROLES = ['Parent', 'Guardian', 'Caregiver'];

export interface LogEntry {
  id: string;
  kind: LogKind;
  date: Date;
  minutes?: number;
  /** Students discussed (pseudonymous codes). Optional for supervision. */
  studentCodes: string[];
  /** Role, not name: "Teacher", "Parent", "Supervising OT". */
  who: string;
  method: ContactMethod | SupervisionMethod;
  topic: string;
  outcome: string;
  /** Day key for a follow-up reminder. */
  followUp?: string;
  followUpDone?: boolean;
  /** Supervision only: contact happened onsite, and included observing the COTA with a student. */
  onsite?: boolean;
  observed?: boolean;
  createdAt: Date;
}

export interface FollowUp {
  entry: LogEntry;
  due: string;
  daysLeft: number;
  status: 'overdue' | 'soon' | 'upcoming';
}

export function followUps(entries: LogEntry[], today: string, soonDays = 3): FollowUp[] {
  return entries
    .filter((e) => isDayKey(e.followUp) && !e.followUpDone)
    .map((e) => {
      const daysLeft = daysBetween(today, e.followUp!);
      return { entry: e, due: e.followUp!, daysLeft, status: (daysLeft < 0 ? 'overdue' : daysLeft <= soonDays ? 'soon' : 'upcoming') as FollowUp['status'] };
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** "3 teacher/staff consults (45 min) and 1 parent contact." for a student over a range. */
export function contactSummary(entries: LogEntry[], code: string, range: { start: Date; end: Date }): string | undefined {
  const mine = entries.filter((e) => e.kind !== 'supervision' && e.studentCodes.includes(code) && e.date >= range.start && e.date <= range.end);
  if (!mine.length) return undefined;
  const part = (kind: LogKind, one: string, many: string) => {
    const xs = mine.filter((e) => e.kind === kind);
    if (!xs.length) return undefined;
    const mins = xs.reduce((a, e) => a + (e.minutes ?? 0), 0);
    return `${xs.length} ${xs.length === 1 ? one : many}${mins ? ` (${mins} min)` : ''}`;
  };
  const parts = [part('consult', 'consultation with school staff', 'consultations with school staff'), part('parent', 'parent/guardian contact', 'parent/guardian contacts')].filter(Boolean);
  return `Collaboration: ${parts.join(' and ')}.`;
}

export interface DirectCareSession {
  groupKey: string;
  date: Date;
  start?: Date;
  end?: Date;
  attendance: string;
  signerRole?: 'OT' | 'COTA';
}

export interface SupervisionMonth {
  year: number;
  /** 0-based month */
  month: number;
  directMinutes: number;
  supervisionMinutes: number;
  requiredMinutes: number;
  /** Supervision minutes as % of direct care, rounded down. */
  percent?: number;
  onsiteObservation: boolean;
  methods: SupervisionMethod[];
  contacts: number;
  issues: string[];
}

/**
 * Checks one calendar month. Direct care counts each group session once (it's the COTA's time, not per student).
 * `isCota` decides which sessions count: by default, sessions signed as COTA or still unsigned on a COTA device.
 */
export function supervisionMonth(
  entries: LogEntry[],
  sessions: DirectCareSession[],
  year: number,
  month: number,
  isCota: (s: DirectCareSession) => boolean = (s) => s.signerRole !== 'OT'
): SupervisionMonth {
  const inMonth = (d: Date) => d.getFullYear() === year && d.getMonth() === month;
  const byGroup = new Map<string, number>();
  for (const s of sessions) {
    if (!inMonth(s.date) || s.attendance !== 'present' || !s.start || !s.end || s.end <= s.start || !isCota(s)) continue;
    const m = Math.floor((s.end.getTime() - s.start.getTime()) / 60000);
    byGroup.set(s.groupKey, Math.max(byGroup.get(s.groupKey) ?? 0, m));
  }
  const directMinutes = [...byGroup.values()].reduce((a, b) => a + b, 0);
  const sup = entries.filter((e) => e.kind === 'supervision' && inMonth(e.date));
  const supervisionMinutes = sup.reduce((a, e) => a + (e.minutes ?? 0), 0);
  const requiredMinutes = Math.ceil(directMinutes * 0.1);
  const onsiteObservation = sup.some((e) => e.method === 'faceToFace' && e.onsite && e.observed);
  const methods = SUPERVISION_METHODS.filter((m) => sup.some((e) => e.method === m));

  const issues: string[] = [];
  if (supervisionMinutes < requiredMinutes) issues.push(`Supervisory contact is ${supervisionMinutes} of ${requiredMinutes} min needed (10% of ${directMinutes} min direct care).`);
  if (directMinutes > 0 && !onsiteObservation) issues.push('No onsite face-to-face contact with observation logged this month.');
  if (directMinutes > 0 && methods.length < 2) issues.push('Contact should combine face-to-face, phone and written communication; only one kind is logged.');

  return {
    year, month, directMinutes, supervisionMinutes, requiredMinutes,
    percent: directMinutes ? Math.floor((supervisionMinutes * 100) / directMinutes) : undefined,
    onsiteObservation, methods, contacts: sup.length, issues
  };
}

/** Plan and annual-appraisal checks (§ 42.22(b), (e)). */
export function supervisionPaperwork(today: string, planDate?: string, appraisalDate?: string): string[] {
  const out: string[] = [];
  if (!isDayKey(planDate)) out.push('No supervisory plan date recorded.');
  if (!isDayKey(appraisalDate)) out.push('No annual written performance appraisal recorded.');
  else if (daysBetween(appraisalDate, today) > 365) out.push('The annual written performance appraisal is overdue.');
  return out;
}
