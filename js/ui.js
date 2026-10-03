// Panele boczne: parametry, narzędzia, katastrofy, kreator, wykresy, gatunki, drzewo, inspektor, kronika.
import { DEFAULTS, SCHEMA, GROUPS } from './config.js';
import { TRAITS, PLANT_TRAITS, TRAIT_MAP, makeGenome, cloneGenome, serializeGenome, deserializeGenome, defaultTraits } from './genome.js';
import { BIOMES } from './terrain.js';
import { DISASTERS, DEATH_CAUSES, DEFAULT_WORLD_OPTS, dietClass } from './sim.js';
import { COLOR_MODES, seqColor, dietColor } from './render.js';
import { lineChart, scatterChart, barChart, treeChart, brainChart, attachHover, niceNum } from './charts.js';
import { clamp } from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const TOOLS = [
  { key: 'select', ico: '➤', name: 'Wybierz' },
  { key: 'food', ico: '🌿', name: 'Sadź rośliny' },
  { key: 'meat', ico: '🥩', name: 'Rzuć mięso' },
  { key: 'paint', ico: '🖌', name: 'Maluj teren' },
  { key: 'smite', ico: '⚡', name: 'Piorun (zabij)' },
  { key: 'meteor', ico: '☄', name: 'Meteoryt' },
  { key: 'infect', ico: '🦠', name: 'Zaraź chorobą' },
  { key: 'spawn', ico: '✚', name: 'Wpuść z kreatora' },
];

const SERIES_COLORS = { herb: '#199e70', omni: '#3987e5', carn: '#d95926' };
const DIET_NAMES = ['roślinożerca', 'wszystkożerca', 'mięsożerca'];

function fmtTrait(d, v) {
  return (d.fmt !== undefined ? v.toFixed(d.fmt) : niceNum(v)) + (d.unit || '');
}

export function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export class UI {
  constructor(app) {
    this.app = app;
    this.lastEvent = 0;
    this.selKey = null;
    this.timers = { charts: 0, species: 0, inspect: 0, log: 0, top: 0, tree: 0 };
    this.creator = { traits: defaultTraits(), imported: null };
    this.buildTabs();
    this.buildParams();
    this.buildTools();
    this.buildDisasters();
    this.buildCreator();
    this.buildOverlay();
    this.buildCharts();
    this.buildWorldModal();
    this.bindMisc();
  }

  // ---------- Zakładki ----------
  buildTabs() {
    for (const nav of $$('.tabs')) {
      const panel = nav.parentElement;
      nav.addEventListener('click', e => {
        const b = e.target.closest('button[data-tab]');
        if (!b) return;
        this.showTab(panel, b.dataset.tab);
      });
    }
  }
  showTab(panel, tab) {
    $$('.tabs button', panel).forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    $$('.tab-page', panel).forEach(x => x.classList.toggle('active', x.dataset.page === tab));
    for (const k in this.timers) this.timers[k] = 0;
  }
  activeTab(side) { return $(`#${side} .tabs button.active`)?.dataset.tab; }

  // ---------- Parametry ----------
  field(def, obj, onChange) {
    const wrap = document.createElement('div');
    if (def.type === 'bool') {
      wrap.innerHTML = `<label class="check" title="${esc(def.tip || '')}"><input type="checkbox"> ${esc(def.label)}</label>`;
      const inp = $('input', wrap);
      inp.checked = !!obj[def.key];
      inp.addEventListener('change', () => { obj[def.key] = inp.checked; onChange && onChange(); });
      wrap._sync = () => { inp.checked = !!obj[def.key]; };
      return wrap;
    }
    wrap.className = 'field';
    wrap.innerHTML = `<div class="row"><label title="${esc(def.tip || '')}">${esc(def.label)}</label><span class="val"></span></div><input type="range">` +
      (def.tipShow ? `<div class="tip">${esc(def.tip)}</div>` : '');
    const inp = $('input', wrap), val = $('.val', wrap);
    Object.assign(inp, { min: def.min, max: def.max, step: def.step });
    const show = () => { val.textContent = def.format ? def.format(obj[def.key]) : niceNum(Number(obj[def.key])); };
    inp.value = obj[def.key];
    show();
    inp.addEventListener('input', () => { obj[def.key] = Number(inp.value); show(); onChange && onChange(); });
    wrap._sync = () => { inp.value = obj[def.key]; show(); };
    return wrap;
  }

  buildParams() {
    const root = $('#paramGroups');
    root.innerHTML = '';
    this.paramFields = [];
    for (const [g, name] of Object.entries(GROUPS)) {
      const det = document.createElement('details');
      det.className = 'group';
      if (g === 'sim' || g === 'evo') det.open = true;
      det.innerHTML = `<summary>${esc(name)}</summary><div class="inner"></div>`;
      const inner = $('.inner', det);
      for (const def of SCHEMA.filter(d => d.group === g)) {
        const f = this.field(def, this.app.cfg);
        this.paramFields.push(f);
        inner.appendChild(f);
      }
      root.appendChild(det);
    }
    $('#resetParams').onclick = () => {
      Object.assign(this.app.cfg, DEFAULTS);
      this.syncParams();
      this.toast('Przywrócono domyślne parametry.');
    };
  }
  syncParams() { for (const f of this.paramFields) f._sync(); for (const f of this.disasterFields || []) f._sync(); }

  // ---------- Narzędzia ----------
  buildTools() {
    const grid = $('#toolGrid');
    grid.innerHTML = TOOLS.map((t, i) => `<button class="tool" data-tool="${t.key}"><span class="ico">${t.ico}</span>${esc(t.name)}<kbd>${i + 1}</kbd></button>`).join('');
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-tool]');
      if (b) this.setTool(b.dataset.tool);
    });
    this.setTool('select');
  }
  setTool(key) {
    const app = this.app;
    app.tool = key;
    $$('#toolGrid .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === key));
    const opt = $('#toolOptions');
    const o = app.toolOpts;
    let html = '';
    const needsBrush = ['food', 'meat', 'paint', 'smite', 'infect'].includes(key);
    if (key === 'select') html = '<p class="note">Kliknij stworka albo roślinę, żeby zobaczyć szczegóły w zakładce „Osobnik”.</p>';
    if (key === 'paint') {
      html += '<h3>Biom</h3><div class="grid2">' + BIOMES.map(b => `<button class="tool${o.biome === b.id ? ' active' : ''}" data-biome="${b.id}"><span class="ico" style="background:rgb(${b.color.map(c => Math.min(255, c * 1.6)).join(',')});border-radius:4px;height:14px"></span>${esc(b.name)}</button>`).join('') + '</div>';
    }
    if (key === 'meteor') html = '<p class="note">Kliknij na mapie, gdzie ma uderzyć meteoryt (promień ok. 130).</p>';
    if (key === 'spawn') html = '<p class="note">Kliknij na mapie, żeby wpuścić stworki zaprojektowane w zakładce „Kreator”.</p>';
    if (key === 'infect') html += '<p class="note">Zaraża stworki w obszarze. Choroba przenosi się przez kontakt.</p>';
    opt.innerHTML = html;
    if (needsBrush) {
      opt.appendChild(this.field({ key: 'radius', label: 'Promień pędzla', min: 10, max: 250, step: 5 }, o));
    }
    if (key === 'food') opt.appendChild(this.field({ key: 'density', label: 'Gęstość sadzenia', min: 1, max: 40, step: 1 }, o));
    $$('[data-biome]', opt).forEach(b => b.onclick = () => {
      o.biome = Number(b.dataset.biome);
      $$('[data-biome]', opt).forEach(x => x.classList.toggle('active', x === b));
    });
    app.renderer.brush = null;
  }

  // ---------- Katastrofy ----------
  buildDisasters() {
    const list = $('#disasterList');
    list.innerHTML = Object.entries(DISASTERS).map(([k, d]) => `
      <div class="disaster"><div class="txt"><b>${esc(d.name)}</b><span>${esc(d.desc)}${d.dur ? ` Czas trwania: ${d.dur} roku.` : ''}</span></div>
      <button class="btn small" data-dis="${k}">Wywołaj</button></div>`).join('');
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-dis]');
      if (b) this.app.sim.triggerDisaster(b.dataset.dis);
    });
    const p = $('#disasterParams');
    p.innerHTML = '<h3>Ustawienia</h3>';
    this.disasterFields = SCHEMA.filter(d => ['randomDisasters', 'disasterRate', 'climateOffset', 'seasonAmplitude'].includes(d.key)).map(d => {
      const f = this.field(d, this.app.cfg, () => this.syncParams());
      p.appendChild(f);
      return f;
    });
  }

  // ---------- Kreator ----------
  buildCreator() {
    const root = $('#creatorFields');
    root.innerHTML = '';
    this.creatorFields = TRAITS.map(d => {
      const f = this.field({ key: d.key, label: d.name, min: d.min, max: d.max, step: (d.max - d.min) / 200, tip: d.desc, tipShow: true, format: v => fmtTrait(d, v) }, this.creator.traits, () => this.updateCreatorSwatch());
      root.appendChild(f);
      return f;
    });
    const sw = document.createElement('div');
    sw.className = 'row-flex';
    sw.style.margin = '6px 0 10px';
    sw.innerHTML = '<span class="muted">Podgląd:</span><canvas id="creatorPreview" width="80" height="40" style="width:80px;height:40px"></canvas><span id="creatorDietLabel" class="dim"></span>';
    root.prepend(sw);
    this.updateCreatorSwatch();
    const cnt = $('#creatorCount');
    cnt.oninput = () => { $('#creatorCountV').textContent = cnt.value; };
    $('#creatorSpawnRandom').onclick = () => {
      const pos = this.app.sim.terrain.randomPassable(b => !b.water);
      this.spawnFromCreator(pos.x, pos.y);
    };
    $('#creatorSpawnClick').onclick = () => { this.setTool('spawn'); this.showTab($('#left'), 'tools'); };
    $('#creatorFromSelected').onclick = () => {
      const c = this.app.selected;
      if (!c || !c.g.t) { this.toast('Najpierw zaznacz stworka.'); return; }
      Object.assign(this.creator.traits, c.g.t);
      $('#creatorBrain').value = 'selected';
      this.creator.selectedWeights = new Float32Array(c.g.w);
      this.syncCreator();
      this.toast('Wczytano geny zaznaczonego stworka.');
    };
    $('#creatorImport').onclick = () => $('#genomeInput').click();
    $('#genomeInput').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const o = JSON.parse(await f.text());
        if (o.format !== 'ewosym-genome') throw new Error('To nie jest plik genomu.');
        const g = deserializeGenome(o.genome);
        Object.assign(this.creator.traits, g.t);
        this.creator.imported = g.w;
        const opt = $('#creatorBrain option[value=imported]');
        opt.disabled = false;
        $('#creatorBrain').value = 'imported';
        this.syncCreator();
        this.toast(`Zaimportowano genom${o.name ? ': ' + o.name : ''}.`);
      } catch (err) { this.toast('Błąd importu: ' + err.message); }
    };
  }
  syncCreator() { for (const f of this.creatorFields) f._sync(); this.updateCreatorSwatch(); }
  updateCreatorSwatch() {
    const cv = $('#creatorPreview');
    if (!cv) return;
    const t = this.creator.traits;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 80, 40);
    const r = t.size * 1.3;
    const g = ctx.createRadialGradient(40, 20, r * 0.3, 40, 20, r * 2);
    g.addColorStop(0, `hsla(${t.hue},85%,62%,0.4)`); g.addColorStop(1, `hsla(${t.hue},85%,62%,0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(40, 20, r * 2, 0, 7); ctx.fill();
    ctx.fillStyle = `hsl(${t.hue},85%,62%)`; ctx.beginPath(); ctx.arc(40, 20, r, 0, 7); ctx.fill();
    if (t.diet > 0.33) { ctx.strokeStyle = t.diet > 0.66 ? '#ff5a3c' : '#ffaa3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(40, 20, r + 1, 0, 7); ctx.stroke(); }
    $('#creatorDietLabel').textContent = DIET_NAMES[dietClass(t.diet)];
  }
  creatorGenome() {
    const mode = $('#creatorBrain').value;
    let brain = 'instinct';
    if (mode === 'random') brain = 'random';
    else if (mode === 'selected') {
      const c = this.app.selected;
      brain = c && c.g.t ? new Float32Array(c.g.w) : this.creator.selectedWeights ? new Float32Array(this.creator.selectedWeights) : 'instinct';
    } else if (mode === 'imported' && this.creator.imported) brain = new Float32Array(this.creator.imported);
    return makeGenome(Object.assign({}, this.creator.traits), brain);
  }
  spawnFromCreator(x, y) {
    const sim = this.app.sim;
    const n = Number($('#creatorCount').value);
    const room = sim.cfg.maxCreatures - sim.creatures.length;
    if (room <= 0) { this.toast('Populacja jest pełna. Zwiększ limit w parametrach albo zrób miejsce.'); return; }
    const out = sim.introduce(this.creatorGenome(), n, x, y);
    if (out.length < n) this.toast(`Wpuszczono ${out.length} z ${n}: osiągnięto limit populacji.`);
  }

  // ---------- Pasek nad mapą ----------
  buildOverlay() {
    const r = this.app.renderer;
    const cm = $('#colorMode');
    cm.innerHTML = COLOR_MODES.map(m => `<option value="${m.key}">${esc(m.name)}</option>`).join('');
    cm.onchange = () => { r.colorMode = cm.value; this.updateLegend(); };
    $('#mapMode').onchange = e => { r.mapMode = e.target.value; };
    $('#showVision').onchange = e => { r.showVision = e.target.checked; };
    $('#fitBtn').onclick = () => { r.fit(); if (this.app.r3d) this.app.r3d.fit(); };
    this.updateLegend();
  }
  updateLegend() {
    const r = this.app.renderer, el = $('#colorLegend');
    const m = r.colorMode;
    const grad = (a, b, c) => `<span class="bar" style="background:linear-gradient(90deg,${a},${b},${c})"></span>`;
    if (m === 'species') el.innerHTML = '<span class="muted">każdy gatunek ma swój kolor</span>';
    else if (m === 'diet') el.innerHTML = `rośl. ${grad(dietColor(0), dietColor(0.5), dietColor(1))} mięso`;
    else if (m === 'hue') el.innerHTML = '<span class="muted">kolor genu barwy</span>';
    else if (m === 'energy') el.innerHTML = `0 ${grad('hsl(0,80%,55%)', 'hsl(65,80%,55%)', 'hsl(130,80%,55%)')} pełna`;
    else if (m === 'gen') el.innerHTML = `stare ${grad(seqColor(0), seqColor(0.5), seqColor(1))} nowe`;
    else {
      const d = TRAIT_MAP[m];
      el.innerHTML = `${fmtTrait(d, d.min)} ${grad(seqColor(0), seqColor(0.5), seqColor(1))} ${fmtTrait(d, d.max)}`;
    }
  }

  // ---------- Wykresy ----------
  buildCharts() {
    const ts = $('#traitSelect');
    ts.innerHTML = '<optgroup label="Stworki">' + TRAITS.filter(d => !d.circular).map(d => `<option value="c:${d.key}">${esc(d.name)}</option>`).join('') + '</optgroup>' +
      '<optgroup label="Rośliny">' + PLANT_TRAITS.map(d => `<option value="p:${d.key}">${esc(d.name)}</option>`).join('') + '</optgroup>' +
      '<optgroup label="Świat"><option value="w:temp">Odchylenie temperatury</option></optgroup>';
    ts.value = 'c:size';
    const opts = TRAITS.map(d => `<option value="${d.key}">${esc(d.name)}</option>`).join('');
    $('#scatterX').innerHTML = opts; $('#scatterY').innerHTML = opts;
    $('#scatterX').value = 'size'; $('#scatterY').value = 'speed';
    const redraw = () => this.drawCharts();
    for (const id of ['traitSelect', 'scatterX', 'scatterY']) $('#' + id).addEventListener('change', redraw);
    for (const id of ['chartPop', 'chartTrait', 'chartPlants', 'chartSpecies']) attachHover($('#' + id), redraw);
    const sc = $('#chartScatter');
    sc.addEventListener('pointermove', e => {
      let best = null, bd = 100;
      for (const p of sc._points || []) { const d = (p.sx - e.offsetX) ** 2 + (p.sy - e.offsetY) ** 2; if (d < bd) { bd = d; best = p; } }
      sc._hoverPt = best; redraw();
    });
    sc.addEventListener('pointerleave', () => { sc._hoverPt = null; redraw(); });
    sc.addEventListener('click', () => { if (sc._hoverPt) this.app.select(sc._hoverPt.ref); });
    const tree = $('#treeCanvas');
    tree.addEventListener('click', e => {
      const rows = tree._rows || [];
      const r = rows.find(r => Math.abs(r.y - e.offsetY) < 8);
      if (r) this.toggleHighlight(r.id);
    });
    $('#treeMin').onchange = () => this.drawTree();
    $('#showExtinct').onchange = () => this.drawSpecies();
  }

  drawCharts() {
    const sim = this.app.sim, H = sim.history, yl = sim.cfg.yearLength;
    const xs = H.map(r => r.t / yl);
    lineChart($('#chartPop'), {
      xs, yMin: 0,
      series: [
        { label: 'Roślinożercy', color: SERIES_COLORS.herb, values: H.map(r => r.herb) },
        { label: 'Wszystkożercy', color: SERIES_COLORS.omni, values: H.map(r => r.omni) },
        { label: 'Mięsożercy', color: SERIES_COLORS.carn, values: H.map(r => r.carn) },
      ],
      fmt: v => v.toFixed(0),
    });
    const sel = $('#traitSelect').value;
    const [kind, key] = sel.split(':');
    if (kind === 'w') {
      lineChart($('#chartTrait'), { xs, series: [{ label: 'Odchylenie', color: '#4fd1c5', values: H.map(r => r.temp) }], unit: '°C' });
    } else {
      const src = kind === 'c' ? 'traits' : 'ptraits';
      const def = (kind === 'c' ? TRAITS : PLANT_TRAITS).find(d => d.key === key);
      const mean = H.map(r => r[src][key] ? r[src][key][0] : NaN);
      const sd = H.map(r => r[src][key] ? r[src][key][1] : NaN);
      lineChart($('#chartTrait'), {
        xs,
        series: [{ label: 'Średnia', color: '#4fd1c5', values: mean, band: [mean.map((m, i) => m - sd[i]), mean.map((m, i) => m + sd[i])] }],
        unit: def.unit || '',
      });
    }
    lineChart($('#chartPlants'), { xs, yMin: 0, series: [{ label: 'Rośliny', color: '#4fd1c5', values: H.map(r => r.plants) }], fmt: v => v.toFixed(0) });
    lineChart($('#chartSpecies'), { xs, yMin: 0, series: [{ label: 'Gatunki', color: '#a78bfa', values: H.map(r => r.species) }], fmt: v => v.toFixed(0) });
    const dx = TRAIT_MAP[$('#scatterX').value], dy = TRAIT_MAP[$('#scatterY').value];
    scatterChart($('#chartScatter'), {
      xr: [dx.min, dx.max], yr: [dy.min, dy.max], xLabel: dx.name, yLabel: dy.name,
      points: sim.creatures.map(c => {
        const s = sim.species.get(c.sp);
        return { x: c.g.t[dx.key], y: c.g.t[dy.key], color: `hsl(${s ? s.hue : 0},80%,62%)`, label: `${s ? s.name : '?'} #${c.id}`, ref: c, sel: c === this.app.selected };
      }),
    });
  }

  // ---------- Gatunki ----------
  toggleHighlight(id) {
    const r = this.app.renderer;
    r.highlightSpecies = r.highlightSpecies === id ? null : id;
    this.drawSpecies(); this.drawTree();
  }
  drawSpecies() {
    const sim = this.app.sim, hl = this.app.renderer.highlightSpecies;
    const showExt = $('#showExtinct').checked;
    let list = [...sim.species.map.values()].filter(s => s.extinct === null || (showExt && s.peak >= 2));
    list.sort((a, b) => (b.extinct === null) - (a.extinct === null) || b.count - a.count || b.peak - a.peak);
    list = list.slice(0, 80);
    const yl = sim.cfg.yearLength;
    $('#speciesList').innerHTML = list.length ? list.map(s => {
      const m = s.means || {};
      const age = ((s.extinct ?? sim.tick) - s.born) / yl;
      const dc = DIET_NAMES[dietClass(m.diet ?? 0)];
      return `<div class="sp-row${hl === s.id ? ' active' : ''}${s.extinct !== null ? ' extinct' : ''}" data-sp="${s.id}">
        <span class="sw" style="background:hsl(${s.hue},80%,62%);box-shadow:0 0 8px hsl(${s.hue},80%,50%)"></span>
        <span class="nm">${esc(s.name)}${s.extinct !== null ? ' †' : ''}</span>
        <span class="cnt">${s.extinct === null ? s.count : 'max ' + s.peak}</span>
        <span class="sub">${dc} · rozm. ${(m.size ?? 0).toFixed(1)} · pręd. ${(m.speed ?? 0).toFixed(2)} · wzrok ${(m.vision ?? 0).toFixed(0)} · ${(m.tempOpt ?? 0).toFixed(0)}°C · ${age.toFixed(1)} lat${s.parent ? ' · od ' + esc(sim.species.get(s.parent)?.name || '?') : ''}</span>
      </div>`;
    }).join('') : '<div class="empty">Brak gatunków.</div>';
    $$('#speciesList [data-sp]').forEach(el => el.onclick = () => this.toggleHighlight(Number(el.dataset.sp)));
  }
  drawTree() {
    treeChart($('#treeCanvas'), this.app.sim, Number($('#treeMin').value), this.app.renderer.highlightSpecies);
  }

  // ---------- Inspektor ----------
  drawInspector(force) {
    const app = this.app, sim = app.sim, el = $('#inspector');
    const s = app.selected;
    const key = s ? (s.g.t ? 'c' : 'p') + s.id : null;
    if (key !== this.selKey || force) {
      this.selKey = key;
      if (!s) { el.innerHTML = '<div class="empty">Kliknij stworka albo roślinę na mapie (narzędzie „Wybierz”).</div>'; return; }
      if (s.g.t) {
        el.innerHTML = `
          <div class="row-flex" style="justify-content:space-between;margin-bottom:6px">
            <div><b id="iName"></b> <span class="muted mono">#${s.id}</span><div class="muted" id="iSub"></div></div>
            <span id="iState" class="chip info" style="pointer-events:none"></span>
          </div>
          <div class="row-flex" style="justify-content:space-between"><span class="dim">Energia</span><span class="mono" id="iE"></span></div>
          <div class="meter"><div id="iEbar" style="background:var(--good)"></div></div>
          <div class="row-flex" style="justify-content:space-between"><span class="dim">Zdrowie</span><span class="mono" id="iH"></span></div>
          <div class="meter"><div id="iHbar" style="background:var(--danger)"></div></div>
          <dl class="kv" id="iKv"></dl>
          <div class="grid3" style="margin:10px 0">
            <button class="btn small" id="iFollow">Śledź</button>
            <button class="btn small" id="iFeed">Nakarm</button>
            <button class="btn small" id="iClone">Klonuj</button>
            <button class="btn small" id="iExport">Eksportuj</button>
            <button class="btn small" id="iCreator">Do kreatora</button>
            <button class="btn small danger" id="iKill">Zabij</button>
          </div>
          <h3>Geny</h3><div id="iTraits"></div>
          <h3>Mózg (na żywo)</h3>
          <p class="note">Niebieskozielone połączenia pobudzają, czerwone hamują. Kolor węzła pokazuje aktywację.</p>
          <canvas id="iBrain" style="width:100%;display:block"></canvas>`;
        $('#iFollow').onclick = () => { app.follow = !app.follow; this.drawInspector(); };
        $('#iFeed').onclick = () => { s.energy = s.maxE; s.hp = s.maxHp; s.infected = 0; };
        $('#iClone').onclick = () => {
          if (sim.creatures.length >= sim.cfg.maxCreatures) { this.toast('Populacja jest pełna.'); return; }
          const c = sim.spawnCreature(cloneGenome(s.g), s.x + 10, s.y + 10, { speciesId: s.sp, direct: true, gen: s.gen, energy: 0.8 });
          sim.addFx('spawn', c.x, c.y, {});
        };
        $('#iExport').onclick = () => {
          const sp = sim.species.get(s.sp);
          downloadJSON({ format: 'ewosym-genome', name: sp ? sp.name : 'stworek', genome: serializeGenome(s.g) }, `genom-${(sp ? sp.name : 'stworek').replace(/\s+/g, '_')}.json`);
        };
        $('#iCreator').onclick = () => { $('#creatorFromSelected').click(); this.showTab($('#left'), 'creator'); if (window.innerWidth <= 1100) $('#left').classList.add('open'); };
        $('#iKill').onclick = () => { sim.kill(s, 'god'); };
      } else {
        el.innerHTML = `<div style="margin-bottom:6px"><b>Roślina</b> <span class="muted mono">#${s.id}</span></div>
          <div class="row-flex" style="justify-content:space-between"><span class="dim">Energia</span><span class="mono" id="iE"></span></div>
          <div class="meter"><div id="iEbar" style="background:var(--good)"></div></div>
          <dl class="kv" id="iKv"></dl><h3>Geny</h3><div id="iTraits"></div>`;
      }
    }
    if (!s) return;
    if (s.g.t) this.updateCreatureInspector(s);
    else this.updatePlantInspector(s);
  }

  traitBars(defs, vals) {
    return defs.map(d => {
      const v = vals[d.key];
      const pos = clamp((v - d.min) / (d.max - d.min), 0, 1) * 100;
      return `<div class="trait-row" title="${esc(d.desc || '')}"><span>${esc(d.name)}</span><span class="v">${fmtTrait(d, v)}</span>
        <div class="bar"><div style="left:calc(${pos}% - 1.5px)"></div></div></div>`;
    }).join('');
  }

  updateCreatureInspector(c) {
    const sim = this.app.sim, yl = sim.cfg.yearLength, t = c.g.t;
    const sp = sim.species.get(c.sp);
    $('#iName').innerHTML = `<span style="color:hsl(${sp ? sp.hue : 0},80%,65%)">●</span> ${esc(sp ? sp.name : '?')}`;
    $('#iSub').textContent = `${DIET_NAMES[dietClass(t.diet)]} · pokolenie ${c.gen}`;
    const st = c.dead ? `nie żyje: ${DEATH_CAUSES[c.cause] || c.cause}` : c.infected ? 'chory' : c.attacking ? 'atakuje' : c.ready ? 'szuka partnera' : c.age < sim.cfg.maturity * t.lifespan * yl ? 'młody' : 'dorosły';
    $('#iState').textContent = st;
    $('#iE').textContent = `${Math.max(0, c.energy).toFixed(0)} / ${c.maxE.toFixed(0)}`;
    $('#iEbar').style.width = clamp(c.energy / c.maxE * 100, 0, 100) + '%';
    $('#iH').textContent = `${Math.max(0, c.hp).toFixed(0)} / ${c.maxHp.toFixed(0)}`;
    $('#iHbar').style.width = clamp(c.hp / c.maxHp * 100, 0, 100) + '%';
    $('#iKv').innerHTML = [
      ['Wiek', `${(c.age / yl).toFixed(2)} / ${(t.lifespan * c.ageVar).toFixed(2)} lat`],
      ['Dzieci', c.children], ['Zabójstwa', c.kills],
      ['Zjedzone rośliny', c.eatenPlant.toFixed(0)], ['Zjedzone mięso', c.eatenMeat.toFixed(0)],
      ['Temperatura tu / optymalna', `${c.localT.toFixed(1)} / ${t.tempOpt.toFixed(1)}°C`],
      ['Prędkość teraz', c.speedNow.toFixed(2)],
      ['Rodzice', c.parents.length ? c.parents.map(p => '#' + p).join(', ') : '—'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#iFollow').textContent = this.app.follow ? 'Nie śledź' : 'Śledź';
    $('#iTraits').innerHTML = this.traitBars(TRAITS, t);
    brainChart($('#iBrain'), c);
  }
  updatePlantInspector(p) {
    const yl = this.app.sim.cfg.yearLength;
    $('#iE').textContent = `${p.energy.toFixed(1)} / ${p.g.maxE.toFixed(1)}`;
    $('#iEbar').style.width = clamp(p.energy / p.g.maxE * 100, 0, 100) + '%';
    $('#iKv').innerHTML = `<dt>Wiek</dt><dd>${(p.age / yl).toFixed(2)} lat</dd><dt>Stan</dt><dd>${p.dead ? 'obumarła' : 'żyje'}</dd>`;
    $('#iTraits').innerHTML = this.traitBars(PLANT_TRAITS, p.g);
  }

  // ---------- Kronika ----------
  drawLog() {
    const sim = this.app.sim, yl = sim.cfg.yearLength;
    barChart($('#chartDeaths'), Object.entries(DEATH_CAUSES).map(([k, label]) => ({ label, value: sim.deaths[k] || 0, color: '#4fd1c5' })));
    $('#eventLog').innerHTML = sim.events.slice().reverse().map(e => `<div class="${e.kind}"><time>r. ${(e.tick / yl).toFixed(2)}</time>${esc(e.text)}</div>`).join('');
  }

  // ---------- Toasty i chipy ----------
  toast(text, kind = '') {
    const wrap = $('#toasts');
    while (wrap.children.length >= 4) wrap.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    wrap.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }
  pollEvents() {
    const sim = this.app.sim;
    const ev = sim.events;
    const last = ev.length ? ev[ev.length - 1] : null;
    if (!last || last === this.lastEventObj) return;
    let i = ev.length - 1;
    while (i > 0 && ev[i - 1] !== this.lastEventObj) i--;
    if (!ev.includes(this.lastEventObj)) i = Math.max(0, ev.length - 3);
    const fresh = ev.slice(i);
    this.lastEventObj = last;
    if (this.app.ff || this.app.speed > 100) return;
    for (const e of fresh.slice(-3)) if (e.kind !== 'info') this.toast(e.text, e.kind);
  }
  drawChips() {
    const app = this.app, sim = app.sim, yl = sim.cfg.yearLength;
    const chips = sim.disasters.map(d => `<span class="chip">${esc(DISASTERS[d.type].name)} · ${((d.end - sim.tick) / yl).toFixed(1)} r.</span>`);
    if (!app.running) chips.unshift('<span class="chip info">PAUZA</span>');
    if (app.follow && app.selected && !app.selected.dead) chips.push('<span class="chip info">śledzenie</span>');
    if (app.renderer.highlightSpecies !== null) {
      const s = sim.species.get(app.renderer.highlightSpecies);
      if (s) chips.push(`<span class="chip info">podświetlony: ${esc(s.name)}</span>`);
    }
    const html = chips.join('');
    if (html !== this._chips) { $('#chips').innerHTML = html; this._chips = html; }
  }
  drawTop(tps) {
    const sim = this.app.sim;
    $('#sYear').textContent = sim.year.toFixed(2);
    $('#sSeason').textContent = sim.seasonName;
    const off = sim.tempOffset;
    $('#sTempL').textContent = `temp. ${off >= 0 ? '+' : ''}${off.toFixed(1)}°C`;
    $('#sPop').textContent = `${sim.creatures.length}/${sim.cfg.maxCreatures}`;
    $('#sPlants').textContent = sim.plants.length;
    $('#sSpecies').textContent = sim.species.alive().filter(s => s.count > 0).length;
    $('#sGen').textContent = sim.maxGen;
    $('#sTps').textContent = Math.round(tps);
  }

  // ---------- Okresowe odświeżanie ----------
  update(now, tps) {
    const T = this.timers;
    const due = (k, ms) => { if (now - T[k] >= ms) { T[k] = now; return true; } return false; };
    if (due('top', 200)) { this.drawTop(tps); this.drawChips(); this.pollEvents(); }
    const right = this.activeTab('right');
    const hidden = window.innerWidth <= 1100 && !$('#right').classList.contains('open');
    if (hidden) return;
    if (right === 'charts' && due('charts', 500)) this.drawCharts();
    if (right === 'species' && due('species', 1000)) this.drawSpecies();
    if (right === 'tree' && due('tree', 1500)) this.drawTree();
    if (right === 'inspect' && due('inspect', 150)) this.drawInspector();
    if (right === 'log' && due('log', 1000)) this.drawLog();
  }

  // ---------- Nowy świat ----------
  buildWorldModal() {
    const fields = [
      { key: 'seed', label: 'Ziarno (puste = losowe)', type: 'text' },
      { key: 'brain', label: 'Mózgi na start', type: 'select', options: [['instinct', 'Instynkt'], ['random', 'Losowe']] },
      { key: 'waterLevel', label: 'Poziom wody', min: 0.15, max: 0.6, step: 0.01 },
      { key: 'mountains', label: 'Góry', min: 0, max: 1.5, step: 0.05 },
      { key: 'tempNorth', label: 'Temperatura na północy (°C)', min: -30, max: 30, step: 1 },
      { key: 'tempSouth', label: 'Temperatura na południu (°C)', min: 0, max: 50, step: 1 },
      { key: 'initialCreatures', label: 'Startowa liczba stworków', min: 2, max: 100, step: 1 },
      { key: 'initialPlants', label: 'Startowa liczba roślin', min: 50, max: 1500, step: 10 },
      { key: 'initialDiet', label: 'Startowa mięsożerność', min: 0, max: 1, step: 0.01 },
      { key: 'carnivoreShare', label: 'Udział drapieżników na start', min: 0, max: 0.6, step: 0.01 },
      { key: 'diversity', label: 'Startowa różnorodność genów', min: 0, max: 1.5, step: 0.05 },
    ];
    this.worldOpts = Object.assign({}, DEFAULT_WORLD_OPTS, { seed: '' });
    const root = $('#worldFields');
    const render = () => {
      root.innerHTML = '';
      for (const f of fields) {
        if (f.type === 'text') {
          const d = document.createElement('div'); d.className = 'field';
          d.innerHTML = `<div class="row"><label>${esc(f.label)}</label></div><input type="text" style="width:100%" value="${esc(this.worldOpts.seed || '')}">`;
          $('input', d).oninput = e => { this.worldOpts.seed = e.target.value; };
          root.appendChild(d);
        } else if (f.type === 'select') {
          const d = document.createElement('div'); d.className = 'field';
          d.innerHTML = `<div class="row"><label>${esc(f.label)}</label></div><select style="width:100%">${f.options.map(([v, l]) => `<option value="${v}"${this.worldOpts[f.key] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
          $('select', d).onchange = e => { this.worldOpts[f.key] = e.target.value; };
          root.appendChild(d);
        } else root.appendChild(this.field(f, this.worldOpts));
      }
    };
    const PRESETS = [
      ['Domyślny', {}],
      ['Archipelag', { waterLevel: 0.5, mountains: 0.3 }],
      ['Superkontynent', { waterLevel: 0.22, mountains: 0.8 }],
      ['Mroźny świat', { tempNorth: -22, tempSouth: 12 }],
      ['Tropiki', { tempNorth: 16, tempSouth: 42 }],
      ['Drapieżnicy', { carnivoreShare: 0.3, initialCreatures: 60 }],
      ['Czysta ewolucja', { brain: 'random', diversity: 1.2, initialCreatures: 70 }],
    ];
    $('#presets').innerHTML = PRESETS.map(([n], i) => `<button class="btn small" data-preset="${i}">${esc(n)}</button>`).join('');
    $('#presets').onclick = e => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      this.worldOpts = Object.assign({}, DEFAULT_WORLD_OPTS, { seed: '' }, PRESETS[Number(b.dataset.preset)][1]);
      render();
    };
    render();
    $('#createWorld').onclick = () => {
      const o = Object.assign({}, this.worldOpts);
      const seedNum = Number(o.seed);
      o.seed = o.seed === '' ? 0 : Number.isFinite(seedNum) && seedNum ? seedNum : [...String(o.seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      this.app.newWorld(o);
      $('#newModal').classList.remove('open');
    };
  }

  bindMisc() {
    $$('.modal-bg').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('open'); }));
    $('#newBtn').onclick = () => $('#newModal').classList.add('open');
    $('#helpBtn').onclick = () => $('#helpModal').classList.add('open');
    $('#toggleLeft').onclick = () => { $('#left').classList.toggle('open'); $('#right').classList.remove('open'); };
    $('#toggleRight').onclick = () => { $('#right').classList.toggle('open'); $('#left').classList.remove('open'); };
  }

  onNewWorld() {
    this.selKey = null;
    this.lastEventObj = null;
    this.syncParams();
    this.drawInspector(true);
    for (const k in this.timers) this.timers[k] = 0;
  }
}
