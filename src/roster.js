// ============================================================================
// Roster - decides who lines up on the grid and what they drive.
//
// Increment 6 replaced the vertical slice's three hardcoded rivals (which all
// shared the stock kart) with the full pilot roster: every AI picks one of the
// fourteen characters, brings that character's signature loadout
// (content/rivals.js) and therefore inherits real per-kart physics through
// buildLoadout() -> vehicleParamsFromStats().
//
// The player entry always reports `nameKey: 'ai.you'` so Grand Prix scoring,
// record boards and notifications keep working exactly as before; the pilot's
// identity lives in `characterId` (used for the model + the localized label in
// menus) and `loadout` (used for physics + geometry).
// ============================================================================

import { CHARACTERS, getCharacter } from './content/characters.js';
import { rivalSpec, getRivalSetup } from './content/rivals.js';
import { buildLoadout, DEFAULT_LOADOUT } from './content/loadout.js';

export const PLAYER_NAME_KEY = 'ai.you';

// Deterministic shuffle (mulberry32-free: caller supplies the RNG, we only
// consume it) so tests can pin the grid while live play stays varied.
function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Picks `count` distinct rivals, preferring pilots other than the player's.
export function pickRivals(count, { rng = Math.random, excludeId = null, pool = CHARACTERS } = {}) {
  const others = pool.filter((c) => c.id !== excludeId);
  const picks = shuffled(others, rng).slice(0, Math.max(0, Math.min(count, others.length)));
  // Degenerate case: pool smaller than requested - fill from everybody.
  if (picks.length < count && excludeId) {
    for (const c of shuffled(pool, rng)) {
      if (picks.length >= count) break;
      if (!picks.includes(c)) picks.push(c);
    }
  }
  return picks;
}

// Entries consumed by main.js:
//   { isPlayer, nameKey, characterId, character, spec, loadout, personality }
export function buildRaceRoster({
  playerSpec = DEFAULT_LOADOUT,
  rivals = 3,
  rng = Math.random,
  pool = CHARACTERS,
} = {}) {
  const spec = { ...DEFAULT_LOADOUT, ...playerSpec };
  const playerCharacter = getCharacter(spec.characterId) || CHARACTERS[0];
  const entries = [{
    isPlayer: true,
    nameKey: PLAYER_NAME_KEY,
    characterId: playerCharacter.id,
    character: playerCharacter,
    spec: { ...spec, characterId: playerCharacter.id },
    loadout: buildLoadout({ ...spec, characterId: playerCharacter.id }),
    personality: 'balanced',        // unused for the player; kept for symmetry
  }];

  for (const character of pickRivals(rivals, { rng, excludeId: playerCharacter.id, pool })) {
    const rSpec = rivalSpec(character.id);
    entries.push({
      isPlayer: false,
      nameKey: character.nameKey,
      characterId: character.id,
      character,
      spec: rSpec,
      loadout: buildLoadout(rSpec),
      personality: getRivalSetup(character.id).personality,
    });
  }
  return entries;
}

// Small helper used by the HUD/results to label any entry.
export function entryLabelKey(entry) {
  return entry.isPlayer ? PLAYER_NAME_KEY : entry.character.nameKey;
}
