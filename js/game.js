// Wippit! — core rules and state machine. No DOM, no rendering.
//
// Coordinates: column x in [0, COLS), row y counts from the bottom (0) upwards.
// Each column is a stack (array) of blocks, index 0 at the bottom. Blocks carry a
// visual position `y` (float) so the renderer can animate falling and tilting.

export const COLS = 6;
export const ROWS = 12;
export const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
export const TIP_THRESHOLD = 3;        // weight difference that tips a seesaw
export const MATCH_DIAGONAL = true;    // diagonal neighbours count for matches
export const BLOCKS_PER_LEVEL = 25;
export const MAX_LEVEL = 20;
export const TILT_ROWS = 0.3;          // how far a column moves up/down when tipped

const GRAVITY = 48;                    // rows / s^2 for settling blocks
const FLIGHT_TIME = 0.6;               // s, catapult flight
const CLEAR_TIME = 0.4;                // s, pop animation
const SPAWN_Y = ROWS + 0.8;            // the active ball enters from above the board
const HARD_DROP_SPEED = 48;            // rows / s
const SOFT_DROP_SPEED = 12;            // rows / s
const TILT_SPEED = 5;                  // tilt units / s
const MAX_CATAPULTS_PER_TURN = 40;     // safety valve against endless ping-pong
const NEIGHBORS = MATCH_DIAGONAL
  ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  : [[1, 0], [-1, 0], [0, 1], [0, -1]];

let nextId = 1;

export function makeBlock(kind, color, weight) {
  return {
    id: nextId++,
    kind,            // 'ball' | 'joker' | 'bomb'
    color,           // one of COLORS (bombs keep one but never match)
    weight,          // 1..9
    y: 0,            // visual row (float)
    vy: 0,           // fall speed (rows / s)
    state: 'rest',   // 'rest' | 'clearing' | 'flying'
    clear: 0,        // pop animation progress 0..1
    flight: null,    // { x0, y0, x1, y1, t, dur, h } while flying
    armed: false,    // bombs: explode at the next resolution step
  };
}

export function fallSpeed(level) {
  return Math.min(1.1 + 0.4 * (level - 1), 9);
}

export function flightPosAt(f, t) {
  t = Math.max(0, Math.min(1, t));
  return {
    x: f.x0 + (f.x1 - f.x0) * t,
    y: f.y0 + (f.y1 - f.y0) * t + f.h * 4 * t * (1 - t),
  };
}

export class Game {
  constructor(hooks = {}) {
    this.hooks = hooks; // { sound(name), gameOver(game) }
    this.reset();
  }

  reset() {
    this.cols = Array.from({ length: COLS }, () => []);
    this.seesaws = [];
    for (let x = 0; x + 1 < COLS; x += 2) {
      // state: -1 = left side down, 0 = level, +1 = right side down
      this.seesaws.push({ left: x, right: x + 1, state: 0, tilt: 0 });
    }
    this.score = 0;
    this.cleared = 0;
    this.level = 1;
    this.chain = 0;
    this.queue = [];
    this.active = null;    // { block, x, y }
    this.flying = null;    // block currently in the air
    this.clearing = [];    // blocks currently popping
    this.particles = [];
    this.popups = [];
    this.phase = 'spawn';  // 'spawn' | 'control' | 'resolve' | 'over'
    this.softDrop = false;
    this.dropSpeed = 0;
    this.time = 0;
    this.catapultsThisTurn = 0;
    this.stats = { tips: 0, maxChain: 0, bombs: 0, drops: 0 };
    this.fillQueue();
  }

  // ---- helpers -----------------------------------------------------------

  sound(name) {
    if (this.hooks.sound) this.hooks.sound(name);
  }

  fillQueue() {
    while (this.queue.length < 2) this.queue.push(this.randomBlock());
  }

  randomBlock() {
    const nColors = Math.min(COLORS.length, 3 + Math.ceil(this.level / 2));
    const color = COLORS[Math.floor(Math.random() * nColors)];
    const weight = 1 + Math.floor(Math.random() * 9);
    const r = Math.random();
    let kind = 'ball';
    if (r < 0.04) kind = 'bomb';
    else if (r < 0.09) kind = 'joker';
    return makeBlock(kind, color, weight);
  }

  columnWeight(x) {
    let w = 0;
    for (const b of this.cols[x]) w += b.weight;
    return w;
  }

  seesawOf(x) {
    const s = this.seesaws[Math.floor(x / 2)];
    return s && (s.left === x || s.right === x) ? s : null;
  }

  /** Vertical visual offset (in rows, positive = up) of a column due to its seesaw. */
  colShift(x) {
    const s = this.seesawOf(x);
    if (!s) return 0;
    return (x === s.left ? s.tilt : -s.tilt) * TILT_ROWS;
  }

  maxHeight() {
    return Math.max(...this.cols.map((c) => c.length));
  }

  // ---- main update -------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.updateAnimations(dt);
    if (this.phase === 'spawn') this.spawn();
    else if (this.phase === 'control') this.updateControl(dt);
    else if (this.phase === 'resolve') this.resolveStep();
  }

  updateAnimations(dt) {
    // Blocks above their slot fall down with gravity.
    for (let x = 0; x < COLS; x++) {
      const col = this.cols[x];
      for (let i = 0; i < col.length; i++) {
        const b = col[i];
        if (b.y > i) {
          b.vy += GRAVITY * dt;
          b.y -= b.vy * dt;
          if (b.y <= i) {
            b.y = i;
            b.vy = 0;
          }
        } else if (b.y < i) {
          b.y = i;
        }
      }
    }
    // Catapulted ball.
    if (this.flying) {
      const f = this.flying.flight;
      f.t += dt / f.dur;
      if (f.t >= 1) this.landFlying();
    }
    // Seesaw tilt.
    for (const s of this.seesaws) {
      const d = s.state - s.tilt;
      const step = TILT_SPEED * dt;
      if (Math.abs(d) <= step) s.tilt = s.state;
      else s.tilt += Math.sign(d) * step;
    }
    // Pop animation.
    if (this.clearing.length) {
      let done = false;
      for (const b of this.clearing) {
        b.clear += dt / CLEAR_TIME;
        if (b.clear >= 1) done = true;
      }
      if (done) this.finishClear();
    }
    // Particles and score popups.
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

  // ---- spawning & player control ----------------------------------------

  spawn() {
    this.fillQueue();
    const block = this.queue.shift();
    this.fillQueue();
    const x = Math.floor((COLS - 1) / 2);
    this.active = { block, x, y: SPAWN_Y };
    this.dropSpeed = 0;
    this.catapultsThisTurn = 0;
    this.phase = 'control';
  }

  updateControl(dt) {
    const a = this.active;
    const speed = Math.max(fallSpeed(this.level), this.dropSpeed, this.softDrop ? SOFT_DROP_SPEED : 0);
    a.y -= speed * dt;
    if (a.y <= this.cols[a.x].length) this.landActive();
  }

  landActive() {
    const a = this.active;
    const b = a.block;
    const col = this.cols[a.x];
    b.y = col.length;
    b.vy = 0;
    b.state = 'rest';
    col.push(b);
    if (b.kind === 'bomb') b.armed = true;
    this.active = null;
    this.chain = 0;
    this.stats.drops++;
    this.sound('land');
    this.phase = 'resolve';
  }

  moveActive(dir) {
    if (this.phase !== 'control') return false;
    const a = this.active;
    const nx = a.x + dir;
    if (nx < 0 || nx >= COLS) return false;
    if (this.cols[nx].length > a.y + 1e-6) return false; // a taller stack is in the way
    a.x = nx;
    this.sound('move');
    return true;
  }

  moveActiveTo(x) {
    let guard = COLS;
    while (this.active && this.active.x !== x && guard-- > 0) {
      if (!this.moveActive(Math.sign(x - this.active.x))) break;
    }
  }

  hardDrop() {
    if (this.phase !== 'control') return;
    this.dropSpeed = HARD_DROP_SPEED;
    this.sound('drop');
  }

  setSoftDrop(on) {
    this.softDrop = !!on;
  }

  // ---- resolution --------------------------------------------------------

  isAnimating() {
    if (this.flying || this.clearing.length) return true;
    for (const s of this.seesaws) if (s.tilt !== s.state) return true;
    for (let x = 0; x < COLS; x++) {
      const col = this.cols[x];
      for (let i = 0; i < col.length; i++) if (col[i].y > i) return true;
    }
    return false;
  }

  /** One step of the landing -> seesaw -> match -> gravity -> game-over loop. */
  resolveStep() {
    if (this.isAnimating()) return;
    if (this.explodeBombs()) return;
    if (this.checkSeesaws()) return;
    if (this.checkMatches()) return;
    if (this.cols.some((c) => c.length >= ROWS)) {
      this.gameOver();
      return;
    }
    this.chain = 0;
    this.phase = 'spawn';
  }

  explodeBombs() {
    const armed = [];
    this.cols.forEach((col, x) => col.forEach((b, i) => {
      if (b.kind === 'bomb' && b.armed) armed.push({ b, x, i });
    }));
    if (!armed.length) return false;

    const doomed = new Set();
    const queue = [...armed];
    while (queue.length) {
      const { b, x, i } = queue.shift();
      b.armed = false;
      if (doomed.has(b)) continue;
      doomed.add(b);
      this.burst(x, i, 'bomb', 26);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx, ny = i + dy;
          if (nx < 0 || nx >= COLS || ny < 0) continue;
          const nb = this.cols[nx][ny];
          if (!nb || doomed.has(nb)) continue;
          if (nb.kind === 'bomb') queue.push({ b: nb, x: nx, i: ny }); // chain reaction
          else doomed.add(nb);
        }
      }
    }
    this.removeBlocks(doomed);
    const n = doomed.size;
    const pts = 30 * n;
    this.score += pts;
    this.cleared += n;
    this.stats.bombs += armed.length;
    this.popups.push({ x: armed[0].x, y: armed[0].i, text: `BOOM +${pts}`, t: 0, life: 1.2, big: false });
    this.sound('boom');
    this.updateLevel();
    return true;
  }

  checkSeesaws() {
    if (this.catapultsThisTurn >= MAX_CATAPULTS_PER_TURN) return false;
    let changed = false;
    for (const s of this.seesaws) {
      const diff = this.columnWeight(s.left) - this.columnWeight(s.right);
      let target = 0;
      if (diff >= TIP_THRESHOLD) target = -1;
      else if (diff <= -TIP_THRESHOLD) target = 1;
      if (target === s.state) continue;
      s.state = target;
      changed = true;
      if (target === 0) continue;

      // The heavy side drops, the light side springs up and catapults its top ball.
      const rising = target === -1 ? s.right : s.left;
      const heavy = target === -1 ? s.left : s.right;
      this.stats.tips++;
      const col = this.cols[rising];
      if (!col.length) {
        this.sound('tilt');
        continue;
      }
      const b = col.pop();
      let tx = rising + (rising - heavy);        // outward, away from the pivot
      if (tx < 0 || tx >= COLS) tx = heavy;      // off the wall, back onto the partner column
      b.state = 'flying';
      b.flight = {
        x0: rising, y0: col.length,
        x1: tx, y1: this.cols[tx].length,
        t: 0, dur: FLIGHT_TIME, h: 0,
      };
      b.flight.h = Math.max(2.5, Math.abs(b.flight.y1 - b.flight.y0) + 1.5);
      this.flying = b;
      this.catapultsThisTurn++;
      this.sound('boing');
      return true; // one catapult at a time, so the player can follow it
    }
    return changed;
  }

  landFlying() {
    const b = this.flying;
    const col = this.cols[b.flight.x1];
    b.flight = null;
    b.state = 'rest';
    b.vy = 0;
    b.y = col.length;
    col.push(b);
    if (b.kind === 'bomb') b.armed = true;
    this.flying = null;
    this.sound('land');
  }

  /** Flood-fill same-coloured groups (jokers are wildcards). Returns [[{x,y,b},...], ...]. */
  findMatchGroups() {
    const at = (x, y) => (x >= 0 && x < COLS && y >= 0 ? this.cols[x][y] || null : null);
    const groups = [];
    for (const color of COLORS) {
      const visited = new Set();
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < this.cols[x].length; y++) {
          const b = this.cols[x][y];
          if (visited.has(b) || b.kind !== 'ball' || b.color !== color) continue;
          const group = [];
          const stack = [{ x, y, b }];
          visited.add(b);
          while (stack.length) {
            const cur = stack.pop();
            group.push(cur);
            for (const [dx, dy] of NEIGHBORS) {
              const nx = cur.x + dx, ny = cur.y + dy;
              const nb = at(nx, ny);
              if (!nb || visited.has(nb) || nb.state !== 'rest') continue;
              if ((nb.kind === 'ball' && nb.color === color) || nb.kind === 'joker') {
                visited.add(nb);
                stack.push({ x: nx, y: ny, b: nb });
              }
            }
          }
          if (group.length >= 3) groups.push(group);
        }
      }
    }
    return groups;
  }

  checkMatches() {
    const groups = this.findMatchGroups();
    if (!groups.length) return false;
    this.chain++;
    this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
    const all = new Set();
    for (const g of groups) {
      const n = g.length;
      const pts = (50 * n + 50 * (n - 3) * (n - 3)) * this.chain;
      this.score += pts;
      let cx = 0, cy = 0;
      for (const c of g) { cx += c.x; cy += c.y; all.add(c.b); }
      cx /= n; cy /= n;
      const text = this.chain > 1 ? `+${pts}  x${this.chain}` : `+${pts}`;
      this.popups.push({ x: cx, y: cy, text, t: 0, life: 1.1, big: this.chain > 1 });
    }
    for (const b of all) {
      b.state = 'clearing';
      b.clear = 0;
    }
    this.clearing = [...all];
    this.sound(this.chain > 1 ? 'chain' : 'pop');
    return true;
  }

  finishClear() {
    const set = new Set(this.clearing);
    this.cols.forEach((col, x) => col.forEach((b, i) => {
      if (set.has(b)) this.burst(x, i, b.color, 10);
    }));
    this.removeBlocks(set);
    this.clearing = [];
    this.cleared += set.size;
    this.updateLevel();
  }

  removeBlocks(set) {
    for (let x = 0; x < COLS; x++) {
      this.cols[x] = this.cols[x].filter((b) => !set.has(b));
    }
    // Blocks above the removed ones keep their visual y and therefore fall.
  }

  updateLevel() {
    const lv = Math.min(MAX_LEVEL, 1 + Math.floor(this.cleared / BLOCKS_PER_LEVEL));
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
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + 4,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        color,
        r: 0.05 + Math.random() * 0.1,
      });
    }
  }

  gameOver() {
    this.phase = 'over';
    this.active = null;
    this.sound('over');
    if (this.hooks.gameOver) this.hooks.gameOver(this);
  }
}
