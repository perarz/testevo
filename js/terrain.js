// Teren: siatka biomów z wysokością, wilgotnością i temperaturą bazową.
import { mulberry32, makeNoise, clamp } from './util.js';

export const BIOMES = [
  { id: 0, name: 'Głęboka woda', hue: 210, color: [11, 29, 51], fert: 0.3, move: 0.35, cost: 0.6, vision: 1, water: true, pass: true },
  { id: 1, name: 'Płytka woda', hue: 200, color: [18, 52, 79], fert: 0.75, move: 0.6, cost: 0.2, vision: 1, water: true, pass: true },
  { id: 2, name: 'Plaża', hue: 45, color: [74, 68, 48], fert: 0.3, move: 1, cost: 0, vision: 1, water: false, pass: true },
  { id: 3, name: 'Pustynia', hue: 38, color: [92, 74, 42], fert: 0.15, move: 0.95, cost: 0, vision: 1.1, water: false, pass: true },
  { id: 4, name: 'Step', hue: 75, color: [61, 74, 40], fert: 0.6, move: 1, cost: 0, vision: 1.1, water: false, pass: true },
  { id: 5, name: 'Łąka', hue: 120, color: [36, 69, 42], fert: 1.0, move: 1, cost: 0, vision: 1, water: false, pass: true },
  { id: 6, name: 'Las', hue: 140, color: [21, 52, 32], fert: 1.3, move: 0.8, cost: 0.05, vision: 0.6, water: false, pass: true },
  { id: 7, name: 'Tundra', hue: 205, color: [72, 82, 92], fert: 0.35, move: 0.85, cost: 0.05, vision: 1, water: false, pass: true },
  { id: 8, name: 'Góry', hue: 230, color: [58, 58, 66], fert: 0.25, move: 0.55, cost: 0.15, vision: 1.25, water: false, pass: true },
  { id: 9, name: 'Skały (ściana)', hue: 0, color: [26, 26, 30], fert: 0, move: 0, cost: 0, vision: 1, water: false, pass: false },
];

export const CELL = 20;

export class Terrain {
  constructor(w, h, opts = {}) {
    this.w = w; this.h = h;
    this.cols = Math.ceil(w / CELL);
    this.rows = Math.ceil(h / CELL);
    const n = this.cols * this.rows;
    this.biome = new Uint8Array(n);
    this.elev = new Float32Array(n);
    this.moist = new Float32Array(n);
    this.baseT = new Float32Array(n);
    this.version = 0;
    this.generate(opts);
  }

  generate({ seed = Math.floor(Math.random() * 1e9), waterLevel = 0.38, mountains = 0.5, tempNorth = -2, tempSouth = 34 } = {}) {
    this.seed = seed;
    this.opts = { seed, waterLevel, mountains, tempNorth, tempSouth };
    const rng = mulberry32(seed);
    const fe = makeNoise(rng), fm = makeNoise(rng), fr = makeNoise(rng);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const nx = x / 80 * 4.5, ny = y / 50 * 3; // ta sama skala cech terenu niezależnie od rozmiaru mapy
        let e = fe(nx, ny, 5);
        // grzbiety górskie
        const ridge = 1 - Math.abs(fr(nx * 0.8 + 10, ny * 0.8, 4) * 2 - 1);
        e = e * 0.85 + ridge * ridge * 0.35 * mountains;
        // krawędzie świata trochę niżej, żeby był ocean
        const dx = Math.min(x, this.cols - 1 - x) / this.cols, dy = Math.min(y, this.rows - 1 - y) / this.rows;
        const edge = clamp(Math.min(dx, dy) * 8, 0, 1);
        e = e * (0.75 + 0.25 * edge) - (1 - edge) * 0.08;
        this.elev[i] = e;
        this.moist[i] = fm(nx + 3, ny + 7, 4);
        const lat = y / (this.rows - 1);
        this.baseT[i] = tempNorth + (tempSouth - tempNorth) * lat;
      }
    }
    for (let i = 0; i < this.biome.length; i++) this.biome[i] = this.classify(i);
    this.version++;
  }

  classify(i) {
    const { waterLevel: wl } = this.opts;
    const e = this.elev[i], m = this.moist[i];
    if (e < wl - 0.07) return 0;
    if (e < wl) return 1;
    if (e > 0.83) return 9;
    if (e > 0.72) return 8;
    if (e < wl + 0.02) return 2;
    const t = this.baseT[i] - (e - wl) * 20;
    if (t < 6) return 7;
    if (m < 0.38 && t > 18) return 3;
    if (m < 0.46) return 4;
    if (m > 0.6) return 6;
    return 5;
  }

  idx(x, y) {
    const cx = clamp(Math.floor(x / CELL), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / CELL), 0, this.rows - 1);
    return cy * this.cols + cx;
  }
  at(x, y) { return BIOMES[this.biome[this.idx(x, y)]]; }
  // Temperatura bazowa (bez pór roku) uwzględniająca wysokość.
  tempAt(x, y) {
    const i = this.idx(x, y);
    const e = this.elev[i];
    const wl = this.opts.waterLevel;
    return this.baseT[i] - Math.max(0, e - wl) * 20;
  }
  passable(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return BIOMES[this.biome[this.idx(x, y)]].pass;
  }

  paint(x, y, r, biomeId) {
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
      const px = (cx + 0.5) * CELL, py = (cy + 0.5) * CELL;
      if ((px - x) ** 2 + (py - y) ** 2 <= r * r) this.biome[cy * this.cols + cx] = biomeId;
    }
    this.version++;
  }

  randomPassable(filter) {
    for (let k = 0; k < 200; k++) {
      const x = Math.random() * this.w, y = Math.random() * this.h;
      const b = this.at(x, y);
      if (b.pass && (!filter || filter(b))) return { x, y };
    }
    return { x: this.w / 2, y: this.h / 2 };
  }

  serialize() {
    return { opts: this.opts, biome: Array.from(this.biome) };
  }
  static deserialize(w, h, data) {
    const t = new Terrain(w, h, data.opts);
    t.biome.set(data.biome);
    t.version++;
    return t;
  }
}
