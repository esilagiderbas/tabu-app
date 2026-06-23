// Kelime Avı (Tabu) — bağımlılıksız Node.js sunucusu
// Çalıştırmak için: node server.js
// Hiçbir npm install gerekmez, sadece Node.js yüklü olması yeterli.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORDS_FILE = path.join(__dirname, 'words.json');

// ---------- Statik dosya sunumu ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bulunamadı');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Kelime listesi yönetimi (dosyada saklanır) ----------
function loadWords() {
  try {
    return JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}
function saveWords(words) {
  fs.writeFileSync(WORDS_FILE, JSON.stringify(words, null, 2), 'utf8');
}

// ---------- HTTP API (kelime ekleme/silme/listeleme) ----------
function handleApi(req, res) {
  if (req.url === '/api/words' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(loadWords()));
  }
  if (req.url === '/api/words' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const newWord = JSON.parse(body);
        if (!newWord.main || !Array.isArray(newWord.forbidden)) {
          res.writeHead(400);
          return res.end('Geçersiz veri');
        }
        const words = loadWords();
        newWord.id = crypto.randomUUID();
        words.push(newWord);
        saveWords(words);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(newWord));
      } catch (e) {
        res.writeHead(400);
        res.end('Hatalı istek');
      }
    });
    return;
  }
  if (req.url.startsWith('/api/words/') && req.method === 'DELETE') {
    const id = req.url.split('/').pop();
    const words = loadWords().filter((w) => w.id !== id);
    saveWords(words);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404);
  res.end('Bulunamadı');
}

// ---------- HTTP sunucu ----------
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

// ====================================================================
// WebSocket implementasyonu (RFC 6455) — sıfırdan, bağımlılık yok
// ====================================================================
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_MAGIC)
    .digest('base64');
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '', '',
  ].join('\r\n');
  socket.write(headers);
  return socket;
}

function encodeFrame(data) {
  const json = Buffer.from(JSON.stringify(data));
  const len = json.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, json]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const opcode = firstByte & 0x0f;
  if (opcode === 0x8) return { opcode, payload: null }; // close
  const secondByte = buffer[1];
  const masked = !!(secondByte & 0x80);
  let len = secondByte & 0x7f;
  let offset = 2;
  if (len === 126) {
    len = buffer.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    len = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  let payload;
  if (masked) {
    const maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
    const data = buffer.slice(offset, offset + len);
    payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      payload[i] = data[i] ^ maskKey[i % 4];
    }
  } else {
    payload = buffer.slice(offset, offset + len);
  }
  try {
    return { opcode, payload: JSON.parse(payload.toString('utf8')) };
  } catch (e) {
    return { opcode, payload: null };
  }
}

// ---------- Oda / Oyun durumu ----------
// rooms: { [roomCode]: { players: Map<socket, {id,name,team,isHost}>, state: {...} } }
const rooms = {};

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Her oyuncuya kişiselleştirilmiş state gönderir: anlatıcı kartı görür, diğerleri görmez.
function personalizedState(room, player) {
  const s = room.state;
  const isNarrator = s.narratorId && player && player.id === s.narratorId;
  const clone = JSON.parse(JSON.stringify(s));
  if (s.phase === 'playing' && !isNarrator) {
    clone.currentCard = null; // diğer oyunculardan kelime gizlenir
  }
  clone.you = player ? { id: player.id, name: player.name, team: player.team, isHost: player.isHost } : null;
  clone.isNarrator = !!isNarrator;
  clone.players = [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, isHost: p.isHost }));
  return clone;
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  for (const [sock, player] of room.players) {
    try {
      sock.write(encodeFrame({ type: 'state', state: personalizedState(room, player) }));
    } catch (e) {}
  }
}

function freshGameState(settings) {
  return {
    phase: 'lobby', // lobby | playing | turnEnd | gameOver
    settings, // { turnSeconds, tabuLimit, passLimit }
    teams: { A: { name: 'Takım 1', score: 0, tabuCount: 0 }, B: { name: 'Takım 2', score: 0, tabuCount: 0 } },
    currentTeam: 'A',
    deck: [],
    deckIndex: 0,
    currentCard: null,
    turnEndsAt: null,
    passesLeftThisTurn: settings ? settings.passLimit : 3,
    log: [],
    winner: null,
    narratorId: null,
    narratorName: null,
    turnOrder: { A: [], B: [] }, // her takım için alfabetik oyuncu id sırası
    turnPointer: { A: 0, B: 0 }, // her takımın sırada kimde olduğu
  };
}

function rebuildTurnOrder(room) {
  const s = room.state;
  for (const team of ['A', 'B']) {
    const members = [...room.players.values()]
      .filter((p) => p.team === team)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    s.turnOrder[team] = members.map((p) => p.id);
    if (s.turnPointer[team] >= s.turnOrder[team].length) s.turnPointer[team] = 0;
  }
}

function pickNarrator(room) {
  const s = room.state;
  rebuildTurnOrder(room);
  const order = s.turnOrder[s.currentTeam];
  if (order.length === 0) {
    s.narratorId = null;
    s.narratorName = null;
    return;
  }
  const idx = s.turnPointer[s.currentTeam] % order.length;
  s.narratorId = order[idx];
  const player = [...room.players.values()].find((p) => p.id === s.narratorId);
  s.narratorName = player ? player.name : null;
  s.turnPointer[s.currentTeam] = (idx + 1) % order.length;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startTurn(room) {
  const s = room.state;
  s.phase = 'playing';
  s.passesLeftThisTurn = s.settings.passLimit;
  pickNarrator(room);
  if (s.deckIndex >= s.deck.length) {
    s.deck = shuffle(s.deck);
    s.deckIndex = 0;
  }
  s.currentCard = s.deck[s.deckIndex];
  s.deckIndex++;
  s.turnEndsAt = Date.now() + s.settings.turnSeconds * 1000;
}

function nextCard(room) {
  const s = room.state;
  if (s.deckIndex >= s.deck.length) {
    s.deck = shuffle(s.deck);
    s.deckIndex = 0;
  }
  s.currentCard = s.deck[s.deckIndex];
  s.deckIndex++;
}

function endTurn(room, reason) {
  const s = room.state;
  s.phase = 'turnEnd';
  s.lastTurnReason = reason;
  s.currentTeam = s.currentTeam === 'A' ? 'B' : 'A';
}

const roomTimers = {};

function tickRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state.phase !== 'playing') return;
  const s = room.state;
  const remaining = Math.max(0, Math.round((s.turnEndsAt - Date.now()) / 1000));
  if (remaining <= 0) {
    endTurn(room, 'time');
    broadcastState(roomCode);
    return;
  }
  broadcastRaw(roomCode, { type: 'tick', remaining });
}

function broadcastRaw(roomCode, data) {
  const room = rooms[roomCode];
  if (!room) return;
  const frame = encodeFrame(data);
  for (const sock of room.players.keys()) {
    try {
      sock.write(frame);
    } catch (e) {}
  }
}

function ensureTimer(roomCode) {
  if (roomTimers[roomCode]) return;
  roomTimers[roomCode] = setInterval(() => tickRoom(roomCode), 1000);
}

function checkGameOver(room) {
  const s = room.state;
  for (const key of ['A', 'B']) {
    if (s.teams[key].tabuCount >= s.settings.tabuLimit) {
      s.phase = 'gameOver';
      const other = key === 'A' ? 'B' : 'A';
      s.winner = other;
      return true;
    }
  }
  return false;
}

function handleMessage(roomCode, ws, msg) {
  const room = rooms[roomCode];
  if (!room) return;
  const s = room.state;
  const player = room.players.get(ws);

  switch (msg.type) {
    case 'join': {
      if (!player) return;
      player.name = (msg.name || 'Oyuncu').slice(0, 20).trim() || 'Oyuncu';
      player.team = msg.team === 'B' ? 'B' : 'A';
      rebuildTurnOrder(room);
      broadcastState(roomCode);
      break;
    }
    case 'setTeamName': {
      if (!player || !player.isHost) break; // sadece kurucu
      if (s.teams[msg.team]) s.teams[msg.team].name = msg.name.slice(0, 20);
      broadcastState(roomCode);
      break;
    }
    case 'startGame': {
      if (!player || !player.isHost) break; // sadece kurucu
      if (s.phase !== 'lobby') break;
      rebuildTurnOrder(room);
      if (s.turnOrder.A.length === 0 || s.turnOrder.B.length === 0) {
        ws.write(encodeFrame({ type: 'error', message: 'Her iki takımda da en az 1 oyuncu olmalı.' }));
        break;
      }
      const words = loadWords();
      if (words.length < 5) {
        ws.write(encodeFrame({ type: 'error', message: 'En az 5 kelime eklemelisin.' }));
        break;
      }
      s.settings = msg.settings;
      s.passesLeftThisTurn = msg.settings.passLimit;
      s.deck = shuffle(words);
      s.deckIndex = 0;
      s.turnPointer = { A: 0, B: 0 };
      startTurn(room);
      ensureTimer(roomCode);
      broadcastState(roomCode);
      break;
    }
    case 'beginTurn': {
      if (!player || !player.isHost) break; // sadece kurucu sıradaki turu başlatır
      if (s.phase !== 'turnEnd' && s.phase !== 'lobby') break;
      startTurn(room);
      broadcastState(roomCode);
      break;
    }
    case 'correct': {
      if (s.phase !== 'playing') break;
      if (!player || player.id !== s.narratorId) break; // sadece anlatıcı işaretleyebilir
      s.teams[s.currentTeam].score += 1;
      s.log.unshift({ word: s.currentCard.main, result: 'correct', team: s.currentTeam });
      nextCard(room);
      broadcastState(roomCode);
      break;
    }
    case 'tabu': {
      if (s.phase !== 'playing') break;
      if (!player || player.id !== s.narratorId) break;
      s.teams[s.currentTeam].tabuCount += 1;
      s.teams[s.currentTeam].score = Math.max(0, s.teams[s.currentTeam].score - 1);
      s.log.unshift({ word: s.currentCard.main, result: 'tabu', team: s.currentTeam });
      if (checkGameOver(room)) {
        broadcastState(roomCode);
        break;
      }
      nextCard(room);
      broadcastState(roomCode);
      break;
    }
    case 'pass': {
      if (s.phase !== 'playing') break;
      if (!player || player.id !== s.narratorId) break;
      if (s.passesLeftThisTurn <= 0) break;
      s.passesLeftThisTurn -= 1;
      s.log.unshift({ word: s.currentCard.main, result: 'pass', team: s.currentTeam });
      nextCard(room);
      broadcastState(roomCode);
      break;
    }
    case 'endTurnManual': {
      if (!player || !player.isHost) break; // sadece kurucu erken bitirebilir (karışıklığı önlemek için)
      if (s.phase !== 'playing') break;
      endTurn(room, 'manual');
      broadcastState(roomCode);
      break;
    }
    case 'restart': {
      if (!player || !player.isHost) break;
      rooms[roomCode].state = freshGameState(s.settings);
      broadcastState(roomCode);
      break;
    }
    case 'sync': {
      broadcastState(roomCode);
      break;
    }
  }
}

server.on('upgrade', (req, socket) => {
  const urlParts = req.url.split('/').filter(Boolean); // ws/ROOMCODE  or  ws/new
  if (urlParts[0] !== 'ws') {
    socket.destroy();
    return;
  }
  let roomCode = urlParts[1];
  let isHost = false;

  if (roomCode === 'new') {
    roomCode = makeRoomCode();
    isHost = true;
    rooms[roomCode] = {
      players: new Map(),
      state: freshGameState({ turnSeconds: 90, tabuLimit: 3, passLimit: 5 }),
    };
  } else if (!rooms[roomCode]) {
    socket.destroy();
    return;
  }

  acceptWebSocket(req, socket);
  const room = rooms[roomCode];
  const playerId = crypto.randomUUID();
  const player = { id: playerId, name: isHost ? 'Kurucu' : 'Oyuncu', team: 'A', isHost };
  room.players.set(socket, player);

  socket.write(
    encodeFrame({ type: 'joined', roomCode, you: player, state: personalizedState(room, player) })
  );
  broadcastState(roomCode);

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const secondByte = buffer[1];
      let len = secondByte & 0x7f;
      let headerLen = 2;
      if (len === 126) headerLen = 4;
      else if (len === 127) headerLen = 10;
      const masked = !!(secondByte & 0x80);
      if (masked) headerLen += 4;
      if (buffer.length < headerLen) break;
      if (len === 126) len = buffer.readUInt16BE(2);
      else if (len === 127) len = Number(buffer.readBigUInt64BE(2));
      const totalLen = headerLen + len;
      if (buffer.length < totalLen) break;
      const frameBuf = buffer.slice(0, totalLen);
      buffer = buffer.slice(totalLen);
      const frame = decodeFrame(frameBuf);
      if (!frame) continue;
      if (frame.opcode === 0x8) {
        socket.end();
        continue;
      }
      if (frame.payload) {
        handleMessage(roomCode, socket, frame.payload);
      }
    }
  });

  socket.on('close', () => {
    if (rooms[roomCode]) {
      rooms[roomCode].players.delete(socket);
      rebuildTurnOrder(rooms[roomCode]);
      broadcastState(roomCode);
    }
  });
  socket.on('error', () => {
    if (rooms[roomCode]) {
      rooms[roomCode].players.delete(socket);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  console.log('\n🎉 Kelime Avı sunucusu çalışıyor!\n');
  console.log(`   Bu bilgisayarda: http://localhost:${PORT}`);
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Aynı WiFi'daki arkadaşın için: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('\n   Kapatmak için Ctrl+C\n');
});
