import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween } from './dates';
import { FormRecord, calcText, defaultTasks, expiry, formName, hearingBy, legalStatus, mandatoryReview, nextInChain, raiDue } from './mha';
import { Draft, composeDraft, dueItems, expiredDrafts, isStale, purge } from './ward';
import { findIdentifiers } from './identifiers';
import { makeCode, CODE_RE } from './codes';
import { roundsLine, roundsSummary } from './rounds';
import { sampleWard } from './sample';

let n = 0;
const id = () => `id${n++}`;
const f = (p: Partial<FormRecord> & Pick<FormRecord, 'type' | 'signedOn'>): FormRecord => ({ id: id(), code: 'B4-HERON', tasks: [], createdAt: new Date(2026, 0, 1), ...p });

describe('certificate expiry', () => {
  it('Form 3 lasts 14 days including the signing day', () => {
    expect(expiry({ type: 'form3', signedOn: '2026-10-06' })).toBe('2026-10-19');
  });
  it('Form 4 renewals last 1, 2 then 3 months', () => {
    expect(expiry({ type: 'form4', seq: 1, signedOn: '2026-10-20' })).toBe('2026-11-19');
    expect(expiry({ type: 'form4', seq: 2, signedOn: '2026-08-22' })).toBe('2026-10-21');
    expect(expiry({ type: 'form4', seq: 3, signedOn: '2026-07-01' })).toBe('2026-09-30');
  });
  it('Form 4A lasts 3 months and CTOs 6', () => {
    expect(expiry({ type: 'form4a', seq: 1, signedOn: '2026-07-11' })).toBe('2026-10-10');
    expect(expiry({ type: 'cto', seq: 0, signedOn: '2026-01-31' })).toBe('2026-07-30');
    expect(expiry({ type: 'form5', signedOn: '2026-07-11' })).toBeUndefined();
  });
  it('clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('explains the calculation', () => {
    expect(calcText({ type: 'form4', seq: 2, signedOn: '2026-08-22' })).toContain('2 months');
  });
});

describe('mandatory reviews and the chain', () => {
  it('flags the 1st Form 4A and every 4th after', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((s) => mandatoryReview({ type: 'form4a', seq: s }))).toEqual([true, false, false, false, true, false, true]);
    expect(mandatoryReview({ type: 'form4', seq: 3 })).toBe(false);
  });
  it('flags the 2nd CTO renewal and every 2nd after', () => {
    expect([0, 1, 2, 3, 4].map((s) => mandatoryReview({ type: 'cto', seq: s }))).toEqual([false, false, true, false, true]);
  });
  it('suggests the next certificate', () => {
    expect(nextInChain({ type: 'form3' })).toEqual({ type: 'form4', seq: 1 });
    expect(nextInChain({ type: 'form4', seq: 3 })).toEqual({ type: 'form4a', seq: 1 });
    expect(nextInChain({ type: 'form4a', seq: 4 })).toEqual({ type: 'form4a', seq: 5 });
  });
  it('adds the Form 17 task only when a review is mandatory', () => {
    expect(defaultTasks('form4a', 1).some((t) => t.includes('Form 17'))).toBe(true);
    expect(defaultTasks('form4a', 2).some((t) => t.includes('Form 17'))).toBe(false);
  });
  it('names forms', () => {
    expect(formName({ type: 'form4a', seq: 1 })).toBe('Form 4A, 1st');
    expect(formName({ type: 'cto', seq: 2 })).toBe('CTO, 2nd renewal');
  });
});

describe('legal status', () => {
  it('uses the latest certificate unless a later Form 5 ends it', () => {
    const forms = [f({ type: 'form3', signedOn: '2026-09-01' }), f({ type: 'form4', seq: 1, signedOn: '2026-09-14' })];
    const st = legalStatus(forms);
    expect(st.involuntary).toBe(true);
    expect(st.expiry).toBe('2026-10-13');
    expect(legalStatus([...forms, f({ type: 'form5', signedOn: '2026-09-20' })]).involuntary).toBe(false);
  });
  it('computes hearing and RAI-MH dates', () => {
    expect(hearingBy('2026-10-08')).toBe('2026-10-15');
    expect(daysBetween('2026-07-14', raiDue('2026-07-14'))).toBe(92);
  });
});

describe('drafts', () => {
  const draft: Draft = {
    id: 'd', code: 'B4-HERON', kind: 'contact', serviceDate: '2026-10-08', with: 'Family', how: 'Phone', minutes: 15,
    reported: ['Wants to live closer to family'], observed: [], plan: ['Update housing application'], detail: 'sister will visit Saturday',
    author: 'Social work', createdAt: new Date(2026, 9, 8, 9)
  };
  it('keeps reported and observed apart', () => {
    expect(composeDraft(draft, 'Oct 8, 2026')).toBe(
      'Contact with family by phone, 15 min, Oct 8, 2026.\nReported: Wants to live closer to family.\nObserved: [none recorded]\nPlan: Update housing application.\nDetail: sister will visit Saturday'
    );
  });
  it('purges note content when charted', () => {
    const p = purge(draft, 'charted', new Date(2026, 9, 8, 10));
    expect(p.reported).toEqual([]);
    expect(p.detail).toBe('');
    expect(p.minutes).toBe(15);
    expect(composeDraft(p, 'x')).toBe('');
  });
  it('expires uncharted drafts after N days', () => {
    expect(expiredDrafts([draft], new Date(2026, 9, 12, 10), 3)).toHaveLength(1);
    expect(expiredDrafts([draft], new Date(2026, 9, 10, 10), 3)).toHaveLength(0);
  });
});

describe('identifier check', () => {
  it('catches numbers, contact details and names', () => {
    const kinds = findIdentifiers('Spoke with Mrs. Lee. Card 1234-567-890-AB, MRN 4455667, call 416-555-0199, M5V 2T6, born 1981-04-02. Her sister Linda will visit.').map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['health card number', 'ID number', 'phone number', 'postal code', 'possible birth date', 'name after a title', 'possible name']));
  });
  it('leaves ordinary ward text alone', () => {
    expect(findIdentifiers('Sister will visit Saturday. Call ODSP and the PGT about the Form 21 by Oct 12.')).toEqual([]);
  });
});

describe('ward views', () => {
  const today = '2026-10-08';
  const ward = sampleWard(today, id, new Date(2026, 9, 8, 12));
  it('makes valid codes', () => {
    expect(CODE_RE.test(makeCode(new Set()))).toBe(true);
  });
  it('lists what is due, urgent first', () => {
    const due = dueItems(ward.patients, ward.forms, ward.referrals, today);
    expect(due[0].urgent).toBe(true);
    const heron = due.find((d) => d.code === 'B4-HERON' && d.kind === 'certificate');
    expect(heron?.text).toContain('mandatory CCB review');
    expect(heron?.due).toBe('2026-10-10');
    expect(due.some((d) => d.kind === 'stale' && d.code === 'B4-HERON')).toBe(true);
    expect(due.some((d) => d.kind === 'task' && d.code === 'T9-CEDAR')).toBe(true);
    expect(due.some((d) => d.kind === 'rai' && d.code === 'M5-FINCH')).toBe(true);
  });
  it('flags stale referrals', () => {
    expect(ward.referrals.filter((r) => isStale(r, today)).map((r) => r.code)).toEqual(['B4-HERON']);
  });
  it('builds a rounds summary', () => {
    const line = roundsLine(ward.patients[0], ward.forms, ward.referrals, today);
    expect(line.legal).toBe('Involuntary · Form 4A, 1st');
    expect(line.alc).toBe(41);
    const text = roundsSummary(line, today, ['Social work to update housing file by Oct 9'], ['Psychiatry', 'Social work']);
    expect(text).toContain('Present: Psychiatry, Social work');
    expect(text).toContain('- Social work to update housing file by Oct 9');
  });
});
