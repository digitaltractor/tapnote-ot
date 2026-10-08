// Patient codes like "B4-HERON". The app never stores which person a code belongs to:
// staff match the code to the Cerner banner or the bed board.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const WORDS = [
  'OTTER', 'HERON', 'MAPLE', 'FINCH', 'CEDAR', 'WREN', 'BIRCH', 'ASPEN', 'ROBIN', 'FERN',
  'WILLOW', 'SPARROW', 'BADGER', 'LARK', 'ALDER', 'PINE', 'OAK', 'MOSS', 'CLOVER', 'IRIS',
  'BEAVER', 'CRANE', 'DOVE', 'EAGLE', 'FALCON', 'HAZEL', 'JUNIPER', 'LUPINE', 'MARTEN', 'OSPREY',
  'PLOVER', 'QUAIL', 'RAVEN', 'SAGE', 'TERN', 'THRUSH', 'TULIP', 'VIOLET', 'YARROW', 'ZINNIA'
];

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

const pick = <T,>(list: ArrayLike<T>, rand: () => number): T => list[Math.floor(rand() * list.length)];

export function makeCode(existing: Set<string>, rand: () => number = secureRandom): string {
  for (let i = 0; i < 500; i++) {
    const code = `${pick(LETTERS, rand)}${pick(DIGITS, rand)}-${pick(WORDS, rand)}`;
    if (!existing.has(code)) return code;
  }
  return 'P' + crypto.randomUUID().slice(0, 6).toUpperCase();
}

export const CODE_RE = /^[A-Z][2-9]-[A-Z]{2,10}$/;
