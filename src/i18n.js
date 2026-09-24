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
  'menu.kicker':       { en: 'Arcade Grand Prix',                   it: 'Gran Premio Arcade' },
  'menu.command':      { en: 'Race command',                        it: 'Comando gara' },
  'menu.startHint':    { en: 'Choose a mode and take the grid',     it: 'Scegli una modalità e parti' },
  'menu.garageHint':   { en: 'Tune your pilot and kart',            it: 'Personalizza pilota e kart' },
  'menu.settingsHint': { en: 'Controls, display and accessibility', it: 'Comandi, schermo e accessibilità' },
  'menu.activeLoadout':{ en: 'Active loadout',                      it: 'Configurazione attiva' },
  'menu.ready':        { en: 'Ready',                               it: 'Pronto' },

  'settings.title':    { en: 'Settings',                            it: 'Impostazioni' },
  'settings.language': { en: 'Language',                            it: 'Lingua' },
  'settings.camDist':  { en: 'Camera distance',                     it: 'Distanza telecamera' },
  'settings.camHeight':{ en: 'Camera height',                       it: 'Altezza telecamera' },
  'settings.volume':   { en: 'Volume',                              it: 'Volume' },
  'settings.engineVolume': { en: 'Engine volume',                   it: 'Volume motore' },
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
  'pause.raceInProgress': { en: 'Race in progress',                 it: 'Gara in corso' },
  'pause.battleInProgress': { en: 'Battle in progress',             it: 'Battaglia in corso' },
  'pause.settingsHint': { en: 'Settings apply live - the race stays paused while you tune them.',
                          it: 'Le impostazioni si applicano subito: la gara resta in pausa.' },

  // ---------------- finish sequence (results presentation) ----------------
  'results.finishBanner': { en: 'FINISH',                           it: 'TRAGUARDO' },
  'results.posBanner':    { en: '{pos} PLACE',                      it: '{pos} POSTO' },
  'results.winner':       { en: 'Winner',                           it: 'Vincitore' },
  'results.yourTime':     { en: 'Your time',                        it: 'Il tuo tempo' },
  'results.bestLapShort': { en: 'Best lap',                         it: 'Miglior giro' },
  'results.newBest':      { en: 'New personal best!',               it: 'Nuovo record personale!' },
  'results.podiumBanner': { en: 'Podium finish',                    it: 'Arrivo a podio' },

  'results.title':     { en: 'Race Results',                        it: 'Risultati della gara' },
  'results.pos':       { en: 'Position',                            it: 'Posizione' },
  'results.time':      { en: 'Total time',                          it: 'Tempo totale' },
  'results.bestLap':   { en: 'Best lap',                            it: 'Miglior giro' },
  'results.victory':   { en: 'VICTORY!',                            it: 'VITTORIA!' },
  'results.podium':    { en: 'On the podium!',                      it: 'Sul podio!' },
  'results.done':      { en: 'Race complete',                       it: 'Gara completata' },
  'results.rowFormat': { en: '{pos} · {name} · {time}',             it: '{pos} · {name} · {time}' },

  // ---------------- gamepad navigation hints ----------------
  'nav.gamepadHint':   { en: 'Gamepad: stick / D-pad move · A select · B back · START pause',
                         it: 'Gamepad: leva / croce muovi · A seleziona · B indietro · START pausa' },
  'nav.continue':      { en: 'Press A to continue',                 it: 'Premi A per continuare' },

  'error.webgl':       { en: 'WebGL is not available in this browser.',
                         it: 'WebGL non è disponibile in questo browser.' },

  // ---------------- online multiplayer ----------------
  'online.title':      { en: 'Online Multiplayer',                  it: 'Multigiocatore Online' },
  'online.subtitle':   { en: 'Race friends around the world',       it: 'Gareggia con amici da tutto il mondo' },
  'online.playerName': { en: 'Your name',                           it: 'Il tuo nome' },
  'online.lobbies':    { en: 'Lobbies',                             it: 'Lobby' },
  'online.create':     { en: 'Create Lobby',                        it: 'Crea Lobby' },
  'online.join':       { en: 'Join',                                it: 'Unisciti' },
  'online.refresh':    { en: 'Refresh',                             it: 'Aggiorna' },
  'online.leave':      { en: 'Leave',                               it: 'Esci' },
  'online.ready':      { en: 'Ready',                               it: 'Pronto' },
  'online.notReady':   { en: 'Not Ready',                           it: 'Non Pronto' },
  'online.start':      { en: 'Start Race',                          it: 'Inizia Gara' },
  'online.waiting':    { en: 'Waiting for host…',                   it: 'In attesa dell\\u2019host…' },
  'online.connecting': { en: 'Connecting…',                         it: 'Connessione…' },
  'online.connected':  { en: 'Connected',                           it: 'Connesso' },
  'online.disconnected':{ en: 'Disconnected',                       it: 'Disconnesso' },
  'online.noLobbies':  { en: 'No lobbies yet - create one!',       it: 'Nessuna lobby: creane una!' },
  'online.lobbyName':  { en: 'Lobby name',                          it: 'Nome lobby' },
  'online.track':      { en: 'Track',                               it: 'Pista' },
  'online.players':    { en: 'Players',                             it: 'Giocatori' },
  'online.maxPlayers': { en: 'Max players',                         it: 'Max giocatori' },
  'online.chat':       { en: 'Chat',                                it: 'Chat' },
  'online.chatPlaceholder': { en: 'Type a message…',                it: 'Scrivi un messaggio…' },
  'online.send':       { en: 'Send',                                it: 'Invia' },
  'online.host':       { en: 'Host',                                it: 'Host' },
  'online.you':        { en: 'You',                                 it: 'Tu' },
  'online.countdown':  { en: 'Starting in {n}…',                    it: 'Partenza tra {n}…' },
  'online.race':       { en: 'Online Race',                         it: 'Gara Online' },
  'online.battle':     { en: 'Online Battle',                       it: 'Battaglia Online' },
  'online.joinById':   { en: 'Join by ID',                          it: 'Unisciti con ID' },
  'online.lobbyId':    { en: 'Lobby ID',                            it: 'ID Lobby' },
  'online.status':     { en: 'Status: {s}',                         it: 'Stato: {s}' },
  'online.ping':       { en: 'Ping: {ms}ms',                        it: 'Ping: {ms}ms' },
  'online.returnToLobby': { en: 'Return to Lobby',                  it: 'Torna alla Lobby' },
  'online.spectate':   { en: 'Spectating',                          it: 'Spettatore' },
  'online.finished':   { en: 'Finished',                            it: 'Finito' },
  'online.racing':     { en: 'Racing',                              it: 'In gara' },
  'online.inLobby':    { en: 'In lobby',                            it: 'In lobby' },
  'online.countdownState': { en: 'Starting',                        it: 'Partenza' },
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
