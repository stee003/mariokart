// ============================================================================
// LocalizationManager - all UI text lives in this EN/IT dictionary.
// No hardcoded UI strings anywhere else. Usage: i18n.t('hud.lapFormat', {lap, total}).
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
  'settings.size.normal': { en: 'Normal',                           it: 'Normale' },
  'settings.size.large':  { en: 'Large',                            it: 'Grande' },
  'settings.size.xlarge': { en: 'Extra large',                      it: 'Molto grande' },
  'menu.pilotOf':      { en: 'Pilot: {name}',                       it: 'Pilota: {name}' },
  'menu.kartOf':       { en: 'Kart: {name}',                        it: 'Kart: {name}' },

  'difficulty.beginner': { en: 'Beginner',                          it: 'Principiante' },
  'difficulty.easy':     { en: 'Easy',                              it: 'Facile' },
  'difficulty.normal':   { en: 'Normal',                            it: 'Normale' },
  'difficulty.hard':     { en: 'Hard',                              it: 'Difficile' },
  'difficulty.expert':   { en: 'Expert',                            it: 'Esperto' },
  'difficulty.master':   { en: 'Master',                            it: 'Maestro' },

  'settings.uiScale':    { en: 'UI scale',                          it: 'Dimensione interfaccia' },
  'settings.reduceFx':   { en: 'Reduced effects',                   it: 'Effetti ridotti' },
  'settings.colorblind': { en: 'Colorblind-friendly colors',        it: 'Colori per daltonici' },
  'settings.minimap':    { en: 'Minimap',                           it: 'Minimappa' },
  'settings.keys':       { en: 'Key bindings',                      it: 'Comandi tastiera' },
  'settings.resetKeys':  { en: 'Reset bindings',                    it: 'Ripristina comandi' },
  'keys.press':          { en: 'Press a key… (Esc cancels)',        it: 'Premi un tasto… (Esc annulla)' },
  'keys.action.throttle':{ en: 'Accelerate',                        it: 'Acceleratore' },
  'keys.action.brake':   { en: 'Brake / Reverse',                   it: 'Freno / Retromarcia' },
  'keys.action.left':    { en: 'Steer left',                        it: 'Sterzo a sinistra' },
  'keys.action.right':   { en: 'Steer right',                       it: 'Sterzo a destra' },
  'keys.action.drift':   { en: 'Drift',                             it: 'Derapata' },
  'keys.action.trick':   { en: 'Aerial trick',                      it: 'Acrobazia aerea' },
  'keys.action.item':    { en: 'Use power-up',                      it: 'Usa potenziamento' },
  'keys.action.reset':   { en: 'Reset to track',                    it: 'Torna in pista' },
  'keys.action.pause':   { en: 'Pause',                             it: 'Pausa' },
  'keys.action.confirm': { en: 'Confirm',                           it: 'Conferma' },

  'controls.help':     { en: 'WASD / Arrows drive · SHIFT drift · SPACE trick · E power-up · R reset · ESC pause · gamepad supported',
                         it: 'WASD / Frecce guida · SHIFT derapata · SPACE acrobazia · E potenziamento · R reset · ESC pausa · gamepad supportato' },
  'controls.gamepad':  { en: 'Gamepad: RT throttle · LT brake · X drift · Y power-up · A trick · START pause',
                         it: 'Gamepad: RT accelera · LT frena · X derapata · Y potenziamento · A acrobazia · START pausa' },

  'garage.title':      { en: 'Garage',                              it: 'Garage' },
  'garage.character':  { en: 'Pilot',                               it: 'Pilota' },
  'garage.chassis':    { en: 'Chassis',                             it: 'Telaio' },
  'garage.wheels':     { en: 'Wheels',                              it: 'Ruote' },
  'garage.paint':      { en: 'Paint',                               it: 'Vernice' },
  'garage.stats':      { en: 'Effective stats',                     it: 'Statistiche effettive' },
  'garage.lockedLevel':{ en: 'Reach level {level}',                 it: 'Raggiungi il livello {level}' },
  'garage.locked':     { en: 'Locked',                              it: 'Bloccato' },
  'garage.hint':       { en: 'All builds are side-grades: pick what fits your style.', it: 'Tutte le configurazioni sono equivalenti: scegli il tuo stile.' },
  'stat.acceleration': { en: 'Acceleration',                        it: 'Accelerazione' },
  'stat.topSpeed':     { en: 'Top speed',                           it: 'Velocità max' },
  'stat.handling':     { en: 'Handling',                            it: 'Maneggevolezza' },
  'stat.weight':       { en: 'Weight',                              it: 'Peso' },
  'stat.driftControl': { en: 'Drift control',                       it: 'Controllo derapata' },
  'stat.offRoad':      { en: 'Off-road',                            it: 'Fuoristrada' },

  'ach.nightShift':    { en: 'Night Shift',                         it: 'Turno di Notte' },
  'ach.nightShift.d':  { en: 'Set a time trial record on a night track', it: 'Stabilisci un record a tempo su una pista notturna' },
  'ach.collector':     { en: 'Collector',                           it: 'Collezionista' },
  'ach.collector.d':   { en: 'Earn ten other achievements',         it: 'Ottieni altri dieci traguardi' },

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

  'preview.shortcut':  { en: 'Shortcut',                            it: 'Scorciatoia' },
  'preview.pad':       { en: 'Boost pad',                           it: 'Piastra turbo' },
  'preview.ramp':      { en: 'Ramp',                                it: 'Rampa' },
  'preview.box':       { en: 'Item box',                            it: 'Cassa oggetti' },
  'preview.length':    { en: '{km} km',                             it: '{km} km' },
  'preview.laps':      { en: '{laps} laps',                         it: '{laps} giri' },
  'preview.difficulty':{ en: 'Difficulty {stars}',                  it: 'Difficolt\u00e0 {stars}' },
  'preview.record':    { en: 'Record {time}',                       it: 'Record {time}' },

  'ordinal.1':         { en: '1st',                                 it: '1º' },
  'ordinal.2':         { en: '2nd',                                 it: '2º' },
  'ordinal.3':         { en: '3rd',                                 it: '3º' },
  'ordinal.4':         { en: '4th',                                 it: '4º' },
  'ordinal.5':         { en: '5th',                                 it: '5º' },
  'ordinal.6':         { en: '6th',                                 it: '6º' },
  'ordinal.7':         { en: '7th',                                 it: '7º' },
  'ordinal.8':         { en: '8th',                                 it: '8º' },

  'ai.cinder':         { en: 'Cinder',                              it: 'Cinder' },
  'ai.zephyr':         { en: 'Zephyr',                              it: 'Zephyr' },
  'ai.bastion':        { en: 'Bastion',                             it: 'Bastion' },
  'ai.nova':           { en: 'Nova',                                it: 'Nova' },
  'ai.thistle':        { en: 'Thistle',                             it: 'Thistle' },
  'ai.coral':          { en: 'Coral',                               it: 'Coral' },
  'ai.volt':           { en: 'Volt',                                it: 'Volt' },
  'ai.obsidian':       { en: 'Obsidian',                            it: 'Obsidian' },
  'ai.juniper':        { en: 'Juniper',                             it: 'Juniper' },
  'ai.ratchet':        { en: 'Ratchet',                             it: 'Ratchet' },
  'ai.lumi':           { en: 'Lumi',                                it: 'Lumi' },
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
