// Beta 2: goal mastery, prompt fading, regulation/engagement trends and suggested next steps.
// Everything here is computed from recorded sessions only; suggestions are drafts for the therapist to edit.

import type { PromptLevel, RegulationState } from './types';
import { slope } from './progress';
import type { GoalPoint, GoalProgress } from './progress';

export interface Mastery {
  /** Consecutive sessions at or above criterion, counting back from the latest. */
  streak: number;
  needed: number;
  mastered: boolean;
  /** Session where the current run first reached `needed`. */
  metOn?: Date;
  /** Earliest session where any run reached `needed` (may not have been maintained). */
  firstMetOn?: Date;
}

export function mastery(points: GoalPoint[], criterion: number | undefined, needed = 3): Mastery {
  const n = Math.max(1, Math.round(needed));
  if (criterion == null) return { streak: 0, needed: n, mastered: false };
  let run = 0;
  let firstMetOn: Date | undefined;
  points.forEach((p) => {
    run = p.percent >= criterion ? run + 1 : 0;
    if (run === n && !firstMetOn) firstMetOn = p.date;
  });
  const streak = run;
  const mastered = streak >= n;
  const metOn = mastered ? points[points.length - streak + n - 1].date : undefined;
  return { streak, needed: n, mastered, metOn, firstMetOn };
}

export type Direction = 'fading' | 'increasing' | 'steady' | 'none';

export interface PromptTrend {
  first?: string;
  last?: string;
  direction: Direction;
  /** Share of sessions (with a prompt level) at the lowest-rank level, 0–100. */
  independentShare?: number;
  lastRank?: number;
  /** Next lower enabled level after the latest one, for "fade toward …" text. */
  nextLower?: string;
}

export function promptTrend(points: GoalPoint[], levels: PromptLevel[]): PromptTrend {
  const byName = new Map(levels.map((l) => [l.name.toLowerCase(), l]));
  const ranked = points.flatMap((p) => {
    const l = p.promptLevelName ? byName.get(p.promptLevelName.toLowerCase()) : undefined;
    return l ? [l] : [];
  });
  if (ranked.length === 0) return { direction: 'none' };
  const minRank = Math.min(...levels.map((l) => l.rank));
  const first = ranked[0];
  const last = ranked[ranked.length - 1];
  const s = slope(ranked.map((l) => l.rank));
  const direction: Direction = ranked.length < 2 ? 'none' : s < -0.1 ? 'fading' : s > 0.1 ? 'increasing' : 'steady';
  const lower = levels.filter((l) => l.isEnabled && l.rank < last.rank).sort((a, b) => b.rank - a.rank)[0];
  return {
    first: first.name,
    last: last.name,
    direction,
    independentShare: Math.round((ranked.filter((l) => l.rank === minRank).length * 100) / ranked.length),
    lastRank: last.rank - minRank,
    nextLower: lower?.name
  };
}

export interface StateSession {
  date: Date;
  regulation?: RegulationState;
  engagement?: number;
}

export interface StateTrend {
  rated: number;
  counts: Record<RegulationState, number>;
  /** % of rated sessions in "Calm" (ready to learn), for the first and second half of the period. */
  calmFirst?: number;
  calmSecond?: number;
  calmShare?: number;
  engagementAvg?: number;
  engagementFirst?: number;
  engagementSecond?: number;
  engagementDirection: 'up' | 'down' | 'steady' | 'none';
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const round1 = (x: number | undefined) => (x == null ? undefined : Math.round(x * 10) / 10);
const halves = <T,>(xs: T[]): [T[], T[]] => [xs.slice(0, Math.floor(xs.length / 2)), xs.slice(Math.ceil(xs.length / 2))];

export function stateTrend(sessions: StateSession[]): StateTrend {
  const sorted = [...sessions].sort((a, b) => a.date.getTime() - b.date.getTime());
  const reg = sorted.filter((s) => s.regulation);
  const counts: Record<RegulationState, number> = { Low: 0, Calm: 0, Heightened: 0, High: 0 };
  reg.forEach((s) => counts[s.regulation!]++);
  const calmPct = (xs: StateSession[]) => (xs.length ? Math.round((xs.filter((s) => s.regulation === 'Calm').length * 100) / xs.length) : undefined);
  const [r1, r2] = halves(reg);

  const eng = sorted.filter((s) => s.engagement != null).map((s) => s.engagement!);
  const [e1, e2] = halves(eng);
  const ef = avg(e1);
  const es = avg(e2);
  const engagementDirection = eng.length < 4 || ef == null || es == null ? 'none' : es - ef >= 0.5 ? 'up' : ef - es >= 0.5 ? 'down' : 'steady';

  return {
    rated: reg.length,
    counts,
    calmShare: calmPct(reg),
    calmFirst: reg.length >= 4 ? calmPct(r1) : undefined,
    calmSecond: reg.length >= 4 ? calmPct(r2) : undefined,
    engagementAvg: round1(avg(eng)),
    engagementFirst: round1(ef),
    engagementSecond: round1(es),
    engagementDirection
  };
}

export interface GoalInsight {
  mastery: Mastery;
  prompts: PromptTrend;
  /** Sessions to reach criterion at the current rate, when progressing and plausible. */
  sessionsToCriterion?: number;
  nextSteps: string[];
}

const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function goalInsight(p: GoalProgress, levels: PromptLevel[], needed = 3): GoalInsight {
  const crit = p.goal.criterionPercent;
  const m = mastery(p.points, crit, needed);
  const prompts = promptTrend(p.points, levels);
  const steps: string[] = [];
  const last = p.points[p.points.length - 1];
  const rate = slope(p.points.map((x) => x.percent));
  let sessionsToCriterion: number | undefined;

  if (p.points.length < 2) {
    steps.push('Collect data in at least 3 sessions before the next report.');
  } else if (m.mastered) {
    steps.push(`Criterion met in ${m.streak} consecutive sessions${m.metOn ? ` (since ${fmt(m.metOn)})` : ''}.`);
    if (prompts.lastRank && prompts.lastRank > 0) steps.push(`Fade ${prompts.last!.toLowerCase()} prompting${prompts.nextLower ? ` toward ${prompts.nextLower.toLowerCase()}` : ''} while keeping accuracy at criterion.`);
    else steps.push('Check carryover in the classroom with the teacher; consider a new goal or reduced service at the next IEP review.');
  } else {
    if (m.firstMetOn) steps.push(`Criterion was reached on ${fmt(m.firstMetOn)} but not maintained; continue practice for consistency across ${m.needed} sessions.`);
    if (p.status === 'Progressing') {
      if (crit != null && last && rate > 0.5) {
        const n = Math.ceil((crit - last.percent) / rate);
        if (n > 0 && n <= 40) sessionsToCriterion = n;
      }
      if (prompts.direction === 'fading') steps.push('Continue the current plan; prompting is fading as accuracy improves.');
      else if (prompts.direction === 'increasing') steps.push('Accuracy is improving but with more support; check whether the task is too hard or prompts are being added too quickly.');
      else if (prompts.lastRank && prompts.lastRank > 0) steps.push(`Continue the current approach and begin fading from ${prompts.last!.toLowerCase()} prompts${prompts.nextLower ? ` to ${prompts.nextLower.toLowerCase()}` : ''}.`);
      else steps.push('Continue the current plan.');
      if (sessionsToCriterion) steps.push(`At the current rate, criterion is about ${sessionsToCriterion} session${sessionsToCriterion === 1 ? '' : 's'} away.`);
    } else if (p.status === 'Not progressing') {
      steps.push('Review task difficulty and try a different strategy, materials or accommodation.');
      if (prompts.direction === 'increasing') steps.push('Prompt dependence is increasing; plan a prompt-fading sequence.');
      steps.push('If there is no change by the next report, discuss with the IEP team.');
    } else if (p.status === 'Goal met') {
      steps.push(`Latest session met criterion; confirm across ${m.needed} consecutive sessions before calling it mastered.`);
    }
  }
  return { mastery: m, prompts, sessionsToCriterion, nextSteps: steps };
}

/** Student-level suggestions from regulation and engagement. */
export function stateNextSteps(t: StateTrend): string[] {
  const out: string[] = [];
  if (t.rated >= 3 && t.calmShare != null && t.calmShare < 50) {
    const off = t.rated - t.counts.Calm;
    out.push(`Regulation was a barrier in ${off} of ${t.rated} rated sessions; build in regulation supports before skill work.`);
  }
  if (t.engagementDirection === 'down') out.push('Engagement dropped across the period; review motivation, activity choice and session timing.');
  return out;
}

export function describeState(t: StateTrend): string | undefined {
  const parts: string[] = [];
  if (t.rated > 0) {
    let s = `Calm and ready to learn in ${t.counts.Calm} of ${t.rated} rated sessions`;
    if (t.calmFirst != null && t.calmSecond != null && t.calmFirst !== t.calmSecond) s += ` (${t.calmFirst}% early in the period, ${t.calmSecond}% later)`;
    parts.push(`${s}.`);
  }
  if (t.engagementAvg != null) {
    let s = `Average engagement ${t.engagementAvg}/5`;
    if (t.engagementDirection === 'up' || t.engagementDirection === 'down') s += `, ${t.engagementDirection === 'up' ? 'rising' : 'falling'} from ${t.engagementFirst} to ${t.engagementSecond}`;
    parts.push(`${s}.`);
  }
  return parts.length ? parts.join(' ') : undefined;
}
