// Wippit! — canvas renderer. Reads game state, draws, never mutates it.

import { COLS, ROWS, COLORS, TIP_THRESHOLD, flightPosAt } from './game.js';

export const PALETTE = {
  red:    { base: '#ff4d5e', dark: '#8e0f1f', light: '#ffc2c8' },
  blue:   { base: '#3a86ff', dark: '#0d2f78', light: '#c0d8ff' },
  green:  { base: '#3ddc6c', dark: '#0c5f27', light: '#c4f7d1' },
  yellow: { base: '#ffd23f', dark: '#8f6200', light: '#fff4bf' },
  purple: { base: '#b566ff', dark: '#44157e', light: '#e6ccff' },
  bomb:   { base: '#50505f', dark: '#101016', light: '#a4a4ba' },
};

const FONT = '"Trebuchet MS", "Segoe UI", Verdana, system-ui, sans-serif';
const TILT_ANGLE = 0.33; // rad, plank rotation at full tilt

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draws a glossy ball (with its weight) centred on (cx, cy) with radius r. */
export function drawBall(g, cx, cy, r, b, t = 0) {
  g.save();
  // soft shadow
  g.beginPath();
  g.arc(cx + r * 0.08, cy + r * 0.14, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();

  if (b.kind === 'joker') {
    const n = COLORS.length;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, (i / n) * Math.PI * 2 - Math.PI / 2, ((i + 1) / n) * Math.PI * 2 - Math.PI / 2);
      g.closePath();
      g.fillStyle = PALETTE[COLORS[i]].base;
      g.fill();
    }
    const sh = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.15);
    sh.addColorStop(0, 'rgba(255,255,255,0.6)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = sh;
    g.fill();
  } else {
    const pal = b.kind === 'bomb' ? PALETTE.bomb : PALETTE[b.color];
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r * 1.2);
    grad.addColorStop(0, pal.light);
    grad.addColorStop(0.35, pal.base);
    grad.addColorStop(1, pal.dark);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
  }

  // rim
  g.beginPath();
  g.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = Math.max(1, r * 0.06);
  g.stroke();
  // specular highlight
  g.beginPath();
  g.ellipse(cx - r * 0.38, cy - r * 0.45, r * 0.3, r * 0.17, -0.6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.fill();
  // bottom reflection
  g.beginPath();
  g.arc(cx, cy + r * 0.12, r * 0.74, Math.PI * 0.22, Math.PI * 0.78);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = r * 0.14;
  g.stroke();

  if (b.kind === 'bomb') {
    // fuse
    g.beginPath();
    g.moveTo(cx + r * 0.15, cy - r * 0.9);
    g.quadraticCurveTo(cx + r * 0.35, cy - r * 1.35, cx + r * 0.7, cy - r * 1.15);
    g.strokeStyle = '#e8d7b0';
    g.lineWidth = Math.max(1.5, r * 0.12);
    g.lineCap = 'round';
    g.stroke();
    // spark
    const flick = 1 + 0.35 * Math.sin(t * 28 + b.id);
    const sg = g.createRadialGradient(cx + r * 0.7, cy - r * 1.15, 0, cx + r * 0.7, cy - r * 1.15, r * 0.28 * flick);
    sg.addColorStop(0, '#fff7c0');
    sg.addColorStop(0.4, '#ffb020');
    sg.addColorStop(1, 'rgba(255,80,0,0)');
    g.beginPath();
    g.arc(cx + r * 0.7, cy - r * 1.15, r * 0.28 * flick, 0, Math.PI * 2);
    g.fillStyle = sg;
    g.fill();
  }

  // weight
  const fs = r * 1.05;
  g.font = `900 ${fs}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = r * 0.22;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.strokeText(String(b.weight), cx, cy + r * 0.06);
  g.fillStyle = b.kind === 'bomb' ? '#ffb347' : '#ffffff';
  g.fillText(String(b.weight), cx, cy + r * 0.06);
  g.restore();
}

export class Renderer {
  constructor(canvas, nextCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nctx = nextCanvas.getContext('2d');
    this.s = 40;
    this.dpr = 1;
    this.spriteCache = new Map();
    this.bubbles = Array.from({ length: 22 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.015 + Math.random() * 0.05,
      v: 0.012 + Math.random() * 0.03,
      w: Math.random() * Math.PI * 2,
    }));
    this.layout(360, 640);
  }

  /** Fits the board into the given CSS pixel box. */
  layout(availW, availH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const unitsW = COLS + 1.0;
    const unitsH = ROWS + 1.5 + 1.8 + 0.4;
    const s = Math.max(14, Math.floor(Math.min(availW / unitsW, availH / unitsH)));
    this.s = s;
    this.dpr = dpr;
    this.pad = 0.5 * s;
    this.top = 1.5 * s;
    this.bottomArea = 1.8 * s;
    this.W = COLS * s + 2 * this.pad;
    this.H = this.top + ROWS * s + this.bottomArea + 0.4 * s;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;

    const nw = Math.round(s * 1.7), nh = Math.round(s * 3.0);
    this.nextCanvas.width = Math.round(nw * dpr);
    this.nextCanvas.height = Math.round(nh * dpr);
    this.nextCanvas.style.width = `${nw}px`;
    this.nextCanvas.style.height = `${nh}px`;
    this.spriteCache.clear();
  }

  cx(x) { return this.pad + (x + 0.5) * this.s; }
  cy(y) { return this.top + (ROWS - y - 0.5) * this.s; }

  /** Column index under a CSS-pixel position relative to the canvas, or null. */
  columnAt(px) {
    const x = Math.floor((px - this.pad) / this.s);
    return x >= 0 && x < COLS ? x : null;
  }

  sprite(b, d) {
    const key = `${b.kind}:${b.color}:${b.weight}:${d}`;
    let c = this.spriteCache.get(key);
    if (c) return c;
    const size = Math.ceil(d * 1.5);
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);
    drawBall(g, size / 2, size / 2, d / 2, b);
    this.spriteCache.set(key, c);
    return c;
  }

  blit(g, b, px, py, d, alpha = 1, scale = 1) {
    const c = this.sprite(b, d);
    const w = (c.width / this.dpr) * scale;
    g.globalAlpha = alpha;
    g.drawImage(c, px - w / 2, py - w / 2, w, w);
    g.globalAlpha = 1;
  }

  draw(game, t) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(g, t);
    this.drawBoard(g, game);
    this.drawSeesaws(g, game);
    this.drawBlocks(g, game, t);
    this.drawActive(g, game, t);
    this.drawParticles(g, game);
    this.drawPopups(g, game);
    this.drawDanger(g, game, t);
    this.drawNext(game, t);
  }

  drawBackground(g, t) {
    const { W, H } = this;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#2b1a66');
    grad.addColorStop(0.55, '#1c2a6e');
    grad.addColorStop(1, '#0d4a62');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (const b of this.bubbles) {
      const y = 1 - ((b.y + t * b.v) % 1);
      const x = b.x + Math.sin(t * 0.6 + b.w) * 0.02;
      g.beginPath();
      g.arc(x * W, y * H, b.r * W, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawBoard(g, game) {
    const s = this.s;
    const fx = this.pad * 0.45, fw = this.W - this.pad * 0.9;
    const fy = this.top - 0.3 * s;
    const fh = ROWS * s + 0.3 * s + this.bottomArea - 0.1 * s;

    // playfield glass
    roundRect(g, fx, fy, fw, fh, 0.5 * s);
    g.fillStyle = 'rgba(6,4,28,0.6)';
    g.fill();

    for (let x = 0; x < COLS; x++) {
      const cx = this.cx(x);
      g.fillStyle = x % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.055)';
      g.fillRect(cx - s / 2, this.top, s, ROWS * s);
      if (game.active && game.active.x === x && game.phase === 'control') {
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(cx - s / 2, this.top - 1.3 * s, s, ROWS * s + 1.3 * s);
      }
      // glass highlight
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(cx - s / 2 + 2, this.top, s * 0.12, ROWS * s);
    }
    // faint row lines
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 1;
    for (let y = 1; y < ROWS; y++) {
      const py = this.top + y * s;
      g.beginPath();
      g.moveTo(fx, py);
      g.lineTo(fx + fw, py);
      g.stroke();
    }
    // floor between board and seesaws
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(fx, this.top + ROWS * s, fw, this.bottomArea - 0.1 * s);

    // wooden U-frame (open at the top)
    const lw = 0.3 * s;
    const wood = g.createLinearGradient(0, fy, 0, fy + fh);
    wood.addColorStop(0, '#d9a056');
    wood.addColorStop(0.5, '#9a6430');
    wood.addColorStop(1, '#5e3a16');
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.strokeStyle = wood;
    g.beginPath();
    g.moveTo(fx, fy - 0.4 * s);
    g.lineTo(fx, fy + fh - 0.5 * s);
    g.arcTo(fx, fy + fh, fx + 0.5 * s, fy + fh, 0.5 * s);
    g.lineTo(fx + fw - 0.5 * s, fy + fh);
    g.arcTo(fx + fw, fy + fh, fx + fw, fy + fh - 0.5 * s, 0.5 * s);
    g.lineTo(fx + fw, fy - 0.4 * s);
    g.stroke();
    g.strokeStyle = 'rgba(255,230,180,0.35)';
    g.lineWidth = 1.5;
    g.stroke();
  }

  drawSeesaws(g, game) {
    const s = this.s;
    const pivotY = this.top + ROWS * s + 0.6 * s;
    for (const sw of game.seesaws) {
      const px = (this.cx(sw.left) + this.cx(sw.right)) / 2;
      const wl = game.columnWeight(sw.left);
      const wr = game.columnWeight(sw.right);
      const diff = wl - wr;

      // pivot
      g.beginPath();
      g.moveTo(px, pivotY - 0.05 * s);
      g.lineTo(px - 0.26 * s, pivotY + 0.62 * s);
      g.lineTo(px + 0.26 * s, pivotY + 0.62 * s);
      g.closePath();
      g.fillStyle = '#3b2a4a';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1.5;
      g.stroke();

      // plank
      g.save();
      g.translate(px, pivotY);
      g.rotate(sw.tilt * TILT_ANGLE);
      const L = 0.92 * s, T = 0.17 * s;
      const wood = g.createLinearGradient(0, -T, 0, T);
      wood.addColorStop(0, '#f0c27a');
      wood.addColorStop(0.5, '#c78a3f');
      wood.addColorStop(1, '#7a4a1c');
      roundRect(g, -L, -T, 2 * L, 2 * T, T);
      g.fillStyle = wood;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1.5;
      g.stroke();
      // pads under each column
      for (const sx of [-s / 2, s / 2]) {
        roundRect(g, sx - 0.36 * s, -T - 0.1 * s, 0.72 * s, 0.12 * s, 0.04 * s);
        g.fillStyle = '#5a3a1a';
        g.fill();
      }
      // pivot bolt
      g.beginPath();
      g.arc(0, 0, 0.07 * s, 0, Math.PI * 2);
      g.fillStyle = '#ffe8b0';
      g.fill();
      g.restore();

      // weight badges
      for (const [x, w, other] of [[sw.left, wl, wr], [sw.right, wr, wl]]) {
        const bx = this.cx(x);
        const by = pivotY + 0.95 * s;
        const heavier = w > other;
        const near = Math.abs(diff) === TIP_THRESHOLD - 1 && w < other;
        roundRect(g, bx - 0.36 * s, by - 0.22 * s, 0.72 * s, 0.44 * s, 0.22 * s);
        g.fillStyle = heavier ? 'rgba(255,210,63,0.95)' : near ? 'rgba(255,120,80,0.85)' : 'rgba(255,255,255,0.14)';
        g.fill();
        g.font = `900 ${0.3 * s}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = heavier ? '#3b2300' : '#ffffff';
        g.fillText(String(w), bx, by + 0.01 * s);
      }
    }
  }

  drawBlocks(g, game, t) {
    const s = this.s, d = s * 0.94;
    for (let x = 0; x < COLS; x++) {
      const shift = game.colShift(x);
      const col = game.cols[x];
      const px = this.cx(x);
      for (let i = 0; i < col.length; i++) {
        const b = col[i];
        const py = this.cy(b.y + shift);
        if (b.state === 'clearing') {
          const k = Math.min(1, b.clear);
          this.blit(g, b, px, py, d, 1 - k, 1 + 0.6 * k);
          g.beginPath();
          g.arc(px, py, d * (0.5 + 0.6 * k), 0, Math.PI * 2);
          g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
          g.lineWidth = 3;
          g.stroke();
        } else if (b.kind === 'bomb') {
          // bombs are drawn live for the flickering spark
          drawBall(g, px, py, d / 2, b, t);
        } else {
          this.blit(g, b, px, py, d);
        }
      }
    }
    if (game.flying) {
      const b = game.flying;
      const f = b.flight;
      for (const [dt, a] of [[0.14, 0.12], [0.07, 0.28]]) {
        const p = flightPosAt(f, f.t - dt);
        this.blit(g, b, this.cx(p.x), this.cy(p.y), d, a, 0.9);
      }
      const p = flightPosAt(f, f.t);
      this.blit(g, b, this.cx(p.x), this.cy(p.y), d);
    }
  }

  drawActive(g, game, t) {
    const a = game.active;
    if (!a || game.phase !== 'control') return;
    const s = this.s, d = s * 0.94;
    const px = this.cx(a.x);
    const landY = game.cols[a.x].length;
    // landing guide
    g.save();
    g.setLineDash([4, 6]);
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, this.cy(a.y) + d / 2);
    g.lineTo(px, this.cy(landY) - d / 2);
    g.stroke();
    g.beginPath();
    g.arc(px, this.cy(landY + game.colShift(a.x)), d / 2 - 1, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    if (a.block.kind === 'bomb') drawBall(g, px, this.cy(a.y), d / 2, a.block, t);
    else this.blit(g, a.block, px, this.cy(a.y), d);
  }

  drawParticles(g, game) {
    const s = this.s;
    for (const p of game.particles) {
      const pal = p.color === 'bomb' ? { base: '#ffb020' } : PALETTE[p.color] || { base: '#fff' };
      g.globalAlpha = Math.max(0, Math.min(1, p.life / 0.4));
      g.fillStyle = pal.base;
      g.beginPath();
      g.arc(this.cx(p.x), this.cy(p.y), p.r * s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  drawPopups(g, game) {
    const s = this.s;
    for (const p of game.popups) {
      const k = p.t / p.life;
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const px = this.cx(p.x);
      const py = this.cy(p.y) - k * 0.9 * s;
      const fs = p.big ? 0.62 * s : 0.42 * s;
      g.font = `900 ${fs}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.globalAlpha = alpha;
      g.lineWidth = fs * 0.22;
      g.strokeStyle = 'rgba(40,10,60,0.9)';
      g.strokeText(p.text, px, py);
      g.fillStyle = p.big ? '#ffd23f' : '#ffffff';
      g.fillText(p.text, px, py);
    }
    g.globalAlpha = 1;
  }

  drawDanger(g, game, t) {
    if (game.phase === 'over' || game.maxHeight() < ROWS - 2) return;
    const s = this.s;
    const a = 0.22 + 0.14 * Math.sin(t * 9);
    const grad = g.createLinearGradient(0, this.top, 0, this.top + 2.5 * s);
    grad.addColorStop(0, `rgba(255,40,60,${a})`);
    grad.addColorStop(1, 'rgba(255,40,60,0)');
    g.fillStyle = grad;
    g.fillRect(this.pad, this.top, COLS * s, 2.5 * s);
  }

  drawNext(game, t) {
    const g = this.nctx;
    const c = this.nextCanvas;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = c.width / this.dpr, h = c.height / this.dpr;
    g.clearRect(0, 0, w, h);
    const [a, b] = game.queue;
    if (a) drawBall(g, w / 2, h * 0.3, this.s * 0.46, a, t);
    if (b) {
      g.globalAlpha = 0.75;
      drawBall(g, w / 2, h * 0.75, this.s * 0.34, b, t);
      g.globalAlpha = 1;
    }
  }
}
