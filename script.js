const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const boardSizeSelect = document.getElementById("boardSize");
const newGameButton = document.getElementById("newGame");
const undoButton = document.getElementById("undoMove");
const passButton = document.getElementById("passTurn");
const clearBoardButton = document.getElementById("clearBoard");
const turnText = document.getElementById("turnText");
const turnDot = document.getElementById("turnDot");
const statusHint = document.getElementById("statusHint");
const blackCapturesEl = document.getElementById("blackCaptures");
const whiteCapturesEl = document.getElementById("whiteCaptures");
const gameOverPanel = document.getElementById("gameOverPanel");
const scoreSummary = document.getElementById("scoreSummary");
const coinEl = document.getElementById("coin");
const coinResultEl = document.getElementById("coinResult");
const player1ColorEl = document.getElementById("player1Color");
const player2ColorEl = document.getElementById("player2Color");

const STONE = {
  BLACK: 1,
  WHITE: 2,
};

const KOMI = 6.5;

const state = {
  size: 19,
  board: [],
  current: STONE.BLACK,
  lastMove: null,
  koPoint: null,
  captures: { black: 0, white: 0 },
  passes: 0,
  gameOver: false,
  history: [],
  hintTimer: null,
  gameStarted: false,
  coinFlipping: false,
  playerColors: { player1: "TBD", player2: "TBD" },
};

const metrics = {
  sizePx: 0,
  padding: 0,
  cell: 0,
};

function resetBoard(size, started) {
  state.size = size;
  state.board = Array.from({ length: size }, () => Array(size).fill(0));
  state.current = STONE.BLACK;
  state.lastMove = null;
  state.koPoint = null;
  state.captures = { black: 0, white: 0 };
  state.passes = 0;
  state.gameOver = false;
  state.history = [];
  state.gameStarted = started;

  clearHintTimer();
  updateCaptures();
  hideGameOver();
  updateStatus();
  updateControlStates();
  draw();
}

function updateStatus() {
  clearHintTimer();

  if (state.coinFlipping) {
    turnText.textContent = "Flipping coin";
    turnDot.style.background = "#b6b0a7";
    setStatusHint(defaultHint());
    updateControlStates();
    return;
  }

  if (state.gameOver) {
    turnText.textContent = "Game over";
    turnDot.style.background = "#b6b0a7";
    setStatusHint(defaultHint());
    updateControlStates();
    return;
  }

  if (!state.gameStarted) {
    turnText.textContent = "Waiting to start";
    turnDot.style.background = "#b6b0a7";
    setStatusHint(defaultHint());
    updateControlStates();
    return;
  }

  if (state.current === STONE.BLACK) {
    turnText.textContent = "Black to play";
    turnDot.style.background = "#1f1c18";
  } else {
    turnText.textContent = "White to play";
    turnDot.style.background = "#f5f1ea";
  }

  setStatusHint(defaultHint());
  updateControlStates();
}

function defaultHint() {
  if (state.coinFlipping) {
    return "Deciding who gets Black...";
  }
  if (state.gameOver) {
    return "Game over. Press New game to play again.";
  }
  if (!state.gameStarted) {
    return "Press New game to flip and start.";
  }
  return "Click an intersection to place a stone. Two passes end the game.";
}

function setStatusHint(message, temporary = false) {
  statusHint.textContent = message;
  if (!temporary) return;

  clearHintTimer();
  state.hintTimer = window.setTimeout(() => {
    statusHint.textContent = defaultHint();
    state.hintTimer = null;
  }, 1200);
}

function clearHintTimer() {
  if (state.hintTimer) {
    window.clearTimeout(state.hintTimer);
    state.hintTimer = null;
  }
}

function updateCaptures() {
  blackCapturesEl.textContent = String(state.captures.black);
  whiteCapturesEl.textContent = String(state.captures.white);
}

function updatePlayerLabels() {
  player1ColorEl.textContent = state.playerColors.player1;
  player2ColorEl.textContent = state.playerColors.player2;
}

function updateControlStates() {
  const canPlay =
    state.gameStarted && !state.gameOver && !state.coinFlipping;
  passButton.disabled = !canPlay;
  undoButton.disabled = state.history.length === 0 || state.coinFlipping;
  newGameButton.disabled = state.coinFlipping;
  clearBoardButton.disabled = state.coinFlipping;
  boardSizeSelect.disabled = state.coinFlipping;
}

function snapshotState() {
  return {
    board: cloneBoard(state.board),
    current: state.current,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    koPoint: state.koPoint ? { ...state.koPoint } : null,
    captures: { ...state.captures },
    passes: state.passes,
    gameOver: state.gameOver,
    gameStarted: state.gameStarted,
  };
}

function restoreState(snapshot) {
  state.board = cloneBoard(snapshot.board);
  state.current = snapshot.current;
  state.lastMove = snapshot.lastMove ? { ...snapshot.lastMove } : null;
  state.koPoint = snapshot.koPoint ? { ...snapshot.koPoint } : null;
  state.captures = { ...snapshot.captures };
  state.passes = snapshot.passes;
  state.gameOver = snapshot.gameOver;
  state.gameStarted = snapshot.gameStarted;

  updateCaptures();

  if (state.gameOver) {
    showGameOver(buildScoreResult());
  } else {
    hideGameOver();
  }

  updateStatus();
  draw();
  updateControlStates();
}

function pushHistory() {
  state.history.push(snapshotState());
  updateControlStates();
}

function showGameOver(result) {
  const lines = [
    `Black: ${result.blackScore.toFixed(1)} (${result.blackTerritory} territory + ${state.captures.black} captures)`,
    `White: ${result.whiteScore.toFixed(1)} (${result.whiteTerritory} territory + ${state.captures.white} captures + ${KOMI} komi)`,
    result.winner === "Draw"
      ? "Draw game."
      : `${result.winner} wins by ${result.margin.toFixed(1)}.`,
  ];

  scoreSummary.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
  gameOverPanel.classList.remove("hidden");
}

function hideGameOver() {
  scoreSummary.textContent = "";
  gameOverPanel.classList.add("hidden");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  const scale = window.devicePixelRatio || 1;

  canvas.width = Math.round(size * scale);
  canvas.height = Math.round(size * scale);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  metrics.sizePx = size;
  metrics.padding = Math.max(18, size * 0.065);
  metrics.cell = (size - metrics.padding * 2) / (state.size - 1);

  draw();
}

function drawBoard() {
  const { sizePx, padding, cell } = metrics;

  ctx.clearRect(0, 0, sizePx, sizePx);

  ctx.fillStyle = "#d8b67a";
  ctx.fillRect(0, 0, sizePx, sizePx);

  ctx.strokeStyle = "#5b3c25";
  ctx.lineWidth = 1.2;

  for (let i = 0; i < state.size; i += 1) {
    const offset = padding + i * cell;

    ctx.beginPath();
    ctx.moveTo(padding, offset);
    ctx.lineTo(sizePx - padding, offset);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(offset, padding);
    ctx.lineTo(offset, sizePx - padding);
    ctx.stroke();
  }

  drawStarPoints();
}

function drawStarPoints() {
  const points = getStarPoints();
  if (points.length === 0) return;

  ctx.fillStyle = "#4b3121";
  const radius = Math.max(2.2, metrics.cell * 0.1);

  points.forEach(([row, col]) => {
    const x = metrics.padding + col * metrics.cell;
    const y = metrics.padding + row * metrics.cell;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawStone(x, y, player, scale) {
  const radius = metrics.cell * 0.45 * scale;
  const gradient = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.35,
    radius * 0.2,
    x,
    y,
    radius
  );

  if (player === STONE.BLACK) {
    gradient.addColorStop(0, "#4a3f38");
    gradient.addColorStop(1, "#14110f");
  } else {
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, "#d5d0c8");
  }

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = radius * 0.2;
  ctx.shadowOffsetY = radius * 0.08;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawLastMove() {
  if (!state.lastMove) return;
  const { row, col } = state.lastMove;
  const x = metrics.padding + col * metrics.cell;
  const y = metrics.padding + row * metrics.cell;
  const radius = metrics.cell * 0.15;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();
}

function draw() {
  drawBoard();

  for (let row = 0; row < state.size; row += 1) {
    for (let col = 0; col < state.size; col += 1) {
      const player = state.board[row][col];
      if (!player) continue;

      const x = metrics.padding + col * metrics.cell;
      const y = metrics.padding + row * metrics.cell;
      drawStone(x, y, player, 1);
    }
  }

  drawLastMove();
}

function getStarPoints() {
  const size = state.size;
  if (![9, 13, 19].includes(size)) return [];

  const near = size === 9 ? 2 : 3;
  const center = Math.floor(size / 2);
  const far = size - 1 - near;

  if (size === 9) {
    return [
      [near, near],
      [near, far],
      [far, near],
      [far, far],
      [center, center],
    ];
  }

  const points = [near, center, far];
  const result = [];
  points.forEach((row) => {
    points.forEach((col) => {
      result.push([row, col]);
    });
  });

  return result;
}

function getIntersection(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const gridX = (x - metrics.padding) / metrics.cell;
  const gridY = (y - metrics.padding) / metrics.cell;

  const col = Math.round(gridX);
  const row = Math.round(gridY);

  if (col < 0 || row < 0 || col >= state.size || row >= state.size) {
    return null;
  }

  const dx = Math.abs(gridX - col);
  const dy = Math.abs(gridY - row);
  if (dx > 0.45 || dy > 0.45) return null;

  return { row, col };
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function getNeighbors(row, col) {
  const result = [];
  if (row > 0) result.push([row - 1, col]);
  if (row < state.size - 1) result.push([row + 1, col]);
  if (col > 0) result.push([row, col - 1]);
  if (col < state.size - 1) result.push([row, col + 1]);
  return result;
}

function getGroup(board, row, col) {
  const color = board[row][col];
  const stack = [[row, col]];
  const stones = [];
  const liberties = new Set();
  const visited = new Set([`${row},${col}`]);

  while (stack.length) {
    const [r, c] = stack.pop();
    stones.push([r, c]);

    getNeighbors(r, c).forEach(([nr, nc]) => {
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

function applyMove(row, col, player) {
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

  getNeighbors(row, col).forEach(([nr, nc]) => {
    if (boardCopy[nr][nc] !== opponent) return;
    const key = `${nr},${nc}`;
    if (checked.has(key)) return;

    const group = getGroup(boardCopy, nr, nc);
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

  const ownGroup = getGroup(boardCopy, row, col);
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

function placeStone(row, col) {
  if (state.coinFlipping) return;
  if (!state.gameStarted) {
    setStatusHint("Press New game to start.", true);
    return;
  }
  if (state.gameOver) return;

  const result = applyMove(row, col, state.current);
  if (!result.legal) {
    setStatusHint("Illegal move. Try again.", true);
    return;
  }

  pushHistory();
  state.board = result.board;
  state.koPoint = result.koPoint;
  state.lastMove = { row, col };
  state.passes = 0;

  if (result.captured.length > 0) {
    if (state.current === STONE.BLACK) {
      state.captures.black += result.captured.length;
    } else {
      state.captures.white += result.captured.length;
    }
    updateCaptures();
  }

  state.current = state.current === STONE.BLACK ? STONE.WHITE : STONE.BLACK;
  updateStatus();
  draw();
}

function passTurn() {
  if (state.coinFlipping) return;
  if (!state.gameStarted || state.gameOver) return;

  pushHistory();
  state.passes += 1;
  state.koPoint = null;

  if (state.passes >= 2) {
    endGame();
    return;
  }

  state.current = state.current === STONE.BLACK ? STONE.WHITE : STONE.BLACK;
  updateStatus();
  setStatusHint("Pass. Two passes end the game.", true);
}

function buildScoreResult() {
  const territory = scoreTerritory(state.board);
  const blackScore = territory.black + state.captures.black;
  const whiteScore = territory.white + state.captures.white + KOMI;
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

function endGame() {
  state.gameOver = true;
  updateStatus();
  showGameOver(buildScoreResult());
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

        getNeighbors(r, c).forEach(([nr, nc]) => {
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

function undoMove() {
  if (state.history.length === 0 || state.coinFlipping) return;
  const snapshot = state.history.pop();
  restoreState(snapshot);
  setStatusHint("Move undone.", true);
}

function setPlayerAssignments(blackPlayer, whitePlayer) {
  state.playerColors.player1 = blackPlayer === "Player 1" ? "Black" : "White";
  state.playerColors.player2 = whitePlayer === "Player 2" ? "White" : "Black";
  updatePlayerLabels();
}

function startNewGame() {
  if (state.coinFlipping) return;

  state.coinFlipping = true;
  updateStatus();

  coinEl.classList.remove("heads", "tails");
  coinEl.classList.add("flipping");
  coinResultEl.textContent = "Flipping...";

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const blackPlayer = result === "heads" ? "Player 1" : "Player 2";
  const whitePlayer = result === "heads" ? "Player 2" : "Player 1";

  window.setTimeout(() => {
    state.coinFlipping = false;
    coinEl.classList.remove("flipping");
    coinEl.classList.add(result);
    setPlayerAssignments(blackPlayer, whitePlayer);
    coinResultEl.textContent =
      result === "heads"
        ? "Heads: Player 1 is Black."
        : "Tails: Player 2 is Black.";
    resetBoard(state.size, true);
    setStatusHint("Game start. Black plays first.", true);
  }, 1100);
}

canvas.addEventListener("click", (event) => {
  const hit = getIntersection(event);
  if (!hit) return;
  placeStone(hit.row, hit.col);
});

newGameButton.addEventListener("click", () => {
  startNewGame();
});

undoButton.addEventListener("click", () => {
  undoMove();
});

passButton.addEventListener("click", () => {
  passTurn();
});

clearBoardButton.addEventListener("click", () => {
  resetBoard(state.size, state.gameStarted);
});

boardSizeSelect.addEventListener("change", (event) => {
  const size = Number(event.target.value);
  resetBoard(size, false);
  resizeCanvas();
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

updatePlayerLabels();
resetBoard(state.size, false);
resizeCanvas();
