import { SessionSnapshot, minutes, serviceDelivered } from './types';

export type Severity = 'blocking' | 'warning';
export interface AuditIssue {
  severity: Severity;
  message: string;
}

/** Pre-signature checks modeled on the PA SBAP self-audit record review. Mirrors SelfAudit.swift. */
export function checkSession(
  s: SessionSnapshot,
  sameDay: SessionSnapshot[] = [],
  weeklyAuthorizedMinutes?: number,
  minutesAlreadyThisWeek = 0
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  if (!serviceDelivered(s.attendance)) return issues;

  if (!s.start || !s.end) issues.push({ severity: 'blocking', message: 'Add exact start and end times' });
  else if (minutes(s) == null) issues.push({ severity: 'blocking', message: 'End time must be after start time' });
  if (!s.progress) issues.push({ severity: 'blocking', message: 'Choose a progress indicator' });
  if (s.activities.length === 0 && !s.comment.trim()) {
    issues.push({ severity: 'blocking', message: 'Describe the service: pick an activity or add a comment' });
  }
  if (!s.observations.some((o) => o.total > 0)) issues.push({ severity: 'warning', message: 'No goal data recorded' });
  if (s.groupSize < 1) issues.push({ severity: 'blocking', message: 'Group size must be at least 1' });

  if (s.start && s.end && s.end > s.start) {
    for (const other of sameDay) {
      if (other.id === s.id || !serviceDelivered(other.attendance) || !other.start || !other.end || other.end <= other.start) continue;
      const sameGroup = other.start.getTime() === s.start.getTime() && other.end.getTime() === s.end.getTime() && other.groupSize === s.groupSize && s.groupSize > 1;
      if (!sameGroup && s.start < other.end && other.start < s.end) {
        issues.push({ severity: 'blocking', message: `Overlaps the ${other.studentCode} session` });
      }
    }
  }

  const m = minutes(s);
  if (weeklyAuthorizedMinutes != null && m != null && minutesAlreadyThisWeek + m > weeklyAuthorizedMinutes) {
    issues.push({ severity: 'warning', message: `Exceeds ${weeklyAuthorizedMinutes} authorized minutes this week` });
  }
  return issues;
}

export function isReadyToSign(issues: AuditIssue[]): boolean {
  return !issues.some((i) => i.severity === 'blocking');
}
