// ============================================================================
// LocalizationManager - all UI text lives in this EN/IT dictionary.
// No hardcoded UI strings anywhere else. Usage: i18n.t('race.lap').
// Supports {placeholder} interpolation.
// ============================================================================

import { CONTENT_STRINGS } from './content/strings.js';

const BASE_STRINGS = {
  'game.title':        { en: 'Sunforge Racers',                     it: 'Sunforge Racers' },
  'game.subtitle':     { en: 'Desert Canyon Grand Prix',            it: 'Gran Premio del Canyon del Deserto' },
  'game.pilot':        { en: 'Pilot: Ember the Dustfox',            it: 'Pilota: Ember la Volpe delle Sabbie' },
  'game.kart':         { en: 'Kart: Dune Blazer MK-1',              it: 'Kart: Dune Blazer MK-1' },

  'menu.start':        { en: 'Start Race',                          it: 'Inizia la gara' },
  'menu.settings':     { en: 'Settings',                            it: 'Impostazioni' },
  'menu.restart':      { en: 'Restart',                             it: 'Ricomincia' },
  'menu.main':         { en: 'Main Menu',                           it: 'Menu principale' },
  'menu.resume':       { en: 'Resume',                              it: 'Riprendi' },
  'menu.mode':         { en: 'Choose Game Mode',                    it: 'Scegli la modalità' },
  'menu.press':        { en: 'An original arcade kart prototype',   it: 'Un prototipo arcade di kart originale' },

  'settings.title':    { en: 'Settings',                            it: 'Impostazioni' },
  'settings.language': { en: 'Language',                            it: 'Lingua' },
  'settings.camDist':  { en: 'Camera distance',                     it: 'Distanza telecamera' },
  'settings.camHeight':{ en: 'Camera height',                       it: 'Altezza telecamera' },
  'settings.volume':   { en: 'Volume',                              it: 'Volume' },
  'settings.music':    { en: 'Music volume',                        it: 'Volume musica' },
  'settings.difficulty': { en: 'AI difficulty',                     it: 'Difficoltà IA' },
  'settings.laps':     { en: 'Quick race laps',                     it: 'Giri gara rapida' },
  'settings.rivals':   { en: 'Rivals',                              it: 'Avversari' },
  'settings.back':     { en: 'Back',                                it: 'Indietro' },

  'controls.help':     { en: 'WASD / Arrows drive · SHIFT drift · SPACE aerial trick · R reset · ESC pause',
                         it: 'WASD / Frecce guida · SHIFT derapata · SPACE acrobazia aerea · R reset · ESC pausa' },

  'hud.lap':           { en: 'Lap',                                 it: 'Giro' },
  'hud.lapFormat':     { en: 'Lap {lap}/{total}',                   it: 'Giro {lap}/{total}' },
  'hud.speedUnit':     { en: 'km/h',                                it: 'km/h' },
  'hud.boost':         { en: 'DRIFT CHARGE',                        it: 'CARICA DERAPATA' },
  'hud.ready':         { en: 'BOOST READY!',                        it: 'BOOST PRONTO!' },

  'race.go':           { en: 'GO!',                                 it: 'VIA!' },
  'race.position':     { en: 'Position',                            it: 'Posizione' },
  'race.finalLap':     { en: 'FINAL LAP!',                          it: 'ULTIMO GIRO!' },
  'race.wrongWay':     { en: 'WRONG WAY!',                          it: 'CONTROMANO!' },
  'race.rocketStart':  { en: 'ROCKET START!',                       it: 'PARTENZA A RAZZO!' },
  'race.trick':        { en: 'TRICK LANDED!',                       it: 'ACROBAZIA RIUSCITA!' },
  'race.recovering':   { en: 'Back on track',                       it: 'Di nuovo in pista' },
  'race.finished':     { en: 'FINISH!',                             it: 'TRAGUARDO!' },
  'race.bestLap':      { en: 'New best lap!',                       it: 'Nuovo miglior giro!' },

  'ordinal.1':         { en: '1st',                                 it: '1º' },
  'ordinal.2':         { en: '2nd',                                 it: '2º' },
  'ordinal.3':         { en: '3rd',                                 it: '3º' },
  'ordinal.4':         { en: '4th',                                 it: '4º' },

  'ai.cinder':         { en: 'Cinder',                              it: 'Cinder' },
  'ai.zephyr':         { en: 'Zephyr',                              it: 'Zephyr' },
  'ai.bastion':        { en: 'Bastion',                             it: 'Bastion' },
  'ai.you':            { en: 'You',                                 it: 'Tu' },

  'pause.title':       { en: 'Paused',                              it: 'Pausa' },

  'results.title':     { en: 'Race Results',                        it: 'Risultati della gara' },
  'results.pos':       { en: 'Position',                            it: 'Posizione' },
  'results.time':      { en: 'Total time',                          it: 'Tempo totale' },
  'results.bestLap':   { en: 'Best lap',                            it: 'Miglior giro' },
  'results.victory':   { en: 'VICTORY!',                            it: 'VITTORIA!' },
  'results.podium':    { en: 'On the podium!',                      it: 'Sul podio!' },
  'results.done':      { en: 'Race complete',                       it: 'Gara completata' },
  'results.rowFormat': { en: '{pos} · {name} · {time}',             it: '{pos} · {name} · {time}' },

  // ---------------------------------------------------------------- garage
  'menu.pilotLine':    { en: 'Pilot: {name}, {species}',            it: 'Pilota: {name}, {species}' },
  'menu.kartLine':     { en: 'Kart: {chassis} · {wheels}',          it: 'Kart: {chassis} · {wheels}' },

  'garage.title':      { en: 'Garage',                              it: 'Officina' },
  'garage.tab.pilot':  { en: 'Pilot',                               it: 'Pilota' },
  'garage.tab.chassis':{ en: 'Chassis',                             it: 'Telaio' },
  'garage.tab.wheels': { en: 'Wheels',                              it: 'Ruote' },
  'garage.tab.paint':  { en: 'Paint',                               it: 'Vernice' },
  'garage.tab.decal':  { en: 'Decal',                               it: 'Decalcomania' },
  'garage.tab.exhaust':{ en: 'Exhaust',                             it: 'Scarico' },
  'garage.tab.effect': { en: 'Boost effect',                        it: 'Effetto turbo' },
  'garage.attributes': { en: 'Attributes',                          it: 'Attributi' },
  'garage.performance':{ en: 'Performance preview',                 it: 'Anteprima prestazioni' },
  'garage.vsEquipped': { en: 'against the equipped build',          it: 'rispetto all’assetto attuale' },
  'garage.statHint':   { en: 'Nothing wins everywhere: every build trades a strength for a weakness.',
                         it: 'Niente vince ovunque: ogni assetto scambia un punto di forza con un difetto.' },
  'garage.saveHint':   { en: 'Selections are saved automatically.', it: 'Le scelte vengono salvate automaticamente.' },
  'garage.dragHint':   { en: 'Drag to spin · scroll to zoom',       it: 'Trascina per ruotare · rotella per lo zoom' },
  'garage.focusPilot': { en: 'Pilot view',                          it: 'Vista pilota' },
  'garage.focusKart':  { en: 'Kart view',                           it: 'Vista kart' },
  'garage.randomize':  { en: 'Surprise me',                         it: 'Sorprendimi' },
  'garage.reset':      { en: 'Stock build',                         it: 'Assetto di serie' },
  'garage.toModes':    { en: 'To the track',                        it: 'In pista' },
  'garage.lockedLevel':{ en: 'Unlocks at level {level}',            it: 'Si sblocca al livello {level}' },
  'garage.lockedAchievement': { en: 'Unlocks with the “{name}” achievement',
                                it: 'Si sblocca con l’impresa “{name}”' },
  'garage.lockedCup':  { en: 'Unlocks by finishing the {name}',     it: 'Si sblocca completando {name}' },
  'garage.equipped':   { en: 'Equipped',                            it: 'Equipaggiato' },
  'garage.selection':  { en: 'Build',                               it: 'Assetto' },

  // ------------------------------------------------- attribute names
  'stat.acceleration': { en: 'Acceleration',                        it: 'Accelerazione' },
  'stat.topSpeed':     { en: 'Top speed',                           it: 'Velocità massima' },
  'stat.handling':     { en: 'Handling',                            it: 'Tenuta' },
  'stat.weight':       { en: 'Weight',                              it: 'Peso' },
  'stat.driftControl': { en: 'Drift control',                       it: 'Controllo derapata' },
  'stat.offRoad':      { en: 'Off-road',                            it: 'Fuoristrada' },
  'stat.short.acceleration': { en: 'ACC',                           it: 'ACC' },
  'stat.short.topSpeed': { en: 'SPD',                               it: 'VEL' },
  'stat.short.handling': { en: 'HND',                               it: 'TEN' },
  'stat.short.weight': { en: 'WGT',                                 it: 'PES' },
  'stat.short.driftControl': { en: 'DRF',                           it: 'DRP' },
  'stat.short.offRoad': { en: 'OFF',                                it: 'OFF' },

  // ------------------------------------------------- performance preview
  'perf.topSpeed':     { en: 'Top speed',                           it: 'Velocità massima' },
  'perf.accel':        { en: '0–100 km/h',                          it: '0–100 km/h' },
  'perf.cornering':    { en: 'Cornering',                           it: 'Curva' },
  'perf.grip':         { en: 'Grip',                                it: 'Aderenza' },
  'perf.offRoad':      { en: 'Off-road cap',                        it: 'Limite fuoristrada' },
  'perf.driftCharge':  { en: 'Full drift charge',                   it: 'Carica derapata completa' },
  'perf.mass':         { en: 'Mass / impact',                       it: 'Massa / impatto' },
  'unit.kmh':          { en: 'km/h',                                it: 'km/h' },
  'unit.sec':          { en: 's',                                   it: 's' },
  'unit.degs':         { en: '°/s',                                 it: '°/s' },
  'unit.x':            { en: '×',                                   it: '×' },

  'ai.speedster':      { en: 'Speedster',                           it: 'Velocista' },
  'ai.technical':      { en: 'Technician',                          it: 'Tecnico' },
  'ai.wildcard':       { en: 'Wildcard',                            it: 'Imprevedibile' },
  'ai.guardian':       { en: 'Guardian',                            it: 'Guardiano' },

  // ---------------------------------------------------------------- records
  'records.title':     { en: 'Records & stats',                        it: 'Record e statistiche' },
  'records.level':     { en: 'Level {level}',                       it: 'Livello {level}' },
  'records.xp':        { en: '{xp} / {next} XP',                    it: '{xp} / {next} XP' },
  'records.achievementsCount': { en: '{earned} of {total} achievements', it: '{earned} di {total} imprese' },
  'records.unlocksCount': { en: '{unlocked} of {total} unlocks',    it: '{unlocked} di {total} sbloccabili' },
  'records.cupsCount': { en: '{earned} of {total} cups',            it: '{earned} di {total} coppe' },
  'records.tracks':    { en: 'Time trial records',                  it: 'Record prove a tempo' },
  'records.leaderboard': { en: 'Leaderboard',                       it: 'Classifica' },
  'records.achievements': { en: 'Achievements',                     it: 'Imprese' },
  'records.stats':     { en: 'Statistics',                          it: 'Statistiche' },
  'records.trophies':  { en: 'Cup trophies',                        it: 'Trofei delle coppe' },
  'records.ghostTag':  { en: 'ghost',                               it: 'fantasma' },
  'records.noRecords': { en: 'No times yet — run a time trial and the board fills up.',
                         it: 'Nessun tempo: corri una prova a tempo e la classifica si riempirà.' },
  'records.earned':    { en: 'Earned',                              it: 'Ottenuta' },
  'records.locked':    { en: 'Locked',                              it: 'Bloccata' },
  'records.loading':   { en: 'Contacting the record service…',      it: 'Contatto il servizio record…' },
  'records.offline':   { en: 'Offline — showing records saved on this device.',
                         it: 'Offline — mostro i record salvati su questo dispositivo.' },
  'records.sourceLocal': { en: 'Saved on this device.',             it: 'Salvati su questo dispositivo.' },
  'records.sourceRemote': { en: 'Global records online.',           it: 'Record globali online.' },
  'records.practice':  { en: 'Practice this track',                 it: 'Prova questa pista' },
  'records.stat.races': { en: 'Races finished',                     it: 'Gare concluse' },
  'records.stat.wins': { en: 'Wins',                                it: 'Vittorie' },
  'records.stat.podiums': { en: 'Podiums',                          it: 'Podi' },
  'records.stat.laps': { en: 'Laps driven',                         it: 'Giri percorsi' },
  'records.stat.fastestLaps': { en: 'Fastest laps',                 it: 'Giri veloci' },
  'records.stat.records': { en: 'Track records',                    it: 'Record di pista' },
  'records.stat.ghostsRaced': { en: 'Ghosts raced',                 it: 'Fantasma sfidati' },
  'records.stat.tracksPlayed': { en: 'Tracks played',               it: 'Piste giocate' },
  'records.stat.cups': { en: 'Cups completed',                      it: 'Coppe completate' },
  'records.stat.cupsGold': { en: 'Gold cups',                       it: 'Coppe d’oro' },
  'records.stat.cupsPlatinum': { en: 'Platinum cups',               it: 'Coppe di platino' },
  'records.stat.itemsTaken': { en: 'Power-ups collected',           it: 'Potenziamenti raccolti' },
  'records.stat.itemsUsed': { en: 'Power-ups used',                 it: 'Potenziamenti usati' },
  'records.stat.battles': { en: 'Battles fought',                   it: 'Battaglie disputate' },
  'records.stat.battleWins': { en: 'Battles won',                   it: 'Battaglie vinte' },
  'records.stat.nightWins': { en: 'Night-shift wins',               it: 'Vittorie in notturna' },

  'error.webgl':       { en: 'WebGL is not available in this browser.',
                         it: 'WebGL non è disponibile in questo browser.' },
};

// Content-owned strings (characters, parts, items...) merged on top so
// content files keep their own EN/IT next to their data.
export const STRINGS = { ...BASE_STRINGS, ...CONTENT_STRINGS };

export class LocalizationManager {
  constructor(saveManager) {
    this.save = saveManager;
    this.lang = saveManager.get('lang', 'en') === 'it' ? 'it' : 'en';
    this.listeners = new Set();
  }

  setLanguage(lang) {
    if (lang !== 'en' && lang !== 'it') return;
    if (lang === this.lang) return;
    this.lang = lang;
    this.save.set('lang', lang);
    for (const fn of this.listeners) fn(lang);
  }

  t(key, vars) {
    const entry = STRINGS[key];
    let s = entry ? (entry[this.lang] ?? entry.en) : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.split(`{${k}}`).join(String(v));
      }
    }
    return s;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
