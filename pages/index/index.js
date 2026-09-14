// 三国方块 —— 抖音小程序 · 俄罗斯方块
// 存储使用玩家本地存储（tt.setStorageSync / tt.getStorageSync）

const COLS = 10;
const ROWS = 20;
const STORAGE_KEY = 'sanguo_tetris_best_v1';

// 官职随等级晋升
const RANKS = [
  '新兵', '什长', '百夫长', '屯长', '军侯', '校尉', '中郎将',
  '偏将军', '车骑将军', '骠骑将军', '大将军', '大都督', '丞相', '魏武大帝',
];

// 七种方块以三国兵器/典故命名，配古风配色
const PIECES = [
  { key: 'I', name: '青龙偃月', color: '#4aa87a', dark: '#245c40', n: 4, base: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { key: 'O', name: '方天画戟', color: '#e2b33f', dark: '#97701c', n: 3, base: [[1, 0], [2, 0], [1, 1], [2, 1]], fixed: true },
  { key: 'T', name: '卧龙羽扇', color: '#a06cc9', dark: '#5f3a86', n: 3, base: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { key: 'S', name: '赤焰狂蹄', color: '#dd5a4e', dark: '#94322a', n: 3, base: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { key: 'Z', name: '玄铁坚甲', color: '#5f83ad', dark: '#35516f', n: 3, base: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { key: 'J', name: '丈八蛇矛', color: '#4f7fc2', dark: '#2b4f85', n: 3, base: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { key: 'L', name: '江东烈火', color: '#e08a3c', dark: '#a25a1a', n: 3, base: [[2, 0], [0, 1], [1, 1], [2, 1]] },
];

function rotateCells(cells, n) {
  // 顺时针旋转：(x, y) -> (n-1-y, x)
  return cells.map((c) => [n - 1 - c[1], c[0]]);
}

const SHAPES = {};
const SHAPE_LIST = [];
PIECES.forEach((p, i) => {
  let cells = p.base;
  const rots = [];
  for (let r = 0; r < 4; r++) {
    rots.push(cells);
    if (!p.fixed) cells = rotateCells(cells, p.n);
  }
  const shape = Object.assign({}, p, { index: i + 1, rots });
  SHAPES[p.key] = shape;
  SHAPE_LIST[i + 1] = shape;
});

Page({
  data: {
    state: 'start', // start | playing | paused | over
    score: 0,
    lines: 0,
    level: 1,
    rank: RANKS[0],
    best: { score: 0, lines: 0, level: 0 },
    newRecord: false,
    boardStyle: '',
  },

  onLoad() {
    this.board = this.emptyBoard();
    this.cur = null;
    this.nextKey = null;
    this.softHeld = false;
    this.dropAcc = 0;
    this.dropInterval = 850;
    this.flashRows = null;
    this.flashAcc = 0;
    this.msg = { text: '', until: 0 };
    this.lastTs = 0;
    this.loopRunning = false;
    this.repeatTimer = null;
    this.cell = 16;
    this.nextSize = 56;

    this.setData({ best: this.loadBest() });
    this.computeBoardSize();
  },

  onReady() {
    const query = tt.createSelectorQuery();
    query.select('#board').fields({ node: true, size: true });
    query.select('#next').fields({ node: true, size: true });
    query.exec((res) => {
      const boardInfo = res[0];
      const nextInfo = res[1];
      if (!boardInfo || !boardInfo.node) {
        tt.showToast({ title: '基础库版本过低，请升级抖音后重试', icon: 'none' });
        return;
      }
      let dpr = 2;
      try {
        dpr = Math.min(tt.getSystemInfoSync().pixelRatio || 2, 2);
      } catch (e) { }

      this.canvas = boardInfo.node;
      this.canvas.width = boardInfo.width * dpr;
      this.canvas.height = boardInfo.height * dpr;
      this.ctx = this.canvas.getContext('2d');
      this.ctx.scale(dpr, dpr);

      if (nextInfo && nextInfo.node) {
        this.nextCanvas = nextInfo.node;
        this.nextCanvas.width = nextInfo.width * dpr;
        this.nextCanvas.height = nextInfo.height * dpr;
        this.nextCtx = this.nextCanvas.getContext('2d');
        this.nextCtx.scale(dpr, dpr);
        this.nextSize = nextInfo.width;
      }
      this.startLoop();
    });
  },

  onHide() {
    if (this.data.state === 'playing') this.pauseGame();
  },

  onUnload() {
    this.loopRunning = false;
    this.stopRepeat();
  },

  noop() { },

  // ---------- 本地存储（玩家本地存储最高战绩） ----------
  loadBest() {
    try {
      const v = tt.getStorageSync(STORAGE_KEY);
      if (v && typeof v === 'object' && typeof v.score === 'number') return v;
    } catch (e) { }
    return { score: 0, lines: 0, level: 0 };
  },

  saveBest(best) {
    try {
      tt.setStorageSync(STORAGE_KEY, best);
    } catch (e) { }
  },

  // ---------- 布局 ----------
  computeBoardSize() {
    try {
      const sys = tt.getSystemInfoSync();
      const availH = sys.windowHeight - 240; // 预留顶部信息栏 + 底部按钮区
      const availW = sys.windowWidth - 24;
      const cell = Math.max(12, Math.min(24, Math.floor(Math.min(availW / COLS, availH / ROWS))));
      this.cell = cell;
      this.setData({
        boardStyle: 'width:' + cell * COLS + 'px;height:' + cell * ROWS + 'px;',
      });
    } catch (e) {
      this.cell = 16;
      this.setData({ boardStyle: 'width:160px;height:320px;' });
    }
  },

  // ---------- 游戏流程 ----------
  emptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  },

  randomKey() {
    return PIECES[Math.floor(Math.random() * PIECES.length)].key;
  },

  startGame() {
    this.board = this.emptyBoard();
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.dropInterval = 850;
    this.dropAcc = 0;
    this.flashRows = null;
    this.flashAcc = 0;
    this.nextKey = null;
    this.softHeld = false;
    this.msg = { text: '', until: 0 };
    this.setData({
      state: 'playing',
      score: 0,
      lines: 0,
      level: 1,
      rank: RANKS[0],
      newRecord: false,
    });
    this.spawn();
  },

  pauseGame() {
    if (this.data.state !== 'playing') return;
    this.softHeld = false;
    this.stopRepeat();
    this.setData({ state: 'paused' });
  },

  resumeGame() {
    if (this.data.state !== 'paused') return;
    this.lastTs = 0;
    this.setData({ state: 'playing' });
  },

  gameOver() {
    this.cur = null;
    this.softHeld = false;
    this.stopRepeat();
    const best = this.data.best;
    let newRecord = false;
    if (this.score > best.score) {
      newRecord = true;
      const saved = { score: this.score, lines: this.lines, level: this.level };
      this.saveBest(saved); // 写入玩家本地存储
      this.setData({ best: saved });
    }
    this.setData({ state: 'over', newRecord });
  },

  spawn() {
    if (!this.nextKey) this.nextKey = this.randomKey();
    const key = this.nextKey;
    this.nextKey = this.randomKey();
    const shape = SHAPES[key];
    this.cur = {
      key,
      rot: 0,
      cells: shape.rots[0],
      n: shape.n,
      x: Math.floor((COLS - shape.n) / 2),
      y: 0,
    };
    this.dropAcc = 0;
    if (this.collides(this.cur.cells, this.cur.x, this.cur.y)) {
      this.gameOver();
      return;
    }
    this.drawNext();
  },

  // ---------- 操作 ----------
  tryMove(dx) {
    if (this.data.state !== 'playing' || this.flashRows || !this.cur) return;
    if (!this.collides(this.cur.cells, this.cur.x + dx, this.cur.y)) {
      this.cur.x += dx;
    }
  },

  tryRotate() {
    if (this.data.state !== 'playing' || this.flashRows || !this.cur) return;
    const shape = SHAPES[this.cur.key];
    if (shape.fixed) return;
    const nextRot = (this.cur.rot + 1) % 4;
    const cells = shape.rots[nextRot];
    const kicks = [0, -1, 1, -2, 2]; // 简易踢墙
    for (let i = 0; i < kicks.length; i++) {
      if (!this.collides(cells, this.cur.x + kicks[i], this.cur.y)) {
        this.cur.rot = nextRot;
        this.cur.cells = cells;
        this.cur.x += kicks[i];
        return;
      }
    }
  },

  moveDown() {
    if (this.collides(this.cur.cells, this.cur.x, this.cur.y + 1)) return false;
    this.cur.y += 1;
    return true;
  },

  hardDrop() {
    if (this.data.state !== 'playing' || this.flashRows || !this.cur) return;
    let d = 0;
    while (this.moveDown()) d++;
    this.score += d * 2;
    this.setData({ score: this.score });
    this.lockPiece();
  },

  lockPiece() {
    const piece = this.cur;
    if (!piece) return;
    const shape = SHAPES[piece.key];
    let dead = false;
    for (let i = 0; i < piece.cells.length; i++) {
      const bx = piece.x + piece.cells[i][0];
      const by = piece.y + piece.cells[i][1];
      if (by < 0) {
        dead = true;
        continue;
      }
      this.board[by][bx] = shape.index;
    }
    this.cur = null;
    if (dead) {
      this.gameOver();
      return;
    }
    const full = [];
    for (let y = 0; y < ROWS; y++) {
      if (this.board[y].every((v) => v > 0)) full.push(y);
    }
    if (full.length) {
      this.flashRows = full;
      this.flashAcc = 0;
    } else {
      this.spawn();
    }
  },

  finishClear() {
    const rows = this.flashRows;
    const n = rows.length;
    this.flashRows = null;
    // 移除满行，顶部补空行
    this.board = this.board.filter((row, idx) => rows.indexOf(idx) === -1);
    while (this.board.length < ROWS) {
      this.board.unshift(new Array(COLS).fill(0));
    }
    const baseScore = [0, 100, 300, 500, 800][n] || 0;
    this.score += baseScore * this.level;
    this.lines += n;
    let text = n >= 4 ? '无双乱舞！斩敌+4' : n >= 2 ? '连斩！斩敌+' + n : '斩敌+1';
    const newLevel = Math.min(RANKS.length, Math.floor(this.lines / 10) + 1);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.dropInterval = Math.max(90, 850 - (this.level - 1) * 65);
      text = '晋升！官至' + RANKS[this.level - 1];
    }
    this.showMsg(text);
    this.setData({
      score: this.score,
      lines: this.lines,
      level: this.level,
      rank: RANKS[this.level - 1],
    });
    this.spawn();
  },

  showMsg(text) {
    this.msg = { text, until: Date.now() + 1200 };
  },

  // ---------- 主循环 ----------
  startLoop() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    const raf = this.canvas.requestAnimationFrame
      ? this.canvas.requestAnimationFrame.bind(this.canvas)
      : (cb) => setTimeout(() => cb(Date.now()), 33);
    const step = (ts) => {
      if (!this.loopRunning) return;
      if (!this.lastTs) this.lastTs = ts;
      let dt = ts - this.lastTs;
      this.lastTs = ts;
      if (dt > 200) dt = 200;
      this.update(dt);
      this.render();
      raf(step);
    };
    raf(step);
  },

  update(dt) {
    if (this.data.state !== 'playing') return;
    if (this.flashRows) {
      this.flashAcc += dt;
      if (this.flashAcc >= 160) this.finishClear();
      return;
    }
    if (!this.cur) return;
    this.dropAcc += dt;
    const interval = this.softHeld ? 45 : this.dropInterval;
    if (this.dropAcc >= interval) {
      this.dropAcc = 0;
      if (!this.moveDown()) this.lockPiece();
    }
  },

  collides(cells, px, py) {
    for (let i = 0; i < cells.length; i++) {
      const bx = px + cells[i][0];
      const by = py + cells[i][1];
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && this.board[by][bx]) return true;
    }
    return false;
  },

  // ---------- 渲染 ----------
  drawCell(ctx, px, py, s, shape) {
    ctx.fillStyle = shape.color;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(px + 3, py + 3, s - 6, Math.max(2, Math.floor(s * 0.2)));
    ctx.strokeStyle = shape.dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
  },

  drawGhost(ctx, cell) {
    let gy = this.cur.y;
    while (!this.collides(this.cur.cells, this.cur.x, gy + 1)) gy++;
    if (gy === this.cur.y) return;
    const shape = SHAPES[this.cur.key];
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = shape.color;
    for (let i = 0; i < this.cur.cells.length; i++) {
      const bx = this.cur.x + this.cur.cells[i][0];
      const by = gy + this.cur.cells[i][1];
      if (by >= 0) ctx.fillRect(bx * cell + 3, by * cell + 3, cell - 6, cell - 6);
    }
    ctx.restore();
  },

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const cell = this.cell;
    const w = cell * COLS;
    const h = cell * ROWS;

    ctx.fillStyle = '#16110b';
    ctx.fillRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = 'rgba(212, 175, 110, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, h);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(w, y * cell + 0.5);
    }
    ctx.stroke();

    // 已固定的方块
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = this.board[y][x];
        if (v) this.drawCell(ctx, x * cell, y * cell, cell, SHAPE_LIST[v]);
      }
    }

    // 满行闪烁
    if (this.flashRows) {
      const t = Math.min(1, this.flashAcc / 160);
      ctx.fillStyle = 'rgba(255, 240, 200, ' + (0.35 + t * 0.5) + ')';
      for (let i = 0; i < this.flashRows.length; i++) {
        ctx.fillRect(0, this.flashRows[i] * cell, w, cell);
      }
    }

    // 影子 + 当前方块
    if (this.cur && this.data.state === 'playing') {
      this.drawGhost(ctx, cell);
      const shape = SHAPES[this.cur.key];
      for (let i = 0; i < this.cur.cells.length; i++) {
        const bx = this.cur.x + this.cur.cells[i][0];
        const by = this.cur.y + this.cur.cells[i][1];
        if (by >= 0) this.drawCell(ctx, bx * cell, by * cell, cell, shape);
      }
    }

    // 边框
    ctx.strokeStyle = 'rgba(212, 175, 110, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // 战报浮字
    const now = Date.now();
    if (this.msg.text && now < this.msg.until) {
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(this.msg.text).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(w / 2 - tw / 2 - 12, 14, tw + 24, 30);
      ctx.fillStyle = '#f5dfae';
      ctx.fillText(this.msg.text, w / 2, 35);
    }

    // 非进行中状态的画布内浮层（避免原生组件遮挡问题）
    const st = this.data.state;
    if (st !== 'playing') this.drawOverlay(ctx, w, h, st);
  },

  drawOverlay(ctx, w, h, state) {
    ctx.fillStyle = 'rgba(10, 7, 4, 0.82)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    const cx = w / 2;
    const best = this.data.best;

    if (state === 'start') {
      ctx.fillStyle = '#f5dfae';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('三 国 方 块', cx, h * 0.3);
      ctx.fillStyle = '#c9b382';
      ctx.font = '15px sans-serif';
      ctx.fillText('消行斩敌 · 步步高升', cx, h * 0.3 + 32);
      ctx.fillStyle = '#e8d5b0';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('历史最高战功：' + (best ? best.score : 0), cx, h * 0.56);
      ctx.fillStyle = '#8f7b55';
      ctx.font = '13px sans-serif';
      ctx.fillText('点击下方「点将出征」按钮开战', cx, h * 0.68);
    } else if (state === 'paused') {
      ctx.fillStyle = '#f5dfae';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('安 营 扎 寨', cx, h * 0.4);
      ctx.fillStyle = '#8f7b55';
      ctx.font = '13px sans-serif';
      ctx.fillText('点击下方「继续出征」返回战场', cx, h * 0.4 + 34);
    } else if (state === 'over') {
      ctx.fillStyle = '#e0655a';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('败 走 麦 城', cx, h * 0.26);
      ctx.fillStyle = '#f5dfae';
      ctx.font = '16px sans-serif';
      ctx.fillText('最终战功 ' + this.score + ' · 斩敌 ' + this.lines, cx, h * 0.42);
      ctx.fillText('官至 ' + RANKS[this.level - 1], cx, h * 0.42 + 26);
      if (this.data.newRecord) {
        ctx.fillStyle = '#ffd76a';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('史册留名！刷新最高战功！', cx, h * 0.42 + 58);
      } else if (best) {
        ctx.fillStyle = '#8f7b55';
        ctx.font = '13px sans-serif';
        ctx.fillText('历史最高战功 ' + best.score, cx, h * 0.42 + 58);
      }
      ctx.fillStyle = '#8f7b55';
      ctx.font = '13px sans-serif';
      ctx.fillText('点击下方「再战」卷土重来', cx, h * 0.68);
    }
  },

  drawNext() {
    const ctx = this.nextCtx;
    if (!ctx) return;
    const size = this.nextSize;
    ctx.clearRect(0, 0, size, size);
    const shape = SHAPES[this.nextKey];
    if (!shape) return;
    const cells = shape.rots[0];
    let minX = 9, maxX = -1, minY = 9, maxY = -1;
    cells.forEach((c) => {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    });
    const c = 13;
    const px = (size - (maxX - minX + 1) * c) / 2 - minX * c;
    const py = (size - (maxY - minY + 1) * c) / 2 - minY * c;
    cells.forEach((cc) => {
      this.drawCell(ctx, px + cc[0] * c, py + cc[1] * c, c, shape);
    });
  },

  // ---------- 事件 ----------
  onStart() {
    this.startGame();
  },
  onRestart() {
    this.startGame();
  },
  onResume() {
    this.resumeGame();
  },
  onBackHome() {
    this.board = this.emptyBoard();
    this.cur = null;
    this.flashRows = null;
    this.setData({ state: 'start' });
  },
  onPauseTap() {
    const st = this.data.state;
    if (st === 'playing') this.pauseGame();
    else if (st === 'paused') this.resumeGame();
  },
  onLeftDown() {
    this.tryMove(-1);
    this.startRepeat(-1);
  },
  onRightDown() {
    this.tryMove(1);
    this.startRepeat(1);
  },
  onLeftUp() {
    this.stopRepeat();
  },
  onRightUp() {
    this.stopRepeat();
  },
  onRotate() {
    this.tryRotate();
  },
  onSoftDown() {
    if (this.data.state !== 'playing') return;
    this.softHeld = true;
  },
  onSoftUp() {
    this.softHeld = false;
  },
  onHardDrop() {
    this.hardDrop();
  },
  startRepeat(dx) {
    this.stopRepeat();
    this.repeatTimer = setInterval(() => {
      if (this.data.state === 'playing') this.tryMove(dx);
    }, 110);
  },
  stopRepeat() {
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
  },
});
