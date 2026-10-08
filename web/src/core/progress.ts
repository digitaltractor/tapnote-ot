import { GoalSnapshot, SessionSnapshot, observationFor, percent, serviceDelivered } from './types';
import { TimeStyle } from './time';

export type ReportPeriod = 'month' | 'quarter' | 'year' | 'custom';
export const REPORT_PERIOD_LABEL: Record<ReportPeriod, string> = { month: 'Month', quarter: 'Quarter', year: 'Year', custom: 'Custom' };

export function periodRange(period: ReportPeriod, end: Date): { start: Date; end: Date } {
  const months = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
  const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
  const start = new Date(end.getFullYear(), end.getMonth() - months, end.getDate());
  return { start, end: endOfDay };
}

export type GoalStatus = 'Goal met' | 'Progressing' | 'Not progressing' | 'Not enough data';

export interface GoalPoint {
  date: Date;
  percent: number;
  promptLevelName?: string;
}

export interface GoalProgress {
  goal: GoalSnapshot;
  points: GoalPoint[];
  status: GoalStatus;
  narrative: string;
  average?: number;
}

/** Least-squares slope in percentage points per session. */
export function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

/** Summarizes one goal over a period from recorded sessions only. Mirrors ProgressReport.swift. */
export function goalProgress(goal: GoalSnapshot, sessions: SessionSnapshot[], range: { start: Date; end: Date }, periodLabel: string, time = new TimeStyle()): GoalProgress {
  const points: GoalPoint[] = sessions
    .filter((s) => s.date >= range.start && s.date <= range.end && serviceDelivered(s.attendance))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .flatMap((s) => {
      const obs = observationFor(s, goal);
      const pct = percent(obs);
      return obs && pct != null ? [{ date: s.date, percent: pct, promptLevelName: obs.promptLevelName }] : [];
    });

  if (points.length < 2) {
    const narrative = points.length === 0
      ? `No data recorded for goal ${goal.number} (${goal.shortName}) this ${periodLabel}. [Add context]`
      : `One session of data for goal ${goal.number} (${goal.shortName}) this ${periodLabel}: ${points[0].percent}% correct. [Add context]`;
    return { goal, points, status: 'Not enough data', narrative, average: points[0]?.percent };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const average = Math.round(points.reduce((a, p) => a + p.percent, 0) / points.length);
  let status: GoalStatus;
  if (goal.criterionPercent != null && last.percent >= goal.criterionPercent) status = 'Goal met';
  else if (slope(points.map((p) => p.percent)) > 0.5) status = 'Progressing';
  else status = 'Not progressing';

  let text = `Across ${points.length} sessions this ${periodLabel} (${time.date(first.date)}–${time.date(last.date)}), accuracy on ${goal.shortName.toLowerCase()} went from ${first.percent}% to ${last.percent}% (average ${average}%)`;
  if (goal.criterionPercent != null) text += ` against a ${goal.criterionPercent}% criterion`;
  text += '.';
  if (first.promptLevelName && last.promptLevelName && first.promptLevelName !== last.promptLevelName) {
    text += ` Prompting changed from ${first.promptLevelName.toLowerCase()} to ${last.promptLevelName.toLowerCase()}.`;
  }
  text += ' [Add classroom observations and next steps]';
  return { goal, points, status, narrative: text, average };
}
