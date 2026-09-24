// ============================================================================
// SUNFORGE ARSENAL - the power-up catalog (22 original items).
//
// Design pillars
//   1. READABLE IN A GLANCE. Every item owns one hue, one icon silhouette and
//      one sound, so a player can name what hit them (or what they are
//      holding) without reading a word. No two items share any of the three.
//   2. ONE SENTENCE OF PURPOSE. Each entry states what it does, what it costs
//      and how to answer it (`counterKey` is shown in the pause/garage copy).
//      An item with no answer is not in the set.
//   3. ROLES, NOT DUPLICATES. The set is spread across six roles - forward
//      attack, area denial, mobility, disruption, protection and gamble - and
//      inside a role the options trade against each other instead of being
//      reskins: the Lance is fast, straight and pierces; the Fang is homing
//      but leaves the road dirty; the Pod is a weak spread that is hard to
//      dodge entirely.
//   4. POSITION-WEIGHTED, NOT POSITION-FIXED. `rollItem` favours disruption
//      for backmarkers and denial/protection for leaders, and gates the
//      signature item to the back of the field. Everyone gets answers; nobody
//      gets the hammer at the front.
//   5. COSTS ARE REAL. Glasswalk leaves a trail that slows you too, the Ember
//      Draft forbids drifting, the Sunflare's immunity is shorter than its
//      boost, the Bulwark blocks its owner on the way out, and the Lottery can
//      hand you something you did not want.
//
// category: projectile | hazard | buff | debuff | zone | utility
//   (the AI reasons about categories only - see AIController._shouldUseItem)
// bias: leader | chaser | any   (extra roulette tilt on top of the category)
// ============================================================================

export const ITEMS = {
  // ------------------------------------------------------- forward attack
  cinder_lance: {
    id: 'cinder_lance', nameKey: 'item.cinderLance', descKey: 'item.cinderLance.desc',
    counterKey: 'item.cinderLance.counter',
    category: 'projectile', targeting: 'forward', bias: 'any', weight: 10,
    color: 0xff7a2a, icon: 'lance', sound: 'lance',
    // Fast, dead straight, and it keeps going: one spear can collect two karts
    // that are running in a line. No homing means it is dodgeable by steering.
    params: { speed: 62, homing: 0, pierce: 1, life: 2.3 },
  },
  hornet_pod: {
    id: 'hornet_pod', nameKey: 'item.hornetPod', descKey: 'item.hornetPod.desc',
    counterKey: 'item.hornetPod.counter',
    category: 'projectile', targeting: 'forward', bias: 'any', weight: 9,
    color: 0xffd23f, icon: 'pod', sound: 'pod',
    // Three brass wasps in a spread. Each one is weak and slow to turn, but a
    // target has to beat all three lines instead of one.
    params: { count: 3, speed: 41, homing: 0.42, spread: 0.3, life: 3.1, weakHit: true },
  },
  glass_fang: {
    id: 'glass_fang', nameKey: 'item.glassFang', descKey: 'item.glassFang.desc',
    counterKey: 'item.glassFang.counter',
    category: 'projectile', targeting: 'forward', bias: 'chaser', weight: 8,
    color: 0xbaf0ff, icon: 'fang', sound: 'fang',
    // Locks on hard - and shatters where it lands, leaving a patch of glass on
    // the racing line for whoever is following.
    params: {
      speed: 50, homing: 0.72, life: 3.0, lockBreakDrift: true,
      shatter: { radius: 3.2, life: 5.5, slowMult: 0.62, slipDur: 0.9 },
    },
  },

  // ---------------------------------------------------------- area denial
  kiln_mortar: {
    id: 'kiln_mortar', nameKey: 'item.kilnMortar', descKey: 'item.kilnMortar.desc',
    counterKey: 'item.kilnMortar.counter',
    category: 'hazard', targeting: 'leaderAhead', bias: 'chaser', weight: 7,
    color: 0xff5a3c, icon: 'mortar', sound: 'mortar',
    // Lobs a shell at where the kart ahead is GOING to be. The telegraph ring
    // lands first, so the target can read it and drive out - if they notice.
    // With nobody ahead it drops a crater far enough up the road to matter to
    // whoever is coming.
    params: { flight: 1.15, lead: 1.0, radius: 5.0, life: 6.5, armTime: 0, burnDur: 0.8, noTargetAhead: 1.5 },
  },
  slag_mine: {
    id: 'slag_mine', nameKey: 'item.slagMine', descKey: 'item.slagMine.desc',
    counterKey: 'item.slagMine.counter',
    category: 'hazard', targeting: 'drop', bias: 'leader', weight: 9,
    color: 0xe0561a, icon: 'mine', sound: 'slag',
    // A crucible of slag that drags nearby karts in, then erupts and launches
    // whatever it is holding.
    params: { radius: 4.4, pull: 8.5, armTime: 0.85, life: 24, launch: 7.2 },
  },
  brass_bulwark: {
    id: 'brass_bulwark', nameKey: 'item.brassBulwark', descKey: 'item.brassBulwark.desc',
    counterKey: 'item.brassBulwark.counter',
    category: 'hazard', targeting: 'drop', bias: 'leader', weight: 7,
    color: 0xd8a24a, icon: 'bulwark', sound: 'bulwark',
    // A physical gate across half the road: it does not just slow karts, it
    // stops them and pushes them back. Costs the owner a lane too - the gate
    // rises clear of them, then it is solid for everybody, owner included.
    // 6 m keeps a kart-wide lane open even when it lands mid-road on the
    // narrowest track (13.4 m): it forces a choice of side, it never closes
    // the road. `thickness` is the collider's half-depth (plate + end posts).
    params: { width: 6.0, thickness: 0.25, height: 2.3, life: 8.5, slowMult: 0.5, solid: true, riseTime: 0.5, ownerGrace: 2.2 },
  },
  dust_veil: {
    id: 'dust_veil', nameKey: 'item.dustVeil', descKey: 'item.dustVeil.desc',
    counterKey: 'item.dustVeil.counter',
    category: 'hazard', targeting: 'drop', bias: 'leader', weight: 8,
    color: 0xcfa279, icon: 'veil', sound: 'veil',
    // A curtain of desert dust. Nothing solid about it - you simply cannot see
    // or grip through it, and the steering goes loose.
    params: { width: 11, life: 7.5, gripMult: 0.42, jitter: 0.6, slipDur: 1.3, riseTime: 0.6, ownerGrace: 1.2 },
  },
  thorn_scatter: {
    id: 'thorn_scatter', nameKey: 'item.thornScatter', descKey: 'item.thornScatter.desc',
    counterKey: 'item.thornScatter.counter',
    category: 'hazard', targeting: 'drop', bias: 'leader', weight: 8,
    color: 0x8aff6a, icon: 'thorn', sound: 'scatter',
    // Three iron thorns flung into a fan behind you. Individually trivial,
    // together they close off the whole inside line.
    params: { count: 3, spread: 3.4, back: 4.5, radius: 2.3, armTime: 0.5, life: 18, spinDur: 1.0 },
  },

  // ------------------------------------------------------------- mobility
  sunflare: {
    id: 'sunflare', nameKey: 'item.sunflare', descKey: 'item.sunflare.desc',
    counterKey: 'item.sunflare.counter',
    category: 'buff', targeting: 'self', bias: 'any', weight: 10,
    color: 0xffb830, icon: 'flare', sound: 'flare',
    // The panic button: an instant kick of boost wrapped in a very short
    // window of immunity. The immunity is shorter than the boost on purpose.
    params: { boostLevel: 2, immune: 0.7 },
  },
  ember_draft: {
    id: 'ember_draft', nameKey: 'item.emberDraft', descKey: 'item.emberDraft.desc',
    counterKey: 'item.emberDraft.counter',
    category: 'buff', targeting: 'self', bias: 'chaser', weight: 9,
    color: 0xff9a3c, icon: 'draft', sound: 'draft',
    // A long, strong pull of speed - paid for with the drift button. Best on
    // the straights, worst in the corners.
    params: { duration: 3.4, speedMult: 1.22, accelMult: 1.9, noDrift: true },
  },
  glasswalk: {
    id: 'glasswalk', nameKey: 'item.glasswalk', descKey: 'item.glasswalk.desc',
    counterKey: 'item.glasswalk.counter',
    category: 'buff', targeting: 'self', bias: 'any', weight: 7,
    color: 0x9be8ff, icon: 'glasswalk', sound: 'glass',
    // Turn to glass: nothing can touch you, you cannot touch a box, and you
    // shed a trail of it that slows whoever follows - including your future
    // self on the next lap.
    params: {
      duration: 3.6, intangible: true, noItems: true,
      trail: { every: 0.32, radius: 2.8, life: 3.4, slowMult: 0.72, slipDur: 0.6 },
    },
  },
  dune_skip: {
    id: 'dune_skip', nameKey: 'item.duneSkip', descKey: 'item.duneSkip.desc',
    counterKey: 'item.duneSkip.counter',
    category: 'buff', targeting: 'self', bias: 'any', weight: 8,
    color: 0xffe9b0, icon: 'skip', sound: 'skip',
    // A hop over the dunes: lifts the kart clean off the ground and throws it
    // forward. Clears low obstacles, sets up a trick, and cannot be steered
    // much on the way down.
    params: { launch: 8.2, forward: 9, airSteer: 0.6 },
  },

  // ----------------------------------------------------------- disruption
  rust_blight: {
    id: 'rust_blight', nameKey: 'item.rustBlight', descKey: 'item.rustBlight.desc',
    counterKey: 'item.rustBlight.counter',
    category: 'debuff', targeting: 'leaderAhead', bias: 'chaser', weight: 7,
    color: 0xa06a3a, icon: 'blight', sound: 'blight',
    // Rust in the drivetrain of the kart ahead. Top speed is untouched, so it
    // barely matters on a straight - and it is brutal after any hit or corner.
    params: { duration: 4.4, accelMult: 0.4, gripMult: 0.92 },
  },
  gyro_jinx: {
    id: 'gyro_jinx', nameKey: 'item.gyroJinx', descKey: 'item.gyroJinx.desc',
    counterKey: 'item.gyroJinx.counter',
    category: 'debuff', targeting: 'nearestAhead', bias: 'chaser', weight: 7,
    color: 0xd8f4a0, icon: 'jinx', sound: 'jinx',
    // Spins the gyros in a rival's kart: a full, uncontrollable rotation that
    // also dumps their held item.
    params: { duration: 1.25, steerMult: 0.08, speedMult: 0.6, spin: true, dropItem: true },
  },
  hourglass_hex: {
    id: 'hourglass_hex', nameKey: 'item.hourglassHex', descKey: 'item.hourglassHex.desc',
    counterKey: 'item.hourglassHex.counter',
    category: 'zone', targeting: 'nearestAhead', bias: 'chaser', weight: 6,
    color: 0x8ad0ff, icon: 'hourglass', sound: 'hex',
    // Hangs a slow bubble ON a rival for a few seconds - it travels with them,
    // so anyone who drafts past them gets caught in it too.
    params: { radius: 11, duration: 3.2, windup: 0.45, slowMult: 0.62 },
  },

  // ----------------------------------------------------------- protection
  forge_ward: {
    id: 'forge_ward', nameKey: 'item.forgeWard', descKey: 'item.forgeWard.desc',
    counterKey: 'item.forgeWard.counter',
    category: 'utility', targeting: 'self', bias: 'leader', weight: 8,
    color: 0x7deede, icon: 'ward', sound: 'ward',
    // A quenched plate that eats the next hit and scours off whatever is
    // already on you.
    params: { shieldCharge: 1, cleanse: true },
  },
  echo_bell: {
    id: 'echo_bell', nameKey: 'item.echoBell', descKey: 'item.echoBell.desc',
    counterKey: 'item.echoBell.counter',
    category: 'utility', targeting: 'self', bias: 'any', weight: 8,
    color: 0x2fd8c8, icon: 'bell', sound: 'bell',
    // A ringing shockwave: cleanses you, shatters every trap in range, and pays
    // a little boost back for each one it breaks.
    params: { radius: 14, cleanse: true, boostPerHazard: 0.4 },
  },
  mirage_decoy: {
    id: 'mirage_decoy', nameKey: 'item.mirageDecoy', descKey: 'item.mirageDecoy.desc',
    counterKey: 'item.mirageDecoy.counter',
    category: 'utility', targeting: 'drop', bias: 'leader', weight: 7,
    color: 0xf0d0ff, icon: 'decoy', sound: 'decoy',
    // Leaves a heat-haze double behind you. Projectiles go for it instead, and
    // it flashes over whoever is close when it goes.
    params: { duration: 10, flashRadius: 6.5, absorbHits: 1 },
  },
  storm_cell: {
    id: 'storm_cell', nameKey: 'item.stormCell', descKey: 'item.stormCell.desc',
    counterKey: 'item.stormCell.counter',
    category: 'buff', targeting: 'self', bias: 'leader', weight: 7,
    color: 0x8ac8ff, icon: 'cell', sound: 'storm',
    // Bolts a charged cell to your exhaust. Every drift-boost you release from
    // here on arcs backwards into whoever is tailing you - three times.
    params: { charges: 3, zapRadius: 7.5, duration: 14 },
  },
  hex_mirror: {
    id: 'hex_mirror', nameKey: 'item.hexMirror', descKey: 'item.hexMirror.desc',
    counterKey: 'item.hexMirror.counter',
    category: 'utility', targeting: 'self', bias: 'any', weight: 6,
    color: 0xff5df1, icon: 'mirror', sound: 'mirror',
    // Paints a sigil on your kart. The next hostile item that would land on you
    // goes straight back to whoever threw it. One use, and it expires.
    params: { duration: 7.5, reflects: 1 },
  },

  // --------------------------------------------------------------- gamble
  kiln_lottery: {
    id: 'kiln_lottery', nameKey: 'item.kilnLottery', descKey: 'item.kilnLottery.desc',
    counterKey: 'item.kilnLottery.counter',
    category: 'utility', targeting: 'self', bias: 'any', weight: 6,
    color: 0xf0e04a, icon: 'dice', sound: 'dice',
    // Throw your item back into the kiln and take whatever comes out, weighted
    // by your position like a normal pickup. It can be better. It can be a
    // Dust Veil with nobody behind you.
    params: { rerolls: 1 },
  },
  sunforge_heart: {
    id: 'sunforge_heart', nameKey: 'item.sunforgeHeart', descKey: 'item.sunforgeHeart.desc',
    counterKey: 'item.sunforgeHeart.counter',
    category: 'buff', targeting: 'self', bias: 'chaser', weight: 9,
    color: 0xffd700, icon: 'heart', sound: 'heart',
    // The signature: a long, violent burst that trails molten fire behind it,
    // so overtaking with it is also an attack. Gated to the back of the field -
    // leaders never see one.
    params: {
      duration: 3.2, speedMult: 1.32, accelMult: 2.3, noDrift: true,
      burn: { coneLen: 12, coneHalfAngle: 0.5, dragMult: 0.7 },
      minFieldFraction: 0.6,
    },
  },
};

export const ITEM_LIST = Object.values(ITEMS);

// Every item must be answerable; the set is only balanced if the answers are
// spread across roles rather than concentrated in one counter-item.
export const ITEM_ROLES = {
  forwardAttack: ['cinder_lance', 'hornet_pod', 'glass_fang', 'kiln_mortar'],
  areaDenial: ['slag_mine', 'brass_bulwark', 'dust_veil', 'thorn_scatter'],
  mobility: ['sunflare', 'ember_draft', 'glasswalk', 'dune_skip'],
  disruption: ['rust_blight', 'gyro_jinx', 'hourglass_hex'],
  protection: ['forge_ward', 'echo_bell', 'mirage_decoy', 'storm_cell', 'hex_mirror'],
  gamble: ['kiln_lottery', 'sunforge_heart'],
};

// Position-weighted roulette. `pos` is 1-based, `total` the kart count.
//
//   t = 0 at the front of the field, 1 at the back.
//
// Backmarkers get disruption and mobility; the front gets denial and
// protection, because that is the part of the field where a trap is worth
// more than a boost. `bias` tilts an individual item on top of its category,
// and a signature item is gated to the back third outright.
export function rollItem(rng, pos, total) {
  const t = total > 1 ? (pos - 1) / (total - 1) : 0.5; // 0 = leader
  const pool = [];
  for (const item of ITEM_LIST) {
    let w = item.weight;

    switch (item.category) {
      case 'debuff':
      case 'zone': w *= 0.55 + 0.95 * t; break;        // backmarkers disrupt
      case 'buff': w *= 0.85 + 0.5 * t; break;         // speed helps the back
      case 'utility': w *= 1.25 - 0.5 * t; break;      // leaders protect
      case 'hazard': w *= 1.3 - 0.55 * t; break;       // traps favour the front
      default: w *= 1; break;                          // projectiles: everyone
    }

    if (item.bias === 'leader') w *= 1.35 - 0.6 * t;
    else if (item.bias === 'chaser') w *= 0.7 + 0.6 * t;

    // signature item: only from the back third of the field onwards
    const gate = item.params?.minFieldFraction;
    if (gate != null && t < gate) w = 0;

    pool.push({ item, w: Math.max(0, w) });
  }
  const live = pool.filter((p) => p.w > 0);
  const sum = live.reduce((s, p) => s + p.w, 0);
  if (!(sum > 0)) return live.length ? live[live.length - 1].item.id : ITEM_LIST[0].id;
  let r = rng() * sum;
  for (const p of live) {
    r -= p.w;
    if (r <= 0) return p.item.id;
  }
  return live[live.length - 1].item.id;
}

// Reroll used by the Kiln Lottery: same weighting, but never itself.
export function rollItemExcept(rng, pos, total, excludeId) {
  const list = ITEM_LIST;
  let id = rollItem(rng, pos, total);
  let guard = 0;
  while (id === excludeId && guard++ < 12) id = rollItem(rng, pos, total);
  if (id === excludeId) {
    const fallback = list.filter((i) => i.id !== excludeId);
    id = fallback[Math.min(fallback.length - 1, Math.floor(rng() * fallback.length))].id;
  }
  return id;
}
