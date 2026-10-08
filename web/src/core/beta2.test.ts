import { describe, expect, it } from 'vitest';
import { addDays, addYears, daysBetween, deadlinesFor, evalDueDate, reportDueDates, DeadlineStudent } from './deadlines';
import { goalInsight, mastery, promptTrend, stateNextSteps, stateTrend, describeState } from './mastery';
import { contactSummary, followUps, LogEntry, supervisionMonth, supervisionPaperwork, DirectCareSession } from './contacts';
import { goalProgress } from './progress';
import { DEFAULT_PROMPT_LEVELS, GoalSnapshot, SessionSnapshot } from './types';

describe('day keys', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
  });
  it('handles leap days', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2026-10-07', 3)).toBe('2029-10-07');
  });
});

describe('evaluation clock', () => {
  it('is 60 calendar days from consent', () => {
    expect(evalDueDate('2026-10-01')).toBe('2026-11-30');
  });
  it('skips summer break', () => {
    const cal = { lastDaySpring: '2027-06-10', firstDayFall: '2027-08-25' };
    // May 20 + 21 days → Jun 10, then the clock stops until Aug 25 (counted), 39 more days → Oct 2.
    expect(evalDueDate('2027-05-20', cal)).toBe('2027-10-02');
  });
});

describe('progress report dates', () => {
  it('uses month ends for monthly', () => {
    expect(reportDueDates('Monthly', '2026-10-08', '2026-12-31')).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
  });
  it('uses marking periods when set, else calendar quarters', () => {
    expect(reportDueDates('Quarterly', '2026-10-01', '2027-03-31', { markingPeriodEnds: ['2027-01-22', '2026-11-06'] })).toEqual(['2026-11-06', '2027-01-22']);
    expect(reportDueDates('Quarterly', '2026-10-01', '2027-03-31')).toEqual(['2026-12-31', '2027-03-31']);
    expect(reportDueDates('With report cards', '2026-10-01', '2027-03-31')).toEqual([]);
  });
});

describe('student deadlines', () => {
  const base: DeadlineStudent = { code: 'K7-OTTER', isActive: true, createdAt: new Date(2026, 7, 20), reportCadence: 'Quarterly' };
  it('flags IEP, re-eval and eval clock', () => {
    const d = deadlinesFor({ ...base, iepDate: '2025-11-01', lastEvalDate: '2024-10-15', reevalYears: 2, evalConsentDate: '2026-09-01' }, '2026-10-08');
    const by = Object.fromEntries(d.map((x) => [x.kind, x]));
    expect(by.iep.due).toBe('2026-11-01');
    expect(by.iep.status).toBe('soon');
    expect(by.reeval.due).toBe('2026-10-15');
    expect(by.reeval.label).toContain('2-year');
    expect(by.eval.due).toBe('2026-10-31');
  });
  it('marks overdue and ignores inactive students', () => {
    const d = deadlinesFor({ ...base, iepDate: '2025-09-30' }, '2026-10-08');
    expect(d.find((x) => x.kind === 'iep')?.status).toBe('overdue');
    expect(d.find((x) => x.kind === 'iep')?.daysLeft).toBe(-8);
    expect(deadlinesFor({ ...base, isActive: false, iepDate: '2025-09-30' }, '2026-10-08')).toEqual([]);
  });
  it('lists missed reports and only the next upcoming one', () => {
    const st = { ...base, reportCadence: 'Monthly', createdAt: new Date(2026, 6, 1) };
    const d = deadlinesFor(st, '2026-10-08').filter((x) => x.kind === 'report');
    expect(d.map((x) => `${x.due} ${x.status}`)).toEqual(['2026-08-31 overdue', '2026-09-30 overdue', '2026-10-31 upcoming']);
    const sent = deadlinesFor({ ...st, reportsExported: ['2026-09-01', '2026-09-29'] }, '2026-10-08').filter((x) => x.kind === 'report');
    expect(sent.map((x) => x.due)).toEqual(['2026-10-31']);
  });
});

const goal: GoalSnapshot = { id: 'g1', number: 1, shortName: 'Letter formation', detail: '', criterionPercent: 80 };
function snaps(data: [number, string?][], start = 1): SessionSnapshot[] {
  return data.map(([pct, prompt], i) => ({
    id: `s${i}`, studentCode: 'K7-OTTER', studentAlias: 'Otter', date: new Date(2026, 8, start + i * 2), plannedMinutes: 30, groupSize: 1,
    attendance: 'present', delivery: 'inPerson', isMakeUp: false, activities: [], goals: [goal],
    observations: [{ goalID: 'g1', correct: pct, total: 100, promptLevelName: prompt }], comment: ''
  }));
}
const range = { start: new Date(2026, 7, 1), end: new Date(2026, 11, 31) };

describe('mastery', () => {
  it('needs N consecutive sessions at criterion', () => {
    const pts = goalProgress(goal, snaps([[60], [82], [85], [70], [80], [90], [88]]), range, 'quarter').points;
    const m = mastery(pts, 80, 3);
    expect(m.streak).toBe(3);
    expect(m.mastered).toBe(true);
    expect(m.metOn).toEqual(pts[6].date);
    expect(mastery(pts, 80, 4).mastered).toBe(false);
  });
  it('remembers a run that was not maintained', () => {
    const pts = goalProgress(goal, snaps([[82], [85], [90], [60]]), range, 'quarter').points;
    const m = mastery(pts, 80, 3);
    expect(m.mastered).toBe(false);
    expect(m.firstMetOn).toEqual(pts[2].date);
  });
});

describe('prompt trend', () => {
  it('detects fading toward independence', () => {
    const pts = goalProgress(goal, snaps([[50, 'Model'], [60, 'Visual'], [65, 'Gestural'], [70, 'Verbal']]), range, 'quarter').points;
    const t = promptTrend(pts, DEFAULT_PROMPT_LEVELS);
    expect(t.direction).toBe('fading');
    expect(t.first).toBe('Model');
    expect(t.last).toBe('Verbal');
    expect(t.nextLower).toBe('Independent');
    expect(t.independentShare).toBe(0);
  });
  it('detects increasing support', () => {
    const pts = goalProgress(goal, snaps([[50, 'Verbal'], [55, 'Visual'], [52, 'Model']]), range, 'quarter').points;
    expect(promptTrend(pts, DEFAULT_PROMPT_LEVELS).direction).toBe('increasing');
  });
});

describe('next steps', () => {
  it('suggests fading after mastery with prompts', () => {
    const p = goalProgress(goal, snaps([[70, 'Verbal'], [82, 'Verbal'], [85, 'Verbal'], [90, 'Verbal']]), range, 'quarter');
    const g = goalInsight(p, DEFAULT_PROMPT_LEVELS, 3);
    expect(g.mastery.mastered).toBe(true);
    expect(g.nextSteps.join(' ')).toMatch(/Fade verbal prompting toward independent/);
  });
  it('projects sessions to criterion when progressing', () => {
    const p = goalProgress(goal, snaps([[40], [50], [60], [70]]), range, 'quarter');
    const g = goalInsight(p, DEFAULT_PROMPT_LEVELS, 3);
    expect(p.status).toBe('Progressing');
    expect(g.sessionsToCriterion).toBe(1);
  });
  it('flags no progress for the IEP team', () => {
    const p = goalProgress(goal, snaps([[60], [55], [58], [52]]), range, 'quarter');
    expect(goalInsight(p, DEFAULT_PROMPT_LEVELS).nextSteps.join(' ')).toMatch(/IEP team/);
  });
});

describe('regulation and engagement', () => {
  const s = (d: number, regulation?: 'Low' | 'Calm' | 'Heightened' | 'High', engagement?: number) => ({ date: new Date(2026, 9, d), regulation, engagement });
  it('summarizes calm share and engagement direction', () => {
    const t = stateTrend([s(1, 'High', 2), s(2, 'Heightened', 2), s(3, 'Calm', 4), s(4, 'Calm', 4)]);
    expect(t.rated).toBe(4);
    expect(t.calmFirst).toBe(0);
    expect(t.calmSecond).toBe(100);
    expect(t.engagementDirection).toBe('up');
    expect(describeState(t)).toContain('Calm and ready to learn in 2 of 4');
    expect(stateNextSteps(t)).toEqual([]);
  });
  it('suggests regulation supports when calm is rare', () => {
    const t = stateTrend([s(1, 'High'), s(2, 'Heightened'), s(3, 'Calm')]);
    expect(stateNextSteps(t)[0]).toMatch(/barrier in 2 of 3/);
  });
});

const entry = (p: Partial<LogEntry>): LogEntry => ({
  id: Math.random().toString(36), kind: 'consult', date: new Date(2026, 9, 5), studentCodes: ['K7-OTTER'], who: 'Teacher', method: 'inPerson',
  topic: '', outcome: '', createdAt: new Date(), ...p
});

describe('contact logs', () => {
  it('summarizes consults and parent contacts for a student', () => {
    const list = [entry({ minutes: 10 }), entry({ minutes: 15 }), entry({ kind: 'parent', method: 'phone' }), entry({ studentCodes: ['M3-HERON'] })];
    expect(contactSummary(list, 'K7-OTTER', range)).toBe('Collaboration: 2 consultations with school staff (25 min) and 1 parent/guardian contact.');
    expect(contactSummary(list, 'P9-MAPLE', range)).toBeUndefined();
  });
  it('lists open follow-ups', () => {
    const list = [entry({ followUp: '2026-10-07' }), entry({ followUp: '2026-10-09' }), entry({ followUp: '2026-10-01', followUpDone: true })];
    expect(followUps(list, '2026-10-08').map((f) => `${f.due} ${f.status}`)).toEqual(['2026-10-07 overdue', '2026-10-09 soon']);
  });
});

describe('COTA supervision (49 Pa. Code 42.22)', () => {
  const t = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
  const sessions: DirectCareSession[] = [
    // A group of two counts once: 30 min
    { groupKey: 'g1', date: t(5, 9), start: t(5, 9), end: t(5, 9, 30), attendance: 'present' },
    { groupKey: 'g1', date: t(5, 9), start: t(5, 9), end: t(5, 9, 30), attendance: 'present' },
    { groupKey: 'g2', date: t(6, 9), start: t(6, 9), end: t(6, 10, 30), attendance: 'present' },
    { groupKey: 'g3', date: t(7, 9), attendance: 'studentAbsent' },
    { groupKey: 'g4', date: new Date(2026, 8, 30, 9), start: new Date(2026, 8, 30, 9), end: new Date(2026, 8, 30, 10), attendance: 'present' }
  ];
  it('needs 10% of direct care, an onsite observation and mixed contact', () => {
    const m = supervisionMonth([], sessions, 2026, 9);
    expect(m.directMinutes).toBe(120);
    expect(m.requiredMinutes).toBe(12);
    expect(m.issues).toHaveLength(3);
  });
  it('passes with enough mixed contact', () => {
    const sup = [
      entry({ kind: 'supervision', method: 'faceToFace', onsite: true, observed: true, minutes: 10, studentCodes: [] }),
      entry({ kind: 'supervision', method: 'phone', minutes: 5, studentCodes: [] })
    ];
    const m = supervisionMonth(sup, sessions, 2026, 9);
    expect(m.supervisionMinutes).toBe(15);
    expect(m.percent).toBe(12);
    expect(m.onsiteObservation).toBe(true);
    expect(m.issues).toEqual([]);
  });
  it('checks plan and appraisal dates', () => {
    expect(supervisionPaperwork('2026-10-08')).toHaveLength(2);
    expect(supervisionPaperwork('2026-10-08', '2026-08-25', '2025-09-01')).toEqual(['The annual written performance appraisal is overdue.']);
    expect(supervisionPaperwork('2026-10-08', '2026-08-25', '2026-01-10')).toEqual([]);
  });
});
