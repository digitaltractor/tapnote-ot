import { StudentIdentity } from '../core/types';
import { DB } from './db';
import { Sealed, dec, enc, fromB64, hkdfKey, open, pbkdf2Key, randomBytes, seal, toB64 } from './crypto';

/**
 * Identity vault: real names, DOB, PA Secure ID and diagnosis, keyed by student code.
 *
 * - A random 256-bit data key (DEK) encrypts the identities (AES-GCM).
 * - The DEK is wrapped twice: by a key from a passkey's WebAuthn PRF output (Face ID / Touch ID,
 *   iOS 18+ Safari) and by a passphrase key (PBKDF2-SHA256), which is the fallback and recovery path.
 * - Decrypted identities live only in memory and are dropped after inactivity or when the app is hidden.
 */

const META_KEY = 'vault';
const PASS_ITERATIONS = 310_000;
const IDLE_LOCK_MS = 5 * 60_000;
const HIDDEN_LOCK_MS = 60_000;

interface VaultBlob {
  version: 1;
  passphrase: { salt: string; iterations: number; wrapped: Sealed };
  passkey?: { credentialId: string; prfSalt: string; wrapped: Sealed };
  identities: Sealed;
}

type Listener = () => void;

export class Vault {
  private blob?: VaultBlob;
  private dek?: CryptoKey;
  private identities: Record<string, StudentIdentity> = {};
  private idleTimer?: ReturnType<typeof setTimeout>;
  private hiddenTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<Listener>();

  private constructor(private db: DB) {}

  static async load(db: DB): Promise<Vault> {
    const v = new Vault(db);
    v.blob = (await db.get('meta', META_KEY)) as VaultBlob | undefined;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') v.hiddenTimer = setTimeout(() => v.lock(), HIDDEN_LOCK_MS);
        else clearTimeout(v.hiddenTimer);
      });
    }
    return v;
  }

  get isConfigured(): boolean { return !!this.blob; }
  get hasPasskey(): boolean { return !!this.blob?.passkey; }
  get isUnlocked(): boolean { return !!this.dek; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() { this.listeners.forEach((fn) => fn()); }

  private touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), IDLE_LOCK_MS);
  }

  lock() {
    this.dek = undefined;
    this.identities = {};
    clearTimeout(this.idleTimer);
    this.notify();
  }

  // Setup

  /** Creates the vault with a passphrase. Optionally adds Face ID unlock right after. */
  async create(passphrase: string): Promise<void> {
    const dekRaw = randomBytes(32);
    const salt = randomBytes(16);
    const kek = await pbkdf2Key(passphrase, salt, PASS_ITERATIONS);
    this.dek = await crypto.subtle.importKey('raw', dekRaw, 'AES-GCM', true, ['encrypt', 'decrypt']);
    this.blob = {
      version: 1,
      passphrase: { salt: toB64(salt), iterations: PASS_ITERATIONS, wrapped: await seal(kek, dekRaw) },
      identities: await seal(this.dek, enc.encode('{}'))
    };
    this.identities = {};
    await this.persist();
    this.touch();
    this.notify();
  }

  static passkeysSupported(): boolean {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
  }

  private pendingPasskey?: { credentialId: string; prfSalt: string };

  /**
   * Registers a passkey (Face ID / Touch ID) and wraps the DEK with its PRF output. The vault must be unlocked.
   * WebAuthn has to start straight from a tap, so the passkey prompt comes first. If the platform doesn't
   * return the PRF secret at creation, this returns 'confirm' and `confirmPasskey()` must be called from a second tap.
   */
  async addPasskey(): Promise<'done' | 'confirm'> {
    if (!this.blob || !this.dek) throw new Error('Unlock the vault first.');
    const prfSalt = randomBytes(32);
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'TapNote OT' },
        user: { id: randomBytes(16), name: 'TapNote vault', displayName: 'TapNote vault' },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error('Passkey creation was cancelled.');
    const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
    if (!ext.prf || ext.prf.enabled === false) {
      throw new Error('This device or browser can’t use Face ID to unlock web app data (needs iOS 18 or later). Keep using your passphrase.');
    }
    const credentialId = toB64(cred.rawId);
    const secret = ext.prf.results?.first;
    if (!secret) {
      this.pendingPasskey = { credentialId, prfSalt: toB64(prfSalt) };
      return 'confirm';
    }
    await this.wrapForPasskey(credentialId, toB64(prfSalt), secret);
    return 'done';
  }

  /** Second step of passkey setup on platforms that only return the PRF secret on sign-in. */
  async confirmPasskey(): Promise<void> {
    const pending = this.pendingPasskey;
    if (!pending) throw new Error('Start Face ID setup again.');
    const secret = await this.prfSecret(pending.credentialId, pending.prfSalt);
    await this.wrapForPasskey(pending.credentialId, pending.prfSalt, secret);
    this.pendingPasskey = undefined;
  }

  private async wrapForPasskey(credentialId: string, prfSalt: string, secret: ArrayBuffer) {
    if (!this.blob || !this.dek) throw new Error('Unlock the vault first.');
    const dekRaw = new Uint8Array(await crypto.subtle.exportKey('raw', this.dek));
    const kek = await hkdfKey(secret, 'tapnote-vault-kek');
    this.blob.passkey = { credentialId, prfSalt, wrapped: await seal(kek, dekRaw) };
    await this.persist();
    this.touch();
    this.notify();
  }

  async removePasskey(): Promise<void> {
    if (!this.blob) return;
    delete this.blob.passkey;
    await this.persist();
    this.notify();
  }

  async changePassphrase(oldPass: string, newPass: string): Promise<void> {
    if (!this.blob) throw new Error('No vault.');
    const dekRaw = await this.unwrapWithPassphrase(oldPass);
    const salt = randomBytes(16);
    const kek = await pbkdf2Key(newPass, salt, PASS_ITERATIONS);
    this.blob.passphrase = { salt: toB64(salt), iterations: PASS_ITERATIONS, wrapped: await seal(kek, dekRaw) };
    await this.persist();
  }

  // Unlock

  /** Face ID via passkey. Every call prompts; use it for signing and exports too. */
  async unlockWithPasskey(): Promise<void> {
    if (!this.blob?.passkey) throw new Error('Face ID unlock isn’t set up.');
    const { credentialId, prfSalt, wrapped } = this.blob.passkey;
    const secret = await this.prfSecret(credentialId, prfSalt);
    const kek = await hkdfKey(secret, 'tapnote-vault-kek');
    let dekRaw: Uint8Array<ArrayBuffer>;
    try {
      dekRaw = await open(kek, wrapped);
    } catch {
      throw new Error('That passkey didn’t unlock the vault. Use your passphrase.');
    }
    this.dek = await crypto.subtle.importKey('raw', dekRaw, 'AES-GCM', true, ['encrypt', 'decrypt']);
    await this.loadIdentities();
    this.touch();
    this.notify();
  }

  async unlockWithPassphrase(passphrase: string): Promise<void> {
    const dekRaw = await this.unwrapWithPassphrase(passphrase);
    this.dek = await crypto.subtle.importKey('raw', dekRaw, 'AES-GCM', true, ['encrypt', 'decrypt']);
    await this.loadIdentities();
    this.touch();
    this.notify();
  }

  // Identities (require unlocked)

  all(): Record<string, StudentIdentity> {
    this.requireUnlocked();
    this.touch();
    return { ...this.identities };
  }

  get(code: string): StudentIdentity | undefined {
    this.requireUnlocked();
    this.touch();
    return this.identities[code];
  }

  /** code -> real name, for scrubbing names out of free text. Empty when locked. */
  namesForScrubbing(): Record<string, string> {
    if (!this.dek) return {};
    const out: Record<string, string> = {};
    for (const [code, id] of Object.entries(this.identities)) if (id.realName.trim()) out[code] = id.realName.trim();
    return out;
  }

  async set(code: string, identity: StudentIdentity | undefined): Promise<void> {
    this.requireUnlocked();
    if (identity && (identity.realName.trim() || identity.paSecureID.trim())) this.identities[code] = identity;
    else delete this.identities[code];
    this.blob!.identities = await seal(this.dek!, enc.encode(JSON.stringify(this.identities)));
    await this.persist();
    this.touch();
    this.notify();
  }

  // Internals

  private requireUnlocked() {
    if (!this.dek) throw new Error('The vault is locked.');
  }

  private async unwrapWithPassphrase(passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.blob) throw new Error('No vault.');
    const p = this.blob.passphrase;
    const kek = await pbkdf2Key(passphrase, fromB64(p.salt), p.iterations);
    try {
      return await open(kek, p.wrapped);
    } catch {
      throw new Error('That passphrase didn’t match.');
    }
  }

  private async loadIdentities() {
    const plain = await open(this.dek!, this.blob!.identities);
    this.identities = JSON.parse(dec.decode(plain));
  }

  private async prfSecret(credentialIdB64: string, prfSaltB64: string): Promise<ArrayBuffer> {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: fromB64(credentialIdB64) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: fromB64(prfSaltB64) } } } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential | null;
    if (!assertion) throw new Error('Face ID was cancelled.');
    const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    const first = ext.prf?.results?.first;
    if (!first) throw new Error('This browser didn’t return a Face ID key. Use your passphrase.');
    return first;
  }

  private async persist() {
    await this.db.put('meta', this.blob, META_KEY);
  }
}
