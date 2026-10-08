/** Shared date/time formatting so notes, CSV and PDF agree. Matches the Swift TimeStyle output. */
export class TimeStyle {
  constructor(readonly timeZone?: string) {}

  /** "9:15 AM" */
  time(d: Date): string {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: this.timeZone })
      .format(d)
      .replace(/ /g, ' ');
  }

  /** "10/07/2026" */
  date(d: Date): string {
    return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: this.timeZone }).format(d);
  }

  /** "October 7, 2026" */
  longDate(d: Date): string {
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: this.timeZone }).format(d);
  }

  /** "2026-10-07" for file names */
  fileDate(d: Date): string {
    const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: this.timeZone }).format(d);
    return p;
  }
}
