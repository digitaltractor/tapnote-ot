import { describe, expect, it } from 'vitest';
import { GoalSnapshot, STARTER_ACTIVITIES, SessionSnapshot, minutes, sbapServiceType } from './types';
import { composeNote, plainText } from './notes';
import { checkSession, isReadyToSign } from './audit';
import { csvField, sbapCSV } from './csv';
import { goalProgress } from './progress';
import { aliasFor, makeCode, scrubNames } from './pseudonym';
import { TimeStyle } from './time';

const time = new TimeStyle('UTC');
const d = (iso: string) => new Date(iso);

function otter(progress: SessionSnapshot['progress'] | null = 'progressing'): { s: SessionSnapshot; g1: GoalSnapshot; g2: GoalSnapshot } {
  const g1: GoalSnapshot = { id: 'g1', number: 1, shortName: 'Letter formation', detail: '', criterionPercent: 90 };
  const g2: GoalSnapshot = { id: 'g2', number: 2, shortName: 'Cutting a curved line', detail: '', criterionPercent: 80 };
  const s: SessionSnapshot = {
    id: 's1', studentCode: 'K7-OTTER', studentAlias: 'Otter',
    date: d('2026-10-07T09:15:00Z'), start: d('2026-10-07T09:15:00Z'), end: d('2026-10-07T09:45:40Z'),
    plannedMinutes: 30, groupSize: 1, attendance: 'present', delivery: 'inPerson', isMakeUp: false,
    activities: [STARTER_ACTIVITIES[0], STARTER_ACTIVITIES[2]], goals: [g1, g2],
    observations: [
      { goalID: 'g1', correct: 7, total: 10, promptLevelName: 'Verbal' },
      { goalID: 'g2', correct: 3, total: 6, promptLevelName: 'Partial physical' }
    ],
    regulation: 'Calm', engagement: 4, progress: progress ?? undefined, comment: 'used slant board'
  };
  return { s, g1, g2 };
}

describe('service type and minutes', () => {
  it('maps SBAP service types', () => {
    expect(sbapServiceType('present', 'inPerson', false)).toBe('D');
    expect(sbapServiceType('present', 'inPerson', true)).toBe('DM');
    expect(sbapServiceType('present', 'telehealthHome', false)).toBe('10');
    expect(sbapServiceType('present', 'telehealthNotHome', true)).toBe('02M');
    expect(sbapServiceType('studentAbsent', 'inPerson', false)).toBe('SA');
    expect(sbapServiceType('providerNotAvailable', 'inPerson', false)).toBe('PNA');
  });
  it('never rounds minutes up', () => {
    expect(minutes(otter().s)).toBe(30);
  });
});

describe('notes', () => {
  it('builds a SOAP note from recorded facts only', () => {
    const note = composeNote(otter().s, 'soap', time);
    expect(note.sections.map((s) => s.title)).toEqual(['S', 'O', 'A', 'P']);
    expect(note.sections[0].text).toBe('Presented calm on arrival. Engagement 4/5.');
    expect(note.sections[1].text).toContain('9:15 AM–9:45 AM (30 min)');
    expect(note.sections[1].text).toContain('Goal 1 (Letter formation): 7/10 trials correct (70%) with verbal prompts.');
    expect(note.sections[1].text).toContain('Therapist comment: used slant board');
    expect(note.sections[2].text).toContain('Goal 1 accuracy (70%) is below the 90% criterion.');
    expect(note.missing).toEqual([]);
  });
  it('flags missing data instead of inventing it', () => {
    const { s } = otter(null);
    s.regulation = undefined;
    const note = composeNote(s, 'soap', time);
    expect(note.missing).toEqual(['Regulation state', 'Progress indicator']);
    expect(plainText(note).toLowerCase()).not.toContain('progressing');
  });
  it('writes a log-only line for absences', () => {
    const { s } = otter();
    s.attendance = 'studentAbsent';
    const note = composeNote(s, 'soap', time);
    expect(note.sections).toHaveLength(1);
    expect(plainText(note).startsWith('Student absent (SA).')).toBe(true);
  });
  it('supports narrative and DAP', () => {
    expect(composeNote(otter().s, 'narrative', time).sections).toHaveLength(1);
    expect(composeNote(otter().s, 'dap', time).sections.map((x) => x.title)).toEqual(['D', 'A', 'P']);
  });
});

describe('self-audit', () => {
  it('passes a complete session', () => {
    expect(isReadyToSign(checkSession(otter().s))).toBe(true);
  });
  it('blocks without a progress indicator', () => {
    const issues = checkSession(otter(null).s);
    expect(isReadyToSign(issues)).toBe(false);
    expect(issues).toContainEqual({ severity: 'blocking', message: 'Choose a progress indicator' });
  });
  it('blocks overlapping sessions', () => {
    const { s } = otter();
    const other: SessionSnapshot = { ...s, id: 's2', studentCode: 'M3-HERON', start: d('2026-10-07T09:30:00Z'), end: d('2026-10-07T10:00:00Z') };
    expect(checkSession(s, [other])).toContainEqual({ severity: 'blocking', message: 'Overlaps the M3-HERON session' });
  });
  it('does not treat the same group as an overlap', () => {
    const start = d('2026-10-07T08:30:00Z');
    const end = d('2026-10-07T09:00:00Z');
    const base = { ...otter().s, start, end, date: start, groupSize: 3 };
    const a = { ...base, id: 'a', studentCode: 'R2-FINCH' };
    const b = { ...base, id: 'b', studentCode: 'T5-CEDAR' };
    expect(isReadyToSign(checkSession(a, [a, b]))).toBe(true);
  });
  it('needs no times for an absence', () => {
    const s: SessionSnapshot = { ...otter().s, attendance: 'studentAbsent', start: undefined, end: undefined };
    expect(checkSession(s)).toEqual([]);
  });
});

describe('CSV export', () => {
  it('is pseudonymous by default', () => {
    const lines = sbapCSV([otter().s], { time }).split('\r\n');
    expect(lines[0]).toBe('Student Code,Date,Start,End,Treatment Key,Group Size,Service Type,Progress Indicator,Description');
    expect(lines[1].startsWith('K7-OTTER,10/07/2026,9:15 AM,9:45 AM,19; 51,1,D,Pr,')).toBe(true);
  });
  it('adds identity only when provided', () => {
    const csv = sbapCSV([otter().s], { time, identity: () => ({ realName: 'Test Student', dateOfBirth: '01/02/2018', paSecureID: '1234567890', diagnosis: '' }) });
    expect(csv).toContain('Test Student,01/02/2018,1234567890,K7-OTTER');
  });
  it('escapes fields', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
  });
});

describe('progress reports', () => {
  it('summarizes a goal across sessions', () => {
    const goal: GoalSnapshot = { id: 'g1', number: 1, shortName: 'Letter formation', detail: '', criterionPercent: 90 };
    const values = [40, 50, 55, 70];
    const sessions = values.map((v, i): SessionSnapshot => ({
      ...otter().s, id: `s${i}`, date: d(`2026-09-0${i + 1}T09:00:00Z`),
      observations: [{ goalID: 'g1', correct: v, total: 100, promptLevelName: i < 2 ? 'Partial physical' : 'Verbal' }]
    }));
    const r = goalProgress(goal, sessions, { start: d('2026-09-01T00:00:00Z'), end: d('2026-09-30T23:59:59Z') }, 'month', time);
    expect(r.status).toBe('Progressing');
    expect(r.average).toBe(54);
    expect(r.narrative).toContain('went from 40% to 70% (average 54%) against a 90% criterion.');
    expect(r.narrative).toContain('Prompting changed from partial physical to verbal.');
  });
  it('reports when there is no data', () => {
    const goal: GoalSnapshot = { id: 'g9', number: 2, shortName: 'Buttoning', detail: '' };
    expect(goalProgress(goal, [], { start: d('2026-09-01T00:00:00Z'), end: d('2026-09-30T00:00:00Z') }, 'month', time).status).toBe('Not enough data');
  });
});

describe('pseudonyms', () => {
  it('makes unique codes in the expected format', () => {
    const existing = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = makeCode(existing);
      expect(code).toMatch(/^[A-HJ-NP-Z][2-9]-[A-Z]+$/);
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
    expect(aliasFor('K7-OTTER')).toBe('Otter');
  });
  it('scrubs full, first and last names', () => {
    const r = scrubNames("Ava did well; Martinez's mom came. noah was out. Avalanche drill.", { 'K7-OTTER': 'Ava Martinez', 'M3-HERON': 'Noah Li' });
    expect(r.text).toBe("K7-OTTER did well; K7-OTTER's mom came. M3-HERON was out. Avalanche drill.");
    expect(r.replacements).toBe(3);
  });
  it('prefers the full name', () => {
    const r = scrubNames('Ava Martinez arrived', { 'K7-OTTER': 'Ava Martinez' });
    expect(r).toEqual({ text: 'K7-OTTER arrived', replacements: 1 });
  });
});
