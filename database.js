const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tictactoe.db'));

// Habilita chaves estrangeiras
db.pragma('foreign_keys = ON');

// Criação das tabelas conforme a Seção 5 / ERD do documento da UniRV
db.exec(`
  CREATE TABLE IF NOT EXISTS JOGADOR (
    id_jogador INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname VARCHAR(40) NOT NULL UNIQUE,
    email VARCHAR(100),
    vitorias_totais INTEGER DEFAULT 0,
    derrotas_totais INTEGER DEFAULT 0,
    data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS SALA_JOGO (
    id_sala INTEGER PRIMARY KEY AUTOINCREMENT,
    id_jogador_host INTEGER NOT NULL,
    id_jogador_visitante INTEGER,
    codigo_sala VARCHAR(10) NOT NULL UNIQUE,
    privada BOOLEAN DEFAULT 0,
    status_sala VARCHAR(20) DEFAULT 'AGUARDANDO',
    FOREIGN KEY (id_jogador_host) REFERENCES JOGADOR(id_jogador),
    FOREIGN KEY (id_jogador_visitante) REFERENCES JOGADOR(id_jogador)
  );

  CREATE TABLE IF NOT EXISTS PARTIDA (
    id_partida INTEGER PRIMARY KEY AUTOINCREMENT,
    id_sala INTEGER NOT NULL,
    id_vencedor INTEGER,
    simbolo_turno_atual VARCHAR(1) DEFAULT 'X',
    placar_host INTEGER DEFAULT 0,
    placar_visitante INTEGER DEFAULT 0,
    status_resultado VARCHAR(20) DEFAULT 'EM_ANDAMENTO',
    data_hora_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_sala) REFERENCES SALA_JOGO(id_sala),
    FOREIGN KEY (id_vencedor) REFERENCES JOGADOR(id_jogador)
  );

  CREATE TABLE IF NOT EXISTS JOGADA (
    id_jogada INTEGER PRIMARY KEY AUTOINCREMENT,
    id_partida INTEGER NOT NULL,
    id_jogador INTEGER NOT NULL,
    posicao_celula INTEGER NOT NULL,
    simbolo VARCHAR(1) NOT NULL,
    timestamp_jogada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_partida) REFERENCES PARTIDA(id_partida),
    FOREIGN KEY (id_jogador) REFERENCES JOGADOR(id_jogador)
  );

  CREATE TABLE IF NOT EXISTS MENSAGEM_CHAT (
    id_mensagem INTEGER PRIMARY KEY AUTOINCREMENT,
    id_sala INTEGER NOT NULL,
    id_jogador_remetente INTEGER NOT NULL,
    conteudo_texto TEXT NOT NULL,
    timestamp_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_sala) REFERENCES SALA_JOGO(id_sala),
    FOREIGN KEY (id_jogador_remetente) REFERENCES JOGADOR(id_jogador)
  );
`);

// Helpers para operações no BD
const dbOps = {
  getOrCreateJogador: (nickname) => {
    let row = db.prepare('SELECT * FROM JOGADOR WHERE nickname = ?').get(nickname);
    if (!row) {
      const email = `${nickname.toLowerCase().replace(/[^a-z0-9]/g, '')}@game.local`;
      const info = db.prepare('INSERT INTO JOGADOR (nickname, email) VALUES (?, ?)').run(nickname, email);
      row = db.prepare('SELECT * FROM JOGADOR WHERE id_jogador = ?').get(info.lastInsertRowid);
    }
    return row;
  },

  criarSala: (idHost, codigoSala, privada = false) => {
    const info = db.prepare(`
      INSERT INTO SALA_JOGO (id_jogador_host, codigo_sala, privada, status_sala)
      VALUES (?, ?, ?, 'AGUARDANDO')
    `).run(idHost, codigoSala, privada ? 1 : 0);
    return info.lastInsertRowid;
  },

  vincularVisitante: (idSala, idVisitante) => {
    db.prepare(`
      UPDATE SALA_JOGO 
      SET id_jogador_visitante = ?, status_sala = 'EM_JOGO' 
      WHERE id_sala = ?
    `).run(idVisitante, idSala);
  },

  iniciarPartida: (idSala, placarHost, placarVisitante, turnoInicial = 'X') => {
    const info = db.prepare(`
      INSERT INTO PARTIDA (id_sala, simbolo_turno_atual, placar_host, placar_visitante, status_resultado)
      VALUES (?, ?, ?, ?, 'EM_ANDAMENTO')
    `).run(idSala, turnoInicial, placarHost, placarVisitante);
    return info.lastInsertRowid;
  },

  salvarJogada: (idPartida, idJogador, posicao, simbolo) => {
    db.prepare(`
      INSERT INTO JOGADA (id_partida, id_jogador, posicao_celula, simbolo)
      VALUES (?, ?, ?, ?)
    `).run(idPartida, idJogador, posicao, simbolo);
  },

  atualizarTurnoPartida: (idPartida, nextTurn) => {
    db.prepare('UPDATE PARTIDA SET simbolo_turno_atual = ? WHERE id_partida = ?').run(nextTurn, idPartida);
  },

  finalizarPartida: (idPartida, idVencedor, resultado, placarHost, placarVisitante) => {
    db.prepare(`
      UPDATE PARTIDA
      SET id_vencedor = ?, status_resultado = ?, placar_host = ?, placar_visitante = ?
      WHERE id_partida = ?
    `).run(idVencedor, resultado, placarHost, placarVisitante, idPartida);

    if (idVencedor) {
      db.prepare('UPDATE JOGADOR SET vitorias_totais = vitorias_totais + 1 WHERE id_jogador = ?').run(idVencedor);
    }
  },

  salvarMensagemChat: (idSala, idJogador, texto) => {
    db.prepare(`
      INSERT INTO MENSAGEM_CHAT (id_sala, id_jogador_remetente, conteudo_texto)
      VALUES (?, ?, ?)
    `).run(idSala, idJogador, texto);
  },

  getStats: () => {
    return {
      jogadores: db.prepare('SELECT COUNT(*) as count FROM JOGADOR').get().count,
      partidas: db.prepare('SELECT COUNT(*) as count FROM PARTIDA').get().count,
      jogadas: db.prepare('SELECT COUNT(*) as count FROM JOGADA').get().count
    };
  }
};

module.exports = { db, dbOps };
