// Rysowanie świata na canvasie: teren, rośliny, mięso, stworki, efekty.
import { BIOMES, CELL } from './terrain.js';
import { WORLD_W, WORLD_H } from './sim.js';
import { TRAIT_MAP } from './genome.js';
import { clamp, lerp, TAU, makeNoise, mulberry32 } from './util.js';

const TEX_SCALE = 6; // pikseli tekstury na komórkę terenu

export const COLOR_MODES = [
  { key: 'species', name: 'Gatunek' },
  { key: 'diet', name: 'Dieta' },
  { key: 'size', name: 'Rozmiar', trait: true },
  { key: 'speed', name: 'Prędkość', trait: true },
  { key: 'vision', name: 'Wzrok', trait: true },
  { key: 'fov', name: 'Pole widzenia', trait: true },
  { key: 'tempOpt', name: 'Optymalna temp.', trait: true },
  { key: 'fertility', name: 'Płodność', trait: true },
  { key: 'toxRes', name: 'Odporność na toksyny', trait: true },
  { key: 'lifespan', name: 'Długość życia', trait: true },
  { key: 'mutRate', name: 'Tempo mutacji', trait: true },
  { key: 'choosy', name: 'Wybredność', trait: true },
  { key: 'care', name: 'Opieka nad młodymi', trait: true },
  { key: 'hue', name: 'Ubarwienie' },
  { key: 'sex', name: 'Płeć' },
  { key: 'age', name: 'Wiek' },
  { key: 'energy', name: 'Energia' },
  { key: 'gen', name: 'Pokolenie' },
];

// Skala sekwencyjna dla wartości 0..1 (od chłodnego błękitu do ciepłego bursztynu).
export function seqColor(n, a = 1) {
  n = clamp(n, 0, 1);
  const h = lerp(215, 38, n), s = lerp(70, 90, n), l = lerp(48, 62, n);
  return `hsla(${h},${s}%,${l}%,${a})`;
}
export function dietColor(d, a = 1) { return `hsla(${lerp(140, 8, d)},80%,${lerp(52, 58, d)}%,${a})`; }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
    this.tex = document.createElement('canvas');
    this.texKey = '';
    this.particles = [];
    this.colorMode = 'species';
    this.mapMode = 'biome';
    this.showVision = false;
    this.highlightSpecies = null;
    this.selected = null;
    this.hover = null;
    this.brush = null;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  fit() {
    this.cam.x = WORLD_W / 2; this.cam.y = WORLD_H / 2;
    this.cam.zoom = Math.min(this.w / WORLD_W, this.h / WORLD_H) * 0.98;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.cam.zoom + this.cam.x, y: (sy - this.h / 2) / this.cam.zoom + this.cam.y };
  }
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * factor, 0.2, 12);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }
  pan(dx, dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; }

  // ---------- Tekstura terenu ----------
  buildTerrain(sim) {
    const T = sim.terrain;
    const tq = Math.round(sim.tempOffset / 1.5);
    const key = `${T.version}|${this.mapMode}|${tq}|${this.mapMode === 'fert' ? Math.round(sim.fertMul * 10) + '|' + Math.floor(sim.tick / 300) : ''}`;
    if (key === this.texKey) return;
    this.texKey = key;
    const W = T.cols * TEX_SCALE, H = T.rows * TEX_SCALE;
    if (this.tex.width !== W || this.tex.height !== H) { this.tex.width = W; this.tex.height = H; }
    // zniekształcenie siatki szumem, żeby granice biomów były organiczne, a nie kwadratowe
    if (this.warpSeed !== T.seed || !this.warp || this.warp.length !== W * H) {
      this.warpSeed = T.seed;
      const nx = makeNoise(mulberry32(T.seed + 11)), ny = makeNoise(mulberry32(T.seed + 23));
      this.warp = new Int32Array(W * H);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const u = px / TEX_SCALE, v = py / TEX_SCALE;
        const wx = clamp(Math.floor(u + (nx(u * 0.7, v * 0.7, 3) - 0.5) * 1.6), 0, T.cols - 1);
        const wy = clamp(Math.floor(v + (ny(u * 0.7 + 5, v * 0.7, 3) - 0.5) * 1.6), 0, T.rows - 1);
        this.warp[py * W + px] = wy * T.cols + wx;
      }
    }
    const tctx = this.tex.getContext('2d');
    const img = tctx.createImageData(W, H);
    const d = img.data;
    const off = tq * 1.5;
    const wl = T.opts.waterLevel;
    for (let py = 0; py < H; py++) {
      const fy = (py + 0.5) / TEX_SCALE - 0.5;
      const cy0 = clamp(Math.floor(fy), 0, T.rows - 1), cy1 = Math.min(cy0 + 1, T.rows - 1), ty = clamp(fy - cy0, 0, 1);
      for (let px = 0; px < W; px++) {
        const fx = (px + 0.5) / TEX_SCALE - 0.5;
        const cx0 = clamp(Math.floor(fx), 0, T.cols - 1), cx1 = Math.min(cx0 + 1, T.cols - 1), tx = clamp(fx - cx0, 0, 1);
        const ci = this.warp[py * W + px];
        const i00 = cy0 * T.cols + cx0, i10 = cy0 * T.cols + cx1, i01 = cy1 * T.cols + cx0, i11 = cy1 * T.cols + cx1;
        const e = lerp(lerp(T.elev[i00], T.elev[i10], tx), lerp(T.elev[i01], T.elev[i11], tx), ty);
        const b = BIOMES[T.biome[ci]];
        let r, g, bl;
        if (this.mapMode === 'temp') {
          const temp = T.baseT[ci] - Math.max(0, T.elev[ci] - wl) * 20 + off;
          const n = clamp((temp + 15) / 60, 0, 1);
          // rozbieżna skala: niebieski — szary — czerwony
          if (n < 0.5) { const k = n / 0.5; r = lerp(40, 70, k); g = lerp(90, 72, k); bl = lerp(170, 72, k); }
          else { const k = (n - 0.5) / 0.5; r = lerp(70, 190, k); g = lerp(72, 60, k); bl = lerp(72, 45, k); }
          if (!b.pass) { r *= 0.4; g *= 0.4; bl *= 0.4; }
        } else if (this.mapMode === 'fert') {
          // żyzność biomu × składniki odżywcze w glebie (odchody i rozkładające się ciała)
          const f = clamp(b.fert * sim.fertMul * (0.35 + 0.65 * Math.min(sim.nutr[ci], 2)) / 1.8, 0, 1);
          r = lerp(22, 40, f); g = lerp(24, 150, f); bl = lerp(28, 70, f);
          if (b.water) { r *= 0.7; g *= 0.8; bl = bl * 0.8 + 40; }
        } else {
          [r, g, bl] = b.color;
          const shade = b.water ? 0.75 + (e - wl + 0.1) * 2.2 : 0.82 + (e - wl) * 0.9;
          r *= shade; g *= shade; bl *= shade;
          // śnieg i lód, gdy jest zimno
          const temp = T.baseT[ci] - Math.max(0, T.elev[ci] - wl) * 20 + off;
          if (temp < 0 && b.pass) {
            const k = clamp(-temp / 10, 0, 1) * (b.water ? 0.55 : 0.6);
            const sr = b.water ? 95 : 140, sg = b.water ? 125 : 152, sb = b.water ? 150 : 168;
            r = lerp(r, sr, k); g = lerp(g, sg, k); bl = lerp(bl, sb, k);
          }
        }
        const k = (py * W + px) * 4;
        d[k] = r; d[k + 1] = g; d[k + 2] = bl; d[k + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
  }

  // ---------- Kolor stworka ----------
  creatureColor(c, sim, a = 1) {
    const t = c.g.t;
    switch (this.colorMode) {
      case 'species': { const s = sim.species.get(c.sp); return `hsla(${s ? s.hue : 0},85%,62%,${a})`; }
      case 'diet': return dietColor(t.diet, a);
      case 'hue': return `hsla(${t.hue},85%,62%,${a})`;
      case 'sex': return c.sex === 1 ? `hsla(330,80%,68%,${a})` : `hsla(205,85%,62%,${a})`;
      case 'age': return seqColor(c.age / (t.lifespan * sim.cfg.yearLength), a);
      case 'energy': return `hsla(${lerp(0, 130, c.energy / c.maxE)},80%,55%,${a})`;
      case 'gen': return seqColor(sim.maxGen ? c.gen / sim.maxGen : 0, a);
      default: {
        const d = TRAIT_MAP[this.colorMode];
        return seqColor((t[d.key] - d.min) / (d.max - d.min), a);
      }
    }
  }

  ingestFx(sim) {
    const now = performance.now();
    for (const f of sim.fx) {
      if (this.particles.length > 120) this.particles.shift();
      this.particles.push(Object.assign({ born: now }, f));
    }
    sim.fx.length = 0;
  }

  // ---------- Klatka ----------
  draw(sim) {
    const ctx = this.ctx, z = this.cam.zoom, dpr = this.dpr;
    this.buildTerrain(sim);
    this.ingestFx(sim);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - this.cam.x * z), dpr * (this.h / 2 - this.cam.y * z));

    // teren
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tex, 0, 0, sim.terrain.cols * CELL, sim.terrain.rows * CELL);
    ctx.strokeStyle = 'rgba(79,209,197,0.25)';
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    const view = this.toWorld(0, 0), view2 = this.toWorld(this.w, this.h);
    const inView = (x, y, m) => x > view.x - m && x < view2.x + m && y > view.y - m && y < view2.y + m;

    // rośliny
    for (const p of sim.plants) {
      if (!inView(p.x, p.y, 10)) continue;
      const g = p.g;
      const hue = lerp(lerp(105, 170, g.water), 290, g.tox * g.tox);
      const fill = clamp(p.energy / g.maxE, 0, 1);
      const r = 1.1 + Math.sqrt(Math.max(0, p.energy)) * 0.42;
      ctx.fillStyle = `hsla(${hue},${55 + g.tox * 25}%,${30 + fill * 22}%,0.9)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    }
    // mięso
    ctx.fillStyle = 'rgba(200,70,70,0.85)';
    for (const m of sim.meat) {
      if (!inView(m.x, m.y, 10)) continue;
      const r = 1.2 + Math.sqrt(m.energy) * 0.3;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
    }

    // płynne przejście między krokami symulacji przy wolnych prędkościach
    const a = clamp(this.alpha ?? 1, 0, 1);
    for (const c of sim.creatures) {
      c.rx = c.px === undefined ? c.x : c.px + (c.x - c.px) * a;
      c.ry = c.py === undefined ? c.y : c.py + (c.y - c.py) * a;
    }

    // zaznaczony: wzrok
    const sel = this.selected && !this.selected.dead ? this.selected : null;
    if (this.showVision || sel) {
      ctx.lineWidth = 1 / z;
      for (const c of sim.creatures) {
        if (!(this.showVision || c === sel)) continue;
        if (!inView(c.rx, c.ry, c.g.t.vision)) continue;
        ctx.strokeStyle = c === sel ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
        ctx.setLineDash(c === sel ? [4 / z, 4 / z] : []);
        ctx.beginPath(); ctx.arc(c.rx, c.ry, c.g.t.vision * sim.terrain.at(c.rx, c.ry).vision, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // linia rodzic — karmione młode
    ctx.strokeStyle = 'rgba(255,150,210,0.6)';
    ctx.lineWidth = 1 / z;
    for (const c of sim.creatures) {
      if (!c.beingFed || sim.tick - c.beingFed > 10 || !c.parents.length) continue;
      const p = sim.byId.get(c.parents[0]) || sim.byId.get(c.parents[1]);
      if (!p) continue;
      ctx.beginPath(); ctx.moveTo(c.rx, c.ry); ctx.lineTo(p.rx ?? p.x, p.ry ?? p.y); ctx.stroke();
    }

    // stworki — poświata
    const hl = this.highlightSpecies;
    ctx.globalCompositeOperation = 'lighter';
    for (const c of sim.creatures) {
      if (!inView(c.rx, c.ry, 40)) continue;
      const dim = hl !== null && c.sp !== hl;
      if (dim) continue;
      const gr = ctx.createRadialGradient(c.rx, c.ry, c.r * 0.4, c.rx, c.ry, c.r * 2.8);
      gr.addColorStop(0, this.creatureColor(c, sim, 0.38));
      gr.addColorStop(1, this.creatureColor(c, sim, 0));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r * 2.8, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // stworki — ciało
    const now = performance.now();
    for (const c of sim.creatures) {
      if (!inView(c.rx, c.ry, 20)) continue;
      const dim = hl !== null && c.sp !== hl;
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = this.creatureColor(c, sim, 1);
      ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r, 0, TAU); ctx.fill();
      // ciemny środek pokazuje poziom energii
      const ef = clamp(c.energy / c.maxE, 0, 1);
      ctx.fillStyle = 'rgba(5,8,12,0.55)';
      ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r * 0.55 * (1 - ef), 0, TAU); ctx.fill();
      // obwódka diety
      const d = c.g.t.diet;
      if (d > 0.33) {
        ctx.strokeStyle = d > 0.66 ? 'rgba(255,90,60,0.95)' : 'rgba(255,170,60,0.85)';
        ctx.lineWidth = Math.max(1, c.r * 0.22);
        ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r + ctx.lineWidth * 0.5, 0, TAU); ctx.stroke();
      }
      // oko w kierunku ruchu
      const ex = c.rx + Math.cos(c.angle) * c.r * 0.62, ey = c.ry + Math.sin(c.angle) * c.r * 0.62;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.arc(ex, ey, Math.max(0.9, c.r * 0.24), 0, TAU); ctx.fill();
      if (c.attacking) {
        ctx.strokeStyle = 'rgba(255,60,60,0.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r + 3, c.angle - 0.6, c.angle + 0.6); ctx.stroke();
      }
      if (c.hurt && sim.tick - c.hurt < 8) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r + 1.5, 0, TAU); ctx.stroke();
      }
      if (c.infected) {
        ctx.strokeStyle = 'rgba(190,120,255,0.9)'; ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(c.rx, c.ry, c.r + 3.5, (now / 400) % TAU, (now / 400) % TAU + TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (c.ready && z > 1.4) {
        ctx.fillStyle = 'rgba(255,120,200,0.9)';
        ctx.beginPath(); ctx.arc(c.rx, c.ry - c.r - 3, 1.3, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // zaznaczenie
    if (sel) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 / z;
      const pr = sel.r + 5 + Math.sin(now / 200) * 1.5;
      ctx.beginPath(); ctx.arc(sel.rx, sel.ry, pr, 0, TAU); ctx.stroke();
    } else if (this.selected && this.selected.g && this.selected.g.maxE !== undefined && !this.selected.dead) {
      const p = this.selected;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); ctx.stroke();
    }
    if (this.hover && this.hover !== sel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.arc(this.hover.rx, this.hover.ry, this.hover.r + 3, 0, TAU); ctx.stroke();
    }

    // efekty
    this.particles = this.particles.filter(p => now - p.born < (p.type === 'meteor' ? 1600 : 700));
    for (const p of this.particles) {
      const k = (now - p.born) / (p.type === 'meteor' ? 1600 : 700);
      ctx.lineWidth = 1.5 / Math.max(0.6, z);
      if (p.type === 'birth') {
        ctx.strokeStyle = `hsla(${p.hue},90%,75%,${1 - k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 + k * 18, 0, TAU); ctx.stroke();
      } else if (p.type === 'death') {
        ctx.strokeStyle = p.cause === 'predation' ? `rgba(255,70,70,${1 - k})` : `rgba(180,190,200,${0.8 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 1.5), 0, TAU); ctx.stroke();
      } else if (p.type === 'spawn') {
        ctx.strokeStyle = `rgba(79,209,197,${1 - k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 + k * 22, 0, TAU); ctx.stroke();
      } else if (p.type === 'smite') {
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
        ctx.lineWidth = 3 / z;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.6), 0, TAU); ctx.stroke();
      } else if (p.type === 'meteor') {
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * (0.6 + k));
        gr.addColorStop(0, `rgba(255,220,150,${0.9 * (1 - k)})`);
        gr.addColorStop(0.5, `rgba(255,120,40,${0.6 * (1 - k)})`);
        gr.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + k), 0, TAU); ctx.fill();
      }
    }

    // pędzel narzędzia
    if (this.brush) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.beginPath(); ctx.arc(this.brush.x, this.brush.y, this.brush.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
