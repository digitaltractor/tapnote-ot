// Fictional sample ward, dated relative to today so the demo always looks current.

import { addDays, addMonths } from './dates';
import { FormRecord, FormType } from './mha';
import { Draft, Patient, Referral, newFormTasks } from './ward';

export interface WardData {
  patients: Patient[];
  forms: FormRecord[];
  referrals: Referral[];
  drafts: Draft[];
}

export function sampleWard(today: string, makeId: () => string, now = new Date()): WardData {
  const created = new Date(now.getTime() - 90 * 86_400_000);
  const patient = (code: string, p: Partial<Patient>): Patient => ({ code, active: true, createdAt: created, ...p });
  const form = (code: string, type: FormType, signedOn: string, seq: number | undefined, done: number, extra: Partial<FormRecord> = {}): FormRecord => {
    const tasks = newFormTasks(type, seq, makeId).map((t, i) => ({ ...t, done: i < done }));
    return { id: makeId(), code, type, signedOn, seq, tasks, createdAt: created, ...extra };
  };
  const referral = (code: string, r: Partial<Referral> & Pick<Referral, 'kind' | 'status' | 'nextAction'>): Referral => ({ id: makeId(), code, createdAt: created, ...r });
  const d = (n: number) => addDays(today, n);
  // A Form 4A signed so that it expires in 2 days: signed = (today + 3) − 3 months.
  const herons4A = addMonths(d(3), -3);

  const patients: Patient[] = [
    patient('B4-HERON', { edd: d(43), alcSince: d(-41), destination: 'Supportive housing', barrier: 'Housing waitlist', owner: 'Social work', raiLast: d(-60) }),
    patient('T9-CEDAR', { barrier: 'No substitute decision-maker identified', owner: 'Social work', raiLast: d(-2) }),
    patient('K2-MAPLE', { edd: d(54), alcSince: d(-70), destination: 'Long-term care', barrier: 'LTC home choices', owner: 'Social work', raiLast: d(-75) }),
    patient('R7-OTTER', { edd: d(22), destination: 'Own apartment with ACT', barrier: 'Community treatment plan', owner: 'Psychiatry', raiLast: d(-30) }),
    patient('M5-FINCH', { edd: d(29), destination: 'Homes for Special Care', barrier: 'Placement offer', owner: 'Social work', raiLast: d(-86) })
  ];

  const forms: FormRecord[] = [
    form('B4-HERON', 'form3', addMonths(d(3), -9), undefined, 3),
    form('B4-HERON', 'form21', addMonths(d(3), -9), undefined, 3),
    form('B4-HERON', 'form4a', herons4A, 1, 3),
    form('T9-CEDAR', 'form3', d(-2), undefined, 2),
    form('T9-CEDAR', 'form33', d(-2), undefined, 2),
    form('K2-MAPLE', 'form4', addMonths(d(14), -2), 2, 3),
    form('R7-OTTER', 'form5', d(-20), undefined, 0)
  ];

  const referrals: Referral[] = [
    referral('B4-HERON', { kind: 'Coordinated Access (housing)', status: 'Waiting', sentOn: d(-128), lastUpdate: d(-62), nextAction: 'Update the application file', owner: 'Social work' }),
    referral('B4-HERON', { kind: 'ODSP', status: 'Planned', nextAction: 'Confirm prescribed class with the local office', nextDue: d(1), owner: 'Social work' }),
    referral('B4-HERON', { kind: 'Public Guardian and Trustee', status: 'Waiting', sentOn: d(-20), lastUpdate: d(-6), nextAction: 'Housing deposit approval', nextDue: d(12), owner: 'Social work' }),
    referral('T9-CEDAR', { kind: 'Family meeting', status: 'Planned', nextAction: 'Book with family and SDM', nextDue: d(6), owner: 'Social work' }),
    referral('K2-MAPLE', { kind: 'Long-term care (Ontario Health atHome)', status: 'Waiting', sentOn: d(-40), lastUpdate: d(-20), nextAction: 'Choose homes with SDM', nextDue: d(7), owner: 'Social work' }),
    referral('R7-OTTER', { kind: 'ACT team', status: 'Accepted', sentOn: d(-30), lastUpdate: d(-8), nextAction: 'Intake meeting', nextDue: d(14), owner: 'Psychiatry' }),
    referral('R7-OTTER', { kind: 'Ontario Works', status: 'Sent', sentOn: d(-10), lastUpdate: d(-10), nextAction: 'Check application status', nextDue: d(8), owner: 'Social work' }),
    referral('M5-FINCH', { kind: 'Homes for Special Care', status: 'Waiting', sentOn: d(-29), lastUpdate: d(-12), nextAction: 'Follow up with the regional office', nextDue: d(4), owner: 'Social work' })
  ];

  const draft = (code: string, p: Partial<Draft>, hoursAgo: number): Draft => ({
    id: makeId(), code, kind: 'contact', serviceDate: today, with: 'Family', how: 'Phone', reported: [], observed: [], plan: [], detail: '',
    author: 'Social work', createdAt: new Date(now.getTime() - hoursAgo * 3_600_000), ...p
  });
  const drafts: Draft[] = [
    draft('K2-MAPLE', { serviceDate: d(-1), with: 'Substitute decision-maker', minutes: 20, reported: ['Prefers a home near the family'], plan: ['Share the home list'] }, 22),
    draft('R7-OTTER', { with: 'Community agency', minutes: 10, reported: ['ACT intake can start the week of discharge'], plan: ['Confirm intake date'] }, 2)
  ];

  return { patients, forms, referrals, drafts };
}
