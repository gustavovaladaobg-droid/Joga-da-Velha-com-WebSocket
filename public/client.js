// Cliente WebSocket e gerenciador de interface (Front-end burro / Authoritative Server)

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
let socket = null;

// Estado local da sessão
let myPlayerName = localStorage.getItem('tictactoe_nickname') || '';
let mySymbol = null; // 'X' ou 'O'
let currentRoomCode = null;
let currentTurn = 'X';
let matchStartTime = null;

function connectWebSocket(onOpenCallback) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    if (onOpenCallback) onOpenCallback();
    return;
  }

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('Conectado ao servidor WebSocket');
    if (onOpenCallback) onOpenCallback();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Erro ao processar mensagem do servidor:', e);
    }
  };

  socket.onclose = () => {
    console.warn('Conexão WebSocket fechada');
  };

  socket.onerror = (err) => {
    console.error('Erro na conexão WebSocket:', err);
  };
}

function sendMsg(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  } else {
    console.warn('Tentativa de envio com socket fechado:', payload);
  }
}

// Transição de Telas Sem Recarregar Página (SPA)
function showArenaScreen() {
  document.getElementById('section-lobby').classList.add('hidden');
  document.getElementById('section-arena').classList.remove('hidden');
  document.getElementById('lobby-server-badge').classList.add('hidden');
  document.getElementById('btn-leave-room').classList.remove('hidden');
  document.getElementById('header-subtitle').textContent = `SALA: ${currentRoomCode}`;
}

function showLobbyScreen() {
  document.getElementById('section-arena').classList.add('hidden');
  document.getElementById('section-lobby').classList.remove('hidden');
  document.getElementById('lobby-server-badge').classList.remove('hidden');
  document.getElementById('btn-leave-room').classList.add('hidden');
  document.getElementById('waiting-room-card').classList.add('hidden');
  document.getElementById('btn-create-room').disabled = false;
  document.getElementById('header-subtitle').textContent = 'LOBBY DE SALAS';
  document.getElementById('game-over-modal').classList.add('hidden');

  currentRoomCode = null;
  mySymbol = null;
}

// ==========================================
// ROTEAMENTO DE MENSAGENS DO SERVIDOR
// ==========================================
function handleServerMessage(data) {
  switch (data.type) {
    // Atualização de salas públicas no lobby
    case 'PUBLIC_ROOMS_UPDATE':
      renderPublicRooms(data.rooms);
      break;

    // Sala criada com sucesso (Host aguarda no lobby)
    case 'ROOM_CREATED':
      currentRoomCode = data.roomCode;
      mySymbol = data.symbol;

      const waitingCard = document.getElementById('waiting-room-card');
      const codeDisplay = document.getElementById('created-room-code');
      const btnCreate = document.getElementById('btn-create-room');
      if (waitingCard && codeDisplay) {
        codeDisplay.textContent = data.roomCode;
        waitingCard.classList.remove('hidden');
        if (btnCreate) btnCreate.disabled = true;
      }
      break;

    // Erros (ex: Sala cheia, Sala inexistente)
    case 'ERROR':
      showLobbyFeedback(data.message, 'error');
      break;

    // Jogada Inválida rejeitada pelo servidor (RF-03)
    case 'INVALID_MOVE':
      alert(`[Jogada Rejeitada]: ${data.message}`);
      break;

    // Início da Partida (ambos os participantes na sala!)
    case 'GAME_START':
      currentRoomCode = data.roomCode;
      if (data.mySymbol) mySymbol = data.mySymbol;
      currentTurn = data.currentTurn;

      showArenaScreen();
      onGameStart(data);
      break;

    // Atualização do Tabuleiro (RF-04)
    case 'BOARD_UPDATE':
      onBoardUpdate(data);
      break;

    // Timer regressivo de 15 segundos
    case 'TIMER_TICK':
      onTimerTick(data);
      break;

    // Fim de jogo normal (RF-05)
    case 'GAME_OVER':
      onGameOver(data);
      break;

    // Vitória por W.O. por desconexão (RF-08)
    case 'GAME_OVER_WO':
      const turnBanner = document.getElementById('turn-banner');
      if (turnBanner) {
        turnBanner.className = 'turn-banner alert-red';
        document.getElementById('turn-banner-text').textContent = data.message;
      }
      break;

    // Chat da Partida (RF-06)
    case 'CHAT_MESSAGE':
      appendChatMessage(data);
      break;

    // Notificação de Desconexão temporária (RF-08)
    case 'PLAYER_DISCONNECTED':
      const bannerEl = document.getElementById('turn-banner');
      if (bannerEl) {
        bannerEl.className = 'turn-banner alert-red';
        document.getElementById('turn-banner-text').textContent = data.message;
      }
      break;

    // Revanche solicitada
    case 'REMATCH_OFFERED':
      const statusBox = document.getElementById('rematch-status');
      if (statusBox) {
        statusBox.textContent = `${data.from} solicitou uma revanche!`;
        statusBox.classList.remove('hidden');
        const rematchBtn = document.getElementById('btn-request-rematch');
        if (rematchBtn) rematchBtn.textContent = 'Aceitar Revanche';
      }
      break;

    case 'REMATCH_PENDING':
      const pendingBox = document.getElementById('rematch-status');
      if (pendingBox) {
        pendingBox.textContent = data.message;
        pendingBox.classList.remove('hidden');
      }
      break;

    case 'REMATCH_ACCEPTED':
      onRematchAccepted(data);
      break;

    case 'OPPONENT_LEFT':
      alert(data.message);
      showLobbyScreen();
      break;

    case 'LEFT_ROOM_SUCCESS':
      showLobbyScreen();
      break;
  }
}

// ==========================================
// LÓGICA DO LOBBY
// ==========================================
function initLobby() {
  const nameInput = document.getElementById('player-name');
  const btnCreate = document.getElementById('btn-create-room');
  const btnJoin = document.getElementById('btn-join-code');
  const codeInput = document.getElementById('room-code-input');

  if (myPlayerName && nameInput) {
    nameInput.value = myPlayerName;
  }

  btnCreate.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Jogador';
    myPlayerName = name;
    localStorage.setItem('tictactoe_nickname', name);

    connectWebSocket(() => {
      sendMsg({
        type: 'CREATE_ROOM',
        player: name
      });
    });
  });

  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const code = document.getElementById('created-room-code').textContent;
      navigator.clipboard.writeText(code);
      btnCopy.textContent = '✓ Copiado!';
      setTimeout(() => { btnCopy.textContent = '📋 Copiar'; }, 2000);
    });
  }

  const btnCancel = document.getElementById('btn-cancel-room');
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      if (currentRoomCode) {
        sendMsg({ type: 'LEAVE_ROOM', roomCode: currentRoomCode });
      }
      showLobbyScreen();
    });
  }

  btnJoin.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Jogador';
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      showLobbyFeedback('Por favor, informe o código da sala de 6 dígitos.', 'error');
      return;
    }
    myPlayerName = name;
    localStorage.setItem('tictactoe_nickname', name);

    connectWebSocket(() => {
      sendMsg({
        type: 'JOIN_ROOM',
        roomCode: code,
        playerName: name
      });
    });
  });

  connectWebSocket();
}

function renderPublicRooms(roomsList) {
  const tbody = document.getElementById('rooms-tbody');
  const countEl = document.getElementById('active-rooms-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = roomsList.length;

  if (!roomsList || roomsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhuma sala aguardando oponente no momento. Crie uma!</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  roomsList.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="code-pill">${r.code}</span></td>
      <td><strong>${r.host}</strong></td>
      <td><span class="vacancy-pill">${r.players}/2</span></td>
      <td>
        <button class="btn btn-blue btn-sm" onclick="joinSpecificRoom('${r.code}')">Entrar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.joinSpecificRoom = function(code) {
  const nameInput = document.getElementById('player-name');
  const name = (nameInput ? nameInput.value.trim() : '') || myPlayerName || 'Jogador';
  myPlayerName = name;
  localStorage.setItem('tictactoe_nickname', name);

  connectWebSocket(() => {
    sendMsg({
      type: 'JOIN_ROOM',
      roomCode: code,
      playerName: name
    });
  });
};

function showLobbyFeedback(msg, type) {
  const el = document.getElementById('lobby-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `feedback-msg ${type}`;
}

// ==========================================
// LÓGICA DA ARENA
// ==========================================
function initArena() {
  // Eventos de clique nas 9 células (RF-02)
  const cells = document.querySelectorAll('.cell');
  cells.forEach((cell) => {
    cell.addEventListener('click', () => {
      const pos = parseInt(cell.dataset.index, 10);
      // Front-end burro: envia a jogada ao servidor para validação
      sendMsg({
        type: 'MOVE',
        roomCode: currentRoomCode,
        position: pos,
        playerSymbol: mySymbol
      });
    });
  });

  // Chat Lateral (RF-06)
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    sendMsg({
      type: 'CHAT_MESSAGE',
      roomCode: currentRoomCode,
      text
    });
    chatInput.value = '';
  });

  // Botão Sair da Sala
  document.getElementById('btn-leave-room').addEventListener('click', () => {
    if (confirm('Deseja realmente sair da partida?')) {
      sendMsg({ type: 'LEAVE_ROOM', roomCode: currentRoomCode });
      showLobbyScreen();
    }
  });

  // Modal Game Over (RF-07)
  document.getElementById('btn-request-rematch').addEventListener('click', () => {
    sendMsg({ type: 'REQUEST_REMATCH', roomCode: currentRoomCode });
  });

  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    sendMsg({ type: 'LEAVE_ROOM', roomCode: currentRoomCode });
    showLobbyScreen();
  });
}

function onGameStart(data) {
  currentTurn = data.currentTurn;
  if (data.mySymbol) mySymbol = data.mySymbol;

  document.getElementById('my-symbol-display').textContent = mySymbol;
  document.getElementById('my-name-display').textContent = myPlayerName;

  document.getElementById('score-host-name').textContent = data.hostPlayer;
  document.getElementById('score-guest-name').textContent = data.guestPlayer;
  document.getElementById('score-host-val').textContent = data.scoreHost;
  document.getElementById('score-guest-val').textContent = data.scoreGuest;

  // Limpa mensagens anteriores de chat
  document.getElementById('chat-messages').innerHTML = `
    <div class="chat-msg system">
      <span class="chat-text">Partida iniciada! Oponente: ${data.opponent}.</span>
    </div>
  `;

  matchStartTime = Date.now();
  updateTurnBanner(currentTurn);
  renderBoard(data.board);
}

function onBoardUpdate(data) {
  renderBoard(data.board);
  if (data.nextTurn) {
    currentTurn = data.nextTurn;
    updateTurnBanner(currentTurn);
  }
}

function renderBoard(board) {
  const cells = document.querySelectorAll('.cell');
  board.forEach((val, idx) => {
    const cell = cells[idx];
    cell.textContent = val || '';
    cell.className = 'cell';
    if (val === 'X') cell.classList.add('symbol-x');
    if (val === 'O') cell.classList.add('symbol-o');
    cell.disabled = val !== null;
  });
}

function updateTurnBanner(turn) {
  const banner = document.getElementById('turn-banner');
  const icon = document.getElementById('turn-banner-icon');
  const text = document.getElementById('turn-banner-text');
  const timerTag = document.getElementById('turn-timer-tag');

  timerTag.classList.remove('hidden');

  if (turn === mySymbol) {
    banner.className = 'turn-banner my-turn';
    icon.textContent = '🟢';
    text.textContent = `VOCÊ É O '${mySymbol}' | SUA VEZ DE JOGAR!`;
  } else {
    banner.className = 'turn-banner opponent-turn';
    icon.textContent = '⏳';
    text.textContent = `VOCÊ É O '${mySymbol}' | Aguardando jogada do adversário (${turn})...`;
  }
}

function onTimerTick(data) {
  const timerTag = document.getElementById('turn-timer-tag');
  if (timerTag) {
    timerTag.textContent = `${data.timeRemaining}s`;
  }
}

function onGameOver(data) {
  const modal = document.getElementById('game-over-modal');
  const title = document.getElementById('modal-title');
  const subtitle = document.getElementById('modal-subtitle');
  const icon = document.getElementById('modal-icon');
  const scoreBoardEl = document.getElementById('modal-scoreboard');
  const durationEl = document.getElementById('modal-match-duration');

  document.getElementById('score-host-val').textContent = data.scoreHost;
  document.getElementById('score-guest-val').textContent = data.scoreGuest;
  scoreBoardEl.textContent = `${data.scoreHost} x ${data.scoreGuest}`;

  const seconds = matchStartTime ? Math.floor((Date.now() - matchStartTime) / 1000) : 0;
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  durationEl.textContent = `${mins}:${secs}`;

  if (data.combo) {
    const cells = document.querySelectorAll('.cell');
    data.combo.forEach(idx => cells[idx].classList.add('winning-cell'));
  }

  if (data.winner === 'DRAW') {
    icon.textContent = '🤝';
    title.textContent = 'DEU VELHA! EMPATE!';
    subtitle.textContent = 'Nenhum dos jogadores conseguiu alinhar 3 símbolos.';
  } else if (data.winner === mySymbol) {
    icon.textContent = '🏆';
    title.textContent = 'VITÓRIA! VOCÊ VENCEU!';
    subtitle.textContent = 'Excelente desempenho estratégico na partida!';
  } else {
    icon.textContent = '❌';
    title.textContent = 'DERROTA! VOCÊ PERDEU!';
    subtitle.textContent = `O jogador ${data.winnerPlayer || data.winner} venceu esta rodada.`;
  }

  document.getElementById('rematch-status').classList.add('hidden');
  document.getElementById('btn-request-rematch').textContent = 'Solicitar Revanche [WS]';

  modal.classList.remove('hidden');
}

function onRematchAccepted(data) {
  const modal = document.getElementById('game-over-modal');
  modal.classList.add('hidden');

  currentTurn = data.currentTurn;
  matchStartTime = Date.now();

  // Inverte símbolo local conforme servidor
  mySymbol = (mySymbol === 'X') ? 'O' : 'X';
  document.getElementById('my-symbol-display').textContent = mySymbol;

  document.getElementById('score-host-val').textContent = data.scoreHost;
  document.getElementById('score-guest-val').textContent = data.scoreGuest;

  renderBoard(data.board);
  updateTurnBanner(currentTurn);

  appendChatMessage({
    sender: 'Sistema',
    text: '--- Revanche iniciada! Símbolos invertidos. ---',
    system: true
  });
}

function appendChatMessage(data) {
  const messagesBox = document.getElementById('chat-messages');
  if (!messagesBox) return;

  const msgDiv = document.createElement('div');

  if (data.system) {
    msgDiv.className = 'chat-msg system';
    msgDiv.innerHTML = `<span class="chat-text">${data.text}</span>`;
  } else {
    const isMine = data.symbol === mySymbol;
    msgDiv.className = `chat-msg ${isMine ? 'mine' : 'theirs'}`;
    msgDiv.innerHTML = `
      <div class="chat-meta">
        <strong>${data.sender} (${data.symbol})</strong>
        <span>${data.time || ''}</span>
      </div>
      <span class="chat-text">${escapeHtml(data.text)}</span>
    `;
  }

  messagesBox.appendChild(msgDiv);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  initLobby();
  initArena();
});
