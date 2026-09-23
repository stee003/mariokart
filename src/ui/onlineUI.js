// ============================================================================
// OnlineUI - the online screen: server status, ranked standing, world ghosts,
// the live lobby and the season ladder.
//
// Like every other screen in the game this module only draws and forwards
// clicks; the OnlineService owns providers and the NetSession owns the socket.
// All visible text comes from the LocalizationManager, so EN/IT switching and
// the localization purity test both work unchanged.
// ============================================================================

const $ = (id) => document.getElementById(id);

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class OnlineUI {
  constructor({
    i18n, service, tracks = [], save = null, session = null,
    onBack = null, onRankedRace = null, onGhostRace = null, onLobbyStart = null,
  } = {}) {
    this.i18n = i18n;
    this.service = service;
    this.tracks = tracks;
    this.save = save;
    this.session = session;
    this.onBack = onBack || (() => {});
    this.onRankedRace = onRankedRace || (() => {});
    this.onGhostRace = onGhostRace || (() => {});
    this.onLobbyStart = onLobbyStart || (() => {});
    this.visible = false;
    this.busy = false;
    this.errorKey = null;
    this.ranked = null;
    this.ladder = [];
    this.rooms = [];
    this.selectedTrackId = tracks[0] ? tracks[0].id : null;
    this.pendingRoom = null;
    this.bind();
    i18n.onChange(() => { if (this.visible) this.render(); });
  }

  // ------------------------------------------------------------------ chrome
  bind() {
    const click = (id, fn) => {
      const node = $(id);
      if (node) node.addEventListener('click', fn);
    };
    click('btn-online-back', () => this.onBack());
    click('btn-online-refresh', () => this.refresh());
    click('btn-online-ranked', () => {
      if (this.selectedTrackId) this.onRankedRace(this.selectedTrackId);
    });
    click('btn-online-ghost', () => {
      if (this.selectedTrackId) this.onGhostRace(this.selectedTrackId, 1);
    });
    click('btn-online-create', () => this.createRoom());
    click('btn-online-join', () => {
      const input = $('online-code');
      const code = (input && input.value ? input.value : '').trim().toUpperCase();
      if (code) this.joinRoom(code);
    });
    click('btn-online-leave', () => this.leaveRoom());
    click('btn-online-start', () => {
      if (this.session) this.session.startRace(this.selectedTrackId);
      this.onLobbyStart(this.selectedTrackId);
    });
    const picker = $('online-track');
    if (picker) {
      for (const def of this.tracks) {
        const opt = el('option', '', this.i18n.t(def.nameKey));
        opt.value = def.id;
        picker.appendChild(opt);
      }
      picker.value = this.selectedTrackId || '';
      picker.addEventListener('change', () => { this.selectedTrackId = picker.value; });
    }
    const nameInput = $('online-name');
    if (nameInput) {
      nameInput.value = this.save ? this.save.get('playerName', 'Racer') : 'Racer';
      nameInput.addEventListener('change', () => {
        const value = (nameInput.value || '').trim() || 'Racer';
        nameInput.value = value;
        if (this.save) this.save.set('playerName', value);
      });
    }
  }

  show() {
    this.visible = true;
    this.render();
    this.refresh();
  }

  hide() { this.visible = false; }

  playerName() {
    return (this.save && this.save.get('playerName', 'Racer')) || 'Racer';
  }

  // ------------------------------------------------------------------ data
  async refresh() {
    if (!this.service) return;
    this.busy = true;
    this.render();
    await this.service.probe();
    if (this.service.online) {
      const [ranked, ladder, rooms] = await Promise.all([
        this.service.getRanked(this.playerName()).catch(() => null),
        this.service.fetchLadder(10),
        this.service.fetchRooms(),
      ]);
      this.ranked = ranked && Number.isFinite(ranked.points) ? ranked : null;
      this.ladder = ladder;
      this.rooms = rooms;
    } else {
      this.ranked = null;
      this.ladder = [];
      this.rooms = [];
    }
    this.busy = false;
    this.render();
  }

  async createRoom() {
    if (!this.session) return;
    this.errorKey = null;
    this.session.connect();
    this.session.on('welcome', (msg) => {
      this.pendingRoom = msg.room;
      this.render();
    });
    this.session.on('serverError', (msg) => {
      this.errorKey = `online.error.${msg.code}`;
      this.render();
    });
    this.session.join({
      create: true,
      profile: this.profile(),
      trackId: this.selectedTrackId,
    });
  }

  async joinRoom(code) {
    if (!this.session) return;
    this.errorKey = null;
    this.session.connect();
    this.session.on('welcome', (msg) => { this.pendingRoom = msg.room; this.render(); });
    this.session.on('serverError', (msg) => {
      this.errorKey = `online.error.${msg.code}`;
      this.render();
    });
    this.session.on('players', () => this.render());
    this.session.join({ room: code, profile: this.profile(), trackId: this.selectedTrackId });
  }

  leaveRoom() {
    if (this.session) this.session.leave();
    this.pendingRoom = null;
    this.render();
  }

  profile() {
    const spec = this.save ? this.save.get('loadout', {}) : {};
    return {
      name: this.playerName(),
      characterId: spec.characterId || null,
      chassisId: spec.chassisId || null,
      wheelId: spec.wheelId || null,
      paintId: spec.paintId || null,
    };
  }

  // ------------------------------------------------------------------ render
  render() {
    const t = (key, vars) => this.i18n.t(key, vars);
    this._renderStatus(t);
    this._renderRanked(t);
    this._renderGhost(t);
    this._renderLobby(t);
    this._renderLadder(t);
  }

  _renderStatus(t) {
    const box = $('online-status');
    if (!box) return;
    const online = this.service && this.service.online;
    box.textContent = this.busy || (this.service && this.service.status === 'checking')
      ? t('online.checking')
      : online
        ? t('online.connected', { latency: this.service.latency ?? 0 })
        : t('online.offline');
    box.className = `records-chip ${online ? 'online' : 'offline'}`;
  }

  _renderRanked(t) {
    const box = $('online-ranked');
    if (!box) return;
    box.innerHTML = '';
    const head = el('div', 'panel-head', t('online.ranked'));
    box.appendChild(head);
    if (!this.service || !this.service.online) {
      box.appendChild(el('div', 'records-row locked', t('online.rankedOffline')));
      return;
    }
    const r = this.ranked;
    if (!r) {
      box.appendChild(el('div', 'records-row', t('online.unranked')));
    } else {
      box.appendChild(el('div', 'records-row', t('online.rankLine', {
        season: r.season, rank: r.rank ?? '—', points: Math.round(r.points),
      })));
      box.appendChild(el('div', 'records-row', t('online.recordLine', {
        wins: r.wins ?? 0, matches: r.matches ?? 0,
      })));
    }
    box.appendChild(el('div', 'records-hint', t('online.rankedHint')));
  }

  _renderGhost(t) {
    const box = $('online-ghost');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'panel-head', t('online.worldGhost')));
    box.appendChild(el('div', 'records-hint', t('online.ghostHint')));
  }

  _renderLobby(t) {
    const box = $('online-lobby');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'panel-head', t('online.lobby')));
    const session = this.session;
    const room = this.pendingRoom || (session && session.room);
    if (this.errorKey) box.appendChild(el('div', 'records-row locked', t(this.errorKey)));
    if (!room) {
      box.appendChild(el('div', 'records-hint', t('online.lobbyHint')));
      if (this.rooms.length) {
        const list = el('div', 'list-scroll short-list');
        for (const r of this.rooms.slice(0, 4)) {
          const row = el('button', 'list-row');
          row.appendChild(el('span', 'list-name', t('online.roomRow', { code: r.code, count: r.players })));
          row.dataset.room = r.code;
          row.addEventListener('click', () => this.joinRoom(r.code));
          list.appendChild(row);
        }
        box.appendChild(list);
      }
      return;
    }
    box.appendChild(el('div', 'records-row', t('online.roomCode', { code: room })));
    const players = session ? [...session.players.values()] : [];
    const list = el('div', 'list-scroll short-list');
    for (const p of players) {
      const row = el('div', 'list-row' + (p.host ? ' selected' : ''));
      row.appendChild(el('span', 'list-name', p.name));
      row.appendChild(el('span', 'list-meta', p.host ? t('online.host') : ''));
      list.appendChild(row);
    }
    box.appendChild(list);
    if (session && session.host) {
      box.appendChild(el('div', 'records-hint', t('online.hostHint')));
    } else {
      box.appendChild(el('div', 'records-hint', t('online.waiting')));
    }
  }

  _renderLadder(t) {
    const box = $('online-ladder');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'panel-head', t('online.ladder')));
    if (!this.ladder.length) {
      box.appendChild(el('div', 'records-row', t('online.ladderEmpty')));
      return;
    }
    const rows = el('div', 'list-scroll short-list');
    for (const row of this.ladder) {
      const line = el('div', 'list-row' + (row.name === this.playerName() ? ' selected' : ''));
      line.appendChild(el('span', 'list-name', `#${row.rank} ${row.name}`));
      line.appendChild(el('span', 'list-meta', t('online.points', { points: Math.round(row.points) })));
      rows.appendChild(line);
    }
    box.appendChild(rows);
  }
}
