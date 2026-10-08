import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Store } from './store';
import { sampleWard } from '../core/sample';

let n = 0;
const id = () => `x${n++}`;

describe('store', () => {
  it('seeds the sample ward and keeps it across reopen', async () => {
    const a = await Store.open('t1');
    expect(await a.isSeeded()).toBe(false);
    await a.replaceAll(sampleWard('2026-10-08', id, new Date(2026, 9, 8, 12)));
    const b = await Store.open('t1');
    expect(await b.isSeeded()).toBe(true);
    expect(b.patientList().map((p) => p.code)).toContain('B4-HERON');
    expect(b.formList('B4-HERON').length).toBe(3);
  });
  it('expires old drafts by deleting their text', async () => {
    const s = await Store.open('t2');
    await s.replaceAll(sampleWard('2026-10-08', id, new Date(2026, 9, 8, 12)));
    const purged = await s.expireDrafts(3, new Date(2026, 9, 12, 12));
    expect(purged).toBe(2);
    expect(s.draftList().every((d) => d.purged === 'expired' && d.reported.length === 0)).toBe(true);
  });
});
