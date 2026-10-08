const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
export const WORDS = [
  'OTTER', 'HERON', 'MAPLE', 'FINCH', 'CEDAR', 'WREN', 'BIRCH', 'ASPEN', 'ROBIN', 'FERN',
  'WILLOW', 'SPARROW', 'BADGER', 'LARK', 'ALDER', 'PINE', 'OAK', 'MOSS', 'CLOVER', 'IRIS',
  'BEAVER', 'CRANE', 'DOVE', 'EAGLE', 'FALCON', 'HAZEL', 'JUNIPER', 'LUPINE', 'MARTEN', 'OSPREY',
  'PLOVER', 'QUAIL', 'RAVEN', 'SAGE', 'TERN', 'THRUSH', 'TULIP', 'VIOLET', 'YARROW', 'ZINNIA'
];

function pick<T>(list: ArrayLike<T>, rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/** Student code like "K7-OTTER"; look-alike characters (I, O, 0, 1) left out. Mirrors PseudonymGenerator. */
export function makeCode(existing: Set<string>, rand: () => number = secureRandom): string {
  for (let i = 0; i < 500; i++) {
    const code = `${pick(LETTERS, rand)}${pick(DIGITS, rand)}-${pick(WORDS, rand)}`;
    if (!existing.has(code)) return code;
  }
  return 'S' + crypto.randomUUID().slice(0, 6).toUpperCase();
}

export function aliasFor(code: string): string {
  const word = code.split('-').pop() ?? code;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces real names (full, first or last) in free text with the student's code. Whole-word, case-insensitive. */
export function scrubNames(text: string, names: Record<string, string>): { text: string; replacements: number } {
  const pairs: [string, string][] = [];
  for (const [code, full] of Object.entries(names)) {
    const candidates = [full, ...full.split(/[ -]+/).filter((p) => p.length >= 2)];
    for (const c of candidates) {
      const t = c.trim();
      if (t) pairs.push([t, code]);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  let count = 0;
  for (const [name, code] of pairs) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, () => {
      count++;
      return code;
    });
  }
  return { text: out, replacements: count };
}
