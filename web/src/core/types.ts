// Core domain types. These mirror the Swift package (Packages/TapNoteCore) and the
// JSON shapes in the encrypted backup, so a backup made on iOS restores here and vice versa.

export interface PromptLevel {
  id: string;
  name: string;
  shortName: string;
  rank: number;
  isEnabled: boolean;
}

export const DEFAULT_PROMPT_LEVELS: PromptLevel[] = [
  { id: 'independent', name: 'Independent', shortName: 'Ind', rank: 0, isEnabled: true },
  { id: 'verbal', name: 'Verbal', shortName: 'Verbal', rank: 1, isEnabled: true },
  { id: 'gestural', name: 'Gestural', shortName: 'Gesture', rank: 2, isEnabled: true },
  { id: 'visual', name: 'Visual', shortName: 'Visual', rank: 3, isEnabled: true },
  { id: 'model', name: 'Model', shortName: 'Model', rank: 4, isEnabled: true },
  { id: 'partial-physical', name: 'Partial physical', shortName: 'Partial', rank: 5, isEnabled: true },
  { id: 'full-physical', name: 'Full physical', shortName: 'Full', rank: 6, isEnabled: true }
];

/** Generic four-state regulation scale (not the trademarked program name). Stored as these strings. */
export const REGULATION_STATES = ['Low', 'Calm', 'Heightened', 'High'] as const;
export type RegulationState = (typeof REGULATION_STATES)[number];

export const PROGRESS_INDICATORS = ['mastering', 'progressing', 'maintaining', 'inconsistent', 'regressing'] as const;
export type ProgressIndicator = (typeof PROGRESS_INDICATORS)[number];

export const PROGRESS_LABEL: Record<ProgressIndicator, string> = {
  mastering: 'Mastering',
  progressing: 'Progressing',
  maintaining: 'Maintaining',
  inconsistent: 'Inconsistent',
  regressing: 'Regressing'
};

/** Codes from the PA SBAP OT service log progress key. */
export const PROGRESS_SBAP: Record<ProgressIndicator, string> = {
  mastering: 'Ms',
  progressing: 'Pr',
  maintaining: 'Mn',
  inconsistent: 'In',
  regressing: 'Rg'
};

export const ATTENDANCE = ['present', 'studentAbsent', 'studentNotAvailable', 'providerAbsent', 'providerNotAvailable'] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  present: 'Present',
  studentAbsent: 'Student absent',
  studentNotAvailable: 'Student not available',
  providerAbsent: 'Therapist absent',
  providerNotAvailable: 'Therapist not available'
};

export const DELIVERY = ['inPerson', 'telehealthNotHome', 'telehealthHome'] as const;
export type Delivery = (typeof DELIVERY)[number];

export const DELIVERY_LABEL: Record<Delivery, string> = {
  inPerson: 'In person',
  telehealthNotHome: 'Telehealth (at school)',
  telehealthHome: 'Telehealth (at home)'
};

export function serviceDelivered(a: Attendance): boolean {
  return a === 'present';
}

/** The SBAP "Service Type" column. */
export function sbapServiceType(attendance: Attendance, delivery: Delivery, isMakeUp: boolean): string {
  switch (attendance) {
    case 'studentAbsent': return 'SA';
    case 'studentNotAvailable': return 'SNA';
    case 'providerAbsent': return 'PA';
    case 'providerNotAvailable': return 'PNA';
    case 'present':
      switch (delivery) {
        case 'inPerson': return isMakeUp ? 'DM' : 'D';
        case 'telehealthNotHome': return isMakeUp ? '02M' : '02';
        case 'telehealthHome': return isMakeUp ? '10M' : '10';
      }
  }
}

export interface Activity {
  id: string;
  name: string;
  sbapKey?: number;
}

/** Keys 12, 19, 41 and 51 come from the SBAP OT Service Provider Log (rev. 04/2025); add others in Settings. */
export const STARTER_ACTIVITIES: Activity[] = [
  { id: 'sbap-19', name: 'Handwriting control', sbapKey: 19 },
  { id: 'sbap-12', name: 'Grasp / release', sbapKey: 12 },
  { id: 'sbap-51', name: 'Visual perception', sbapKey: 51 },
  { id: 'sbap-41', name: 'Self-regulation', sbapKey: 41 },
  { id: 'scissor-skills', name: 'Scissor skills' },
  { id: 'bilateral-coordination', name: 'Bilateral coordination' },
  { id: 'fine-motor-strength', name: 'Fine motor strengthening' },
  { id: 'self-care', name: 'Self-care skills' }
];

export const NOTE_FORMATS = ['soap', 'narrative', 'dap'] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];
export const NOTE_FORMAT_LABEL: Record<NoteFormat, string> = { soap: 'SOAP', narrative: 'Narrative', dap: 'DAP' };

export interface GoalSnapshot {
  id: string;
  number: number;
  shortName: string;
  detail: string;
  criterionPercent?: number;
}

export interface GoalObservation {
  goalID: string;
  correct: number;
  total: number;
  promptLevelName?: string;
}

export function percent(o: GoalObservation | undefined): number | undefined {
  if (!o || o.total <= 0) return undefined;
  return Math.round((o.correct * 100) / o.total);
}

export interface SessionSnapshot {
  id: string;
  studentCode: string;
  studentAlias: string;
  date: Date;
  start?: Date;
  end?: Date;
  plannedMinutes: number;
  groupSize: number;
  attendance: Attendance;
  delivery: Delivery;
  isMakeUp: boolean;
  activities: Activity[];
  goals: GoalSnapshot[];
  observations: GoalObservation[];
  regulation?: RegulationState;
  engagement?: number;
  progress?: ProgressIndicator;
  comment: string;
  signedAt?: Date;
}

/** Exact whole minutes between start and end, never rounded up (SBAP rule). */
export function minutes(s: Pick<SessionSnapshot, 'start' | 'end'>): number | undefined {
  if (!s.start || !s.end || s.end <= s.start) return undefined;
  return Math.floor((s.end.getTime() - s.start.getTime()) / 60000);
}

export function serviceType(s: SessionSnapshot): string {
  return sbapServiceType(s.attendance, s.delivery, s.isMakeUp);
}

export function observationFor(s: SessionSnapshot, goal: GoalSnapshot): GoalObservation | undefined {
  return s.observations.find((o) => o.goalID === goal.id);
}

export interface StudentIdentity {
  realName: string;
  dateOfBirth: string;
  paSecureID: string;
  diagnosis: string;
}

export const emptyIdentity = (): StudentIdentity => ({ realName: '', dateOfBirth: '', paSecureID: '', diagnosis: '' });
