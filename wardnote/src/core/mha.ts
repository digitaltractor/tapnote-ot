// Ontario Mental Health Act forms the ward tracks, and the dates computed from them.
// Durations follow the MHA and Reg. 741 as summarized by the Consent and Capacity Board and Ministry guides;
// the "period minus one day" expiry is a common hospital convention. Check both against hospital policy.

import { addDays, addMonths, daysBetween, short } from './dates';

export type FormType = 'form1' | 'form3' | 'form4' | 'form4a' | 'form5' | 'form33' | 'form21' | 'form24' | 'cto';

export const FORM_INFO: Record<FormType, { label: string; short: string; certificate: boolean }> = {
  form1: { label: 'Form 1 · application for psychiatric assessment', short: 'Form 1', certificate: false },
  form3: { label: 'Form 3 · certificate of involuntary admission', short: 'Form 3', certificate: true },
  form4: { label: 'Form 4 · certificate of renewal', short: 'Form 4', certificate: true },
  form4a: { label: 'Form 4A · certificate of continuation', short: 'Form 4A', certificate: true },
  form5: { label: 'Form 5 · change to voluntary status', short: 'Form 5', certificate: false },
  form33: { label: 'Form 33 · notice of incapacity (treatment or PHI)', short: 'Form 33', certificate: false },
  form21: { label: 'Form 21 · incapacity to manage property', short: 'Form 21', certificate: false },
  form24: { label: 'Form 24 · continuance of property incapacity at discharge', short: 'Form 24', certificate: false },
  cto: { label: 'Form 45 · community treatment order', short: 'CTO', certificate: false }
};

export const FORM_TYPES = Object.keys(FORM_INFO) as FormType[];

export interface Task {
  id: string;
  label: string;
  done: boolean;
}

export interface FormRecord {
  id: string;
  code: string;
  type: FormType;
  /** Day the physician signed it (day key). */
  signedOn: string;
  /** Renewal number for Form 4 (1–3), continuation number for Form 4A (1+), renewal number for a CTO (0 = first order). */
  seq?: number;
  tasks: Task[];
  /** Patient applied to the Consent and Capacity Board (day key). */
  ccbAppliedOn?: string;
  note?: string;
  createdAt: Date;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function formName(f: Pick<FormRecord, 'type' | 'seq'>): string {
  const base = FORM_INFO[f.type].short;
  if (f.type === 'form4' || f.type === 'form4a') return `${base}, ${ordinal(f.seq ?? 1)}`;
  if (f.type === 'cto') return (f.seq ?? 0) === 0 ? 'CTO' : `CTO, ${ordinal(f.seq!)} renewal`;
  return base;
}

/** Months a Form 4 renewal lasts: 1st 1 month, 2nd 2 months, 3rd 3 months. */
const form4Months = (seq: number) => Math.min(Math.max(seq, 1), 3);

/** Last day the form is in force, or undefined when it has no fixed end. */
export function expiry(f: Pick<FormRecord, 'type' | 'seq' | 'signedOn'>): string | undefined {
  switch (f.type) {
    case 'form1': return addDays(f.signedOn, 3); // 72 hours from arrival at the facility: check the exact time
    case 'form3': return addDays(f.signedOn, 13); // up to 14 days
    case 'form4': return addDays(addMonths(f.signedOn, form4Months(f.seq ?? 1)), -1);
    case 'form4a': return addDays(addMonths(f.signedOn, 3), -1);
    case 'cto': return addDays(addMonths(f.signedOn, 6), -1);
    default: return undefined;
  }
}

export function calcText(f: Pick<FormRecord, 'type' | 'seq' | 'signedOn'>): string {
  const s = short(f.signedOn);
  switch (f.type) {
    case 'form1': return `Signed ${s}. Detention for assessment ends 72 hours after arrival at the facility; check the exact time.`;
    case 'form3': return `Signed ${s} + 14 days, minus 1 day.`;
    case 'form4': { const m = form4Months(f.seq ?? 1); return `Signed ${s} + ${m} month${m === 1 ? '' : 's'}, minus 1 day (${formName(f)} renewal).`; }
    case 'form4a': return `Signed ${s} + 3 months, minus 1 day.`;
    case 'cto': return `Issued ${s} + 6 months, minus 1 day. Renew before expiry or within 1 month after.`;
    default: return `Signed ${s}. No fixed end date.`;
  }
}

/**
 * Mandatory Consent and Capacity Board review: on completion of the 1st Form 4A and every 4th after it
 * (1st, 5th, 9th…), and for a CTO on the 2nd renewal and every 2nd after it.
 */
export function mandatoryReview(f: Pick<FormRecord, 'type' | 'seq'>): boolean {
  if (f.type === 'form4a') return ((f.seq ?? 1) - 1) % 4 === 0;
  if (f.type === 'cto') return (f.seq ?? 0) >= 2 && (f.seq ?? 0) % 2 === 0;
  return false;
}

/** The form that normally follows this one in the involuntary chain. */
export function nextInChain(f: Pick<FormRecord, 'type' | 'seq'>): { type: FormType; seq?: number } | undefined {
  if (f.type === 'form3') return { type: 'form4', seq: 1 };
  if (f.type === 'form4') return (f.seq ?? 1) >= 3 ? { type: 'form4a', seq: 1 } : { type: 'form4', seq: (f.seq ?? 1) + 1 };
  if (f.type === 'form4a') return { type: 'form4a', seq: (f.seq ?? 1) + 1 };
  if (f.type === 'cto') return { type: 'cto', seq: (f.seq ?? 0) + 1 };
  return undefined;
}

export function defaultTasks(type: FormType, seq?: number): string[] {
  switch (type) {
    case 'form1': return ['Give Form 42 to the person', 'Decide by 72 hours: discharge, voluntary or Form 3'];
    case 'form3':
    case 'form4':
    case 'form4a': {
      const list = ['Give Form 30 to the patient', 'Notify the rights adviser', 'Get Form 50 back'];
      if (mandatoryReview({ type, seq })) list.push('Send Form 17 to the CCB (mandatory review)');
      return list;
    }
    case 'form33': return ['Give Form 33 to the patient', 'Notify the rights adviser', 'Get Form 50 back', 'Identify the substitute decision-maker'];
    case 'form21': return ['Give Form 33 (property)', 'Notify the rights adviser', 'Send the certificate to the PGT'];
    case 'form24': return ['Give Form 33 (property)', 'Notify the rights adviser', 'Send the notice to the PGT'];
    case 'cto': {
      const list = ['Give Form 49; arrange rights advice', 'Get the community treatment plan signed', 'Confirm community providers', 'Give Form 46'];
      if (mandatoryReview({ type, seq })) list.push('Request the CCB review (mandatory)');
      return list;
    }
    case 'form5': return [];
  }
}

const CERT: FormType[] = ['form3', 'form4', 'form4a'];

export interface LegalStatus {
  involuntary: boolean;
  /** Current certificate, when involuntary. */
  cert?: FormRecord;
  expiry?: string;
  mandatory: boolean;
  cto?: FormRecord;
  ctoExpiry?: string;
}

/** Current status from the form history: the latest certificate stands unless a later Form 5 ends it. */
export function legalStatus(forms: FormRecord[]): LegalStatus {
  const sorted = [...forms].sort((a, b) => a.signedOn.localeCompare(b.signedOn) || a.createdAt.getTime() - b.createdAt.getTime());
  let cert: FormRecord | undefined;
  let cto: FormRecord | undefined;
  for (const f of sorted) {
    if (CERT.includes(f.type)) cert = f;
    if (f.type === 'form5') cert = undefined;
    if (f.type === 'cto') cto = f;
  }
  return {
    involuntary: !!cert,
    cert,
    expiry: cert ? expiry(cert) : undefined,
    mandatory: cert ? mandatoryReview(cert) : false,
    cto,
    ctoExpiry: cto ? expiry(cto) : undefined
  };
}

export function statusLabel(s: LegalStatus): string {
  if (s.cert) return `Involuntary · ${formName(s.cert)}`;
  if (s.cto) return `Voluntary · ${formName(s.cto)}`;
  return 'Voluntary';
}

/** A CCB hearing must begin within 7 days of the Board receiving the application. */
export const hearingBy = (appliedOn: string) => addDays(appliedOn, 7);

/** RAI-MH quarterly assessment is due within 92 days of the last full assessment (CIHI OMHRS). */
export const raiDue = (lastFull: string) => addDays(lastFull, 92);

export const daysLeft = (today: string, k: string) => daysBetween(today, k);
