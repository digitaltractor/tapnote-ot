import { describe, expect, it } from 'vitest';
import { SBAP_OT_KEYS, sbapActivity } from './sbapKeys';
import { ScheduleSlot, dayKey, isoWeekday, scheduledWeeklyMinutes, slotsForDay, unloggedSlots } from './schedule';
import { MinutesSession, isOwed, minutesSummary, weekStart } from './minutes';

describe('SBAP keys', () => {
  it('has keys 1–53 with no gaps or duplicates', () => {
    expect(SBAP_OT_KEYS.map((k) => k.key)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
  });
  it('matches the four keys already in the starter catalog', () => {
    expect(sbapActivity(12)?.name).toContain('Grasp/Release');
    expect(sbapActivity(19)?.name).toContain('Handwriting Control');
    expect(sbapActivity(41)?.name).toContain('Self-Regulation');
    expect(sbapActivity(51)?.name).toContain('Perception');
    expect(sbapActivity(19)?.id).toBe('sbap-19');
  });
});

const slots: ScheduleSlot[] = [
  { id: 'a', weekday: 3, start: '09:15', minutes: 30, studentCodes: ['K7-OTTER'], active: true },
  { id: 'b', weekday: 3, start: '08:30', minutes: 30, studentCodes: ['R2-FINCH', 'T5-CEDAR'], active: true },
  { id: 'c', weekday: 1, start: '10:00', minutes: 30, studentCodes: ['K7-OTTER'], active: true },
  { id: 'd', weekday: 3, start: '13:00', minutes: 30, studentCodes: ['M3-HERON'], active: false }
];

describe('schedule', () => {
  it('uses ISO weekdays', () => {
    expect(isoWeekday(new Date(2026, 9, 5))).toBe(1); // Mon Oct 5 2026
    expect(isoWeekday(new Date(2026, 9, 11))).toBe(7); // Sun
  });
  it('lists active slots for a day in time order and skips closures', () => {
    const wed = new Date(2026, 9, 7);
    expect(slotsForDay(slots, wed).map((s) => s.id)).toEqual(['b', 'a']);
    expect(slotsForDay(slots, wed, [dayKey(wed)])).toEqual([]);
  });
  it('totals scheduled minutes per student', () => {
    expect(scheduledWeeklyMinutes(slots, 'K7-OTTER')).toBe(60);
    expect(scheduledWeeklyMinutes(slots, 'M3-HERON')).toBe(0);
  });
  it('finds scheduled slots with nothing logged', () => {
    const logged = [{ slotId: 'b', studentCode: 'R2-FINCH', date: new Date(2026, 9, 7, 8, 30) }];
    const gaps = unloggedSlots(slots, logged, new Date(2026, 9, 5), new Date(2026, 9, 8));
    expect(gaps.map((g) => `${g.day} ${g.slot.id} ${g.studentCodes.join('+')}`)).toEqual([
      '2026-10-05 c K7-OTTER',
      '2026-10-07 b T5-CEDAR',
      '2026-10-07 a K7-OTTER'
    ]);
  });
  it('ignores days before a slot started', () => {
    const fresh = slots.map((s) => ({ ...s, since: '2026-10-07' }));
    const gaps = unloggedSlots(fresh, [], new Date(2026, 9, 1), new Date(2026, 9, 8));
    expect(gaps.every((g) => g.day >= '2026-10-07')).toBe(true);
    expect(gaps.map((g) => g.slot.id)).toEqual(['b', 'a']);
  });
});

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
function sess(p: Partial<MinutesSession> & { id: string; date: Date }): MinutesSession {
  return { studentCode: 'K7-OTTER', plannedMinutes: 30, attendance: 'present', isMakeUp: false, ...p };
}

describe('missed minutes', () => {
  it('decides what is owed', () => {
    expect(isOwed('providerAbsent', { countStudentUnavailable: false })).toBe(true);
    expect(isOwed('studentAbsent', { countStudentUnavailable: true })).toBe(false);
    expect(isOwed('studentNotAvailable', { countStudentUnavailable: false })).toBe(false);
    expect(isOwed('studentNotAvailable', { countStudentUnavailable: true })).toBe(true);
  });
  it('weeks start on Monday', () => {
    expect(dayKey(weekStart(new Date(2026, 9, 11)))).toBe('2026-10-05');
  });
  it('totals mandated vs delivered and credits linked make-ups', () => {
    const sessions = [
      sess({ id: 's1', date: at(5, 10), start: at(5, 10), end: at(5, 10, 30) }),                       // delivered 30
      sess({ id: 's2', date: at(7, 9, 15), attendance: 'providerAbsent' }),                                   // owed 30
      sess({ id: 's3', date: at(8, 9, 15), attendance: 'studentAbsent' }),                                    // not owed
      sess({ id: 's4', date: at(12, 10), attendance: 'providerNotAvailable', plannedMinutes: 30 }),           // owed 30
      sess({ id: 's5', date: at(13, 14), start: at(13, 14), end: at(13, 14, 20), isMakeUp: true, makeUpFor: ['s4'] }) // 20 to s4
    ];
    const r = minutesSummary('K7-OTTER', 60, sessions, { start: at(5, 0), end: at(16, 23) });
    expect(r.weeks).toEqual([
      { weekStart: '2026-10-05', mandated: 60, delivered: 30 },
      { weekStart: '2026-10-12', mandated: 60, delivered: 20 }
    ]);
    expect(r.mandated).toBe(120);
    expect(r.delivered).toBe(50);
    expect(r.owedTotal).toBe(60);
    expect(r.owed.find((o) => o.sessionId === 's4')?.madeUp).toBe(20);
    expect(r.owed.find((o) => o.sessionId === 's2')?.madeUp).toBe(0);
    expect(r.outstanding).toBe(40);
  });
  it('applies unlinked make-ups to the oldest earlier misses', () => {
    const sessions = [
      sess({ id: 'm1', date: at(5, 9), attendance: 'providerAbsent' }),
      sess({ id: 'm2', date: at(6, 9), attendance: 'providerAbsent' }),
      sess({ id: 'mu', date: at(9, 9), start: at(9, 9), end: at(9, 9, 45), isMakeUp: true })
    ];
    const r = minutesSummary('K7-OTTER', 30, sessions, { start: at(5, 0), end: at(9, 23) });
    expect(r.owed.map((o) => o.madeUp)).toEqual([30, 15]);
    expect(r.outstanding).toBe(15);
  });
});
