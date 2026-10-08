import type { Activity } from './types';

/**
 * Treatment keys from the PA SBAP Occupational Therapy Service Provider Log.
 * Transcribed from the form revision dated 09/19/2023. PA DHS posted a 04/04/2025 revision;
 * verify against the current form before relying on these for billing.
 */
export const SBAP_OT_KEYS_SOURCE = 'PA SBAP OT Service Provider Log, rev. 09/19/2023 — verify against the current form';

export const SBAP_OT_KEYS: { key: number; category: string; label: string }[] = [
  { key: 1, category: 'Assistive Technology', label: 'Access to Device' },
  { key: 2, category: 'Assistive Technology', label: 'Student Training' },
  { key: 3, category: 'Domestic Maintenance', label: 'Adaptive Activities' },
  { key: 4, category: 'Equipment', label: 'Splint/Orthotic/Prosthetic Check' },
  { key: 5, category: 'Equipment', label: 'Splint/Orthotic/Prosthetic Training' },
  { key: 6, category: 'Equipment', label: 'Student Training' },
  { key: 7, category: 'Equipment', label: 'Student Training: Headstick, Dowel Pointer, Mouthstick, Switch' },
  { key: 8, category: 'Fine Motor/Upper Extremity', label: 'Functional Range of Motion' },
  { key: 9, category: 'Fine Motor', label: 'Bilateral Hand Coordination' },
  { key: 10, category: 'Fine Motor', label: 'Desktop Manipulatives' },
  { key: 11, category: 'Fine Motor', label: 'Finger Isolation' },
  { key: 12, category: 'Fine Motor', label: 'Grasp/Release' },
  { key: 13, category: 'Fine Motor', label: 'In-Hand Manipulation' },
  { key: 14, category: 'Fine Motor', label: 'One-Handed Strategies' },
  { key: 15, category: 'Fine Motor', label: 'Strengthening/Endurance' },
  { key: 16, category: 'Functional Academics', label: 'Adaptive Handwriting/Writing Accommodations' },
  { key: 17, category: 'Functional Academics', label: 'Adaptive Handwriting/Writing Implement' },
  { key: 18, category: 'Functional Academics', label: 'Adaptive Handwriting/Writing Surface' },
  { key: 19, category: 'Functional Academics', label: 'Handwriting Control/Coordination' },
  { key: 20, category: 'Mobility', label: 'Grasp of Ambulation Device' },
  { key: 21, category: 'Mobility', label: 'Transfer Training' },
  { key: 22, category: 'Mobility', label: 'Transition Training' },
  { key: 23, category: 'Mobility', label: 'Wheelchair Mobility' },
  { key: 24, category: 'Mobility', label: 'Fine' },
  { key: 25, category: 'Mobility', label: 'Gross' },
  { key: 26, category: 'Neuromuscular Development', label: 'Head Control' },
  { key: 27, category: 'Neuromuscular Development', label: 'Lower Extremity' },
  { key: 28, category: 'Neuromuscular Development', label: 'Trunk Control' },
  { key: 29, category: 'Neuromuscular Development', label: 'Upper Extremity' },
  { key: 30, category: 'Personal Maintenance', label: 'Adaptive Dressing Skills' },
  { key: 31, category: 'Personal Maintenance', label: 'Adaptive Grooming/Hygiene' },
  { key: 32, category: 'Personal Maintenance', label: 'Therapeutic Feeding' },
  { key: 33, category: 'Personal Maintenance', label: 'Toileting' },
  { key: 34, category: 'Positioning', label: 'Adaptive Seating' },
  { key: 35, category: 'Positioning', label: 'Adaptive Standing' },
  { key: 36, category: 'Positioning', label: 'Alternative Device' },
  { key: 37, category: 'Recreation/Leisure', label: 'Adaptive Activities' },
  { key: 38, category: 'Relaxation/Facilitation', label: 'Relaxation/Facilitation Techniques' },
  { key: 39, category: 'Sensory Processing', label: 'Classroom Focusing/Attending Skills' },
  { key: 40, category: 'Sensory Processing', label: 'Management of Classroom Tools/Materials' },
  { key: 41, category: 'Sensory Processing', label: 'Self-Regulation Skills' },
  { key: 42, category: 'Sensory Processing', label: 'Transition Behaviors' },
  { key: 43, category: 'Therapeutic Exercise', label: 'Coordination Activities' },
  { key: 44, category: 'Therapeutic Exercise', label: 'Endurance Training' },
  { key: 45, category: 'Therapeutic Exercise', label: 'Functional Range of Motion' },
  { key: 46, category: 'Therapeutic Exercise', label: 'Muscle Strengthening' },
  { key: 47, category: 'Therapeutic Exercise', label: 'Organization/Motor Planning/Spatial Concepts' },
  { key: 48, category: 'Therapeutic Exercise', label: 'Stretching' },
  { key: 49, category: 'Vocational', label: 'Adaptive Activities' },
  { key: 50, category: 'Visual', label: 'Motor Skills' },
  { key: 51, category: 'Visual', label: 'Perception Skills' },
  { key: 52, category: 'Psycho-Social', label: 'Psycho-Social Skills' },
  { key: 53, category: 'Environmental', label: 'Environmental Adaptations' }
];

/** Activity for an SBAP key, with an id that matches the starter catalog (sbap-<key>). */
export function sbapActivity(key: number): Activity | undefined {
  const k = SBAP_OT_KEYS.find((x) => x.key === key);
  if (!k) return undefined;
  const name = k.label === k.category || k.label.startsWith(k.category) ? k.label : `${k.category}: ${k.label}`;
  return { id: `sbap-${k.key}`, name, sbapKey: k.key };
}
