// ============================================================================
// createRelay - glue between the WebSocket server and the RoomManager.
//
// Message protocol (JSON, all messages carry `t`):
//   client -> server
//     {t:'join', room?, create?, profile, trackId?}   enter (or open) a lobby
//     {t:'state', ...sample}                          kart snapshot, ~20 Hz
//     {t:'start', trackId?}                           host starts the race
//     {t:'finish', time, position}                    report own finish
//     {t:'leave'}                                     exit the lobby
//   server -> client
//     {t:'welcome', id, room, trackId, laps, host, players[]}
//     {t:'players', players[]}
//     {t:'left', id, name}
//     {t:'started', trackId, laps, at}
//     {t:'state', id, ...sample}
//     {t:'finished', id, name, time, position, standings[]}
//     {t:'over', reason, standings[]}
//     {t:'error', code}
//
// The relay never trusts timings or positions from a client beyond the
// sanitised sample; it decides when the race starts and when it is over.
// ============================================================================

export function playerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.profile.name, host: p.isHost,
    characterId: p.profile.characterId, chassisId: p.profile.chassisId,
    wheelId: p.profile.wheelId, paintId: p.profile.paintId,
    finished: p.finished, time: p.time,
  }));
}

export function createRelay({ ws, rooms, now = () => Date.now(), heartbeatMs = 25000 }) {
  function sendTo(conn, msg) { conn.send(msg); }

  function broadcastRoom(room, msg, exceptId = null) {
    for (const p of room.players.values()) {
      if (p.id === exceptId) continue;
      p.conn.send(msg);
    }
  }

  function endRace(room, reason) {
    if (!room.started || room.over) return null;
    room.over = true;
    const standings = rooms.standings(room);
    broadcastRoom(room, { t: 'over', reason, standings, at: now() });
    return standings;
  }

  function onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.t;

    if (type === 'join') {
      const res = rooms.join(conn, {
        room: msg.room, create: !!msg.create, profile: msg.profile || {},
      });
      if (res.error) return sendTo(conn, { t: 'error', code: res.error });
      const { room, player } = res;
      if (Number.isFinite(Number(msg.laps))) room.laps = Math.max(1, Math.min(9, Math.floor(Number(msg.laps))));
      if (typeof msg.trackId === 'string') room.trackId = msg.trackId.slice(0, 48);
      sendTo(conn, {
        t: 'welcome', id: conn.id, room: room.code, host: player.isHost,
        trackId: room.trackId, laps: room.laps, players: playerList(room),
      });
      broadcastRoom(room, { t: 'players', players: playerList(room) }, conn.id);
      return;
    }

    if (type === 'leave') {
      const room = rooms.leave(conn);
      if (room) broadcastRoom(room, { t: 'players', players: playerList(room) });
      return;
    }

    if (type === 'state') {
      const res = rooms.state(conn, msg);
      if (res.error || res.dropped) return;
      broadcastRoom(res.room, { t: 'state', id: conn.id, ...res.state }, conn.id);
      return;
    }

    if (type === 'start') {
      const res = rooms.start(conn, { trackId: msg.trackId });
      if (res.error) return sendTo(conn, { t: 'error', code: res.error });
      const { room } = res;
      broadcastRoom(room, {
        t: 'started', trackId: room.trackId, laps: room.laps, at: now(),
        players: playerList(room),
      });
      return;
    }

    if (type === 'finish') {
      const res = rooms.finish(conn, { time: msg.time, position: msg.position });
      if (res.error) return sendTo(conn, { t: 'error', code: res.error });
      const { room, player } = res;
      const standings = rooms.standings(room);
      broadcastRoom(room, {
        t: 'finished', id: player.id, name: player.profile.name,
        time: player.time, position: player.position, standings,
      });
      if (rooms.shouldEnd(room)) endRace(room, 'all-finished');
      return;
    }

    sendTo(conn, { t: 'error', code: 'unknown-type' });
  }

  ws.on('connection', (conn) => {
    conn.on('message', (msg) => {
      try { onMessage(conn, msg); } catch { sendTo(conn, { t: 'error', code: 'server-error' }); }
    });
    conn.on('close', () => {
      const room = rooms.leave(conn);
      if (room) {
        broadcastRoom(room, { t: 'players', players: playerList(room) });
        if (room.started && rooms.shouldEnd(room)) endRace(room, 'room-emptied');
      }
    });
  });

  // Heartbeat: keeps NAT paths open and reaps dead sockets.
  const timer = setInterval(() => {
    for (const conn of ws.connections) {
      if (conn.closed) continue;
      if (!conn.alive) { conn.close(1001); continue; }
      conn.alive = false;
      conn.ping();
      conn.once('pong', () => { conn.alive = true; });
    }
    rooms.sweep();
    for (const room of rooms.rooms.values()) {
      if (rooms.shouldEnd(room)) endRace(room, 'timeout');
    }
  }, heartbeatMs);
  if (timer.unref) timer.unref();

  return { onMessage, endRace, stop: () => clearInterval(timer), playerList };
}
