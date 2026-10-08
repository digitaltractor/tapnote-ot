// Patients, discharge referrals and contact drafts: the records WardNote keeps. Codes only.

import { addDays, daysBetween } from './dates';
import { FormRecord, defaultTasks, expiry, formName, hearingBy, legalStatus, raiDue } from './mha';

export const ROLES = ['Psychiatry', 'Nursing', 'Social work', 'OT', 'Rec therapy'] as const;
export type Role = (typeof ROLES)[number];

export interface Patient {
  code: string;
  active: boolean;
  /** Estimated date of discharge (day key). */
  edd?: string;
  /** Day the patient was designated ALC (day key). */
  alcSince?: string;
  destination?: string;
  barrier?: string;
  owner?: Role;
  /** Last full RAI-MH assessment (admission, quarterly or change in status). */
  raiLast?: string;
  createdAt: Date;
}

export const REFERRAL_KINDS = [
  'Coordinated Access (housing)', 'ACT team', 'Intensive case management', 'Homes for Special Care',
  'Long-term care (Ontario Health atHome)', 'ODSP', 'Ontario Works', 'Public Guardian and Trustee', 'Family meeting', 'Other'
] as const;

export const REFERRAL_STATUS = ['Planned', 'Sent', 'Waiting', 'Accepted', 'Declined', 'Done'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUS)[number];

export interface Referral {
  id: string;
  code: string;
  kind: string;
  status: ReferralStatus;
  sentOn?: string;
  /** Last time anyone updated the application or heard back. */
  lastUpdate?: string;
  nextAction: string;
  nextDue?: string;
  owner?: Role;
  createdAt: Date;
}

/** Applications that go stale on waitlists if nobody updates them. */
export const STALE_DAYS = 30;
export function isStale(r: Referral, today: string): boolean {
  if (r.status !== 'Sent' && r.status !== 'Waiting') return false;
  const last = r.lastUpdate ?? r.sentOn;
  return !!last && daysBetween(last, today) > STALE_DAYS;
}

export const alcDays = (p: Patient, today: string) => (p.alcSince ? daysBetween(p.alcSince, today) : undefined);

// Contact drafts

export const CONTACT_WITH = ['Patient', 'Family', 'Substitute decision-maker', 'Community agency', 'PGT', 'ODSP', 'Housing', 'Team'] as const;
export const CONTACT_HOW = ['In person', 'Phone', 'Video', 'Email'] as const;

export type DraftKind = 'contact' | 'family';

export interface Draft {
  id: string;
  code: string;
  kind: DraftKind;
  /** Service date (day key), kept apart from when the draft was written. */
  serviceDate: string;
  with: string;
  how: string;
  minutes?: number;
  reported: string[];
  observed: string[];
  plan: string[];
  detail: string;
  /** SBAR fields for family meetings. */
  sbar?: { situation: string; background: string; assessment: string; recommendation: string; attendees: string };
  author: Role;
  createdAt: Date;
  chartedAt?: Date;
  /** Set when text was deleted (charted, or expired without charting). */
  purged?: 'charted' | 'expired';
}

const list = (xs: string[]) => (xs.length ? `${xs.join('; ')}.` : '[none recorded]');

export function composeDraft(d: Draft, serviceDateText: string): string {
  if (d.purged) return '';
  if (d.kind === 'family' && d.sbar) {
    const s = d.sbar;
    return [
      `Family meeting ${serviceDateText}${d.minutes ? `, ${d.minutes} min` : ''}. Attendees (by role): ${s.attendees.trim() || '[attendees]'}.`,
      `S: ${s.situation.trim() || '[situation]'}`,
      `B: ${s.background.trim() || '[background]'}`,
      `A: ${s.assessment.trim() || '[assessment]'}`,
      `R: ${s.recommendation.trim() || '[recommendation and who does what by when]'}`
    ].join('\n');
  }
  const head = `Contact with ${d.with.toLowerCase()} by ${d.how.toLowerCase()}${d.minutes ? `, ${d.minutes} min` : ''}, ${serviceDateText}.`;
  return [head, `Reported: ${list(d.reported)}`, `Observed: ${list(d.observed)}`, `Plan: ${list(d.plan)}`, ...(d.detail.trim() ? [`Detail: ${d.detail.trim()}`] : [])].join('\n');
}

/** Keeps only what isn't note content: who, how, how long, when. */
export function purge(d: Draft, why: 'charted' | 'expired', at = new Date()): Draft {
  return {
    ...d, reported: [], observed: [], plan: [], detail: '', sbar: undefined,
    purged: why, chartedAt: why === 'charted' ? at : d.chartedAt
  };
}

/** Drafts left uncharted longer than `days` are purged (OCSWSSW 4.1.2: drafts not put in the record are destroyed). */
export function expiredDrafts(drafts: Draft[], now: Date, days: number): Draft[] {
  const limit = days * 86_400_000;
  return drafts.filter((d) => !d.purged && now.getTime() - d.createdAt.getTime() > limit);
}

// What's due

export interface DueItem {
  key: string;
  code: string;
  text: string;
  due: string;
  urgent: boolean;
  kind: 'certificate' | 'task' | 'ccb' | 'referral' | 'stale' | 'rai' | 'cto';
}

/** Everything on the ward that needs someone in the next `horizon` days, plus anything overdue. */
export function dueItems(patients: Patient[], forms: FormRecord[], referrals: Referral[], today: string, horizon = 14): DueItem[] {
  const out: DueItem[] = [];
  const until = addDays(today, horizon);
  for (const p of patients.filter((x) => x.active)) {
    const mine = forms.filter((f) => f.code === p.code);
    const st = legalStatus(mine);
    if (st.cert && st.expiry && st.expiry <= until) {
      out.push({
        key: `cert-${st.cert.id}`, code: p.code, kind: 'certificate', due: st.expiry,
        text: `${formName(st.cert)} expires${st.mandatory ? '; mandatory CCB review' : ''}`,
        urgent: daysBetween(today, st.expiry) <= 3
      });
    }
    if (st.cto && st.ctoExpiry && st.ctoExpiry <= addDays(today, 30)) {
      out.push({ key: `cto-${st.cto.id}`, code: p.code, kind: 'cto', due: st.ctoExpiry, text: 'CTO expires; renew or end', urgent: daysBetween(today, st.ctoExpiry) <= 7 });
    }
    for (const f of mine) {
      const open = f.tasks.filter((t) => !t.done);
      const live = f === st.cert || f === st.cto || !['form3', 'form4', 'form4a', 'cto'].includes(f.type);
      if (open.length && live && daysBetween(f.signedOn, today) <= 45) {
        out.push({ key: `task-${f.id}`, code: p.code, kind: 'task', due: addDays(f.signedOn, 2), text: `${formName(f)}: ${open[0].label.charAt(0).toLowerCase()}${open[0].label.slice(1)}${open.length > 1 ? ` (+${open.length - 1} more)` : ''}`, urgent: daysBetween(f.signedOn, today) >= 2 });
      }
      if (f.ccbAppliedOn) {
        const by = hearingBy(f.ccbAppliedOn);
        if (by >= today) out.push({ key: `ccb-${f.id}`, code: p.code, kind: 'ccb', due: by, text: 'CCB hearing must start by', urgent: true });
      }
    }
    if (p.raiLast) {
      const due = raiDue(p.raiLast);
      if (due <= until) out.push({ key: `rai-${p.code}`, code: p.code, kind: 'rai', due, text: 'RAI-MH quarterly', urgent: due < today });
    }
  }
  const activeCodes = new Set(patients.filter((p) => p.active).map((p) => p.code));
  for (const r of referrals.filter((x) => activeCodes.has(x.code) && x.status !== 'Done' && x.status !== 'Declined')) {
    if (isStale(r, today)) {
      const last = r.lastUpdate ?? r.sentOn!;
      out.push({ key: `stale-${r.id}`, code: r.code, kind: 'stale', due: last, text: `${r.kind}: no update in ${daysBetween(last, today)} days`, urgent: true });
    } else if (r.nextDue && r.nextDue <= until) {
      out.push({ key: `ref-${r.id}`, code: r.code, kind: 'referral', due: r.nextDue, text: `${r.kind}: ${r.nextAction || 'next step'}`, urgent: r.nextDue < today });
    }
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.due.localeCompare(b.due) || a.code.localeCompare(b.code));
}

export function newFormTasks(type: FormRecord['type'], seq: number | undefined, makeId: () => string) {
  return defaultTasks(type, seq).map((label) => ({ id: makeId(), label, done: false }));
}

export { expiry };
