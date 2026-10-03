// Punkt startowy: pętla symulacji, obsługa myszy i klawiatury, zapis/odczyt.
import { DEFAULTS } from './config.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { UI, TOOLS, downloadJSON } from './ui.js';

const $ = s => document.querySelector(s);

const SPEEDS = [
  { label: 'x0.1', n: 0.1 }, { label: 'x0.25', n: 0.25 }, { label: 'x0.5', n: 0.5 },
  { label: 'x1', n: 1 }, { label: 'x2', n: 2 }, { label: 'x5', n: 5 },
  { label: 'x20', n: 20 }, { label: 'x100', n: 100 }, { label: 'MAX', n: Infinity },
];

const app = {
  cfg: { ...DEFAULTS },
  running: true,
  speed: 1,
  tool: 'select',
  toolOpts: { radius: 60, density: 12, biome: 5 },
  selected: null,
  follow: false,
  ff: null,
};

app.sim = new Sim(app.cfg);
app.renderer = new Renderer($('#world'));
app.renderer.fit();

app.select = obj => {
  app.selected = obj;
  app.renderer.selected = obj;
  if (!obj) app.follow = false;
  app.ui.drawInspector(true);
  if (obj) {
    app.ui.showTab($('#right'), 'inspect');
    if (window.innerWidth <= 1100) $('#right').classList.add('open');
  }
};

app.newWorld = opts => {
  app.sim.reset(opts);
  app.renderer.texKey = '';
  app.renderer.highlightSpecies = null;
  app.renderer.particles = [];
  app.select(null);
  app.ui.onNewWorld();
  app.renderer.fit();
  if (app.r3d) app.r3d.fit();
};

app.ui = new UI(app);

// ---------- Prędkość ----------
const seg = $('#speedSeg');
seg.innerHTML = SPEEDS.map((s, i) => `<button data-i="${i}">${s.label}</button>`).join('');
function setSpeed(i) {
  i = Math.max(0, Math.min(SPEEDS.length - 1, i));
  app.speedIdx = i;
  app.speed = SPEEDS[i].n;
  [...seg.children].forEach((b, k) => b.classList.toggle('active', k === i));
}
seg.onclick = e => { const b = e.target.closest('button'); if (b) setSpeed(Number(b.dataset.i)); };
setSpeed(2); // domyślnie x0.5, żeby dało się śledzić, co się dzieje

function setRunning(v) {
  app.running = v;
  $('#playBtn').textContent = v ? '⏸' : '▶';
}
$('#playBtn').onclick = () => setRunning(!app.running);
$('#stepBtn').onclick = () => { setRunning(false); app.sim.step(); };

// ---------- Przewijanie ----------
$('#ffSelect').onchange = e => {
  const years = Number(e.target.value);
  e.target.value = '';
  if (!years) return;
  app.ff = { start: app.sim.tick, target: app.sim.tick + years * app.cfg.yearLength, years };
  $('#ffOverlay').style.display = 'flex';
};
$('#ffCancel').onclick = () => endFF();
function endFF() {
  app.ff = null;
  $('#ffOverlay').style.display = 'none';
  app.ui.lastEventObj = app.sim.events[app.sim.events.length - 1];
}

// ---------- Zapis / odczyt ----------
function saveName() { return `ewosym-rok-${app.sim.year.toFixed(1)}.json`; }
$('#saveBtn').onclick = () => {
  downloadJSON(app.sim.serialize(), saveName());
  app.ui.toast('Zapisano świat do pliku.');
};
$('#loadBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { loadState(JSON.parse(await f.text())); app.ui.toast('Wczytano świat.'); }
  catch (err) { app.ui.toast('Nie udało się wczytać: ' + err.message); }
};
function loadState(s) {
  app.sim.load(s);
  app.renderer.texKey = '';
  app.renderer.highlightSpecies = null;
  app.select(null);
  app.ui.onNewWorld();
}
$('#quickSave').onclick = () => {
  try { localStorage.setItem('ewosym-quick', JSON.stringify(app.sim.serialize())); app.ui.toast('Zapisano w przeglądarce.'); }
  catch (err) { app.ui.toast('Nie udało się zapisać w przeglądarce (za mało miejsca?). Użyj zapisu do pliku.'); }
};
$('#quickLoad').onclick = () => {
  try {
    const s = localStorage.getItem('ewosym-quick');
    if (!s) { app.ui.toast('Brak szybkiego zapisu.'); return; }
    loadState(JSON.parse(s));
    app.ui.toast('Wczytano szybki zapis.');
  } catch (err) { app.ui.toast('Błąd odczytu: ' + err.message); }
};

// ---------- Mysz na mapie ----------
const canvas = $('#world');
const tip = $('#hoverTip');
let drag = null;
let lastPaint = 0;

function applyTool(w, first) {
  const sim = app.sim, o = app.toolOpts;
  switch (app.tool) {
    case 'food': sim.addFood(w.x, w.y, o.radius, Math.max(1, Math.round(o.density * (o.radius / 60) ** 2 * 0.5))); break;
    case 'meat': sim.addMeat(w.x, w.y, o.radius, Math.max(1, Math.round(o.radius / 15))); break;
    case 'paint': sim.terrain.paint(w.x, w.y, o.radius, o.biome); break;
    case 'smite': if (first) sim.smite(w.x, w.y, o.radius); break;
    case 'meteor': if (first) sim.meteor(w.x, w.y, 130); break;
    case 'infect': if (first) {
      let k = 0;
      for (const c of sim.creatures) if ((c.x - w.x) ** 2 + (c.y - w.y) ** 2 < o.radius ** 2) { c.infected = 1; k++; }
      sim.addFx('smite', w.x, w.y, { r: o.radius });
      app.ui.toast(`Zarażono ${k} stworków.`);
    } break;
    case 'spawn': if (first) app.ui.spawnFromCreator(w.x, w.y); break;
  }
}

// Aktywny widok: 2D (canvas) albo 3D (WebGL)
const is3d = () => app.view === '3d' && app.r3d;
const toWorld = e => is3d() ? app.r3d.toWorld(e.offsetX, e.offsetY) : app.renderer.toWorld(e.offsetX, e.offsetY);
const pickCreature = (e, w) => is3d() ? app.r3d.pick(e.offsetX, e.offsetY, app.sim) : app.sim.creatureAt(w.x, w.y, 6 / app.renderer.cam.zoom + 2);
const BRUSH_TOOLS = ['food', 'meat', 'paint', 'smite', 'infect'];

function onDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  const w = toWorld(e);
  drag = { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button, moved: false, pan: e.button !== 0 || app.tool === 'select' };
  if (e.button === 0 && app.tool !== 'select') { applyTool(w, true); lastPaint = performance.now(); }
}
function onMove(e) {
  const r = app.renderer;
  const w = toWorld(e);
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.abs(e.offsetX - drag.sx) + Math.abs(e.offsetY - drag.sy) > 4) drag.moved = true;
    if (drag.pan && drag.moved) { if (!is3d()) r.pan(dx, dy); app.follow = false; }
    else if (!drag.pan && ['food', 'meat', 'paint'].includes(app.tool) && performance.now() - lastPaint > 60) { applyTool(w, false); lastPaint = performance.now(); }
    drag.x = e.offsetX; drag.y = e.offsetY;
  }
  // podgląd pędzla i najechanie
  r.brush = BRUSH_TOOLS.includes(app.tool) ? { x: w.x, y: w.y, r: app.toolOpts.radius } : app.tool === 'meteor' ? { x: w.x, y: w.y, r: 130 } : null;
  if (drag && drag.pan && drag.moved) { tip.style.display = 'none'; return; }
  const c = pickCreature(e, w);
  r.hover = c;
  const mainRect = e.currentTarget.getBoundingClientRect();
  if (c) {
    const sp = app.sim.species.get(c.sp);
    const d = c.g.t.diet;
    tip.innerHTML = `<b style="color:hsl(${sp ? sp.hue : 0},80%,65%)">${sp ? sp.name : '?'}</b> <span class="muted">#${c.id}</span><br>` +
      `${c.sex === 1 ? '♀' : '♂'} ${c.gf < 1 ? 'młode · ' : ''}${d < 0.33 ? 'roślinożerca' : d < 0.66 ? 'wszystkożerca' : 'mięsożerca'} · energia ${Math.round(c.energy / c.maxE * 100)}% · wiek ${(c.age / app.cfg.yearLength).toFixed(1)} r.`;
    tip.style.display = 'block';
    let tx = e.offsetX + 14, ty = e.offsetY + 14;
    if (tx + 240 > mainRect.width) tx = e.offsetX - 250;
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
  } else if (w.x >= 0 && w.y >= 0 && w.x < 1600 && w.y < 1000 && !drag) {
    const b = app.sim.terrain.at(w.x, w.y);
    const T = app.sim.terrain.tempAt(w.x, w.y) + app.sim.tempOffset;
    tip.innerHTML = `${b.name} <span class="muted">· ${T.toFixed(1)}°C</span>`;
    tip.style.display = 'block';
    tip.style.left = (e.offsetX + 14) + 'px'; tip.style.top = (e.offsetY + 14) + 'px';
  } else tip.style.display = 'none';
}
function onUp(e) {
  if (drag && !drag.moved && drag.button === 0 && app.tool === 'select') {
    const w = toWorld(e);
    const c = pickCreature(e, w);
    if (c) app.select(c);
    else app.select(app.sim.plantAt(w.x, w.y) || null);
  }
  drag = null;
}
function onLeave() { tip.style.display = 'none'; app.renderer.brush = null; app.renderer.hover = null; }

const canvas3d = $('#world3d');
for (const cv of [canvas, canvas3d]) {
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointerleave', onLeave);
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  app.renderer.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// ---------- Przełączanie 2D / 3D ----------
app.view = '2d';
async function setView(v) {
  if (v === '3d' && !app.r3d) {
    try {
      const { Renderer3D } = await import('./render3d.js');
      canvas3d.hidden = false;
      app.r3d = new Renderer3D(canvas3d, app.renderer);
    } catch (err) {
      console.error(err);
      canvas3d.hidden = true;
      app.ui.toast('Nie udało się włączyć widoku 3D (brak WebGL?). ' + err.message);
      return;
    }
  }
  app.view = v;
  canvas.hidden = v === '3d';
  canvas3d.hidden = v !== '3d';
  $('#viewBtn').textContent = v === '3d' ? '2D' : '3D';
  $('#viewBtn').title = v === '3d' ? 'Przełącz na płaską mapę (V)' : 'Przełącz na widok 3D (V)';
  $('#viewHint').hidden = v !== '3d';
  if (v === '3d') app.r3d.resize(); else app.renderer.resize();
  syncToolControls();
}
// w 3D lewy przycisk obraca kamerę tylko przy narzędziu „Wybierz”; inne narzędzia malują
function syncToolControls() {
  if (app.r3d) app.r3d.controls.mouseButtons.LEFT = app.tool === 'select' ? 0 : null;
}
$('#viewBtn').onclick = () => setView(app.view === '3d' ? '2d' : '3d');
const origSetTool = app.ui.setTool.bind(app.ui);
app.ui.setTool = key => { origSetTool(key); syncToolControls(); };

// ---------- Klawiatura ----------
window.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); setRunning(!app.running); }
  else if (/^Digit[1-8]$/.test(e.code)) app.ui.setTool(TOOLS[Number(e.code.slice(5)) - 1].key);
  else if (e.key === 'f' || e.key === 'F') { if (app.selected) { app.follow = !app.follow; app.ui.drawInspector(true); } }
  else if (e.key === 'Escape') { app.select(null); app.renderer.highlightSpecies = null; }
  else if (e.key === '+' || e.key === '=') setSpeed(app.speedIdx + 1);
  else if (e.key === '-') setSpeed(app.speedIdx - 1);
  else if (e.key === 'v' || e.key === 'V') setView(app.view === '3d' ? '2d' : '3d');
});

const onResize = () => { app.renderer.resize(); if (app.r3d) app.r3d.resize(); };
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe($('#main'));

// ---------- Pętla główna ----------
let tpsCount = 0, tpsTime = performance.now(), tps = 0, frame = 0;
function loop(now) {
  const sim = app.sim;
  frame++;
  if (app.ff) {
    const t0 = performance.now();
    while (sim.tick < app.ff.target && performance.now() - t0 < 45) { sim.step(); tpsCount++; }
    const k = (sim.tick - app.ff.start) / (app.ff.target - app.ff.start);
    $('#ffBar').style.width = (k * 100).toFixed(1) + '%';
    $('#ffText').textContent = `rok ${sim.year.toFixed(2)} · stworki ${sim.creatures.length} · gatunki ${sim.species.alive().length}`;
    if (sim.tick >= app.ff.target) { const yrs = app.ff.years; endFF(); app.ui.toast(`Przewinięto o ${yrs} ${yrs === 1 ? 'rok' : yrs < 5 ? 'lata' : 'lat'}.`); }
  } else if (app.running) {
    const t0 = performance.now();
    const budget = app.speed === Infinity ? 30 : 22;
    // ułamkowe prędkości: krok symulacji co kilka klatek
    app.tickAcc = Math.min((app.tickAcc || 0) + app.speed, 1e9);
    const n = app.speed === Infinity ? Infinity : Math.floor(app.tickAcc);
    app.tickAcc -= n === Infinity ? app.tickAcc : n;
    for (let i = 0; i < n; i++) {
      sim.step(); tpsCount++;
      if ((i & 3) === 3 && performance.now() - t0 > budget) break;
    }
  }
  if (now - tpsTime > 1000) { tps = tpsCount * 1000 / (now - tpsTime); tpsCount = 0; tpsTime = now; }

  if (app.selected && app.selected.dead && app.follow) app.follow = false;
  if (app.follow && app.selected && !app.selected.dead) {
    if (is3d()) app.r3d.followTarget(app.selected);
    else {
      const r = app.renderer;
      r.cam.x += (app.selected.x - r.cam.x) * 0.15;
      r.cam.y += (app.selected.y - r.cam.y) * 0.15;
    }
  }
  const alpha = app.running && !app.ff && app.speed < 1 ? app.tickAcc : 1;
  if (!app.ff || frame % 8 === 0) {
    if (is3d()) { app.r3d.alpha = alpha; app.r3d.draw(sim); }
    else { app.renderer.alpha = alpha; app.renderer.draw(sim); }
  }
  app.ui.update(now, tps);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.ewosym = app; // do debugowania w konsoli
