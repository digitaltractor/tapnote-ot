import {
  ATTENDANCE_LABEL, DELIVERY_LABEL, NoteFormat, PROGRESS_LABEL, SessionSnapshot,
  minutes, observationFor, percent, serviceDelivered, serviceType
} from './types';
import { TimeStyle } from './time';

export interface NoteSection {
  title: string;
  text: string;
}

export interface ComposedNote {
  format: NoteFormat;
  sections: NoteSection[];
  /** Items the template couldn't fill from data. Shown, never invented. */
  missing: string[];
}

export function plainText(note: ComposedNote): string {
  return note.sections.map((s) => (s.title ? `${s.title}: ${s.text}` : s.text)).join('\n\n');
}

/** Fact-only session note from structured capture data. Mirrors NoteComposer.swift. */
export function composeNote(s: SessionSnapshot, format: NoteFormat, time = new TimeStyle()): ComposedNote {
  const missing: string[] = [];

  if (!serviceDelivered(s.attendance)) {
    const text = `${ATTENDANCE_LABEL[s.attendance]} (${serviceType(s)}). No service delivered; ${s.plannedMinutes} scheduled minutes logged for make-up.`;
    return { format, sections: [{ title: '', text }], missing: [] };
  }

  const subjective: string[] = [];
  if (s.regulation) subjective.push(`Presented ${s.regulation.toLowerCase()} on arrival.`);
  else missing.push('Regulation state');
  if (s.engagement != null) subjective.push(`Engagement ${s.engagement}/5.`);
  else missing.push('Engagement rating');
  const subjectiveText = subjective.length ? subjective.join(' ') : '[Add presentation]';

  const objective: string[] = [];
  const setting = s.groupSize > 1 ? `Group session (${s.groupSize} students)` : 'Individual session';
  const mins = minutes(s);
  if (s.start && s.end && mins != null) {
    objective.push(`${setting}, ${DELIVERY_LABEL[s.delivery].toLowerCase()}, ${time.time(s.start)}–${time.time(s.end)} (${mins} min)${s.isMakeUp ? ', make-up session' : ''}.`);
  } else {
    objective.push(`${setting}, ${DELIVERY_LABEL[s.delivery].toLowerCase()}.`);
    missing.push('Start and end time');
  }
  if (s.activities.length === 0) missing.push('Activities');
  else objective.push(`Activities: ${s.activities.map((a) => a.name.toLowerCase()).join(', ')}.`);

  const goals = [...s.goals].sort((a, b) => a.number - b.number);
  let anyGoal = false;
  for (const goal of goals) {
    const obs = observationFor(s, goal);
    const pct = percent(obs);
    if (!obs || pct == null) continue;
    anyGoal = true;
    let line = `Goal ${goal.number} (${goal.shortName}): ${obs.correct}/${obs.total} trials correct (${pct}%)`;
    if (obs.promptLevelName) {
      line += obs.promptLevelName === 'Independent' ? ', independent' : ` with ${obs.promptLevelName.toLowerCase()} prompts`;
    }
    objective.push(line + '.');
  }
  if (!anyGoal) missing.push('Goal trial data');
  const comment = s.comment.trim();
  if (comment) objective.push(`Therapist comment: ${comment}`);
  const objectiveText = objective.join(' ');

  const assessment: string[] = [];
  if (s.progress) assessment.push(`Session progress: ${PROGRESS_LABEL[s.progress].toLowerCase()}.`);
  else missing.push('Progress indicator');
  for (const goal of goals) {
    const pct = percent(observationFor(s, goal));
    if (goal.criterionPercent == null || pct == null) continue;
    assessment.push(`Goal ${goal.number} accuracy (${pct}%) ${pct >= goal.criterionPercent ? 'meets' : 'is below'} the ${goal.criterionPercent}% criterion.`);
  }
  const assessmentText = assessment.length ? assessment.join(' ') : '[Add assessment]';
  const planText = 'Continue IEP goals per the current service plan. [Add plan details]';

  let sections: NoteSection[];
  switch (format) {
    case 'soap':
      sections = [
        { title: 'S', text: subjectiveText },
        { title: 'O', text: objectiveText },
        { title: 'A', text: assessmentText },
        { title: 'P', text: planText }
      ];
      break;
    case 'dap':
      sections = [
        { title: 'D', text: `${subjectiveText} ${objectiveText}` },
        { title: 'A', text: assessmentText },
        { title: 'P', text: planText }
      ];
      break;
    case 'narrative':
      sections = [{ title: '', text: [subjectiveText, objectiveText, assessmentText, planText].join(' ') }];
      break;
  }
  return { format, sections, missing };
}
