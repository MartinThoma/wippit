// Wippit! — core rules and state machine. No DOM, no rendering.
//
// Board: COLS columns on COLS/2 seesaws. Each column is a stack (array, index 0 at
// the bottom) resting on a pan. A pan sits 0, 1 or 2 rows up depending on its
// seesaw (down / level / up), so a pan holds 8, 7 or 6 balls below the ceiling.
// "Absolute rows" (pan offset + stack index) are what counts for horizontal
// neighbours, since a raised pan shifts its whole stack.
//
// Above the ceiling hangs a crane; above that a depot of 2 rows of balls. The
// player picks a ball from the depot's bottom row, carries it to a column and
// drops it. A seesaw tilts to its heavier side; when it swings over, the top
// ball of the rising pan is catapulted as many columns as the weight difference
// (towards the heavy side). Balls that leave the board wrap around and come back
// changed (ball -> heart -> bomb -> heart; other specials -> bomb).

export const COLS = 8;
export const ROWS = 8;                 // ceiling: absolute row 8 is out of bounds
export const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan'];
export const BALLS_PER_LEVEL = 25;     // balls dropped per level
export const STAR_EVERY = 50;          // a silver star enters the depot every N balls
export const BONUS_TIME = 8;           // seconds the bonus lamps stay lit after a pop
export const MAX_LEVEL = 30;
export const CRANE_ROW = 9;            // absolute row where the carried ball hangs
export const DEPOT_ROW = 10;           // absolute row of the depot's bottom row
export const TOTAL_ROWS = 12;          // rows 0..11 (board, crane, two depot rows)

/** Kinds that stay on the board as blocks. Everything else is consumed on impact. */
export const STAYS = new Set(['ball', 'joker', 'bomb', 'heart', 'stone', 'star', 'gold']);

export const KIND_INFO = {
  joker: ['Joker', 'Counts as any colour, even as a heart.'],
  bomb: ['Bomb', 'Blasts a 3×3 area where it lands. On an empty pan it waits for the next ball.'],
  heart: ['Heart', 'A ball that flew off the board. Pops only with other hearts, jokers or bombs.'],
  star: ['Silver star', 'Arrives every 50 balls. Three in a row clear the whole board.'],
  gold: ['Gold star', 'Two silver stars stacked. Three golds in a row clear the board and double your score.'],
  stone: ['Stone', 'Never pops. Only bombs, drills and zaps remove it.'],
  drill: ['Drill', 'Destroys the whole stack it lands on.'],
  zap: ['Zap', 'Destroys every ball in the row it hits.'],
  colorzap: ['Colour zap', 'Destroys every ball of the colour it hits.'],
  tint: ['Tint', 'Recolours the whole stack to the colour of its top ball.'],
  tint3: ['Tint 3×3', 'Recolours a 3×3 area to the colour it hits.'],
  level: ['Leveller', 'Sets the weight of every ball in the stack to 0.'],
  stonemaker: ['Stonemaker', 'Turns a 3×3 area into stones. Beware.'],
};

const FALL_SPEED = 22;                 // rows / s for the dropped ball
const GRAVITY = 48;                    // rows / s^2 for settling blocks
const CLEAR_TIME = 0.4;                // s, pop animation
const MERGE_TIME = 0.45;               // s, five-merge animation
const TILT_SPEED = 4.5;                // tilt units / s (a full swing is 2 units)
const MAX_THROWS_PER_TURN = 60;        // safety valve

let nextId = 1;

export function makeBlock(kind, color, weight) {
  return {
    id: nextId++,
    kind,            // see STAYS / KIND_INFO
    color,           // COLORS entry, or 'heart' / 'star' / 'gold', or null
    weight,          // 0..n (specials are weightless)
    y: 0,            // visual stack index (float) while settling
    vy: 0,
    state: 'rest',   // 'rest' | 'clearing' | 'flying' | 'merging'
    clear: 0,        // pop animation progress 0..1
    flight: null,
    dormant: false,  // bombs resting on an empty pan
  };
}

export function flightPosAt(f, t) {
  t = Math.max(0, Math.min(1, t));
  return {
    x: f.x0 + (f.xRaw - f.x0) * t,                      // unwrapped column
    y: f.y0 + (f.y1 - f.y0) * t + f.h * 4 * t * (1 - t), // absolute row
  };
}

export const wrapX = (x) => ((x % COLS) + COLS) % COLS;

export class Game {
  constructor(hooks = {}) {
    this.hooks = hooks; // { sound(name), gameOver(game) }
    this.reset();
  }

  reset() {
    this.cols = Array.from({ length: COLS }, () => []);
    this.seesaws = [];
    for (let x = 0; x + 1 < COLS; x += 2) {
      // state: -1 = left pan down, 0 = level, +1 = right pan down. tilt animates towards state.
      this.seesaws.push({ left: x, right: x + 1, state: 0, tilt: 0 });
    }
    this.score = 0;
    this.level = 1;
    this.dropped = 0;    // balls dropped by the player
    this.taken = 0;      // balls taken from the depot (for stars)
    this.cleared = 0;
    this.chain = 0;
    this.bonusUntil = 0;
    this.starDue = false;
    this.depot = Array.from({ length: COLS }, () => [this.randomBlock(), this.randomBlock()]);
    this.crane = { x: Math.floor(COLS / 2) - 1, block: null };
    this.falling = null;   // { block, x, y } the dropped ball on its way down
    this.flying = null;    // catapulted block
    this.clearing = [];
    this.merging = null;   // { base, others, t }
    this.particles = [];
    this.popups = [];
    this.phase = 'pick';   // 'pick' | 'drop' | 'falling' | 'resolve' | 'over'
    this.time = 0;
    this.throwsThisTurn = 0;
    this.stats = { tips: 0, maxChain: 0, bombs: 0, wraps: 0, merges: 0, farthest: 0 };
  }

  // ---- helpers -----------------------------------------------------------

  sound(name) { if (this.hooks.sound) this.hooks.sound(name); }

  nColors() { return Math.min(COLORS.length, 4 + Math.floor((this.level - 1) / 3)); }

  randomBlock() {
    if (this.starDue) {
      this.starDue = false;
      return makeBlock('star', 'star', 0);
    }
    const pExtra = Math.min(0.16, 0.05 + 0.012 * (this.level - 1));
    if (Math.random() < pExtra) {
      const table = [
        ['joker', 24], ['bomb', 24], ['drill', 10], ['zap', 10], ['colorzap', 8],
        ['tint', 8], ['tint3', 7], ['level', 5], [this.level >= 4 ? 'stonemaker' : 'joker', 4],
      ];
      let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
      for (const [kind, w] of table) {
        r -= w;
        if (r <= 0) return makeBlock(kind, null, 0);
      }
    }
    const color = COLORS[Math.floor(Math.random() * this.nColors())];
    return makeBlock('ball', color, 1 + Math.floor(Math.random() * 9));
  }

  columnWeight(x) {
    let w = 0;
    for (const b of this.cols[x]) w += b.weight;
    return w;
  }

  seesawOf(x) { return this.seesaws[x >> 1]; }

  /** Integer pan height (0 = down, 1 = level, 2 = up) by seesaw state. */
  panRows(x) {
    const s = this.seesawOf(x);
    return x === s.left ? 1 + s.state : 1 - s.state;
  }

  /** Animated pan height (float) by seesaw tilt. */
  panOffset(x) {
    const s = this.seesawOf(x);
    return x === s.left ? 1 + s.tilt : 1 - s.tilt;
  }

  capacity(x) { return ROWS - this.panRows(x); }

  /** Block at an absolute row in column x (or null). */
  cell(x, r) {
    if (x < 0 || x >= COLS) return null;
    const i = r - this.panRows(x);
    return i >= 0 && i < this.cols[x].length ? this.cols[x][i] : null;
  }

  locate(b) {
    for (let x = 0; x < COLS; x++) {
      const i = this.cols[x].indexOf(b);
      if (i >= 0) return { x, i, r: this.panRows(x) + i };
    }
    return null;
  }

  bonusLeft() { return Math.max(0, this.bonusUntil - this.time) / BONUS_TIME; }

  /**
   * What would happen if the carried ball were dropped in column x:
   * { overflow, tip: { rising, dir, d, xRaw, tx, crossings } | null }
   */
  previewDrop(x) {
    const b = this.crane.block;
    if (!b) return null;
    const overflow = STAYS.has(b.kind) && this.cols[x].length + 1 > this.capacity(x);
    let tip = null;
    if (STAYS.has(b.kind) && b.weight > 0) {
      const s = this.seesawOf(x);
      const wl = this.columnWeight(s.left) + (x === s.left ? b.weight : 0);
      const wr = this.columnWeight(s.right) + (x === s.right ? b.weight : 0);
      const target = Math.sign(wr - wl);
      if (target !== 0 && target !== s.state) {
        const rising = target < 0 ? s.right : s.left;
        if (this.cols[rising].length) tip = this.throwParams(rising, target, Math.abs(wl - wr));
      }
    }
    return { overflow, tip };
  }

  throwParams(rising, target, d) {
    const dir = target < 0 ? -1 : 1;    // towards the heavy side, over the pivot
    const xRaw = rising + dir * d;
    return { rising, dir, d, xRaw, tx: wrapX(xRaw), crossings: Math.abs(Math.floor(xRaw / COLS)) };
  }

  // ---- main update -------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.updateAnimations(dt);
    if (this.phase === 'falling') this.updateFalling(dt);
    else if (this.phase === 'resolve') this.resolveStep();
  }

  updateAnimations(dt) {
    for (let x = 0; x < COLS; x++) {
      const col = this.cols[x];
      for (let i = 0; i < col.length; i++) {
        const b = col[i];
        if (b.y > i) {
          b.vy += GRAVITY * dt;
          b.y -= b.vy * dt;
          if (b.y <= i) { b.y = i; b.vy = 0; }
        } else if (b.y < i) {
          b.y = i;
        }
      }
    }
    if (this.flying) {
      const b = this.flying;
      const f = b.flight;
      f.t += dt / f.dur;
      while (f.crossed < f.cross.length && f.t >= f.cross[f.crossed]) {
        f.crossed++;
        this.transformWrapped(b);
      }
      if (f.t >= 1) this.landFlying();
    }
    for (const s of this.seesaws) {
      const d = s.state - s.tilt;
      const step = TILT_SPEED * dt;
      if (Math.abs(d) <= step) s.tilt = s.state;
      else s.tilt += Math.sign(d) * step;
    }
    if (this.clearing.length) {
      let done = false;
      for (const b of this.clearing) {
        b.clear += dt / CLEAR_TIME;
        if (b.clear >= 1) done = true;
      }
      if (done) this.finishClear();
    }
    if (this.merging) {
      this.merging.t += dt / MERGE_TIME;
      for (const b of this.merging.others) b.clear = Math.min(1, this.merging.t);
      if (this.merging.t >= 1) this.finishMerge();
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < p.life);
  }

  // ---- player actions ----------------------------------------------------

  moveCrane(dir) {
    if (this.phase !== 'pick' && this.phase !== 'drop') return false;
    const nx = this.crane.x + dir;
    if (nx < 0 || nx >= COLS) return false;
    this.crane.x = nx;
    this.sound('move');
    return true;
  }

  setCrane(x) {
    if (this.phase !== 'pick' && this.phase !== 'drop') return;
    if (x < 0 || x >= COLS || x === this.crane.x) return;
    this.crane.x = x;
    this.sound('move');
  }

  /** Grab (in 'pick') or drop (in 'drop') at the crane's column. */
  action() {
    if (this.phase === 'pick') this.grab();
    else if (this.phase === 'drop') this.drop();
  }

  grab() {
    if (this.phase !== 'pick') return;
    const slot = this.depot[this.crane.x];
    this.crane.block = slot.shift();
    this.taken++;
    if (this.taken % STAR_EVERY === 0) this.starDue = true;
    slot.push(this.randomBlock());
    this.phase = 'drop';
    this.sound('grab');
  }

  drop() {
    if (this.phase !== 'drop') return;
    const block = this.crane.block;
    this.crane.block = null;
    this.falling = { block, x: this.crane.x, y: CRANE_ROW };
    this.dropped++;
    this.chain = 0;
    this.throwsThisTurn = 0;
    this.phase = 'falling';
    this.sound('drop');
    this.updateLevel();
  }

  updateFalling(dt) {
    const f = this.falling;
    f.y -= FALL_SPEED * dt;
    const landY = this.panRows(f.x) + this.cols[f.x].length;
    if (f.y <= landY) {
      this.falling = null;
      this.onLand(f.block, f.x);
    }
  }

  // ---- landing -----------------------------------------------------------

  onLand(b, x) {
    const col = this.cols[x];
    this.phase = 'resolve';
    if (!STAYS.has(b.kind)) {
      this.applyExtra(b, x);
      return;
    }
    if (b.kind === 'bomb' && col.length > 0) {
      this.explodeAt(x, this.panRows(x) + col.length);
      return;
    }
    b.y = col.length;
    b.vy = 0;
    b.state = 'rest';
    b.flight = null;
    col.push(b);
    this.sound('land');
    if (b.kind === 'bomb') {
      b.dormant = true;
      return;
    }
    const below = col[col.length - 2];
    if (below && below.kind === 'bomb' && below.dormant) {
      this.explodeAt(x, this.panRows(x) + col.length - 2);
    }
  }

  applyExtra(b, x) {
    const col = this.cols[x];
    const top = col[col.length - 1];
    const r = this.panRows(x) + col.length - 1; // absolute row of the ball hit
    const doomed = new Set();
    let label = null;
    switch (b.kind) {
      case 'drill':
        col.forEach((q) => doomed.add(q));
        label = 'DRILL';
        break;
      case 'zap':
        if (top) for (let nx = 0; nx < COLS; nx++) { const q = this.cell(nx, r); if (q) doomed.add(q); }
        label = 'ZAP';
        break;
      case 'colorzap':
        if (top && top.color) this.cols.forEach((c) => c.forEach((q) => { if (q.color === top.color) doomed.add(q); }));
        label = 'COLOUR ZAP';
        break;
      case 'tint':
        if (top && top.kind === 'ball') col.forEach((q) => { if (q.kind === 'ball') q.color = top.color; });
        label = 'TINT';
        break;
      case 'tint3':
        if (top && top.kind === 'ball') this.forArea(x, r, (q) => { if (q.kind === 'ball') q.color = top.color; });
        label = 'TINT';
        break;
      case 'level':
        col.forEach((q) => { q.weight = 0; });
        label = 'WEIGHT 0';
        break;
      case 'stonemaker':
        this.forArea(x, r, (q) => { if (q.kind === 'ball' || q.kind === 'heart') { q.kind = 'stone'; q.color = null; } });
        label = 'STONES!';
        break;
      default:
        break;
    }
    if (doomed.size) {
      this.destroy(doomed, 10);
      this.sound('boom');
    } else {
      this.sound(b.kind === 'stonemaker' ? 'stone' : 'zap');
    }
    if (label) this.popups.push({ x, y: Math.max(r, this.panRows(x)) + 0.5, text: label, t: 0, life: 1.1, big: false });
  }

  forArea(x, r, fn) {
    for (let nx = x - 1; nx <= x + 1; nx++) {
      for (let nr = r - 1; nr <= r + 1; nr++) {
        const q = this.cell(nx, nr);
        if (q) fn(q, nx, nr);
      }
    }
  }

  /** 3x3 explosion centred on absolute cell (x, r); chains into dormant bombs. */
  explodeAt(x, r) {
    const doomed = new Set();
    const queue = [[x, r]];
    const seen = new Set();
    while (queue.length) {
      const [cx, cr] = queue.shift();
      const key = `${cx},${cr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.burst(cx, cr, 'bomb', 24);
      this.forArea(cx, cr, (q, nx, nr) => {
        if (doomed.has(q)) return;
        doomed.add(q);
        if (q.kind === 'bomb') queue.push([nx, nr]);
      });
    }
    this.stats.bombs++;
    this.destroy(doomed, 15);
    this.popups.push({ x, y: r, text: 'BOOM', t: 0, life: 1.0, big: true });
    this.sound('boom');
  }

  destroy(set, pointsEach) {
    if (!set.size) return;
    this.cols.forEach((col, x) => col.forEach((q, i) => {
      if (set.has(q)) this.burst(x, this.panRows(x) + i, q.color || 'bomb', 6);
    }));
    this.removeBlocks(set);
    this.score += pointsEach * set.size * this.level;
    this.cleared += set.size;
  }

  removeBlocks(set) {
    for (let x = 0; x < COLS; x++) this.cols[x] = this.cols[x].filter((b) => !set.has(b));
    if (this.merging && (set.has(this.merging.base) || this.merging.others.some((b) => set.has(b)))) this.merging = null;
  }

  // ---- resolution --------------------------------------------------------

  isAnimating() {
    if (this.flying || this.clearing.length || this.merging) return true;
    for (const s of this.seesaws) if (s.tilt !== s.state) return true;
    for (let x = 0; x < COLS; x++) {
      const col = this.cols[x];
      for (let i = 0; i < col.length; i++) if (col[i].y > i) return true;
    }
    return false;
  }

  resolveStep() {
    if (this.isAnimating()) return;
    if (this.checkMatches()) return;
    if (this.checkMerges()) return;
    if (this.checkSeesaws()) return;
    if (this.cols.some((c, x) => this.panRows(x) + c.length > ROWS)) {
      this.gameOver();
      return;
    }
    this.chain = 0;
    this.phase = 'pick';
  }

  /** Horizontal runs of 3+ pop, together with every connected ball of that colour. */
  findClears() {
    const matchable = (b, c) => !!b && b.state === 'rest' && (b.kind === 'joker' || (b.color !== null && b.color === c));
    const colors = new Set();
    this.cols.forEach((col) => col.forEach((b) => { if (b.color) colors.add(b.color); }));
    const triggered = new Map(); // block -> colour
    let starClear = 0;
    for (const c of colors) {
      for (let r = 0; r < ROWS; r++) {
        let run = [];
        for (let x = 0; x <= COLS; x++) {
          const b = x < COLS ? this.cell(x, r) : null;
          if (matchable(b, c)) {
            run.push(b);
            continue;
          }
          if (run.length >= 3 && run.some((q) => q.kind !== 'joker')) {
            for (const q of run) triggered.set(q, c);
            if (c === 'star') starClear = Math.max(starClear, 1);
            if (c === 'gold') starClear = 2;
          }
          run = [];
        }
      }
    }
    const all = new Set(triggered.keys());
    const queue = [...triggered.entries()];
    while (queue.length) {
      const [b, c] = queue.shift();
      const at = this.locate(b);
      if (!at) continue;
      const nbs = [this.cols[at.x][at.i - 1], this.cols[at.x][at.i + 1], this.cell(at.x - 1, at.r), this.cell(at.x + 1, at.r)];
      for (const nb of nbs) {
        if (matchable(nb, c) && !all.has(nb)) {
          all.add(nb);
          queue.push([nb, c]);
        }
      }
    }
    return { blocks: all, starClear };
  }

  checkMatches() {
    const { blocks, starClear } = this.findClears();
    if (!blocks.size) return false;
    this.chain++;
    this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
    const bonus = this.time < this.bonusUntil ? 2 : 1;
    this.bonusUntil = this.time + BONUS_TIME;

    let targets = blocks;
    let pts;
    let text;
    if (starClear) {
      targets = new Set();
      this.cols.forEach((col) => col.forEach((b) => targets.add(b)));
      pts = 100 * targets.size * this.level;
      text = starClear === 2 ? 'GOLDEN CLEAR!' : 'STAR CLEAR!';
      this.pendingDouble = starClear === 2;
    } else {
      let sumW = 0;
      for (const b of blocks) sumW += b.weight;
      pts = (10 * blocks.size + sumW) * this.level * bonus * this.chain;
      text = `+${pts}`;
      if (this.chain > 1) text += `  x${this.chain}`;
      if (bonus > 1) text = `BONUS ${text}`;
    }
    this.score += pts;
    let cx = 0, cy = 0;
    for (const b of blocks) {
      const at = this.locate(b);
      cx += at.x;
      cy += at.r;
    }
    this.popups.push({ x: cx / blocks.size, y: cy / blocks.size, text, t: 0, life: 1.2, big: this.chain > 1 || bonus > 1 || !!starClear });
    for (const b of targets) {
      b.state = 'clearing';
      b.clear = 0;
    }
    this.clearing = [...targets];
    this.sound(starClear ? 'level' : this.chain > 1 ? 'chain' : 'pop');
    return true;
  }

  finishClear() {
    const set = new Set(this.clearing);
    this.cols.forEach((col, x) => col.forEach((b, i) => {
      if (set.has(b)) this.burst(x, this.panRows(x) + i, b.color || 'bomb', 10);
    }));
    this.removeBlocks(set);
    this.clearing = [];
    this.cleared += set.size;
    if (this.pendingDouble) {
      this.pendingDouble = false;
      this.score *= 2;
      this.popups.push({ x: (COLS - 1) / 2, y: ROWS / 2, text: 'SCORE x2', t: 0, life: 1.6, big: true });
    }
  }

  /** Five same-coloured balls stacked vertically fuse into one heavy ball. */
  checkMerges() {
    for (let x = 0; x < COLS; x++) {
      const col = this.cols[x];
      for (let i = 0; i + 4 < col.length; i++) {
        const base = col[i];
        if (base.kind !== 'ball') continue;
        let ok = true;
        for (let k = 1; k < 5; k++) {
          const q = col[i + k];
          if (q.kind !== 'ball' || q.color !== base.color) { ok = false; break; }
        }
        if (!ok) continue;
        if (base.kind === 'ball') {
          const others = col.slice(i + 1, i + 5);
          for (const q of others) { q.state = 'merging'; q.clear = 0; }
          this.merging = { base, others, t: 0 };
          this.sound('merge');
          return true;
        }
      }
      // two silver stars stacked become a gold star
      for (let i = 0; i + 1 < col.length; i++) {
        if (col[i].kind === 'star' && col[i + 1].kind === 'star') {
          col[i + 1].state = 'merging';
          col[i + 1].clear = 0;
          this.merging = { base: col[i], others: [col[i + 1]], t: 0, gold: true };
          this.sound('merge');
          return true;
        }
      }
    }
    return false;
  }

  finishMerge() {
    const m = this.merging;
    this.merging = null;
    const at = this.locate(m.base);
    if (m.gold) {
      m.base.kind = 'gold';
      m.base.color = 'gold';
    } else {
      m.base.weight += m.others.reduce((a, b) => a + b.weight, 0);
      this.score += 50 * this.level;
      this.stats.merges++;
    }
    this.removeBlocks(new Set(m.others));
    if (at) this.popups.push({ x: at.x, y: at.r + 1, text: m.gold ? 'GOLD!' : `${m.base.weight}!`, t: 0, life: 1.0, big: false });
  }

  checkSeesaws() {
    if (this.throwsThisTurn >= MAX_THROWS_PER_TURN) return false;
    let changed = false;
    for (const s of this.seesaws) {
      const wl = this.columnWeight(s.left);
      const wr = this.columnWeight(s.right);
      const target = Math.sign(wr - wl);
      if (target === s.state) continue;
      s.state = target;
      changed = true;
      if (target === 0) continue;
      this.stats.tips++;
      const rising = target < 0 ? s.right : s.left;
      const col = this.cols[rising];
      if (!col.length) {
        this.sound('tilt');
        continue;
      }
      const p = this.throwParams(rising, target, Math.abs(wl - wr));
      const b = col.pop();
      const y0 = this.panRows(rising) + col.length;
      const y1 = this.panRows(p.tx) + this.cols[p.tx].length;
      const cross = [];
      for (let k = 1; k <= p.crossings; k++) {
        const boundary = p.dir > 0 ? COLS * k - 0.5 : -COLS * (k - 1) - 0.5;
        cross.push((boundary - rising) / (p.xRaw - rising));
      }
      b.state = 'flying';
      b.flight = {
        x0: rising, xRaw: p.xRaw, x1: p.tx, y0, y1,
        t: 0, dur: Math.min(2.0, 0.45 + 0.07 * p.d),
        h: Math.min(4.5, 1.5 + 0.3 * p.d),
        cross, crossed: 0, d: p.d,
      };
      this.flying = b;
      this.throwsThisTurn++;
      this.stats.farthest = Math.max(this.stats.farthest, p.d);
      this.sound('boing');
      return true;
    }
    return changed;
  }

  /** A block that leaves the board comes back as something else. */
  transformWrapped(b) {
    this.stats.wraps++;
    if (b.kind === 'ball') { b.kind = 'heart'; b.color = 'heart'; }
    else if (b.kind === 'heart') { b.kind = 'bomb'; b.color = null; b.weight = 0; }
    else if (b.kind === 'bomb') { b.kind = 'heart'; b.color = 'heart'; }
    else { b.kind = 'bomb'; b.color = null; b.weight = 0; }
    this.sound('warp');
  }

  landFlying() {
    const b = this.flying;
    const tx = b.flight.x1;
    this.flying = null;
    this.onLand(b, tx);
  }

  updateLevel() {
    const lv = Math.min(MAX_LEVEL, 1 + Math.floor(this.dropped / BALLS_PER_LEVEL));
    if (lv > this.level) {
      this.level = lv;
      this.popups.push({ x: (COLS - 1) / 2, y: ROWS / 2, text: `LEVEL ${lv}`, t: 0, life: 1.6, big: true });
      this.sound('level');
    }
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 9;
      this.particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp + 4,
        life: 0.5 + Math.random() * 0.5, color, r: 0.05 + Math.random() * 0.1,
      });
    }
  }

  gameOver() {
    this.phase = 'over';
    this.sound('over');
    if (this.hooks.gameOver) this.hooks.gameOver(this);
  }
}
