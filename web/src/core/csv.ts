import { PROGRESS_SBAP, SessionSnapshot, StudentIdentity, serviceDelivered, serviceType } from './types';
import { composeNote, plainText } from './notes';
import { TimeStyle } from './time';

export const PSEUDONYMOUS_HEADER = ['Student Code', 'Date', 'Start', 'End', 'Treatment Key', 'Group Size', 'Service Type', 'Progress Indicator', 'Description'];
export const IDENTIFIED_HEADER = ['Student Name', 'DOB', 'PA Secure ID', ...PSEUDONYMOUS_HEADER];

/** Neutralizes spreadsheet formula injection and quotes when needed. */
export function csvField(field: string): string {
  let v = field;
  if (v.length > 0 && '=+-@'.includes(v[0])) v = "'" + v;
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function toCSV(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** CSV shaped like the PA SBAP OT Service Provider Log. Mirrors SBAPExport.swift. */
export function sbapCSV(
  sessions: SessionSnapshot[],
  opts: { time?: TimeStyle; noteText?: (s: SessionSnapshot) => string | undefined; identity?: (code: string) => StudentIdentity | undefined } = {}
): string {
  const time = opts.time ?? new TimeStyle();
  const rows: string[][] = [opts.identity ? IDENTIFIED_HEADER : PSEUDONYMOUS_HEADER];
  const key = (s: SessionSnapshot) => (s.start ?? s.date).getTime();
  const ordered = [...sessions].sort((a, b) => key(a) - key(b) || a.studentCode.localeCompare(b.studentCode));
  for (const s of ordered) {
    const keys = s.activities.filter((a) => a.sbapKey != null).map((a) => String(a.sbapKey)).join('; ');
    const description = opts.noteText?.(s) ?? plainText(composeNote(s, 'narrative', time));
    let row = [
      s.studentCode,
      time.date(s.date),
      s.start ? time.time(s.start) : '',
      s.end ? time.time(s.end) : '',
      keys,
      String(s.groupSize),
      serviceType(s),
      serviceDelivered(s.attendance) && s.progress ? PROGRESS_SBAP[s.progress] : '',
      description
    ];
    if (opts.identity) {
      const id = opts.identity(s.studentCode);
      row = [id?.realName ?? '', id?.dateOfBirth ?? '', id?.paSecureID ?? '', ...row];
    }
    rows.push(row);
  }
  return toCSV(rows);
}
