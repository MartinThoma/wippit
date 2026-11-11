// Wippit! — bootstrap: wires game, renderer, audio, input, HUD and PWA together.

import { Game, BALLS_PER_LEVEL, KIND_INFO, makeBlock } from './game.js';
import { Renderer, drawBall } from './render.js';
import { Sfx } from './audio.js';
import { setupPwa } from './pwa.js';

const $ = (sel) => document.querySelector(sel);

const sfx = new Sfx();
const game = new Game({ sound: (n) => sfx.play(n), gameOver: onGameOver });
const renderer = new Renderer($('#board'));

let state = 'menu'; // 'menu' | 'help' | 'playing' | 'paused' | 'over'
let best = 0;
try { best = Number(localStorage.getItem('wippit.best')) || 0; } catch (e) { /* ignore */ }
let pendingUpdate = false;
let lastFrame = performance.now();
const hud = {};

// ---- screens -------------------------------------------------------------

function showScreen(name) {
  $('#overlay').hidden = name === null;
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.dataset.screen !== name;
  $('#btn-pause').textContent = state === 'paused' ? 'Resume' : 'Pause';
  $('#btn-pause').disabled = !(state === 'playing' || state === 'paused');
}

function startGame() {
  sfx.unlock();
  game.reset();
  state = 'playing';
  showScreen(null);
  sfx.play('start');
  updateHud(true);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  showScreen('paused');
}

function resumeGame() {
  if (state !== 'paused') return;
  sfx.unlock();
  state = 'playing';
  lastFrame = performance.now();
  showScreen(null);
}

function toMenu() {
  state = 'menu';
  game.reset();
  showScreen('menu');
  if (pendingUpdate) applyUpdate();
}

function onGameOver(g) {
  state = 'over';
  const isBest = g.score > best;
  if (isBest) {
    best = g.score;
    try { localStorage.setItem('wippit.best', String(best)); } catch (e) { /* ignore */ }
  }
  $('#final-score').textContent = g.score.toLocaleString();
  $('#final-best').hidden = !isBest;
  const bits = [`Level ${g.level}`, `${g.dropped} balls dropped`, `${g.cleared} removed`, `${g.stats.tips} tips`];
  if (g.stats.wraps) bits.push(`${g.stats.wraps} flew round the world`);
  if (g.stats.farthest) bits.push(`longest throw ${g.stats.farthest}`);
  if (g.stats.maxChain > 1) bits.push(`best chain x${g.stats.maxChain}`);
  $('#final-detail').textContent = bits.join(' · ');
  updateHud(true);
  showScreen('over');
  if (pendingUpdate) {
    showToast('Update installed – restarting in a moment…', 4500);
    setTimeout(applyUpdate, 5000);
  }
}

// ---- HUD -----------------------------------------------------------------

function setText(id, value) {
  if (hud[id] === value) return;
  hud[id] = value;
  document.getElementById(id).textContent = value;
}

function updateHud(force = false) {
  setText('hud-score', game.score.toLocaleString());
  setText('hud-best', Math.max(best, game.score).toLocaleString());
  setText('hud-level', String(game.level));
  setText('hud-cleared', String(game.cleared));
  setText('hud-chain', game.chain > 1 ? `x${game.chain}` : '–');
  const toGo = BALLS_PER_LEVEL - (game.dropped % BALLS_PER_LEVEL);
  setText('hud-next-level', `${toGo} ball${toGo === 1 ? '' : 's'}`);
  const bonus = game.bonusLeft();
  const bar = $('#bonus-bar');
  bar.style.width = `${Math.round(bonus * 100)}%`;
  bar.parentElement.classList.toggle('lit', bonus > 0);
  if (force) for (const k of Object.keys(hud)) document.getElementById(k).textContent = hud[k];
}

let toastTimer = 0;
function showToast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Legend icons in the help screen.
function drawLegend() {
  const list = $('#legend');
  list.innerHTML = '';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (const [kind, [name, text]] of Object.entries(KIND_INFO)) {
    const li = document.createElement('li');
    const c = document.createElement('canvas');
    const d = 34;
    c.width = c.height = d * dpr;
    c.style.width = c.style.height = `${d}px`;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const b = makeBlock(kind, kind === 'heart' ? 'heart' : kind === 'star' || kind === 'gold' ? kind : null, kind === 'heart' || kind === 'stone' ? 5 : 0);
    drawBall(g, d / 2, d / 2 + 1, d * 0.4, b);
    li.appendChild(c);
    const span = document.createElement('span');
    span.innerHTML = `<b>${name}</b> ${text}`;
    li.appendChild(span);
    list.appendChild(li);
  }
}
drawLegend();

// ---- update handling -----------------------------------------------------

function applyUpdate() {
  location.reload();
}

setupPwa({
  installButton: $('#btn-install'),
  onUpdateReady() {
    if (state === 'playing' || state === 'paused') {
      pendingUpdate = true;
      showToast('Update downloaded – it will be applied after this game.', 5000);
    } else {
      applyUpdate();
    }
  },
});

// ---- layout --------------------------------------------------------------

function relayout() {
  const r = $('#board-wrap').getBoundingClientRect();
  renderer.layout(Math.max(120, r.width - 8), Math.max(160, r.height - 8));
}
new ResizeObserver(relayout).observe($('#board-wrap'));
window.addEventListener('resize', relayout);
relayout();

// ---- input ---------------------------------------------------------------

const canvas = $('#board');

function hitFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  return renderer.hit(e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener('pointermove', (e) => {
  if (state !== 'playing' || e.pointerType !== 'mouse') return;
  const h = hitFromEvent(e);
  if (h) game.setCrane(h.x);
});

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (state !== 'playing') return;
  const h = hitFromEvent(e);
  if (!h) return;
  e.preventDefault();
  if (e.pointerType === 'mouse' || game.crane.x === h.x) {
    game.setCrane(h.x);
    game.action();
  } else {
    game.setCrane(h.x);
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  const key = e.key;
  const handled = () => e.preventDefault();
  if (key === 'm' || key === 'M') { toggleSound(); return handled(); }

  if (state === 'menu' || state === 'over') {
    if (e.target && e.target.tagName === 'BUTTON' && (key === 'Enter' || key === ' ')) return;
    if (key === 'Enter' || key === ' ') { startGame(); return handled(); }
    if ((key === 'h' || key === 'H') && state === 'menu') { state = 'help'; showScreen('help'); return handled(); }
    if (key === 'Escape' && state === 'over') { toMenu(); return handled(); }
    return;
  }
  if (state === 'help') {
    if (key === 'Escape' || key === 'Enter' || key === ' ' || key === 'Backspace') { toMenu(); return handled(); }
    return;
  }
  if (key === 'Escape' || key === 'p' || key === 'P') {
    if (state === 'playing') pauseGame(); else resumeGame();
    return handled();
  }
  if (state !== 'playing') return;

  switch (key) {
    case 'ArrowLeft': case 'a': case 'A':
      sfx.unlock(); game.moveCrane(-1); return handled();
    case 'ArrowRight': case 'd': case 'D':
      sfx.unlock(); game.moveCrane(1); return handled();
    case ' ': case 'ArrowDown': case 's': case 'S': case 'Enter': case 'ArrowUp': case 'w': case 'W':
      if (e.repeat) return handled();
      sfx.unlock(); game.action(); return handled();
    default:
      return;
  }
});

for (const btn of document.querySelectorAll('#touch-controls [data-action]')) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.unlock();
    if (state !== 'playing') return;
    const a = btn.dataset.action;
    if (a === 'left') game.moveCrane(-1);
    else if (a === 'right') game.moveCrane(1);
    else if (a === 'drop') game.action();
  });
}

function toggleSound() {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  $('#btn-sound').textContent = sfx.muted ? '🔇' : '🔊';
  $('#btn-sound').setAttribute('aria-pressed', String(sfx.muted));
}
$('#btn-sound').textContent = sfx.muted ? '🔇' : '🔊';

$('#btn-play').addEventListener('click', startGame);
$('#btn-again').addEventListener('click', startGame);
$('#btn-help').addEventListener('click', () => { state = 'help'; showScreen('help'); });
$('#btn-help-back').addEventListener('click', toMenu);
$('#btn-resume').addEventListener('click', resumeGame);
$('#btn-quit').addEventListener('click', toMenu);
$('#btn-menu').addEventListener('click', toMenu);
$('#btn-sound').addEventListener('click', toggleSound);
$('#btn-pause').addEventListener('click', () => { if (state === 'playing') pauseGame(); else resumeGame(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});
window.addEventListener('blur', () => { if (state === 'playing') pauseGame(); });

// ---- main loop -----------------------------------------------------------

function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (state === 'playing') {
    game.update(dt);
    updateHud();
  }
  renderer.draw(game, now / 1000);
  requestAnimationFrame(frame);
}

$('#version').textContent = window.WIPPIT_VERSION || 'dev';
setText('hud-best', best.toLocaleString());
showScreen('menu');
requestAnimationFrame(frame);

// Debug handle (used by the headless test driver).
window.wippit = { game, renderer };
