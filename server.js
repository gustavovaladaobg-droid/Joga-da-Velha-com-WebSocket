const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const { dbOps } = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Estado em memória das salas
// rooms[code] = {
//   code,
//   idSala,
//   idPartida,
//   host: { ws, player, idJogador, symbol: 'X' },
//   guest: { ws, player, idJogador, symbol: 'O' } | null,
//   board: Array(9).fill(null),
//   currentTurn: 'X',
//   scoreHost: 0,
//   scoreGuest: 0,
//   status: 'WAITING' | 'PLAYING' | 'FINISHED',
//   disconnectTimeout: null,
//   turnTimer: null,
//   turnTimeRemaining: 15,
//   turnInterval: null,
//   rematchRequestedBy: null
// }
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

function sendTo(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room, payload) {
  if (room.host && room.host.ws) sendTo(room.host.ws, payload);
  if (room.guest && room.guest.ws) sendTo(room.guest.ws, payload);
}

function getPublicRoomsList() {
  const list = [];
  for (const [code, r] of rooms.entries()) {
    if (r.status === 'WAITING') {
      list.push({
        code: r.code,
        host: r.host ? r.host.player : 'Anônimo',
        players: (r.host ? 1 : 0) + (r.guest ? 1 : 0)
      });
    }
  }
  return list;
}

function broadcastLobbyUpdate() {
  const list = getPublicRoomsList();
  const payload = { type: 'PUBLIC_ROOMS_UPDATE', rooms: list };
  for (const client of wss.clients) {
    if (client.inLobby && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }
}

// 8 Padrões de Vitória
const WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Horizontais
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Verticais
  [0, 4, 8], [2, 4, 6]             // Diagonais
];

function checkWinner(board) {
  for (const combo of WIN_PATTERNS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], combo };
    }
  }
  if (board.every(cell => cell !== null)) {
    return { winner: 'DRAW' };
  }
  return null;
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  room.turnTimeRemaining = 15;
  
  broadcastToRoom(room, {
    type: 'TIMER_TICK',
    timeRemaining: room.turnTimeRemaining,
    currentTurn: room.currentTurn
  });

  room.turnInterval = setInterval(() => {
    room.turnTimeRemaining -= 1;
    broadcastToRoom(room, {
      type: 'TIMER_TICK',
      timeRemaining: room.turnTimeRemaining,
      currentTurn: room.currentTurn
    });

    if (room.turnTimeRemaining <= 0) {
      clearInterval(room.turnInterval);
      handleTurnTimeout(room);
    }
  }, 1000);
}

function clearTurnTimer(room) {
  if (room.turnInterval) {
    clearInterval(room.turnInterval);
    room.turnInterval = null;
  }
}

function handleTurnTimeout(room) {
  if (room.status !== 'PLAYING') return;
  // Alterna o turno
  room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
  dbOps.atualizarTurnoPartida(room.idPartida, room.currentTurn);

  broadcastToRoom(room, {
    type: 'BOARD_UPDATE',
    board: room.board,
    nextTurn: room.currentTurn,
    reason: 'TIMEOUT_TURN'
  });

  startTurnTimer(room);
}

function endGame(room, result, winningCombo = null) {
  clearTurnTimer(room);
  room.status = 'FINISHED';

  let idVencedor = null;
  let winnerSymbol = null;
  let statusResultado = 'EMPATE';

  if (result === 'X') {
    idVencedor = room.host.symbol === 'X' ? room.host.idJogador : room.guest.idJogador;
    winnerSymbol = 'X';
    if (room.host.symbol === 'X') {
      room.scoreHost++;
      statusResultado = 'VITORIA_HOST';
    } else {
      room.scoreGuest++;
      statusResultado = 'VITORIA_VISITANTE';
    }
  } else if (result === 'O') {
    idVencedor = room.host.symbol === 'O' ? room.host.idJogador : room.guest.idJogador;
    winnerSymbol = 'O';
    if (room.host.symbol === 'O') {
      room.scoreHost++;
      statusResultado = 'VITORIA_HOST';
    } else {
      room.scoreGuest++;
      statusResultado = 'VITORIA_VISITANTE';
    }
  }

  dbOps.finalizarPartida(room.idPartida, idVencedor, statusResultado, room.scoreHost, room.scoreGuest);

  const winnerPlayer = winnerSymbol ? (room.host.symbol === winnerSymbol ? room.host.player : room.guest.player) : null;

  broadcastToRoom(room, {
    type: 'GAME_OVER',
    winner: result, // 'X', 'O', ou 'DRAW'
    winnerPlayer,
    combo: winningCombo,
    scoreHost: room.scoreHost,
    scoreGuest: room.scoreGuest,
    hostPlayer: room.host.player,
    guestPlayer: room.guest.player
  });
}

wss.on('connection', (ws, req) => {
  ws.inLobby = true;
  ws.roomCode = null;

  // Envia lista pública inicial
  sendTo(ws, { type: 'PUBLIC_ROOMS_UPDATE', rooms: getPublicRoomsList() });

  ws.on('message', (messageText) => {
    let data;
    try {
      data = JSON.parse(messageText);
    } catch (e) {
      return sendTo(ws, { type: 'INVALID_MOVE', message: 'Payload inválido.' });
    }

    const { type } = data;

    // RF-01 / 4.1.1 Entrada ou Criação de Sala
    if (type === 'JOIN_ROOM' || type === 'CREATE_ROOM' || type === 'JOIN_GAME') {
      const playerName = (data.playerName || data.player || 'Jogador').trim();
      let roomCode = data.roomCode ? data.roomCode.trim().toUpperCase() : null;
      const jogador = dbOps.getOrCreateJogador(playerName);

      ws.inLobby = false;

      // Criar nova sala
      if (!roomCode || type === 'CREATE_ROOM') {
        roomCode = generateRoomCode();
        const idSala = dbOps.criarSala(jogador.id_jogador, roomCode, false);

        const newRoom = {
          code: roomCode,
          idSala,
          idPartida: null,
          host: { ws, player: playerName, idJogador: jogador.id_jogador, symbol: 'X' },
          guest: null,
          board: Array(9).fill(null),
          currentTurn: 'X',
          scoreHost: 0,
          scoreGuest: 0,
          status: 'WAITING',
          disconnectTimeout: null,
          turnTimer: null,
          turnTimeRemaining: 15,
          turnInterval: null,
          rematchRequestedBy: null
        };

        rooms.set(roomCode, newRoom);
        ws.roomCode = roomCode;

        sendTo(ws, {
          type: 'ROOM_CREATED',
          roomCode,
          symbol: 'X',
          player: playerName,
          status: 'WAITING'
        });

        broadcastLobbyUpdate();
        return;
      }

      // Ingressar em sala existente
      const room = rooms.get(roomCode);
      if (!room) {
        ws.inLobby = true;
        return sendTo(ws, {
          type: 'ERROR',
          message: '[Sala não encontrada. Verifique o código e tente novamente]'
        });
      }

      if (room.guest && room.guest.ws && room.guest.ws.readyState === WebSocket.OPEN) {
        ws.inLobby = true;
        return sendTo(ws, {
          type: 'ERROR',
          message: `[Erro: A sala ${roomCode} já possui 2 participantes ativos]`
        });
      }

      // Se visitante reconectando ou novo
      room.guest = { ws, player: playerName, idJogador: jogador.id_jogador, symbol: 'O' };
      ws.roomCode = roomCode;
      room.status = 'PLAYING';

      dbOps.vincularVisitante(room.idSala, jogador.id_jogador);
      const idPartida = dbOps.iniciarPartida(room.idSala, room.scoreHost, room.scoreGuest, room.currentTurn);
      room.idPartida = idPartida;

      // Cancela timeout se houve desconexão
      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }

      // Notifica ambos que a partida começou
      sendTo(room.host.ws, {
        type: 'GAME_START',
        roomCode,
        mySymbol: room.host.symbol,
        opponent: room.guest.player,
        currentTurn: room.currentTurn,
        board: room.board,
        scoreHost: room.scoreHost,
        scoreGuest: room.scoreGuest,
        hostPlayer: room.host.player,
        guestPlayer: room.guest.player
      });

      sendTo(room.guest.ws, {
        type: 'GAME_START',
        roomCode,
        mySymbol: room.guest.symbol,
        opponent: room.host.player,
        currentTurn: room.currentTurn,
        board: room.board,
        scoreHost: room.scoreHost,
        scoreGuest: room.scoreGuest,
        hostPlayer: room.host.player,
        guestPlayer: room.guest.player
      });

      broadcastLobbyUpdate();
      startTurnTimer(room);
      return;
    }

    // RF-02 / RF-03 / RF-04 / RF-05: Jogada
    if (type === 'MOVE') {
      const roomCode = ws.roomCode || data.roomCode;
      const room = rooms.get(roomCode);

      if (!room || room.status !== 'PLAYING') {
        return sendTo(ws, { type: 'INVALID_MOVE', message: 'A partida não está em andamento.' });
      }

      const isHost = room.host.ws === ws;
      const isGuest = room.guest && room.guest.ws === ws;

      if (!isHost && !isGuest) {
        return sendTo(ws, { type: 'INVALID_MOVE', message: 'Você não participa desta partida.' });
      }

      const playerObj = isHost ? room.host : room.guest;

      // Validação: Turno estrito
      if (room.currentTurn !== playerObj.symbol) {
        return sendTo(ws, {
          type: 'INVALID_MOVE',
          message: `Não é a sua vez de jogar! Vez de ${room.currentTurn}.`
        });
      }

      const pos = parseInt(data.position, 10);
      if (isNaN(pos) || pos < 0 || pos > 8) {
        return sendTo(ws, { type: 'INVALID_MOVE', message: 'Posição fora dos limites (0-8).' });
      }

      // Validação: Célula ocupada
      if (room.board[pos] !== null) {
        return sendTo(ws, { type: 'INVALID_MOVE', message: 'Célula já preenchida.' });
      }

      // Aplica a jogada
      room.board[pos] = playerObj.symbol;
      dbOps.salvarJogada(room.idPartida, playerObj.idJogador, pos, playerObj.symbol);

      // Checa vitória / empate
      const winResult = checkWinner(room.board);

      if (winResult) {
        // Envia último estado do tabuleiro
        broadcastToRoom(room, {
          type: 'BOARD_UPDATE',
          board: room.board,
          lastMove: { pos, symbol: playerObj.symbol },
          nextTurn: null
        });

        if (winResult.winner === 'DRAW') {
          endGame(room, 'DRAW');
        } else {
          endGame(room, winResult.winner, winResult.combo);
        }
      } else {
        // Alterna turno
        room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
        dbOps.atualizarTurnoPartida(room.idPartida, room.currentTurn);

        broadcastToRoom(room, {
          type: 'BOARD_UPDATE',
          board: room.board,
          lastMove: { pos, symbol: playerObj.symbol },
          nextTurn: room.currentTurn
        });

        startTurnTimer(room);
      }
      return;
    }

    // RF-06: Chat da Partida Integrado
    if (type === 'CHAT' || type === 'CHAT_MESSAGE') {
      const roomCode = ws.roomCode || data.roomCode;
      const room = rooms.get(roomCode);
      if (!room) return;

      const isHost = room.host.ws === ws;
      const sender = isHost ? room.host : room.guest;
      if (!sender) return;

      const text = (data.message || data.text || '').trim();
      if (!text) return;

      dbOps.salvarMensagemChat(room.idSala, sender.idJogador, text);

      broadcastToRoom(room, {
        type: 'CHAT_MESSAGE',
        sender: sender.player,
        symbol: sender.symbol,
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      return;
    }

    // RF-07: Solicitação e Aceite de Revanche
    if (type === 'NEW_GAME' || type === 'REQUEST_REMATCH') {
      const roomCode = ws.roomCode || data.roomCode;
      const room = rooms.get(roomCode);
      if (!room) return;

      const isHost = room.host.ws === ws;
      const sender = isHost ? room.host : room.guest;
      const opponent = isHost ? room.guest : room.host;

      if (!room.rematchRequestedBy) {
        // Primeiro a pedir
        room.rematchRequestedBy = sender.symbol;
        if (opponent && opponent.ws) {
          sendTo(opponent.ws, {
            type: 'REMATCH_OFFERED',
            from: sender.player
          });
        }
        sendTo(ws, {
          type: 'REMATCH_PENDING',
          message: 'Solicitação enviada. Aguardando adversário...'
        });
      } else {
        // Segundo confirmou (revanche aceita!)
        room.rematchRequestedBy = null;
        room.board = Array(9).fill(null);
        room.status = 'PLAYING';

        // Inverte símbolos conforme RF-07
        const prevHostSymbol = room.host.symbol;
        room.host.symbol = room.guest.symbol;
        room.guest.symbol = prevHostSymbol;

        // X sempre começa
        room.currentTurn = 'X';

        const idPartida = dbOps.iniciarPartida(room.idSala, room.scoreHost, room.scoreGuest, room.currentTurn);
        room.idPartida = idPartida;

        broadcastToRoom(room, {
          type: 'REMATCH_ACCEPTED',
          board: room.board,
          currentTurn: room.currentTurn,
          hostSymbol: room.host.symbol,
          guestSymbol: room.guest.symbol,
          scoreHost: room.scoreHost,
          scoreGuest: room.scoreGuest,
          hostPlayer: room.host.player,
          guestPlayer: room.guest.player
        });

        startTurnTimer(room);
      }
      return;
    }

    // Saída voluntária / Voltar ao Lobby
    if (type === 'LEAVE_ROOM') {
      const roomCode = ws.roomCode;
      if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        clearTurnTimer(room);
        const opponent = room.host.ws === ws ? room.guest : room.host;
        if (opponent && opponent.ws) {
          sendTo(opponent.ws, {
            type: 'OPPONENT_LEFT',
            message: 'Oponente saiu da sala.'
          });
        }
        rooms.delete(roomCode);
        broadcastLobbyUpdate();
      }
      ws.roomCode = null;
      ws.inLobby = true;
      sendTo(ws, { type: 'LEFT_ROOM_SUCCESS' });
      return;
    }
  });

  // RF-08: Detecção de Desconexão e Tolerância de 30s
  ws.on('close', () => {
    const roomCode = ws.roomCode;
    if (!roomCode || !rooms.has(roomCode)) {
      broadcastLobbyUpdate();
      return;
    }

    const room = rooms.get(roomCode);
    const isHost = room.host && room.host.ws === ws;
    const isGuest = room.guest && room.guest.ws === ws;

    if (room.status === 'WAITING') {
      // Sala apenas esperando sem segundo jogador
      rooms.delete(roomCode);
      broadcastLobbyUpdate();
      return;
    }

    const opponent = isHost ? room.guest : room.host;

    if (room.status === 'PLAYING') {
      clearTurnTimer(room);

      if (opponent && opponent.ws && opponent.ws.readyState === WebSocket.OPEN) {
        sendTo(opponent.ws, {
          type: 'PLAYER_DISCONNECTED',
          message: 'Adversário desconectado... Aguardando reconexão (30s).'
        });

        // Janela de tolerância de 30 segundos
        room.disconnectTimeout = setTimeout(() => {
          if (opponent.ws.readyState === WebSocket.OPEN) {
            sendTo(opponent.ws, {
              type: 'GAME_OVER_WO',
              winner: opponent.symbol,
              message: '[Oponente desconectou — Vitória por W.O.]'
            });
            endGame(room, opponent.symbol);
          }
          rooms.delete(roomCode);
          broadcastLobbyUpdate();
        }, 30000);
      } else {
        rooms.delete(roomCode);
        broadcastLobbyUpdate();
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`WebSocket Server ativo na porta ${PORT}`);
});
