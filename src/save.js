// ============================================================================
// SaveManager - tiny persistent settings store (localStorage with an
// in-memory fallback so the game still works where storage is blocked).
//
// Corruption policy: a malformed blob is detected at boot, logged once, and
// replaced by defaults - persistence keeps working afterwards, so one bad
// write can never brick the player's future saves.
// ============================================================================

const KEY = 'sunforge_racers_save_v1';

const DEFAULTS = {
  version: 1,
  lang: 'en',
  cameraDistance: 8.6,
  cameraHeight: 3.5,
  volume: 0.8,
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export class SaveManager {
  constructor() {
    this.data = { ...DEFAULTS };
    this.storageOk = false;
    let storage = null;
    try {
      storage = window.localStorage;
      // Some privacy modes expose localStorage but throw on use.
      storage.getItem(KEY);
    } catch (_e) {
      storage = null;
    }
    this._store = storage;
    if (!storage) return;

    let raw = null;
    try { raw = storage.getItem(KEY); } catch (_e) { raw = null; }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isPlainObject(parsed)) {
          this.data = { ...DEFAULTS, ...parsed };
        } else {
          this._log('save blob is not an object - resetting to defaults');
        }
      } catch (_e) {
        this._log('save blob is corrupt JSON - resetting to defaults');
      }
    }
    // persistence probe (also self-heals a corrupt blob immediately)
    try {
      storage.setItem(KEY, JSON.stringify(this.data));
      this.storageOk = true;
    } catch (_e) {
      this.storageOk = false;
    }
  }

  _log(msg) {
    if (typeof console !== 'undefined') console.warn(`[save] ${msg}`);
  }

  get(key, fallback = undefined) {
    return key in this.data ? this.data[key] : (fallback ?? DEFAULTS[key]);
  }

  set(key, value) {
    this.data[key] = value;
    if (!this.storageOk) return;
    try {
      this._store.setItem(KEY, JSON.stringify(this.data));
    } catch (_e) {
      // Quota exceeded: the in-memory copy keeps the session intact.
    }
  }
}
