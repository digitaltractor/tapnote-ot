// A best-effort check for identifying details in free text before it is saved.
// It can't catch everything (PHIPA's test is whether a person is reasonably identifiable), so the
// app keeps free text short, warns, and deletes drafts once they are charted.

export interface Hit {
  kind: string;
  text: string;
}

/** Capitalized words that are fine mid-sentence on a ward. */
const ALLOW = new Set([
  'I', 'ACT', 'ALC', 'CCB', 'CTO', 'EDD', 'HSC', 'ICM', 'LTC', 'MD', 'MHA', 'ODSP', 'OT', 'OW', 'PGT', 'RN', 'RAI', 'SDM', 'SW', 'SBAR',
  'Form', 'Forms', 'Board', 'Cerner', 'PowerChart', 'Ontario', 'Works', 'Health', 'Toronto', 'Coordinated', 'Access', 'Homes', 'Special', 'Care',
  'Public', 'Guardian', 'Trustee', 'Consent', 'Capacity', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec', 'Christmas', 'Thanksgiving', 'English', 'French'
]);

const PATTERNS: [string, RegExp][] = [
  ['health card number', /\b\d{4}[- ]?\d{3}[- ]?\d{3}(?:[- ]?[A-Z]{2})?\b/g],
  ['ID number', /\b\d{6,}\b/g],
  ['phone number', /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g],
  ['email address', /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g],
  ['postal code', /\b[ABCEGHJ-NPRSTVXY]\d[A-Z] ?\d[A-Z]\d\b/gi],
  ['possible birth date', /\b(?:19\d{2}|200\d)[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19\d{2}|200\d)\b/g],
  ['name after a title', /\b(?:Mr|Mrs|Ms|Miss|Dr)\.? [A-Z][a-z]+/g]
];

export function findIdentifiers(text: string): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const add = (kind: string, t: string) => {
    const k = `${kind}:${t}`;
    if (!seen.has(k)) { seen.add(k); hits.push({ kind, text: t }); }
  };
  for (const [kind, re] of PATTERNS) for (const m of text.matchAll(re)) add(kind, m[0]);

  // Capitalized words in the middle of a sentence are often names.
  for (const sentence of text.split(/(?<=[.!?:;\n])\s*/)) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((w, i) => {
      const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '').replace(/['’]s$/, '');
      if (i === 0 || bare.length < 2 || ALLOW.has(bare)) return;
      if (/^[A-Z][a-z]+$/.test(bare) && !/^[A-Z]\d/.test(w)) add('possible name', bare);
    });
  }
  return hits;
}

export function describeHits(hits: Hit[]): string {
  return hits.map((h) => `${h.kind} “${h.text}”`).join(', ');
}
