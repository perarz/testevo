// Śledzenie gatunków: centroidy genetyczne, narodziny i wymieranie gatunków.
import { VEC_LEN, TRAITS, distVec } from './genome.js';
import { speciesName, rand } from './util.js';

export class SpeciesTracker {
  constructor() {
    this.map = new Map();
    this.nextId = 1;
  }

  alive() { return [...this.map.values()].filter(s => s.extinct === null); }
  get(id) { return this.map.get(id); }

  pickHue(near) {
    const used = this.alive().map(s => s.hue);
    let best = rand(0, 360), bestD = -1;
    for (let k = 0; k < 12; k++) {
      const h = near !== undefined && k < 4 ? (near + rand(40, 320)) % 360 : rand(0, 360);
      let d = 360;
      for (const u of used) { const x = Math.abs(h - u); d = Math.min(d, Math.min(x, 360 - x)); }
      if (d > bestD) { bestD = d; best = h; }
    }
    return Math.round(best);
  }

  create(parent, vec, tick, traits) {
    const s = {
      id: this.nextId++,
      name: speciesName(),
      hue: this.pickHue(parent ? parent.hue : undefined),
      parent: parent ? parent.id : null,
      born: tick,
      extinct: null,
      count: 0,
      peak: 0,
      total: 0,
      centroid: new Float32Array(vec),
      means: Object.assign({}, traits),
    };
    this.map.set(s.id, s);
    this.created = s;
    return s;
  }

  // Zwraca gatunek dla nowego genomu: gatunek rodzica, jeśli jest blisko, albo nowy.
  assign(vec, candidates, tick, threshold, traits) {
    let best = null, bestD = Infinity;
    for (const s of candidates) {
      if (!s || !s.centroid) continue;
      const d = distVec(vec, s.centroid);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best && bestD < threshold) return { sp: best, isNew: false };
    return { sp: this.create(candidates[0] || null, vec, tick, traits), isNew: true };
  }

  update(creatures, tick) {
    const acc = new Map();
    for (const c of creatures) {
      if (c.dead) continue;
      let a = acc.get(c.sp);
      if (!a) { a = { n: 0, v: new Float64Array(VEC_LEN) }; acc.set(c.sp, a); }
      a.n++;
      for (let i = 0; i < VEC_LEN; i++) a.v[i] += c.vec[i];
    }
    const extinctNow = [];
    for (const s of this.map.values()) {
      if (s.extinct !== null) continue;
      const a = acc.get(s.id);
      if (!a) {
        s.count = 0;
        if (tick - s.born > 5) { s.extinct = tick; s.centroid = null; extinctNow.push(s); }
        continue;
      }
      s.count = a.n;
      if (a.n > s.peak) s.peak = a.n;
      for (let i = 0; i < VEC_LEN; i++) s.centroid[i] = a.v[i] / a.n;
      for (let i = 0; i < TRAITS.length; i++) {
        const d = TRAITS[i];
        s.means[d.key] = d.min + s.centroid[i] * (d.max - d.min);
      }
    }
    return extinctNow;
  }

  serialize() {
    return {
      nextId: this.nextId,
      list: [...this.map.values()].map(s => ({ ...s, centroid: s.centroid ? Array.from(s.centroid) : null })),
    };
  }
  static deserialize(o) {
    const t = new SpeciesTracker();
    t.nextId = o.nextId;
    for (const s of o.list) t.map.set(s.id, { ...s, centroid: s.centroid ? new Float32Array(s.centroid) : null });
    return t;
  }
}
