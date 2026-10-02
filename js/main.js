// Punkt startowy: pętla symulacji, obsługa myszy i klawiatury, zapis/odczyt.
import { DEFAULTS } from './config.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { UI, TOOLS, downloadJSON } from './ui.js';

const $ = s => document.querySelector(s);

const SPEEDS = [
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
setSpeed(0);

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

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const w = app.renderer.toWorld(e.offsetX, e.offsetY);
  drag = { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button, moved: false, pan: e.button !== 0 || app.tool === 'select' };
  if (e.button === 0 && app.tool !== 'select') { applyTool(w, true); lastPaint = performance.now(); }
});
canvas.addEventListener('pointermove', e => {
  const r = app.renderer;
  const w = r.toWorld(e.offsetX, e.offsetY);
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.abs(e.offsetX - drag.sx) + Math.abs(e.offsetY - drag.sy) > 4) drag.moved = true;
    if (drag.pan && drag.moved) { r.pan(dx, dy); app.follow = false; }
    else if (!drag.pan && ['food', 'meat', 'paint'].includes(app.tool) && performance.now() - lastPaint > 60) { applyTool(w, false); lastPaint = performance.now(); }
    drag.x = e.offsetX; drag.y = e.offsetY;
  }
  // podgląd pędzla i najechanie
  r.brush = ['food', 'meat', 'paint', 'smite', 'infect'].includes(app.tool) ? { x: w.x, y: w.y, r: app.toolOpts.radius } : app.tool === 'meteor' ? { x: w.x, y: w.y, r: 130 } : null;
  const c = app.sim.creatureAt(w.x, w.y, 6 / r.cam.zoom + 2);
  r.hover = c;
  if (c) {
    const sp = app.sim.species.get(c.sp);
    const d = c.g.t.diet;
    tip.innerHTML = `<b style="color:hsl(${sp ? sp.hue : 0},80%,65%)">${sp ? sp.name : '?'}</b> <span class="muted">#${c.id}</span><br>` +
      `${d < 0.33 ? 'roślinożerca' : d < 0.66 ? 'wszystkożerca' : 'mięsożerca'} · energia ${Math.round(c.energy / c.maxE * 100)}% · wiek ${(c.age / app.cfg.yearLength).toFixed(1)} r.`;
    tip.style.display = 'block';
    const mainRect = canvas.getBoundingClientRect();
    let tx = e.offsetX + 14, ty = e.offsetY + 14;
    if (tx + 240 > mainRect.width) tx = e.offsetX - 250;
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
  } else {
    const b = app.sim.terrain.at(w.x, w.y);
    if (w.x >= 0 && w.y >= 0 && w.x < 1600 && w.y < 1000 && !drag) {
      const T = app.sim.terrain.tempAt(w.x, w.y) + app.sim.tempOffset;
      tip.innerHTML = `${b.name} <span class="muted">· ${T.toFixed(1)}°C</span>`;
      tip.style.display = 'block';
      tip.style.left = (e.offsetX + 14) + 'px'; tip.style.top = (e.offsetY + 14) + 'px';
    } else tip.style.display = 'none';
  }
});
canvas.addEventListener('pointerup', e => {
  if (drag && !drag.moved && drag.button === 0 && app.tool === 'select') {
    const w = app.renderer.toWorld(e.offsetX, e.offsetY);
    const c = app.sim.creatureAt(w.x, w.y, 6 / app.renderer.cam.zoom + 2);
    if (c) app.select(c);
    else {
      const p = app.sim.plantAt(w.x, w.y);
      app.select(p || null);
    }
  }
  drag = null;
});
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; app.renderer.brush = null; app.renderer.hover = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  app.renderer.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// ---------- Klawiatura ----------
window.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); setRunning(!app.running); }
  else if (/^Digit[1-8]$/.test(e.code)) app.ui.setTool(TOOLS[Number(e.code.slice(5)) - 1].key);
  else if (e.key === 'f' || e.key === 'F') { if (app.selected) { app.follow = !app.follow; app.ui.drawInspector(true); } }
  else if (e.key === 'Escape') { app.select(null); app.renderer.highlightSpecies = null; }
  else if (e.key === '+' || e.key === '=') setSpeed(app.speedIdx + 1);
  else if (e.key === '-') setSpeed(app.speedIdx - 1);
});

window.addEventListener('resize', () => app.renderer.resize());
new ResizeObserver(() => app.renderer.resize()).observe($('#main'));

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
    for (let i = 0; i < app.speed; i++) {
      sim.step(); tpsCount++;
      if ((i & 3) === 3 && performance.now() - t0 > budget) break;
    }
  }
  if (now - tpsTime > 1000) { tps = tpsCount * 1000 / (now - tpsTime); tpsCount = 0; tpsTime = now; }

  if (app.selected && app.selected.dead && app.follow) app.follow = false;
  if (app.follow && app.selected && !app.selected.dead) {
    const r = app.renderer;
    r.cam.x += (app.selected.x - r.cam.x) * 0.15;
    r.cam.y += (app.selected.y - r.cam.y) * 0.15;
  }
  if (!app.ff || frame % 8 === 0) app.renderer.draw(sim);
  app.ui.update(now, tps);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.ewosym = app; // do debugowania w konsoli
