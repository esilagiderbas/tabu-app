// ===================== Kelime Avı — istemci mantığı =====================

let ws = null;
let roomCode = null;
let myInfo = null; // { id, name, team, isHost }
let settings = { turnSeconds: 90, tabuLimit: 3, passLimit: 5 };
let latestState = null;
let hasJoinedWithName = false;

const screens = {
  entry: document.getElementById('screen-entry'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  turnend: document.getElementById('screen-turnend'),
  gameover: document.getElementById('screen-gameover'),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/${path}`;
}

function connect(path, onJoined) {
  ws = new WebSocket(wsUrl(path));
  ws.addEventListener('open', () => {});
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg, onJoined);
  });
  ws.addEventListener('close', () => {});
  ws.addEventListener('error', () => {});
}

function handleServerMessage(msg, onJoined) {
  if (msg.type === 'joined') {
    roomCode = msg.roomCode;
    myInfo = msg.you;
    latestState = msg.state;
    document.getElementById('room-code-display').textContent = roomCode;
    if (onJoined) onJoined();
    renderState();
    return;
  }
  if (msg.type === 'state') {
    latestState = msg.state;
    if (msg.state.you) myInfo = msg.state.you;
    renderState();
    return;
  }
  if (msg.type === 'tick') {
    updateTimer(msg.remaining);
    return;
  }
  if (msg.type === 'error') {
    const errEl = document.getElementById('word-error');
    if (errEl) errEl.textContent = msg.message;
    return;
  }
}

// ===================== SES SİSTEMİ (Web Audio API) =====================

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(config) {
  try {
    const ctx = getAudioCtx();
    const { notes, type = 'sine', gainVal = 0.18, duration = 0.12, gap = 0 } = config;
    let startTime = ctx.currentTime + 0.01;

    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);

      startTime += duration + gap;
    });
  } catch (e) {
    // ses çalınamazsa sessizce geç
  }
}

// Doğru — yükselen iki nota, yeşil/neşeli
function soundCorrect() {
  playTone({ notes: [523, 784], type: 'sine', gainVal: 0.2, duration: 0.13, gap: 0.04 });
}

// Tabu — alçalan iki nota, gergin
function soundTabu() {
  playTone({ notes: [330, 220], type: 'sawtooth', gainVal: 0.15, duration: 0.14, gap: 0.03 });
}

// Pas — kısa nötr tek nota
function soundPass() {
  playTone({ notes: [392], type: 'triangle', gainVal: 0.14, duration: 0.1 });
}

// Genel UI tık sesi — çok hafif
function soundClick() {
  playTone({ notes: [660], type: 'sine', gainVal: 0.08, duration: 0.07 });
}

// Oyun başladı / tur başladı
function soundStart() {
  playTone({ notes: [440, 554, 659], type: 'sine', gainVal: 0.15, duration: 0.1, gap: 0.06 });
}

// Süre acil — tek kısa bip
function soundUrgentTick() {
  playTone({ notes: [880], type: 'square', gainVal: 0.06, duration: 0.05 });
}

// Oyun bitti — inen üçlü
function soundGameOver() {
  playTone({ notes: [659, 523, 392], type: 'sine', gainVal: 0.18, duration: 0.15, gap: 0.08 });
}

// Tüm butonlara tık sesi bağla (genel)
function attachClickSounds() {
  document.querySelectorAll('button, .chip').forEach((el) => {
    el.addEventListener('pointerdown', () => soundClick(), { passive: true });
  });
}

// ---------- Giriş ekranı ----------
document.getElementById('btn-create-room').addEventListener('click', () => {
  connect('new', () => {
    showScreen('lobby');
    loadWordList();
    renderLobbyVisibility();
  });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) {
    document.getElementById('entry-error').textContent = 'Lütfen bir oda kodu gir.';
    return;
  }
  connect(code, () => {
    showScreen('lobby');
    loadWordList();
    renderLobbyVisibility();
  });
  setTimeout(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      document.getElementById('entry-error').textContent = 'Bu kodla bir oda bulunamadı.';
    }
  }, 800);
});

// ---------- Lobi: isim + takım seçimi ----------
const myTeamChips = document.getElementById('chip-my-team');
let selectedJoinTeam = 'A';
myTeamChips.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    myTeamChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    selectedJoinTeam = chip.dataset.value;
  });
});

document.getElementById('btn-confirm-join').addEventListener('click', () => {
  const name = document.getElementById('my-name-input').value.trim();
  if (!name) {
    document.getElementById('my-name-input').focus();
    return;
  }
  send({ type: 'join', name, team: selectedJoinTeam });
  hasJoinedWithName = true;
  renderLobbyVisibility();
});

document.getElementById('btn-edit-join').addEventListener('click', () => {
  hasJoinedWithName = false;
  renderLobbyVisibility();
});

function renderLobbyVisibility() {
  const joinPanel = document.getElementById('join-form-panel');
  const playersPanel = document.getElementById('players-panel');
  const teamNamesPanel = document.getElementById('team-names-panel');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsReadonlyPanel = document.getElementById('settings-readonly-panel');
  const startBtn = document.getElementById('btn-start-game');
  const waitNote = document.getElementById('non-host-wait-note');

  if (!hasJoinedWithName) {
    joinPanel.style.display = '';
    playersPanel.style.display = 'none';
  } else {
    joinPanel.style.display = 'none';
    playersPanel.style.display = '';
  }

  const isHost = myInfo && myInfo.isHost;
  teamNamesPanel.style.display = isHost ? '' : 'none';
  settingsPanel.style.display = isHost ? '' : 'none';
  settingsReadonlyPanel.style.display = isHost ? 'none' : '';
  startBtn.classList.toggle('hidden', !isHost);
  waitNote.classList.toggle('hidden', !!isHost);
}

// ---------- Lobi: çip seçimleri (sadece kurucu kullanır) ----------
function setupChipGroup(containerId, settingKey) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      settings[settingKey] = parseInt(chip.dataset.value, 10);
    });
  });
}
setupChipGroup('chip-time', 'turnSeconds');
setupChipGroup('chip-tabu', 'tabuLimit');
setupChipGroup('chip-pass', 'passLimit');

// ---------- Lobi: takım adları (sadece kurucu) ----------
document.getElementById('team-a-name').addEventListener('input', (e) => {
  send({ type: 'setTeamName', team: 'A', name: e.target.value || 'Takım 1' });
});
document.getElementById('team-b-name').addEventListener('input', (e) => {
  send({ type: 'setTeamName', team: 'B', name: e.target.value || 'Takım 2' });
});

// ---------- Lobi: kelime listesi yönetimi (herkese açık) ----------
async function loadWordList() {
  const res = await fetch('/api/words');
  const words = await res.json();
  renderWordList(words);
}

function renderWordList(words) {
  const list = document.getElementById('word-list');
  document.getElementById('word-count').textContent = `(${words.length})`;
  if (words.length === 0) {
    list.innerHTML = '<p class="small-note">Henüz kelime yok. Aşağıdan ekleyebilirsin.</p>';
    return;
  }
  list.innerHTML = words
    .map(
      (w) => `
    <div class="word-row" data-id="${w.id}">
      <div class="info">
        <div class="main">${escapeHtml(w.main)}</div>
        <div class="forb">${w.forbidden.map(escapeHtml).join(' · ')}</div>
      </div>
      <button class="delete-btn" data-id="${w.id}">Sil</button>
    </div>`
    )
    .join('');

  list.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      soundClick();
      await fetch(`/api/words/${btn.dataset.id}`, { method: 'DELETE' });
      loadWordList();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('btn-add-word').addEventListener('click', async () => {
  const main = document.getElementById('new-word-main').value.trim();
  const forbInputs = Array.from(document.querySelectorAll('.forb-input'));
  const forbidden = forbInputs.map((i) => i.value.trim()).filter(Boolean);
  const errEl = document.getElementById('word-error');

  if (!main) {
    errEl.textContent = 'Ana kelimeyi gir.';
    return;
  }
  if (forbidden.length < 4) {
    errEl.textContent = 'En az 4 yasaklı kelime gir.';
    return;
  }
  errEl.textContent = '';

  soundClick();
  await fetch('/api/words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ main, forbidden }),
  });

  document.getElementById('new-word-main').value = '';
  forbInputs.forEach((i) => (i.value = ''));
  loadWordList();
});

// ---------- Lobi: oyunu başlat (sadece kurucu) ----------
document.getElementById('btn-start-game').addEventListener('click', () => {
  soundStart();
  send({ type: 'startGame', settings });
});

// ---------- Oyun ekranı: aksiyonlar ----------
document.getElementById('btn-correct').addEventListener('click', () => {
  soundCorrect();
  send({ type: 'correct' });
});
document.getElementById('btn-tabu').addEventListener('click', () => {
  soundTabu();
  send({ type: 'tabu' });
});
document.getElementById('btn-pass').addEventListener('click', () => {
  soundPass();
  send({ type: 'pass' });
});
document.getElementById('btn-end-turn').addEventListener('click', () => {
  soundClick();
  send({ type: 'endTurnManual' });
});
document.getElementById('btn-next-turn').addEventListener('click', () => {
  soundStart();
  send({ type: 'beginTurn' });
});
document.getElementById('btn-restart').addEventListener('click', () => {
  soundStart();
  send({ type: 'restart' });
});

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ---------- Durumu ekrana yansıt ----------
let lastPhase = null;
let lastTimerUrgent = false;

function renderState() {
  if (!latestState) return;
  const s = latestState;

  // Faz geçiş sesleri
  if (s.phase !== lastPhase) {
    if (s.phase === 'playing' && lastPhase === 'lobby') soundStart();
    if (s.phase === 'playing' && lastPhase === 'turnEnd') soundStart();
    if (s.phase === 'gameOver') soundGameOver();
    lastPhase = s.phase;
  }

  if (s.phase === 'lobby') {
    showScreen('lobby');
    renderPlayersList(s);
    if (myInfo && myInfo.isHost) {
      document.getElementById('team-a-name').value = s.teams.A.name;
      document.getElementById('team-b-name').value = s.teams.B.name;
    }
    return;
  }
  if (s.phase === 'playing') {
    showScreen('game');
    renderGame(s);
    return;
  }
  if (s.phase === 'turnEnd') {
    showScreen('turnend');
    renderTurnEnd(s);
    return;
  }
  if (s.phase === 'gameOver') {
    showScreen('gameover');
    renderGameOver(s);
    return;
  }
}

function renderPlayersList(s) {
  const container = document.getElementById('players-list');
  if (!s.players || s.players.length === 0) {
    container.innerHTML = '<p class="small-note">Henüz kimse katılmadı.</p>';
    return;
  }
  const teamAName = s.teams.A.name;
  const teamBName = s.teams.B.name;
  container.innerHTML = `<div class="player-chip-row">${s.players
    .map(
      (p) =>
        `<div class="player-chip team-${p.team.toLowerCase()}">${p.isHost ? '<span class="host-star">⭐</span>' : ''}${escapeHtml(
          p.name
        )} · ${p.team === 'A' ? teamAName : teamBName}</div>`
    )
    .join('')}</div>`;
}

function renderGame(s) {
  document.getElementById('score-a-name').textContent = s.teams.A.name;
  document.getElementById('score-b-name').textContent = s.teams.B.name;
  document.getElementById('score-a-num').textContent = s.teams.A.score;
  document.getElementById('score-b-num').textContent = s.teams.B.score;
  document.getElementById('score-a-tabu').textContent = `tabu: ${s.teams.A.tabuCount}/${s.settings.tabuLimit}`;
  document.getElementById('score-b-tabu').textContent = `tabu: ${s.teams.B.tabuCount}/${s.settings.tabuLimit}`;

  document.getElementById('score-a').classList.toggle('active', s.currentTeam === 'A');
  document.getElementById('score-b').classList.toggle('active', s.currentTeam === 'B');

  const teamLabel = s.currentTeam === 'A' ? s.teams.A.name : s.teams.B.name;
  document.getElementById('turn-indicator').textContent = `${teamLabel} anlatıyor`;

  const isNarrator = !!s.isNarrator;
  const narratorCard = document.getElementById('narrator-card');
  const watchingCard = document.getElementById('watching-card');
  const narratorActions = document.getElementById('narrator-actions');
  const passCount = document.getElementById('pass-count');
  const endTurnBtn = document.getElementById('btn-end-turn');

  if (isNarrator && s.currentCard) {
    narratorCard.classList.remove('hidden');
    watchingCard.classList.add('hidden');
    narratorActions.classList.remove('hidden');
    document.getElementById('card-main').textContent = s.currentCard.main;
    document.getElementById('card-forbidden').innerHTML = s.currentCard.forbidden
      .map((w) => `<div class="forbidden-item">${escapeHtml(w)}</div>`)
      .join('');
    passCount.classList.remove('hidden');
    passCount.textContent = `Pas hakkı: ${s.passesLeftThisTurn}`;
    document.getElementById('btn-pass').disabled = s.passesLeftThisTurn <= 0;
  } else {
    narratorCard.classList.add('hidden');
    watchingCard.classList.remove('hidden');
    narratorActions.classList.add('hidden');
    passCount.classList.add('hidden');
    document.getElementById('watching-narrator-name').textContent = s.narratorName || '—';
  }

  endTurnBtn.classList.toggle('hidden', !(myInfo && myInfo.isHost));

  const remaining = Math.max(0, Math.round((s.turnEndsAt - Date.now()) / 1000));
  updateTimer(remaining);
}

function updateTimer(remaining) {
  const el = document.getElementById('timer-display');
  if (!el || screens.game.classList.contains('hidden')) return;
  el.textContent = remaining;
  const isUrgent = remaining <= 10 && remaining > 0;
  el.classList.toggle('urgent', isUrgent);

  // Son 10 saniyede her saniye bip sesi
  if (isUrgent && !lastTimerUrgent) {
    lastTimerUrgent = true;
  }
  if (isUrgent) {
    soundUrgentTick();
  } else {
    lastTimerUrgent = false;
  }
}

function renderTurnEnd(s) {
  document.getElementById('turnend-text').textContent =
    s.lastTurnReason === 'manual' ? 'Tur erken bitirildi.' : 'Süre doldu, sıra diğer takımda!';

  const teA = document.getElementById('te-score-a');
  const teB = document.getElementById('te-score-b');
  teA.querySelector('.name').textContent = s.teams.A.name;
  teA.querySelector('.num').textContent = s.teams.A.score;
  teB.querySelector('.name').textContent = s.teams.B.name;
  teB.querySelector('.num').textContent = s.teams.B.score;

  const isHost = myInfo && myInfo.isHost;
  document.getElementById('btn-next-turn').classList.toggle('hidden', !isHost);
  document.getElementById('turnend-wait-note').classList.toggle('hidden', !!isHost);
  document.getElementById('btn-next-turn').textContent = `${s.teams[s.currentTeam].name}, başla`;

  const logList = document.getElementById('log-list');
  const icons = { correct: '✅', tabu: '🚫', pass: '⏭️' };
  logList.innerHTML = s.log
    .slice(0, 8)
    .map((item) => `<div class="log-item ${item.result}">${icons[item.result]} ${escapeHtml(item.word)}</div>`)
    .join('');
}

function renderGameOver(s) {
  document.getElementById('winner-text').textContent = `🎉 ${s.teams[s.winner].name} kazandı!`;

  const goA = document.getElementById('go-score-a');
  const goB = document.getElementById('go-score-b');
  goA.querySelector('.name').textContent = s.teams.A.name;
  goA.querySelector('.num').textContent = s.teams.A.score;
  goB.querySelector('.name').textContent = s.teams.B.name;
  goB.querySelector('.num').textContent = s.teams.B.score;

  const isHost = myInfo && myInfo.isHost;
  document.getElementById('btn-restart').classList.toggle('hidden', !isHost);
  document.getElementById('gameover-wait-note').classList.toggle('hidden', !!isHost);
}

// Oda kodunu büyük harfe çevir
document.getElementById('join-code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Sayfa yüklenince tüm butonlara genel tık sesi bağla
// (Oyun aksiyonu butonları kendi seslerini çalar, diğerleri genel tık alır)
document.addEventListener('DOMContentLoaded', () => {
  const gameActionBtns = new Set([
    document.getElementById('btn-correct'),
    document.getElementById('btn-tabu'),
    document.getElementById('btn-pass'),
    document.getElementById('btn-end-turn'),
    document.getElementById('btn-next-turn'),
    document.getElementById('btn-restart'),
    document.getElementById('btn-start-game'),
    document.getElementById('btn-add-word'),
  ]);

  document.querySelectorAll('button, .chip').forEach((el) => {
    if (!gameActionBtns.has(el)) {
      el.addEventListener('pointerdown', () => soundClick(), { passive: true });
    }
  });
});
