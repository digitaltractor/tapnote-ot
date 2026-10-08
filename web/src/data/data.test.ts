import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Store } from './store';
import { Vault } from './vault';
import { makeBackup, readBackup } from './backup';
import type { SessionRecord, StudentRecord } from './db';

const student: StudentRecord = {
  code: 'K7-OTTER', alias: 'Otter', gradeBand: '1–2', serviceMode: 'individual', weeklyMinutes: 30,
  reportCadence: 'Quarterly', isActive: true, createdAt: new Date(),
  goals: [{ id: 'G1', number: 1, shortName: 'Letter formation', detail: '', criterionPercent: 90, isActive: true }]
};

const session: SessionRecord = {
  id: 'S1', groupKey: 'K1', studentCode: 'K7-OTTER', groupSize: 1, plannedMinutes: 30,
  date: new Date('2026-10-07T13:15:00Z'), start: new Date('2026-10-07T13:15:00Z'), end: new Date('2026-10-07T13:45:00Z'),
  attendance: 'present', delivery: 'inPerson', isMakeUp: false,
  activities: [{ id: 'sbap-19', name: 'Handwriting control', sbapKey: 19 }],
  observations: [{ goalID: 'G1', correct: 7, total: 10, promptLevelName: 'Verbal' }],
  regulation: 'Calm', engagement: 4, progress: 'progressing', comment: 'used slant board', addenda: []
};

describe('store', () => {
  it('persists students and sessions across reopen', async () => {
    const a = await Store.open('t-store');
    await a.putStudent(student, 'created');
    await a.putSessions([session], 'started');
    const b = await Store.open('t-store');
    expect(b.studentList().map((s) => s.code)).toEqual(['K7-OTTER']);
    expect(b.sessions.get('S1')?.observations[0].correct).toBe(7);
    expect((await b.auditLog()).length).toBe(2);
  });
  it('refuses to change a signed session', async () => {
    const st = await Store.open('t-signed');
    await st.putSessions([{ ...session, signedAt: new Date() }]);
    await st.updateSession('S1', (s) => { s.comment = 'changed'; });
    expect(st.sessions.get('S1')?.comment).toBe('used slant board');
  });
});

describe('vault', () => {
  it('encrypts identities and unlocks with the passphrase only', async () => {
    const store = await Store.open('t-vault');
    const v = await Vault.load(store.db);
    await v.create('correct horse battery');
    await v.set('K7-OTTER', { realName: 'Ava Martinez', dateOfBirth: '01/02/2018', paSecureID: '1234567890', diagnosis: '' });
    const raw = JSON.stringify(await store.db.get('meta', 'vault'));
    expect(raw).not.toContain('Ava');
    v.lock();
    expect(() => v.all()).toThrow();
    expect(v.namesForScrubbing()).toEqual({});
    await expect(v.unlockWithPassphrase('wrong')).rejects.toThrow();
    const again = await Vault.load(store.db);
    await again.unlockWithPassphrase('correct horse battery');
    expect(again.get('K7-OTTER')?.realName).toBe('Ava Martinez');
    expect(again.namesForScrubbing()).toEqual({ 'K7-OTTER': 'Ava Martinez' });
  });
});

describe('backup', () => {
  it('round-trips and rejects a wrong passphrase', async () => {
    const file = await makeBackup([student], [session], 'backup-pass');
    expect(new TextDecoder().decode(file.slice(0, 4))).toBe('TNB1');
    expect(new DataView(file.buffer).getUint32(20, false)).toBe(310_000);
    await expect(readBackup(file, 'nope')).rejects.toThrow('passphrase');
    const back = await readBackup(file, 'backup-pass');
    expect(back.students[0].goals[0].id).toBe('G1');
    expect(back.sessions[0].start?.toISOString()).toBe('2026-10-07T13:15:00.000Z');
    expect(back.sessions[0].progress).toBe('progressing');
    expect(back.sessions[0].observations[0]).toEqual({ goalID: 'G1', correct: 7, total: 10, promptLevelName: 'Verbal' });
  });
  it('writes dates without milliseconds for the iOS decoder', async () => {
    // Decrypt manually to inspect the JSON.
    const file = await makeBackup([student], [session], 'p');
    const { pbkdf2Key } = await import('./crypto');
    const key = await pbkdf2Key('p', file.slice(4, 20), 310_000, ['decrypt']);
    const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.slice(24, 36) }, key, file.slice(36)));
    expect(plain).toContain('"start":"2026-10-07T13:15:00Z"');
    expect(plain).toContain('"attendanceRaw":"present"');
    expect(plain).not.toMatch(/\.\d{3}Z/);
  });
});

describe('beta data', () => {
  it('upgrades to v2 with a schedule store and keeps slots across reopen', async () => {
    const st = await Store.open('t-sched');
    await st.putSlot({ id: 'sl1', weekday: 3, start: '09:15', minutes: 30, studentCodes: ['K7-OTTER'], active: true });
    await st.setClosures(['2026-11-26', '2026-11-26']);
    const again = await Store.open('t-sched');
    expect(again.slotList().map((s) => s.id)).toEqual(['sl1']);
    expect(again.closures).toEqual(['2026-11-26']);
  });
  it('round-trips schedule, closures and co-sign fields in backups', async () => {
    const s2: SessionRecord = { ...session, slotId: 'sl1', makeUpFor: ['X'], signerRole: 'COTA', coSignedAt: new Date('2026-10-08T12:00:00Z'), coSignerName: 'Sup, OTR/L' };
    const slot = { id: 'sl1', weekday: 3, start: '09:15', minutes: 30, studentCodes: ['K7-OTTER'], active: true };
    const file = await makeBackup([student], [s2], 'pp', { schedule: [slot], closures: ['2026-11-26'] });
    const back = await readBackup(file, 'pp');
    expect(back.schedule).toEqual([slot]);
    expect(back.closures).toEqual(['2026-11-26']);
    expect(back.sessions[0].signerRole).toBe('COTA');
    expect(back.sessions[0].coSignedAt?.toISOString()).toBe('2026-10-08T12:00:00.000Z');
    expect(back.sessions[0].makeUpFor).toEqual(['X']);
  });
  it('verifies the supervisor co-sign passphrase', async () => {
    const { setCoSignPassphrase, verifyCoSignPassphrase, hasCoSignPassphrase } = await import('./cosign');
    const st = await Store.open('t-cosign');
    expect(await hasCoSignPassphrase(st.db)).toBe(false);
    await setCoSignPassphrase(st.db, 'supervisor-pass');
    expect(await verifyCoSignPassphrase(st.db, 'supervisor-pass')).toBe(true);
    expect(await verifyCoSignPassphrase(st.db, 'wrong')).toBe(false);
  });
});
