// Localization QA: every string has EN + IT, every referenced key resolves,
// and Italian strings are actually translated (not silently English).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../src/i18n.js';
import { DIFFICULTY_TIERS } from '../src/aiDifficulty.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { ARENAS } from '../src/content/arenas.js';
import { ITEM_LIST } from '../src/content/items.js';
import { BATTLE_MODES } from '../src/battle.js';
import { CUPS } from '../src/content/cups.js';
import { CHARACTERS } from '../src/content/characters.js';
import { CHASSIS } from '../src/content/chassis.js';
import { WHEELS } from '../src/content/wheels.js';
import { PAINTS, DECALS, EXHAUSTS, EFFECTS } from '../src/content/cosmetics.js';
import { ACHIEVEMENTS } from '../src/achievements.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ------------------------------------------------------------- dictionary QA
const bilingual = Object.entries(STRINGS).filter(([, v]) => !v.en || !v.it);
check('every key has both EN and IT', bilingual.length === 0,
  bilingual.map(([k]) => k).slice(0, 8).join(','));

const empty = Object.entries(STRINGS).filter(([, v]) =>
  typeof v.en !== 'string' || !v.en.trim() || typeof v.it !== 'string' || !v.it.trim());
check('no empty translations', empty.length === 0, empty.map(([k]) => k).join(','));

// broken characters / mojibake scan
const broken = Object.entries(STRINGS).filter(([, v]) => /�|\uFFFD/.test(v.en + v.it));
check('no broken characters in any string', broken.length === 0);

// ------------------------------------------------ referenced-key resolution
const needsKey = (k) => !!k && !STRINGS[k];

const missing = [];
for (const d of DIFFICULTY_TIERS) if (needsKey(d.nameKey)) missing.push(d.nameKey);
for (const t of TRACK_DEFS) for (const k of [t.nameKey, t.teachKey, t.mechanicKey]) if (needsKey(k)) missing.push(k);
for (const a of ARENAS) for (const k of [a.nameKey, a.teachKey, a.descKey]) if (needsKey(k)) missing.push(k);
for (const it of ITEM_LIST) for (const k of [it.nameKey, it.descKey, it.counterKey]) if (needsKey(k)) missing.push(k);
for (const m of BATTLE_MODES) for (const k of [m.nameKey, m.descKey]) if (needsKey(k)) missing.push(k);
for (const c of CUPS) for (const k of [c.nameKey, c.descKey, c.trophyKey]) if (needsKey(k)) missing.push(k);
for (const c of CHARACTERS) for (const k of [c.nameKey, c.speciesKey, c.personalityKey, c.unlock?.noteKey]) if (needsKey(k)) missing.push(k);
for (const c of CHASSIS) for (const k of [c.nameKey, c.descKey]) if (needsKey(k)) missing.push(k);
for (const w of WHEELS) if (needsKey(w.nameKey)) missing.push(w.nameKey);
for (const list of [PAINTS, DECALS, EXHAUSTS, EFFECTS]) for (const c of list) if (needsKey(c.nameKey)) missing.push(c.nameKey);
for (const a of ACHIEVEMENTS) for (const k of [a.nameKey, a.descKey]) if (needsKey(k)) missing.push(k);
// template-composed families
for (let i = 1; i <= 4; i++) if (needsKey('ordinal.' + i)) missing.push('ordinal.' + i);
for (const t of ['bronze', 'silver', 'gold', 'platinum']) if (needsKey('trophy.' + t)) missing.push('trophy.' + t);
check('all content/UI referenced keys exist', missing.length === 0, missing.slice(0, 10).join(','));

// literal keys used in code: i18n.t('...') / t('...') across src
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) srcFiles.push(p);
  }
})(path.join(ROOT, 'src'));
const codeMissing = [];
for (const f of srcFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\bt\(\s*'([a-z][a-z0-9.]*)'/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    // exact hit, or a composition prefix like t('stat.' + k) / t('trophy.' + x)
    const hit = STRINGS[key] || Object.keys(STRINGS).some((s) => s.startsWith(key));
    if (!hit && !codeMissing.includes(key)) codeMissing.push(`${path.basename(f)}:${key}`);
  }
}
check('all literal i18n keys used in code exist', codeMissing.length === 0,
  codeMissing.slice(0, 10).join(','));

// ----------------------------------------------------- genuine IT translation
// These must visibly change language (catches accidental EN passthrough).
for (const k of ['menu.start', 'settings.title', 'race.go', 'results.victory', 'pause.title', 'menu.quick']) {
  check(`IT differs from EN for ${k}`, STRINGS[k].it !== STRINGS[k].en);
}

// interpolation placeholder parity between languages
const badVars = Object.entries(STRINGS).filter(([, v]) => {
  const vars = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join();
  return vars(v.en) !== vars(v.it);
});
check('EN/IT interpolation placeholders match', badVars.length === 0,
  badVars.map(([k]) => k).join(','));

// -------------------------------------------------------------- length audit
// Italian runs long; flag anything > 2.2x the English length on short labels
// (menus/buttons) so text overflow is caught before release.
const overflowRisk = Object.entries(STRINGS)
  .filter(([k, v]) => k.startsWith('menu.') || k.startsWith('settings.') || k.startsWith('difficulty.') || k.startsWith('hud.'))
  .filter(([k, v]) => v.it.length > Math.max(26, v.en.length * 2.2));
check('no likely IT overflow on menu/button labels', overflowRisk.length === 0,
  overflowRisk.map(([k, v]) => `${k}(${v.it.length})`).join(','));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
