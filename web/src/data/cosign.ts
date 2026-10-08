import type { DB } from './db';
import { Sealed, dec, enc, fromB64, open, pbkdf2Key, randomBytes, seal, toB64 } from './crypto';

/**
 * Beta: co-signature for notes written by a COTA. The supervising OT sets her own co-sign
 * passphrase on the COTA's device; co-signing a note requires it. Stored only as a verifier
 * (an AES-GCM-sealed constant under a PBKDF2 key), never as the passphrase itself.
 */

const META_KEY = 'cosign';
const ITERATIONS = 310_000;
const CHECK = 'tapnote-cosign-v1';

interface CoSignBlob {
  salt: string;
  iterations: number;
  check: Sealed;
}

export async function hasCoSignPassphrase(db: DB): Promise<boolean> {
  return !!(await db.get('meta', META_KEY));
}

export async function setCoSignPassphrase(db: DB, passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const key = await pbkdf2Key(passphrase, salt, ITERATIONS);
  const blob: CoSignBlob = { salt: toB64(salt), iterations: ITERATIONS, check: await seal(key, enc.encode(CHECK)) };
  await db.put('meta', blob, META_KEY);
}

export async function verifyCoSignPassphrase(db: DB, passphrase: string): Promise<boolean> {
  const blob = (await db.get('meta', META_KEY)) as CoSignBlob | undefined;
  if (!blob) return false;
  try {
    const key = await pbkdf2Key(passphrase, fromB64(blob.salt), blob.iterations);
    return dec.decode(await open(key, blob.check)) === CHECK;
  } catch {
    return false;
  }
}
