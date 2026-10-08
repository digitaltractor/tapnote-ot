/**
 * Release channel. The beta build is served from /beta/ and keeps its data apart from the
 * stable app at /app/ (same origin, so storage names must differ).
 */
export const CHANNEL: 'stable' | 'beta' = import.meta.env.BASE_URL.includes('/beta') ? 'beta' : 'stable';
export const IS_BETA = CHANNEL === 'beta';
export const DB_NAME = IS_BETA ? 'tapnote-beta' : 'tapnote';
export const PREFS_KEY = IS_BETA ? 'tapnote.beta.prefs.v1' : 'tapnote.prefs.v1';
