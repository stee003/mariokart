// ============================================================================
// SaveManager - tiny persistent settings store (localStorage with an
// in-memory fallback so the game still works where storage is blocked).
// ============================================================================

const KEY = 'sunforge_racers_save_v1';

const DEFAULTS = {
  lang: 'en',
  cameraDistance: 8.6,
  cameraHeight: 3.5,
  volume: 0.8,
};

export class SaveManager {
  constructor() {
    this.data = { ...DEFAULTS };
    this.storageOk = false;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
      this.storageOk = true;
    } catch (_e) {
      this.storageOk = false;
    }
  }

  get(key, fallback = undefined) {
    return key in this.data ? this.data[key] : (fallback ?? DEFAULTS[key]);
  }

  set(key, value) {
    this.data[key] = value;
    if (!this.storageOk) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (_e) { /* ignore quota errors */ }
  }
}
