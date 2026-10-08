import { long, short } from './dates';
import { FormRecord, legalStatus, statusLabel } from './mha';
import { Patient, Referral, alcDays } from './ward';

export interface RoundsLine {
  code: string;
  legal: string;
  legalNext?: string;
  edd?: string;
  alc?: number;
  barrier?: string;
  owner?: string;
  next?: Referral;
}

export function roundsLine(p: Patient, forms: FormRecord[], referrals: Referral[], today: string): RoundsLine {
  const st = legalStatus(forms.filter((f) => f.code === p.code));
  const open = referrals
    .filter((r) => r.code === p.code && r.status !== 'Done' && r.status !== 'Declined' && r.nextDue)
    .sort((a, b) => a.nextDue!.localeCompare(b.nextDue!));
  return {
    code: p.code,
    legal: statusLabel(st),
    legalNext: st.expiry ? `expires ${short(st.expiry)}${st.mandatory ? ' · CCB review' : ''}` : st.ctoExpiry ? `CTO to ${short(st.ctoExpiry)}` : undefined,
    edd: p.edd,
    alc: alcDays(p, today),
    barrier: p.barrier,
    owner: p.owner,
    next: open[0]
  };
}

/** After-rounds summary each discipline can paste into its own Cerner note. */
export function roundsSummary(line: RoundsLine, today: string, decisions: string[], present: string[]): string {
  const lines = [
    `Interdisciplinary rounds ${long(today)}. Present: ${present.length ? present.join(', ') : '[disciplines present]'}.`,
    `Status: ${line.legal}${line.legalNext ? ` (${line.legalNext})` : ''}. EDD: ${line.edd ? long(line.edd) : 'not set'}${line.alc != null ? `. ALC ${line.alc} days` : ''}.`,
    `Main barrier: ${line.barrier || 'none recorded'}.`,
    'Decisions:'
  ];
  const ds = decisions.map((d) => d.trim()).filter(Boolean);
  lines.push(...(ds.length ? ds.map((d) => `- ${d}`) : ['- [decision, owner, date]']));
  return lines.join('\n');
}
