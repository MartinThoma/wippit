// Wippit! — canvas renderer. Reads game state, draws, never mutates it.

import { COLS, ROWS, COLORS, TOTAL_ROWS, CRANE_ROW, DEPOT_ROW, STAYS, flightPosAt, wrapX } from './game.js';

export const PALETTE = {
  red:    { base: '#ff4d5e', dark: '#8e0f1f', light: '#ffc2c8' },
  blue:   { base: '#3a86ff', dark: '#0d2f78', light: '#c0d8ff' },
  green:  { base: '#3ddc6c', dark: '#0c5f27', light: '#c4f7d1' },
  yellow: { base: '#ffd23f', dark: '#8f6200', light: '#fff4bf' },
  purple: { base: '#b566ff', dark: '#44157e', light: '#e6ccff' },
  orange: { base: '#ff8c2a', dark: '#8a3c00', light: '#ffd9b8' },
  cyan:   { base: '#2fd3e6', dark: '#0b5f6b', light: '#c6f6fb' },
  heart:  { base: '#ff5c9a', dark: '#8c0f45', light: '#ffd0e3' },
  bomb:   { base: '#50505f', dark: '#101016', light: '#a4a4ba' },
  stone:  { base: '#8d8d8d', dark: '#303030', light: '#dcdcdc' },
  star:   { base: '#c9ced8', dark: '#5a6070', light: '#ffffff' },
  gold:   { base: '#ffc93c', dark: '#8a5a00', light: '#fff2c0' },
  drill:  { base: '#2bb3a0', dark: '#0b4a42', light: '#bdf3ea' },
  zap:    { base: '#ff9f1c', dark: '#7a4300', light: '#ffe2b8' },
  colorzap: { base: '#ff6b6b', dark: '#7a1515', light: '#ffd0d0' },
  tint:   { base: '#e35bd8', dark: '#6b1663', light: '#f8cdf4' },
  tint3:  { base: '#e35bd8', dark: '#6b1663', light: '#f8cdf4' },
  level:  { base: '#5cc8ff', dark: '#0f4e7a', light: '#d2f0ff' },
  stonemaker: { base: '#a07850', dark: '#3e2a14', light: '#e4d2bd' },
};

const FONT = '"Trebuchet MS", "Segoe UI", Verdana, system-ui, sans-serif';
const BEAM_ANGLE = 0.5; // rad at full tilt

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

function glyph(g, text, cx, cy, size, fill, stroke) {
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (stroke) {
    g.lineWidth = size * 0.2;
    g.strokeStyle = stroke;
    g.strokeText(text, cx, cy);
  }
  g.fillStyle = fill;
  g.fillText(text, cx, cy);
}

/** Draws a glossy ball of any kind centred on (cx, cy) with radius r. */
export function drawBall(g, cx, cy, r, b, t = 0) {
  const kind = b.kind;
  const pal = PALETTE[kind] || PALETTE[b.color] || PALETTE.stone;
  g.save();
  g.beginPath();
  g.arc(cx + r * 0.08, cy + r * 0.14, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();

  if (kind === 'joker') {
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
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r * 1.2);
    grad.addColorStop(0, pal.light);
    grad.addColorStop(0.35, pal.base);
    grad.addColorStop(1, pal.dark);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
  }
  if (kind === 'stone' || kind === 'stonemaker') {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (const [dx, dy, rr] of [[-0.4, 0.2, 0.2], [0.3, -0.1, 0.16], [0.1, 0.5, 0.14], [-0.1, -0.5, 0.12]]) {
      g.beginPath();
      g.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.beginPath();
  g.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = Math.max(1, r * 0.06);
  g.stroke();
  g.beginPath();
  g.ellipse(cx - r * 0.38, cy - r * 0.45, r * 0.3, r * 0.17, -0.6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.fill();
  g.beginPath();
  g.arc(cx, cy + r * 0.12, r * 0.74, Math.PI * 0.22, Math.PI * 0.78);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = r * 0.14;
  g.stroke();

  const white = '#ffffff';
  const outline = 'rgba(0,0,0,0.55)';
  switch (kind) {
    case 'ball':
      glyph(g, String(b.weight), cx, cy + r * 0.06, r * 1.05, white, 'rgba(0,0,0,0.6)');
      break;
    case 'heart':
      glyph(g, '♥', cx, cy + r * 0.08, r * 1.5, 'rgba(255,255,255,0.9)', null);
      if (b.weight > 0) glyph(g, String(b.weight), cx, cy + r * 0.04, r * 0.85, pal.dark, null);
      break;
    case 'stone':
      if (b.weight > 0) glyph(g, String(b.weight), cx, cy + r * 0.06, r * 0.95, '#f0f0f0', 'rgba(0,0,0,0.45)');
      break;
    case 'joker':
      glyph(g, '★', cx, cy + r * 0.06, r * 1.25, white, outline);
      break;
    case 'star':
      glyph(g, '★', cx, cy + r * 0.06, r * 1.3, '#4a5060', 'rgba(255,255,255,0.5)');
      break;
    case 'gold':
      glyph(g, '★', cx, cy + r * 0.06, r * 1.3, white, 'rgba(120,70,0,0.7)');
      break;
    case 'bomb': {
      g.beginPath();
      g.moveTo(cx + r * 0.15, cy - r * 0.9);
      g.quadraticCurveTo(cx + r * 0.35, cy - r * 1.35, cx + r * 0.7, cy - r * 1.15);
      g.strokeStyle = '#e8d7b0';
      g.lineWidth = Math.max(1.5, r * 0.12);
      g.lineCap = 'round';
      g.stroke();
      const flick = 1 + 0.35 * Math.sin(t * 28 + b.id);
      const sg = g.createRadialGradient(cx + r * 0.7, cy - r * 1.15, 0, cx + r * 0.7, cy - r * 1.15, r * 0.28 * flick);
      sg.addColorStop(0, '#fff7c0');
      sg.addColorStop(0.4, '#ffb020');
      sg.addColorStop(1, 'rgba(255,80,0,0)');
      g.beginPath();
      g.arc(cx + r * 0.7, cy - r * 1.15, r * 0.28 * flick, 0, Math.PI * 2);
      g.fillStyle = sg;
      g.fill();
      break;
    }
    case 'drill':
      g.fillStyle = white;
      g.beginPath();
      g.moveTo(cx - r * 0.45, cy - r * 0.45);
      g.lineTo(cx + r * 0.45, cy - r * 0.45);
      g.lineTo(cx, cy + r * 0.6);
      g.closePath();
      g.fill();
      g.strokeStyle = pal.dark;
      g.lineWidth = r * 0.1;
      for (const k of [-0.2, 0.05, 0.3]) {
        g.beginPath();
        g.moveTo(cx - r * 0.4 * (1 - (k + 0.45) / 1.05), cy + r * k);
        g.lineTo(cx + r * 0.4 * (1 - (k + 0.45) / 1.05), cy + r * k);
        g.stroke();
      }
      break;
    case 'zap':
      g.strokeStyle = white;
      g.lineWidth = r * 0.16;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx - r * 0.65, cy);
      g.lineTo(cx - r * 0.2, cy - r * 0.3);
      g.lineTo(cx + r * 0.2, cy + r * 0.3);
      g.lineTo(cx + r * 0.65, cy);
      g.stroke();
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + sgn * r * 0.65, cy);
        g.lineTo(cx + sgn * r * 0.4, cy - r * 0.25);
        g.moveTo(cx + sgn * r * 0.65, cy);
        g.lineTo(cx + sgn * r * 0.4, cy + r * 0.25);
        g.stroke();
      }
      break;
    case 'colorzap':
      g.lineWidth = r * 0.14;
      for (const [rr, col] of [[0.62, white], [0.36, white]]) {
        g.beginPath();
        g.arc(cx, cy, rr * r, 0, Math.PI * 2);
        g.strokeStyle = col;
        g.stroke();
      }
      g.beginPath();
      g.arc(cx, cy, 0.14 * r, 0, Math.PI * 2);
      g.fillStyle = white;
      g.fill();
      break;
    case 'tint':
      g.fillStyle = white;
      g.beginPath();
      g.moveTo(cx, cy - r * 0.65);
      g.quadraticCurveTo(cx + r * 0.55, cy + r * 0.05, cx + r * 0.38, cy + r * 0.3);
      g.arc(cx, cy + r * 0.3, r * 0.38, 0, Math.PI, false);
      g.quadraticCurveTo(cx - r * 0.55, cy + r * 0.05, cx, cy - r * 0.65);
      g.fill();
      break;
    case 'tint3':
    case 'stonemaker':
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          g.fillStyle = kind === 'tint3' ? white : '#2e2016';
          roundRect(g, cx + i * r * 0.42 - r * 0.17, cy + j * r * 0.42 - r * 0.17, r * 0.34, r * 0.34, r * 0.06);
          g.fill();
        }
      }
      break;
    case 'level':
      glyph(g, '=0', cx, cy + r * 0.06, r * 0.95, white, outline);
      break;
    default:
      break;
  }
  g.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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

  layout(availW, availH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const unitsW = COLS + 1.0;
    const unitsH = TOTAL_ROWS + 1.9 + 0.4;
    const s = Math.max(14, Math.floor(Math.min(availW / unitsW, availH / unitsH)));
    this.s = s;
    this.dpr = dpr;
    this.pad = 0.5 * s;
    this.top = 0.4 * s;
    this.W = COLS * s + 2 * this.pad;
    this.H = this.top + TOTAL_ROWS * s + 1.9 * s;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.spriteCache.clear();
  }

  cx(x) { return this.pad + (x + 0.5) * this.s; }
  cy(row) { return this.top + (TOTAL_ROWS - row - 0.5) * this.s; }

  /** What is under a CSS-pixel position relative to the canvas. */
  hit(px, py) {
    const x = Math.floor((px - this.pad) / this.s);
    if (x < 0 || x >= COLS) return null;
    const row = TOTAL_ROWS - 0.5 - (py - this.top) / this.s;
    if (row >= DEPOT_ROW - 0.5) return { area: 'depot', x };
    if (row >= ROWS) return { area: 'crane', x };
    if (row >= -2) return { area: 'board', x };
    return null;
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

  ball(g, b, px, py, d, t, alpha = 1, scale = 1) {
    if (b.kind === 'bomb') {
      g.globalAlpha = alpha;
      drawBall(g, px, py, (d / 2) * scale, b, t);
      g.globalAlpha = 1;
      return;
    }
    const c = this.sprite(b, d);
    const w = (c.width / this.dpr) * scale;
    g.globalAlpha = alpha;
    g.drawImage(c, px - w / 2, py - w / 2, w, w);
    g.globalAlpha = 1;
  }

  draw(game, t) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const preview = game.phase === 'drop' ? game.previewDrop(game.crane.x) : null;
    this.drawBackground(g, t);
    this.drawBoard(g, game, preview, t);
    this.drawDepot(g, game, t);
    this.drawMechanics(g, game, preview, t);
    this.drawBlocks(g, game, t);
    this.drawCrane(g, game, preview, t);
    this.drawFlying(g, game, t);
    this.drawParticles(g, game);
    this.drawPopups(g, game);
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

  drawBoard(g, game, preview, t) {
    const s = this.s;
    const fx = this.pad * 0.45, fw = this.W - this.pad * 0.9;
    const fy = this.cy(ROWS - 0.5);                 // ceiling
    const fh = this.cy(-1.9) - fy;

    roundRect(g, fx, fy - 0.15 * s, fw, fh + 0.15 * s, 0.5 * s);
    g.fillStyle = 'rgba(6,4,28,0.62)';
    g.fill();

    for (let x = 0; x < COLS; x++) {
      const cx = this.cx(x);
      g.fillStyle = x % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.055)';
      g.fillRect(cx - s / 2, fy, s, ROWS * s + 0.5 * s);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(cx - s / 2 + 2, fy, s * 0.12, ROWS * s + 0.5 * s);
    }
    if (game.phase === 'drop' || game.phase === 'pick') {
      const cx = this.cx(game.crane.x);
      g.fillStyle = game.phase === 'drop'
        ? (preview && preview.overflow ? 'rgba(255,60,80,0.18)' : 'rgba(255,255,255,0.08)')
        : 'rgba(255,255,255,0.04)';
      g.fillRect(cx - s / 2, fy, s, ROWS * s + 0.5 * s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) {
      const py = this.cy(r - 0.5);
      g.beginPath();
      g.moveTo(fx, py);
      g.lineTo(fx + fw, py);
      g.stroke();
    }

    // danger glow under the ceiling
    let danger = false;
    for (let x = 0; x < COLS; x++) if (game.cols[x].length >= game.capacity(x) - 1) danger = true;
    if (danger && game.phase !== 'over') {
      const a = 0.2 + 0.12 * Math.sin(t * 9);
      const grad = g.createLinearGradient(0, fy, 0, fy + 2 * s);
      grad.addColorStop(0, `rgba(255,40,60,${a})`);
      grad.addColorStop(1, 'rgba(255,40,60,0)');
      g.fillStyle = grad;
      g.fillRect(this.pad, fy, COLS * s, 2 * s);
    }

    // frame: lid (ceiling) + sides + floor
    const lw = 0.26 * s;
    const wood = g.createLinearGradient(0, fy, 0, fy + fh);
    wood.addColorStop(0, '#d9a056');
    wood.addColorStop(0.5, '#9a6430');
    wood.addColorStop(1, '#5e3a16');
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.strokeStyle = wood;
    roundRect(g, fx, fy, fw, fh, 0.5 * s);
    g.stroke();
    g.strokeStyle = 'rgba(255,230,180,0.3)';
    g.lineWidth = 1.5;
    g.stroke();
    // ceiling marker line
    g.strokeStyle = danger ? 'rgba(255,90,100,0.9)' : 'rgba(255,255,255,0.25)';
    g.setLineDash([s * 0.2, s * 0.15]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(fx + lw, fy + lw * 0.9);
    g.lineTo(fx + fw - lw, fy + lw * 0.9);
    g.stroke();
    g.setLineDash([]);
  }

  drawDepot(g, game, t) {
    const s = this.s;
    const y0 = this.cy(DEPOT_ROW + 1) - 0.5 * s;
    const h = 2 * s;
    roundRect(g, this.pad * 0.45, y0 - 0.08 * s, this.W - this.pad * 0.9, h + 0.16 * s, 0.35 * s);
    g.fillStyle = 'rgba(6,4,28,0.5)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1.5;
    g.stroke();
    const d = s * 0.8;
    for (let x = 0; x < COLS; x++) {
      for (let r = 0; r < 2; r++) {
        const px = this.cx(x), py = this.cy(DEPOT_ROW + r);
        g.beginPath();
        g.arc(px, py + 0.06 * s, d * 0.52, 0, Math.PI * 2);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fill();
        const b = game.depot[x][r];
        if (b) this.ball(g, b, px, py, r === 0 ? d : d * 0.8, t, r === 0 ? 1 : 0.8);
      }
    }
    if (game.phase === 'pick') {
      const px = this.cx(game.crane.x), py = this.cy(DEPOT_ROW);
      g.beginPath();
      g.arc(px, py, d * 0.6 + 2 * Math.sin(t * 6), 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.stroke();
    }
  }

  drawMechanics(g, game, preview, t) {
    const s = this.s;
    const pivotY = this.cy(-1.1);
    const blink = Math.floor(t * 6) % 2 === 0;
    for (const sw of game.seesaws) {
      const px = (this.cx(sw.left) + this.cx(sw.right)) / 2;
      const ang = sw.tilt * BEAM_ANGLE;
      // pivot
      g.beginPath();
      g.moveTo(px, pivotY - 0.05 * s);
      g.lineTo(px - 0.28 * s, this.cy(-1.85));
      g.lineTo(px + 0.28 * s, this.cy(-1.85));
      g.closePath();
      g.fillStyle = '#3b2a4a';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1.5;
      g.stroke();
      // posts from beam ends up to the pans
      for (const [x, sgn] of [[sw.left, -1], [sw.right, 1]]) {
        const ex = px + sgn * 0.5 * s * Math.cos(ang);
        const ey = pivotY + sgn * 0.5 * s * Math.sin(ang);
        const panBottom = this.cy(game.panOffset(x) - 0.5) + 0.3 * s;
        g.strokeStyle = '#5a4a6a';
        g.lineWidth = 0.14 * s;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(this.cx(x), panBottom);
        g.stroke();
      }
      // beam
      g.save();
      g.translate(px, pivotY);
      g.rotate(ang);
      const L = 0.56 * s, T = 0.11 * s;
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
      g.beginPath();
      g.arc(0, 0, 0.07 * s, 0, Math.PI * 2);
      g.fillStyle = '#ffe8b0';
      g.fill();
      g.restore();

      // pans with weight badges
      const wl = game.columnWeight(sw.left), wr = game.columnWeight(sw.right);
      for (const [x, w, other] of [[sw.left, wl, wr], [sw.right, wr, wl]]) {
        const cx = this.cx(x);
        const top = this.cy(game.panOffset(x) - 0.5);
        const warn = preview && preview.tip && preview.tip.rising === x && blink;
        roundRect(g, cx - 0.44 * s, top, 0.88 * s, 0.3 * s, 0.08 * s);
        const grad = g.createLinearGradient(0, top, 0, top + 0.3 * s);
        grad.addColorStop(0, warn ? '#ff8a7a' : '#e3b36a');
        grad.addColorStop(1, warn ? '#b0301f' : '#7a4a1c');
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 1.5;
        g.stroke();
        const heavier = w > other;
        g.font = `900 ${0.24 * s}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = warn ? '#fff' : heavier ? '#fff3c0' : 'rgba(255,255,255,0.75)';
        g.fillText(String(w), cx, top + 0.155 * s);
      }
    }
  }

  drawBlocks(g, game, t) {
    const s = this.s, d = s * 0.94;
    for (let x = 0; x < COLS; x++) {
      const off = game.panOffset(x);
      const col = game.cols[x];
      const px = this.cx(x);
      for (let i = 0; i < col.length; i++) {
        const b = col[i];
        const py = this.cy(b.y + off);
        if (b.state === 'clearing') {
          const k = Math.min(1, b.clear);
          this.ball(g, b, px, py, d, t, 1 - k, 1 + 0.6 * k);
          g.beginPath();
          g.arc(px, py, d * (0.5 + 0.6 * k), 0, Math.PI * 2);
          g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
          g.lineWidth = 3;
          g.stroke();
        } else if (b.state === 'merging') {
          const k = Math.min(1, b.clear);
          const base = game.merging && game.merging.base;
          const by = base ? this.cy(base.y + off) : py;
          this.ball(g, b, px, py + (by - py) * k, d, t, 1 - k * 0.7, 1 - 0.6 * k);
        } else {
          this.ball(g, b, px, py, d, t);
        }
      }
    }
    if (game.falling) {
      const f = game.falling;
      this.ball(g, f.block, this.cx(f.x), this.cy(f.y), d, t);
    }
  }

  drawCrane(g, game, preview, t) {
    const s = this.s;
    const railY = this.cy(CRANE_ROW) - 0.72 * s;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(this.pad * 0.45, railY - 0.08 * s, this.W - this.pad * 0.9, 0.16 * s);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(this.pad * 0.45, railY - 0.08 * s, this.W - this.pad * 0.9, 0.04 * s);
    if (game.phase !== 'pick' && game.phase !== 'drop' && game.phase !== 'falling' && game.phase !== 'resolve') return;

    const cx = this.cx(game.crane.x);
    const ballY = this.cy(CRANE_ROW);
    // trolley
    roundRect(g, cx - 0.32 * s, railY - 0.16 * s, 0.64 * s, 0.32 * s, 0.1 * s);
    g.fillStyle = '#ffd23f';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1.5;
    g.stroke();
    // cable + hook
    const hookY = game.crane.block ? ballY - 0.46 * s : ballY - 0.2 * s;
    g.strokeStyle = '#e8e8f0';
    g.lineWidth = Math.max(1.5, 0.05 * s);
    g.beginPath();
    g.moveTo(cx, railY + 0.16 * s);
    g.lineTo(cx, hookY);
    g.stroke();
    g.beginPath();
    g.arc(cx, hookY + 0.1 * s, 0.1 * s, -Math.PI / 2, Math.PI * 0.9);
    g.stroke();

    if (game.crane.block) {
      this.ball(g, game.crane.block, cx, ballY, s * 0.94, t);
    }
    if (game.phase !== 'drop' || !game.crane.block) return;

    // landing guide
    const x = game.crane.x;
    const landY = game.panOffset(x) + game.cols[x].length;
    g.save();
    g.setLineDash([4, 6]);
    g.strokeStyle = preview && preview.overflow ? 'rgba(255,90,100,0.7)' : 'rgba(255,255,255,0.3)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, ballY + 0.5 * s);
    g.lineTo(cx, this.cy(landY) - 0.47 * s);
    g.stroke();
    if (STAYS.has(game.crane.block.kind)) {
      g.beginPath();
      g.arc(cx, this.cy(landY), 0.47 * s - 1, 0, Math.PI * 2);
      g.stroke();
    }
    // throw preview
    if (preview && preview.tip) {
      const tip = preview.tip;
      const rising = tip.rising;
      const col = game.cols[rising];
      const y0 = game.panOffset(rising) + col.length - 1;
      const y1 = game.panOffset(tip.tx) + game.cols[tip.tx].length;
      const h = Math.min(4.5, 1.5 + 0.3 * tip.d);
      g.strokeStyle = 'rgba(255,210,63,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      let pen = false;
      for (let k = 0; k <= 40; k++) {
        const tt = k / 40;
        const xr = rising + (tip.xRaw - rising) * tt;
        const yy = y0 + (y1 - y0) * tt + h * 4 * tt * (1 - tt);
        const xw = wrapX(xr);
        const jump = Math.abs(xw - wrapX(rising + (tip.xRaw - rising) * ((k - 1) / 40))) > 1.5;
        if (!pen || jump) { g.moveTo(this.cx(xw), this.cy(yy)); pen = true; } else g.lineTo(this.cx(xw), this.cy(yy));
      }
      g.stroke();
      g.beginPath();
      g.arc(this.cx(tip.tx), this.cy(y1), 0.47 * s - 1, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,210,63,0.9)';
      g.stroke();
      g.setLineDash([]);
      const label = tip.crossings ? `${tip.d} ↻` : `${tip.d}`;
      g.font = `900 ${0.32 * s}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(40,10,60,0.9)';
      g.strokeText(label, this.cx(rising), this.cy(y0 + 1.1));
      g.fillStyle = '#ffd23f';
      g.fillText(label, this.cx(rising), this.cy(y0 + 1.1));
    }
    g.restore();
  }

  drawFlying(g, game, t) {
    if (!game.flying) return;
    const s = this.s, d = s * 0.94;
    const b = game.flying;
    const f = b.flight;
    const put = (p, alpha, scale) => {
      const xw = wrapX(p.x);
      this.ball(g, b, this.cx(xw), this.cy(p.y), d, t, alpha, scale);
      // a second copy keeps the ball continuous while it crosses the edge
      if (xw < 0.6) this.ball(g, b, this.cx(xw + COLS), this.cy(p.y), d, t, alpha, scale);
      else if (xw > COLS - 1.6) this.ball(g, b, this.cx(xw - COLS), this.cy(p.y), d, t, alpha, scale);
    };
    for (const [dt, a] of [[0.12, 0.12], [0.06, 0.28]]) put(flightPosAt(f, f.t - dt), a, 0.9);
    put(flightPosAt(f, f.t), 1, 1);
  }

  drawParticles(g, game) {
    const s = this.s;
    for (const p of game.particles) {
      const pal = PALETTE[p.color] || { base: '#ffb020' };
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
      const px = Math.min(this.W - s, Math.max(s, this.cx(p.x)));
      const py = this.cy(p.y) - k * 0.9 * s;
      const fs = p.big ? 0.6 * s : 0.4 * s;
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
}
