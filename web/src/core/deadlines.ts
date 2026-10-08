// Beta 2: IEP, re-evaluation, evaluation-clock and progress-report deadlines.
// All dates are local day keys ("2026-10-07") so nothing shifts across time zones.
// Timelines follow Pennsylvania (22 Pa. Code ch. 14) and IDEA defaults; districts may set earlier internal dates.

export type DeadlineKind = 'iep' | 'reeval' | 'eval' | 'report' | 'followup';
export type DeadlineStatus = 'overdue' | 'soon' | 'upcoming';

export interface Deadline {
  code: string;
  kind: DeadlineKind;
  label: string;
  due: string;
  daysLeft: number;
  status: DeadlineStatus;
}

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  iep: 'Annual IEP',
  reeval: 'Re-evaluation',
  eval: 'Evaluation report',
  report: 'Progress report',
  followup: 'Follow-up'
};

/** How many days ahead each kind counts as "due soon". Re-evals need consent and testing, so they surface earliest. */
export const SOON_DAYS: Record<DeadlineKind, number> = { iep: 30, reeval: 60, eval: 14, report: 14, followup: 3 };

/** The student fields this module reads (all optional on StudentRecord). */
export interface DeadlineStudent {
  code: string;
  isActive: boolean;
  createdAt: Date;
  reportCadence: string;
  /** Date of the current IEP meeting. The next one is due by the anniversary. */
  iepDate?: string;
  /** Date of the last evaluation or re-evaluation report (ER/RR). */
  lastEvalDate?: string;
  /** 3 years by default; 2 for students with an intellectual disability (22 Pa. Code 14.124(c)). */
  reevalYears?: 2 | 3;
  /** Date the district received signed permission to evaluate; starts the 60-day clock. Cleared when the report is done. */
  evalConsentDate?: string;
  /** Days a progress report PDF was exported for this student. */
  reportsExported?: string[];
}

export interface SchoolCalendar {
  /** Last student day in spring. Days strictly between this and firstDayFall don't count toward the 60-day clock. */
  lastDaySpring?: string;
  firstDayFall?: string;
  /** Marking-period end dates, used for quarterly / report-card progress reports. */
  markingPeriodEnds?: string[];
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDayKey = (s: unknown): s is string => typeof s === 'string' && KEY_RE.test(s);

const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function utcDay(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string) => utcDay(b) - utcDay(a);

export function addDays(k: string, n: number): string {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Same month and day n years later; Feb 29 falls back to Feb 28. */
export function addYears(k: string, n: number): string {
  const [y, m, d] = k.split('-').map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${pad(m)}-${pad(Math.min(d, last))}`;
}

function lastOfMonth(y: number, m0: number): string {
  const t = new Date(Date.UTC(y, m0 + 1, 0));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * 60 calendar days from consent, not counting summer break (22 Pa. Code 14.123(b)).
 * Day one is the day after consent was received.
 */
export function evalDueDate(consent: string, cal: SchoolCalendar = {}, days = 60): string {
  const { lastDaySpring: a, firstDayFall: b } = cal;
  const inSummer = (k: string) => !!a && !!b && k > a && k < b;
  let k = consent;
  let counted = 0;
  while (counted < days) {
    k = addDays(k, 1);
    if (!inSummer(k)) counted++;
  }
  return k;
}

/** Progress-report due dates between two day keys, from the student's report cadence. */
export function reportDueDates(cadence: string, from: string, to: string, cal: SchoolCalendar = {}, iepDate?: string): string[] {
  const out: string[] = [];
  const c = cadence.toLowerCase();
  if (c.startsWith('month')) {
    let [y, m] = from.split('-').map(Number);
    m -= 1;
    for (;;) {
      const k = lastOfMonth(y, m);
      if (k > to) break;
      if (k >= from) out.push(k);
      m++;
      if (m > 11) { m = 0; y++; }
    }
  } else if (c.startsWith('quarter') || c.includes('report card')) {
    const ends = (cal.markingPeriodEnds ?? []).filter(isDayKey).sort();
    if (ends.length) out.push(...ends.filter((k) => k >= from && k <= to));
    else if (c.startsWith('quarter')) {
      // No marking periods set: fall back to calendar quarter ends.
      const y0 = Number(from.slice(0, 4));
      for (let y = y0; y <= Number(to.slice(0, 4)); y++) {
        for (const m of [2, 5, 8, 11]) {
          const k = lastOfMonth(y, m);
          if (k >= from && k <= to) out.push(k);
        }
      }
    }
  } else if (c.startsWith('annual') && iepDate) {
    for (let n = 0; n < 40; n++) {
      const k = addYears(iepDate, n);
      if (k > to) break;
      if (k >= from) out.push(k);
    }
  }
  return out;
}

/** A report counts for a due date if it was exported from 3 weeks before to 6 weeks after it. */
const reportCovers = (exported: string[], due: string) => exported.some((e) => daysBetween(due, e) >= -21 && daysBetween(due, e) <= 42);

function make(code: string, kind: DeadlineKind, label: string, due: string, today: string): Deadline {
  const daysLeft = daysBetween(today, due);
  const status: DeadlineStatus = daysLeft < 0 ? 'overdue' : daysLeft <= SOON_DAYS[kind] ? 'soon' : 'upcoming';
  return { code, kind, label, due, daysLeft, status };
}

/** All deadlines for one student within `horizon` days, plus anything overdue. Sorted by date. */
export function deadlinesFor(st: DeadlineStudent, today: string, cal: SchoolCalendar = {}, horizon = 120): Deadline[] {
  if (!st.isActive) return [];
  const out: Deadline[] = [];
  const until = addDays(today, horizon);

  if (isDayKey(st.iepDate)) out.push(make(st.code, 'iep', 'Annual IEP review', addYears(st.iepDate, 1), today));
  if (isDayKey(st.lastEvalDate)) {
    const years = st.reevalYears === 2 ? 2 : 3;
    out.push(make(st.code, 'reeval', `Re-evaluation (${years}-year)`, addYears(st.lastEvalDate, years), today));
  }
  if (isDayKey(st.evalConsentDate)) out.push(make(st.code, 'eval', 'Evaluation report (60-day clock)', evalDueDate(st.evalConsentDate, cal), today));

  // Progress reports: anything missed since the student was added (at most 60 days back), then the next one.
  const exported = (st.reportsExported ?? []).filter(isDayKey);
  const since = [toKey(st.createdAt), addDays(today, -60)].sort()[1];
  // Annual reporting happens at the IEP review, which is already listed.
  const reportDues = st.reportCadence.toLowerCase().startsWith('annual') ? [] : reportDueDates(st.reportCadence, since, until, cal, st.iepDate);
  for (const due of reportDues) {
    if (reportCovers(exported, due)) continue;
    const d = make(st.code, 'report', `${st.reportCadence} progress report`, due, today);
    if (d.status === 'overdue' || !out.some((x) => x.kind === 'report' && x.status !== 'overdue')) out.push(d);
  }

  return out.filter((d) => d.status === 'overdue' || d.due <= until).sort((a, b) => a.due.localeCompare(b.due));
}

export function allDeadlines(students: DeadlineStudent[], today: string, cal: SchoolCalendar = {}, horizon = 120): Deadline[] {
  return students.flatMap((s) => deadlinesFor(s, today, cal, horizon)).sort((a, b) => a.due.localeCompare(b.due) || a.code.localeCompare(b.code));
}

export function describeDays(d: Pick<Deadline, 'daysLeft'>): string {
  if (d.daysLeft === 0) return 'today';
  if (d.daysLeft === 1) return 'tomorrow';
  if (d.daysLeft === -1) return '1 day overdue';
  return d.daysLeft < 0 ? `${-d.daysLeft} days overdue` : `in ${d.daysLeft} days`;
}
