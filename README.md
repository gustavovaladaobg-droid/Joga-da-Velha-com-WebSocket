# Jogo da Velha Multiplayer em Tempo Real com WebSocket (Ws3)
**Disciplina:** Desenvolvimento de Software para Web  
**Professor:** Me. Sergio Souza Novak — UniRV  

---

## 📌 Resumo do Projeto

O sistema implementa um **Jogo da Velha Multiplayer Web** baseado em **WebSocket**, onde o servidor Node.js atua como **autoridade central estrita (*Authoritative Game Server*)**, validando turnos, jogadas, condições de vitória/empate, W.O. por desconexão, chat ao vivo e persistência relacional.

---

## 🚀 Tecnologias Utilizadas
- **Node.js** com **Express** (Servidor HTTP e arquivos estáticos)
- **ws (WebSocket)** (Comunicação bidirecional e em tempo real em `ws://localhost:3000`)
- **better-sqlite3** (Banco de dados SQLite relacional embutido com integridade referencial)
- **HTML5 / CSS3 / JavaScript Vanilla** (Frontend reativo com modelo burro / orientado a eventos)

---

## 📋 Requisitos do PDF Implementados

### Requisitos Funcionais (RF)
- **[RF-01] Criação e Pareamento de Salas (`JOIN_GAME` / `JOIN_ROOM`):** Geração automática de código alfanumérico único de 6 caracteres (ex: `ABC123`), lobby com listagem em tempo real de salas com vagas e atribuição de **X** para o Host e **O** para o Visitante.
- **[RF-02] Validação 100% Server-Side (`MOVE`):** Validação estrita se é o turno do jogador e se a casa está vazia. O frontend não executa regras de jogo por conta própria.
- **[RF-03] Rejeição de Jogadas Inválidas (`INVALID_MOVE`):** Resposta de erro exclusiva para o remetente caso tente jogar fora da vez ou em célula ocupada.
- **[RF-04] Atualização Sincronizada do Tabuleiro (`BOARD_UPDATE`):** Transmissão imediata da nova matriz para ambos os navegadores da sala.
- **[RF-05] Verificação de Vitória e Empate (`GAME_OVER`):** Checagem automática das 8 combinações de vitória (3 horizontais, 3 verticais e 2 diagonais) ou preenchimento total das 9 casas (Velha). Destaque visual da linha vencedora.
- **[RF-06] Chat da Partida Integrado (`CHAT_MESSAGE`):** Canal de conversação lateral em tempo real restrito aos dois jogadores da sala.
- **[RF-07] Placar da Sessão e Revanche (`NEW_GAME` / `REQUEST_REMATCH`):** Placar cumulativo na sessão, solicitação de revanche e inversão automática dos símbolos (quem foi X vira O e vice-versa).
- **[RF-08] Detecção de Desconexão e Tolerância (`PLAYER_DISCONNECTED`):** Tolerância de 30 segundos antes de aplicar derrota por W.O. caso um jogador caia. Cronômetro de turno de 15 segundos por jogada com passagem de vez automática.

### Requisitos Não-Funcionais (RNF)
- **[RNF-01] Autoridade Estrita e Front-end Burro:** O cliente apenas renderiza o estado enviado pelo servidor e despacha eventos.
- **[RNF-02] Isolamento Total entre Salas:** Mensagens, tabuleiros e chats isolados por sala.
- **[RNF-03] Altíssima Responsividade (< 50ms):** WebSocket nativo em memória com sincronismo imediato.

---

## 🗄️ Estrutura do Banco de Dados (PlantUML ERD)
O banco `tictactoe.db` foi estruturado exatamente conforme as 5 tabelas da Seção 5:
1. `JOGADOR` (`id_jogador`, `nickname`, `email`, `vitorias_totais`, `derrotas_totais`, `data_registro`)
2. `SALA_JOGO` (`id_sala`, `id_jogador_host`, `id_jogador_visitante`, `codigo_sala`, `privada`, `status_sala`)
3. `PARTIDA` (`id_partida`, `id_sala`, `id_vencedor`, `simbolo_turno_atual`, `placar_host`, `placar_visitante`, `status_resultado`, `data_hora_inicio`)
4. `JOGADA` (`id_jogada`, `id_partida`, `id_jogador`, `posicao_celula`, `simbolo`, `timestamp_jogada`)
5. `MENSAGEM_CHAT` (`id_mensagem`, `id_sala`, `id_jogador_remetente`, `conteudo_texto`, `timestamp_envio`)

---

## 🖥️ Telas do Sistema
- `tela1-lobby.html` (Lobby com Matchmaking, Criar Sala, Entrar por Código e Lista Pública)
- `tela2-arena.html` (Arena com Placar, Turn Banner com Cronômetro de 15s, Tabuleiro 3x3 e Chat Lateral)
- `tela3-gameover.html` (Modal de Fim de Jogo com status da vitória/empate, resumo e Revanche)

---

## 📦 Como Executar

1. Instale as dependências (já instaladas no ambiente):
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```bash
   npm start
   # ou
   node server.js
   ```

3. Abra o navegador em:
   [http://localhost:3000](http://localhost:3000)

4. Abra uma segunda aba ou janela anônima para testar a partida multiplayer entre dois jogadores em tempo real!
