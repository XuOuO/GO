const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const STONE = {
  BLACK: 1,
  WHITE: 2,
};

const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Go server running");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(room, payload) {
  room.players.forEach((socket) => {
    send(socket, payload);
  });
}

function generateCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 16);
}

function createRoom(ws) {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }

  const room = {
    code,
    players: new Map(),
    host: 1,
    started: false,
    assignments: null,
    state: null,
    names: { 1: "", 2: "" },
    history: [],
  };

  rooms.set(code, room);
  assignPlayer(room, ws, 1);

  send(ws, {
    type: "room_created",
    code,
    playerNumber: 1,
    host: room.host,
    players: room.players.size,
    names: room.names,
  });
}

function assignPlayer(room, ws, playerNumber) {
  ws.roomCode = room.code;
  ws.playerNumber = playerNumber;
  room.players.set(playerNumber, ws);
}

function joinRoom(ws, code) {
  const room = rooms.get(code);
  if (!room) {
    send(ws, { type: "error", message: "Room not found." });
    return;
  }

  if (room.players.size >= 2) {
    send(ws, { type: "error", message: "Room is full." });
    return;
  }

  const playerNumber = room.players.has(1) ? 2 : 1;
  assignPlayer(room, ws, playerNumber);

  if (!room.host) {
    room.host = playerNumber;
  }

  send(ws, {
    type: "room_joined",
    code,
    playerNumber,
    host: room.host,
    players: room.players.size,
    names: room.names,
  });

  broadcast(room, {
    type: "room_update",
    players: room.players.size,
    host: room.host,
    names: room.names,
  });
}

function initState(size) {
  return {
    size,
    board: Array.from({ length: size }, () => Array(size).fill(0)),
    current: STONE.BLACK,
    lastMove: null,
    koPoint: null,
    captures: { black: 0, white: 0 },
    passes: 0,
    gameOver: false,
    gameStarted: true,
    lastActionBy: null,
  };
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function getNeighbors(row, col, size) {
  const result = [];
  if (row > 0) result.push([row - 1, col]);
  if (row < size - 1) result.push([row + 1, col]);
  if (col > 0) result.push([row, col - 1]);
  if (col < size - 1) result.push([row, col + 1]);
  return result;
}

function getGroup(board, row, col, size) {
  const color = board[row][col];
  const stack = [[row, col]];
  const stones = [];
  const liberties = new Set();
  const visited = new Set([`${row},${col}`]);

  while (stack.length) {
    const [r, c] = stack.pop();
    stones.push([r, c]);

    getNeighbors(r, c, size).forEach(([nr, nc]) => {
      if (board[nr][nc] === 0) {
        liberties.add(`${nr},${nc}`);
      } else if (board[nr][nc] === color) {
        const key = `${nr},${nc}`;
        if (!visited.has(key)) {
          visited.add(key);
          stack.push([nr, nc]);
        }
      }
    });
  }

  return { stones, liberties };
}

function applyMoveToState(state, row, col, player) {
  if (state.board[row][col] !== 0) {
    return { legal: false, reason: "occupied" };
  }

  if (state.koPoint && state.koPoint.row === row && state.koPoint.col === col) {
    return { legal: false, reason: "ko" };
  }

  const boardCopy = cloneBoard(state.board);
  boardCopy[row][col] = player;

  const opponent = player === STONE.BLACK ? STONE.WHITE : STONE.BLACK;
  let captured = [];
  const checked = new Set();

  getNeighbors(row, col, state.size).forEach(([nr, nc]) => {
    if (boardCopy[nr][nc] !== opponent) return;
    const key = `${nr},${nc}`;
    if (checked.has(key)) return;

    const group = getGroup(boardCopy, nr, nc, state.size);
    group.stones.forEach(([sr, sc]) => checked.add(`${sr},${sc}`));

    if (group.liberties.size === 0) {
      captured = captured.concat(group.stones);
    }
  });

  if (captured.length > 0) {
    captured.forEach(([r, c]) => {
      boardCopy[r][c] = 0;
    });
  }

  const ownGroup = getGroup(boardCopy, row, col, state.size);
  if (ownGroup.liberties.size === 0) {
    return { legal: false, reason: "suicide" };
  }

  let koPoint = null;
  if (captured.length === 1 && ownGroup.liberties.size === 1) {
    const [kr, kc] = captured[0];
    koPoint = { row: kr, col: kc };
  }

  return { legal: true, board: boardCopy, captured, koPoint };
}

function scoreTerritory(board) {
  const size = board.length;
  const visited = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );
  let black = 0;
  let white = 0;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (board[row][col] !== 0 || visited[row][col]) continue;

      const region = [];
      const owners = new Set();
      const queue = [[row, col]];
      visited[row][col] = true;

      while (queue.length) {
        const [r, c] = queue.pop();
        region.push([r, c]);

        getNeighbors(r, c, size).forEach(([nr, nc]) => {
          if (board[nr][nc] === 0 && !visited[nr][nc]) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          } else if (board[nr][nc] === STONE.BLACK) {
            owners.add(STONE.BLACK);
          } else if (board[nr][nc] === STONE.WHITE) {
            owners.add(STONE.WHITE);
          }
        });
      }

      if (owners.size === 1) {
        if (owners.has(STONE.BLACK)) {
          black += region.length;
        } else if (owners.has(STONE.WHITE)) {
          white += region.length;
        }
      }
    }
  }

  return { black, white };
}

function buildScoreResult(state) {
  const territory = scoreTerritory(state.board);
  const blackScore = territory.black + state.captures.black;
  const whiteScore = territory.white + state.captures.white + 6.5;
  const margin = Math.abs(whiteScore - blackScore);
  let winner = "Draw";

  if (whiteScore > blackScore) {
    winner = "White";
  } else if (blackScore > whiteScore) {
    winner = "Black";
  }

  return {
    blackTerritory: territory.black,
    whiteTerritory: territory.white,
    blackScore,
    whiteScore,
    margin,
    winner,
  };
}

function snapshotState(state) {
  return {
    size: state.size,
    board: cloneBoard(state.board),
    current: state.current,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    koPoint: state.koPoint ? { ...state.koPoint } : null,
    captures: { ...state.captures },
    passes: state.passes,
    gameOver: state.gameOver,
    gameStarted: state.gameStarted,
    lastActionBy: state.lastActionBy,
  };
}

function pushHistory(room, playerNumber) {
  room.history.push({
    snapshot: snapshotState(room.state),
    lastActionBy: playerNumber,
  });
}

function startGame(room, size) {
  const safeSize = [9, 13, 19].includes(size) ? size : 19;
  room.state = initState(safeSize);
  room.started = true;
  room.history = [];
  const blackPlayer = Math.random() < 0.5 ? 1 : 2;
  const whitePlayer = blackPlayer === 1 ? 2 : 1;
  room.assignments = { blackPlayer, whitePlayer };

  broadcast(room, {
    type: "game_started",
    assignments: room.assignments,
    names: room.names,
    state: room.state,
  });
}

function handleMove(ws, message) {
  const room = rooms.get(ws.roomCode);
  if (!room || !room.state || !room.started) {
    send(ws, { type: "error", message: "Game not started." });
    return;
  }

  if (room.state.gameOver) {
    send(ws, { type: "error", message: "Game is over." });
    return;
  }

  const playerColor =
    room.assignments.blackPlayer === ws.playerNumber
      ? STONE.BLACK
      : STONE.WHITE;

  if (room.state.current !== playerColor) {
    send(ws, { type: "error", message: "Not your turn." });
    return;
  }

  const { row, col } = message;
  const result = applyMoveToState(room.state, row, col, playerColor);

  if (!result.legal) {
    send(ws, { type: "error", message: "Illegal move." });
    return;
  }

  pushHistory(room, ws.playerNumber);
  room.state.board = result.board;
  room.state.koPoint = result.koPoint;
  room.state.lastMove = { row, col };
  room.state.passes = 0;
  room.state.lastActionBy = ws.playerNumber;

  if (result.captured.length > 0) {
    if (playerColor === STONE.BLACK) {
      room.state.captures.black += result.captured.length;
    } else {
      room.state.captures.white += result.captured.length;
    }
  }

  room.state.current =
    room.state.current === STONE.BLACK ? STONE.WHITE : STONE.BLACK;

  broadcast(room, {
    type: "state_update",
    assignments: room.assignments,
    names: room.names,
    state: room.state,
    note: "Move undone.",
  });
}

function handlePass(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room || !room.state || !room.started) {
    send(ws, { type: "error", message: "Game not started." });
    return;
  }

  if (room.state.gameOver) {
    send(ws, { type: "error", message: "Game is over." });
    return;
  }

  const playerColor =
    room.assignments.blackPlayer === ws.playerNumber
      ? STONE.BLACK
      : STONE.WHITE;

  if (room.state.current !== playerColor) {
    send(ws, { type: "error", message: "Not your turn." });
    return;
  }

  pushHistory(room, ws.playerNumber);
  room.state.passes += 1;
  room.state.koPoint = null;
  room.state.lastActionBy = ws.playerNumber;

  if (room.state.passes >= 2) {
    room.state.gameOver = true;
    const score = buildScoreResult(room.state);
    broadcast(room, {
      type: "state_update",
      assignments: room.assignments,
      names: room.names,
      state: room.state,
      score,
    });
    return;
  }

  room.state.current =
    room.state.current === STONE.BLACK ? STONE.WHITE : STONE.BLACK;

  broadcast(room, {
    type: "state_update",
    assignments: room.assignments,
    names: room.names,
    state: room.state,
  });
}

function handleUndo(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room || !room.state || !room.started) {
    send(ws, { type: "error", message: "Game not started." });
    return;
  }

  if (room.history.length === 0) {
    send(ws, { type: "error", message: "Nothing to undo." });
    return;
  }

  const last = room.history[room.history.length - 1];
  if (last.lastActionBy !== ws.playerNumber) {
    send(ws, {
      type: "error",
      message: "Only the player who moved last can undo.",
    });
    return;
  }

  room.history.pop();
  room.state = last.snapshot;

  broadcast(room, {
    type: "state_update",
    assignments: room.assignments,
    names: room.names,
    state: room.state,
  });
}

function handleSetName(ws, message) {
  const room = rooms.get(ws.roomCode);
  if (!room) {
    send(ws, { type: "error", message: "Room not found." });
    return;
  }

  const name = sanitizeName(message.name);
  room.names[ws.playerNumber] = name;

  broadcast(room, {
    type: "room_update",
    players: room.players.size,
    host: room.host,
    names: room.names,
  });
}

function handleDisconnect(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  room.players.delete(ws.playerNumber);
  room.names[ws.playerNumber] = "";

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (!room.players.has(room.host)) {
    room.host = room.players.keys().next().value;
    broadcast(room, { type: "host_changed", host: room.host });
  }

  room.started = false;
  room.state = null;
  room.assignments = null;
  room.history = [];

  broadcast(room, {
    type: "room_update",
    players: room.players.size,
    host: room.host,
    names: room.names,
    note: "Opponent left. Room reset.",
  });
  broadcast(room, { type: "game_reset" });
}

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      send(ws, { type: "error", message: "Invalid message." });
      return;
    }

    switch (message.type) {
      case "create_room":
        createRoom(ws);
        break;
      case "join_room":
        joinRoom(ws, String(message.code || "").toUpperCase());
        break;
      case "start_game": {
        const room = rooms.get(ws.roomCode);
        if (!room) {
          send(ws, { type: "error", message: "Room not found." });
          break;
        }
        if (room.host !== ws.playerNumber) {
          send(ws, { type: "error", message: "Only the host can start." });
          break;
        }
        if (room.players.size < 2) {
          send(ws, { type: "error", message: "Waiting for opponent." });
          break;
        }
        startGame(room, Number(message.size));
        break;
      }
      case "move":
        handleMove(ws, message);
        break;
      case "pass":
        handlePass(ws);
        break;
      case "undo":
        handleUndo(ws);
        break;
      case "set_name":
        handleSetName(ws, message);
        break;
      default:
        send(ws, { type: "error", message: "Unknown action." });
        break;
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Go server listening on ${PORT}`);
});
