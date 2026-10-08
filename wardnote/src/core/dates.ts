// Local day keys ("2026-10-08") so nothing shifts across time zones.

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDayKey = (s: unknown): s is string => typeof s === 'string' && KEY_RE.test(s);

const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => toKey(new Date());

export function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function utcDay(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string) => utcDay(b) - utcDay(a);

export function addDays(k: string, n: number): string {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Same day n months later; a day past the month's end falls back to its last day (Jan 31 + 1 month = Feb 28). */
export function addMonths(k: string, n: number): string {
  const [y, m, d] = k.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Oct 10" */
export function short(k: string): string {
  return `${MONTHS[Number(k.slice(5, 7)) - 1]} ${Number(k.slice(8))}`;
}

/** "Sat Oct 10" */
export function withDay(k: string): string {
  return `${DAYS[fromKey(k).getDay()]} ${short(k)}`;
}

export function long(k: string): string {
  return `${short(k)}, ${k.slice(0, 4)}`;
}

export function relative(today: string, k: string): string {
  const n = daysBetween(today, k);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n <= 6) return DAYS[fromKey(k).getDay()];
  return `in ${n} days`;
}
