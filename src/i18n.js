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
