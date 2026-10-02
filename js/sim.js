// Rdzeń symulacji. Nie korzysta z DOM, więc da się go uruchomić także w Node.
import { clamp, rand, gauss, chance, pick, angleDiff, Grid, TAU } from './util.js';
import { Terrain, BIOMES } from './terrain.js';
import { think, NI, NH, NO } from './brain.js';
import {
  TRAITS, PLANT_TRAITS, makeGenome, randomizeTraits, defaultTraits, crossover, cloneGenome, mutate,
  toVec, distVec, serializeGenome, deserializeGenome,
  defaultPlantGenome, mutatePlant, randomPlantGenome,
} from './genome.js';
import { SpeciesTracker } from './species.js';

export const WORLD_W = 1600;
export const WORLD_H = 1000;

export const DEATH_CAUSES = {
  starvation: 'Głód',
  cold: 'Zła temperatura',
  age: 'Starość',
  predation: 'Zjedzony/zabity',
  toxin: 'Trucizna',
  disease: 'Choroba',
  meteor: 'Meteoryt',
  god: 'Boska ręka',
};

export const DISASTERS = {
  drought: { name: 'Susza', dur: 0.6, fert: 0.2, desc: 'Rośliny prawie przestają rosnąć.' },
  iceage: { name: 'Epoka lodowcowa', dur: 1.5, temp: -10, desc: 'Świat ochładza się o 10°C.' },
  warming: { name: 'Globalne ocieplenie', dur: 1.5, temp: 9, desc: 'Świat ociepla się o 9°C.' },
  bloom: { name: 'Urodzaj', dur: 0.5, fert: 2.5, desc: 'Rośliny rosną 2,5 raza szybciej.' },
  plague: { name: 'Zaraza roślin', instant: true, desc: 'Ginie połowa roślin.' },
  epidemic: { name: 'Epidemia', instant: true, desc: 'Choroba zakaźna atakuje część stworków.' },
  meteor: { name: 'Meteoryt', instant: true, desc: 'Uderzenie niszczy wszystko w promieniu ok. 130 jednostek.' },
};

export const DEFAULT_WORLD_OPTS = {
  seed: 0,
  waterLevel: 0.38,
  mountains: 0.5,
  tempNorth: -2,
  tempSouth: 34,
  initialCreatures: 40,
  initialPlants: 450,
  initialDiet: 0.1,
  carnivoreShare: 0.1,
  diversity: 0.5,
  brain: 'instinct',
};

export function dietClass(d) { return d < 0.33 ? 0 : d < 0.66 ? 1 : 2; }

export class Sim {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.reset(opts);
  }

  reset(opts = {}) {
    this.opts = Object.assign({}, DEFAULT_WORLD_OPTS, opts);
    if (!this.opts.seed) this.opts.seed = Math.floor(Math.random() * 1e9);
    this.terrain = new Terrain(WORLD_W, WORLD_H, this.opts);
    this.initState();
    for (let i = 0; i < this.opts.initialPlants; i++) this.spawnRandomPlant(true);
    const n = this.opts.initialCreatures;
    for (let i = 0; i < n; i++) {
      const carn = i < Math.round(n * this.opts.carnivoreShare);
      const base = defaultTraits();
      base.diet = carn ? 0.9 : this.opts.initialDiet;
      if (carn) { base.size = 7.5; base.speed = 1.5; base.vision = 120; }
      const t = randomizeTraits(base, this.opts.diversity * (carn ? 0.4 : 1));
      if (carn) t.diet = clamp(t.diet, 0.7, 1);
      const g = makeGenome(t, this.opts.brain);
      const pos = this.terrain.randomPassable(b => !b.water);
      this.spawnCreature(g, pos.x, pos.y, { energy: 0.7, founder: true });
    }
    this.log(`Nowy świat (ziarno ${this.opts.seed}). Startowa populacja: ${n} stworków.`, 'info');
  }

  initState() {
    this.tick = 0;
    this.nextId = 1;
    this.creatures = [];
    this.plants = [];
    this.meat = [];
    this.newborn = [];
    this.newPlants = [];
    this.species = new SpeciesTracker();
    this.events = [];
    this.disasters = [];
    this.history = [];
    this.historyEvery = 30;
    this.genePool = [];
    this.deaths = Object.fromEntries(Object.keys(DEATH_CAUSES).map(k => [k, 0]));
    this.births = 0;
    this.maxGen = 0;
    this.fx = [];
    this.tempOffset = 0;
    this.fertMul = 1;
    this.creatureGrid = new Grid(WORLD_W, WORLD_H, 60);
    this.plantGrid = new Grid(WORLD_W, WORLD_H, 40);
    this.meatGrid = new Grid(WORLD_W, WORLD_H, 60);
  }

  log(text, kind = 'info') {
    this.events.push({ tick: this.tick, text, kind });
    if (this.events.length > 150) this.events.shift();
  }

  addFx(type, x, y, extra) {
    if (this.fx.length > 300) this.fx.shift();
    this.fx.push(Object.assign({ type, x, y, t: this.tick }, extra));
  }

  // ---------- Czas i środowisko ----------
  get year() { return this.tick / this.cfg.yearLength; }
  get seasonPhase() { return (this.tick % this.cfg.yearLength) / this.cfg.yearLength; }
  get seasonName() {
    const p = this.seasonPhase;
    return p < 0.25 ? 'Wiosna' : p < 0.5 ? 'Lato' : p < 0.75 ? 'Jesień' : 'Zima';
  }
  seasonOffset() { return this.cfg.seasonAmplitude * Math.sin(TAU * (this.seasonPhase - 0.125)); }

  updateEnvironment() {
    const cfg = this.cfg;
    let temp = 0, fert = 1;
    for (const d of this.disasters) {
      const def = DISASTERS[d.type];
      const len = d.end - d.start;
      const env = clamp(Math.min((this.tick - d.start) / (0.15 * len), (d.end - this.tick) / (0.15 * len)), 0, 1);
      if (def.temp) temp += def.temp * env;
      if (def.fert) fert *= 1 + (def.fert - 1) * env;
    }
    this.disasters = this.disasters.filter(d => {
      if (this.tick >= d.end) { this.log(`Koniec: ${DISASTERS[d.type].name}.`, 'disaster'); return false; }
      return true;
    });
    this.disasterTemp = temp;
    this.tempOffset = cfg.climateOffset + this.seasonOffset() + temp;
    this.fertMul = cfg.fertility * fert;
    if (cfg.randomDisasters && chance(cfg.disasterRate / cfg.yearLength)) {
      this.triggerDisaster(pick(Object.keys(DISASTERS)));
    }
  }

  triggerDisaster(type, x, y) {
    const def = DISASTERS[type];
    const cfg = this.cfg;
    if (!def) return;
    if (!def.instant) {
      const existing = this.disasters.find(d => d.type === type);
      const len = def.dur * cfg.yearLength;
      if (existing) existing.end = this.tick + len;
      else this.disasters.push({ type, start: this.tick, end: this.tick + len });
      this.log(`Katastrofa: ${def.name}! ${def.desc}`, 'disaster');
      return;
    }
    if (type === 'plague') {
      let k = 0;
      for (const p of this.plants) if (chance(0.5)) { p.dead = true; k++; }
      this.log(`Zaraza roślin! Zginęło ${k} roślin.`, 'disaster');
    } else if (type === 'epidemic') {
      let k = 0;
      for (const c of this.creatures) if (!c.dead && c.immune <= 0 && chance(0.3)) { c.infected = 1; k++; }
      if (k === 0 && this.creatures.length) { const c = pick(this.creatures); c.infected = 1; k = 1; }
      this.log(`Epidemia! Zarażonych: ${k}. Choroba przenosi się przez kontakt.`, 'disaster');
    } else if (type === 'meteor') {
      if (x === undefined) { x = rand(100, WORLD_W - 100); y = rand(100, WORLD_H - 100); }
      this.meteor(x, y, 130);
    }
  }

  meteor(x, y, R) {
    let k = 0;
    for (const c of this.creatures) {
      if (!c.dead && (c.x - x) ** 2 + (c.y - y) ** 2 < R * R) { this.kill(c, 'meteor'); k++; }
    }
    for (const p of this.plants) if ((p.x - x) ** 2 + (p.y - y) ** 2 < R * R) p.dead = true;
    for (const m of this.meat) if ((m.x - x) ** 2 + (m.y - y) ** 2 < R * R) m.energy = 0;
    this.terrain.paint(x, y, R * 0.55, 3);
    this.terrain.paint(x, y, R * 0.28, 1);
    this.addFx('meteor', x, y, { r: R });
    this.log(`Uderzenie meteorytu! Zginęło ${k} stworków.`, 'disaster');
  }

  // ---------- Tworzenie obiektów ----------
  spawnCreature(g, x, y, o = {}) {
    const t = g.t;
    const m = (t.size / 6) ** 2;
    const vec = toVec(g);
    const parentSp = o.parents ? o.parents.map(id => this.species.get(id)) : null;
    let sp;
    if (o.speciesId && this.species.get(o.speciesId)) {
      sp = this.species.get(o.speciesId);
      if (sp.extinct !== null) { sp.extinct = null; sp.centroid = new Float32Array(vec); }
    } else {
      const cands = parentSp || this.species.alive();
      const res = this.species.assign(vec, cands, this.tick, this.cfg.speciesThreshold, t);
      sp = res.sp;
      if (res.isNew && o.founder) sp.parent = null;
      else if (res.isNew) {
        const par = sp.parent ? this.species.get(sp.parent) : null;
        if (par) this.log(`Nowy gatunek: ${sp.name} (odłam od ${par.name}).`, 'species');
        else if (!o.founder) this.log(`Nowy gatunek: ${sp.name}.`, 'species');
      }
    }
    sp.total++;
    sp.count++;
    const maxE = 100 * m;
    const c = {
      id: this.nextId++, x, y, angle: rand(0, TAU),
      g, vec, m, r: t.size, maxE, maxHp: 50 * m,
      energy: maxE * (o.energy ?? 0.6), hp: 50 * m,
      age: 0, ageVar: rand(0.85, 1.15), cooldown: 0, gen: o.gen || 0,
      sp: sp.id, parents: o.parentIds || [], children: 0, kills: 0, born: this.tick,
      eatenPlant: 0, eatenMeat: 0,
      inp: new Float32Array(NI), hidden: new Float32Array(NH), out: new Float32Array(NO),
      mem: 0, infected: 0, immune: 0, speedNow: 0, ready: false, dead: false, cause: null,
      localT: 0, stress: 0, attacking: 0,
    };
    if (c.gen > this.maxGen) this.maxGen = c.gen;
    if (o.direct) this.creatures.push(c); else this.newborn.push(c);
    return c;
  }

  spawnPlant(g, x, y, energy) {
    const p = { id: this.nextId++, x, y, g, energy, age: 0, life: rand(0.6, 1.4), dead: false, ci: -1, tv: -1 };
    this.newPlants.push(p);
    return p;
  }

  spawnRandomPlant(initial = false, at) {
    const T = this.terrain;
    let pos = at;
    if (!pos) {
      // losowanie z wagą żyzności
      for (let k = 0; k < 30; k++) {
        const q = T.randomPassable();
        if (Math.random() < T.at(q.x, q.y).fert) { pos = q; break; }
      }
      if (!pos) return;
    }
    const b = T.at(pos.x, pos.y);
    let g;
    if (initial) {
      g = defaultPlantGenome(b.water);
      g.tempOpt = T.tempAt(pos.x, pos.y) + gauss() * 4;
      g = mutatePlant(g, 0.5);
    } else if (this.plants.length && chance(0.7)) {
      g = mutatePlant(pick(this.plants).g, this.cfg.plantMutation * 3);
    } else {
      g = randomPlantGenome(b.water);
    }
    this.spawnPlant(g, pos.x, pos.y, initial ? rand(0.3, 1) * g.maxE : 3);
  }

  // ---------- Główny krok ----------
  step() {
    this.tick++;
    this.updateEnvironment();

    this.creatureGrid.clear();
    this.plantGrid.clear();
    this.meatGrid.clear();
    for (const c of this.creatures) if (!c.dead) this.creatureGrid.insert(c);
    for (const p of this.plants) if (!p.dead) this.plantGrid.insert(p);
    for (const m of this.meat) this.meatGrid.insert(m);

    for (const c of this.creatures) if (!c.dead) this.updateCreature(c);
    this.updatePlants();
    this.updateMeat();

    // sprzątanie
    if (this.creatures.some(c => c.dead)) this.creatures = this.creatures.filter(c => !c.dead);
    if (this.newborn.length) { for (const c of this.newborn) this.creatures.push(c); this.newborn.length = 0; }
    if (this.plants.some(p => p.dead)) this.plants = this.plants.filter(p => !p.dead);
    if (this.newPlants.length) { for (const p of this.newPlants) this.plants.push(p); this.newPlants.length = 0; }

    this.assistPopulation();

    if (this.tick % 60 === 0) this.updateSpecies();
    if (this.tick % this.historyEvery === 0) this.recordHistory();
  }

  updateCreature(c) {
    const cfg = this.cfg, T = this.terrain, t = c.g.t;
    c.px = c.x; c.py = c.y;
    c.age++;
    if (c.cooldown > 0) c.cooldown--;
    const biome = T.at(c.x, c.y);
    const localT = T.tempAt(c.x, c.y) + this.tempOffset;
    c.localT = localT;

    // --- Zmysły ---
    const vis = t.vision * biome.vision;
    const vis2 = vis * vis;
    let bp = null, bpd = vis2, bm = null, bmd = vis2, bc = null, bcd = vis2, bmate = null, bmated = vis2;
    const cx = c.x, cy = c.y;
    this.plantGrid.query(cx, cy, vis, p => {
      if (p.dead || p.energy < 2) return;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bpd) { bpd = d; bp = p; }
    });
    this.meatGrid.query(cx, cy, vis, m => {
      if (m.energy <= 0) return;
      const d = (m.x - cx) ** 2 + (m.y - cy) ** 2;
      if (d < bmd) { bmd = d; bm = m; }
    });
    // partnera słychać z 2x większej odległości niż widać („nawoływanie godowe”)
    const hear = vis * 2;
    const mateThr = cfg.mateThreshold;
    bmated = hear * hear;
    this.creatureGrid.query(cx, cy, hear, o => {
      if (o === c || o.dead) return;
      const d = (o.x - cx) ** 2 + (o.y - cy) ** 2;
      if (o.sp === c.sp) {
        if (o.ready && d < bmated) { bmated = d; bmate = o; }
      } else {
        if (d < bcd) { bcd = d; bc = o; }
        // blisko spokrewniony osobnik z innego gatunku też może być partnerem
        if (o.ready && c.ready && d < bmated && distVec(c.vec, o.vec) < mateThr) { bmated = d; bmate = o; }
      }
    });
    // jeśli nie ma obcych w pobliżu, „innym stworkiem” jest najbliższy z własnego gatunku
    if (!bc) {
      this.creatureGrid.query(cx, cy, vis, o => {
        if (o === c || o.dead) return;
        const d = (o.x - cx) ** 2 + (o.y - cy) ** 2;
        if (d < bcd) { bcd = d; bc = o; }
      });
    }

    const inp = c.inp;
    const rel = o => angleDiff(Math.atan2(o.y - cy, o.x - cx) - c.angle) / Math.PI;
    inp[0] = c.energy / c.maxE * 2 - 1;
    inp[1] = c.hp / c.maxHp * 2 - 1;
    if (bp) { inp[2] = rel(bp); inp[3] = 1 - Math.sqrt(bpd) / vis; } else { inp[2] = 0; inp[3] = 0; }
    if (bm) { inp[4] = rel(bm); inp[5] = 1 - Math.sqrt(bmd) / vis; } else { inp[4] = 0; inp[5] = 0; }
    if (bc) {
      inp[6] = rel(bc); inp[7] = 1 - Math.sqrt(bcd) / vis;
      inp[8] = clamp(bc.r / c.r - 1, -1, 1); inp[9] = bc.g.t.diet * 2 - 1;
    } else { inp[6] = 0; inp[7] = 0; inp[8] = 0; inp[9] = 0; }
    if (bmate) { inp[10] = rel(bmate); inp[11] = 1 - Math.sqrt(bmated) / hear; } else { inp[10] = 0; inp[11] = 0; }
    inp[12] = clamp((localT - t.tempOpt) / 20, -1, 1);
    const ax = cx + Math.cos(c.angle) * (c.r + 14), ay = cy + Math.sin(c.angle) * (c.r + 14);
    inp[13] = T.passable(ax, ay) ? 1 - T.at(ax, ay).move : 1;
    inp[14] = c.ready ? 1 : 0;
    inp[15] = c.mem;
    inp[16] = Math.sin(c.age * 0.05);
    inp[17] = bc ? (bc.sp === c.sp ? 1 : -1) : 0;
    inp[18] = 1;

    // --- Myślenie ---
    think(c.g.w, inp, c.hidden, c.out);
    const out = c.out;

    // --- Ruch ---
    c.angle += out[0] * 0.16 / Math.sqrt(c.m);
    let spd = Math.max(0, out[1]) * t.speed * biome.move;
    if (c.hp < c.maxHp * 0.3) spd *= 0.7;
    if (c.infected) spd *= 0.8;
    if (spd > 0) {
      const nx = cx + Math.cos(c.angle) * spd, ny = cy + Math.sin(c.angle) * spd;
      if (T.passable(nx, ny)) { c.x = nx; c.y = ny; }
      else { c.angle += Math.PI * rand(0.5, 1); spd = 0; }
    }
    c.speedNow = spd;
    c.mem = out[4];

    // --- Koszty energetyczne ---
    let cost = 0.015 * c.m * cfg.metabolism * (1 + t.toxRes * 0.3 + t.lifespan / 5 * 0.25);
    cost += 0.012 * cfg.moveCost * c.m * spd * spd;
    cost += 0.006 * cfg.visionCost * Math.pow(t.vision / 100, 1.3);
    cost += biome.cost * 0.02 * c.m * (spd > 0 ? 1 : 0.3);
    let dev = localT - t.tempOpt;
    dev = dev < 0 ? dev / (0.6 + 0.4 * c.m) : dev * (0.8 + 0.2 * c.m);
    const stress = Math.max(0, Math.abs(dev) - 9);
    c.stress = stress;
    cost += stress * 0.002 * cfg.tempCost * Math.sqrt(c.m);
    c.energy -= cost;

    // --- Jedzenie ---
    const plantEff = 1 - t.diet, meatEff = t.diet;
    if (bp && plantEff > 0.03 && c.energy < c.maxE && bpd < (c.r + 3) ** 2) {
      // zjadanie zostawia korzeń — roślina odrasta
      const bite = Math.min(bp.energy - 1, 1.5 * c.m + 0.5);
      bp.energy -= bite;
      const tox = bp.g.tox * (1 - t.toxRes);
      const gain = bite * plantEff * cfg.plantNutrition * (1 - tox);
      c.energy += gain;
      c.eatenPlant += gain;
      if (tox > 0.02) { c.hp -= bite * tox * 0.6; if (c.hp <= 0) { this.kill(c, 'toxin'); return; } }
    }
    if (bm && meatEff > 0.03 && c.energy < c.maxE && bmd < (c.r + 4) ** 2) {
      const bite = Math.min(bm.energy, 3 * c.m + 0.5);
      bm.energy -= bite;
      const gain = bite * meatEff * cfg.meatNutrition;
      c.energy += gain;
      c.eatenMeat += gain;
    }
    if (c.energy > c.maxE) c.energy = c.maxE;

    // --- Atak ---
    c.attacking = 0;
    if (out[3] > 0 && bc && bcd < (c.r + bc.r + 2) ** 2) {
      const power = 2 * cfg.attackPower * c.m * (0.15 + 0.85 * t.diet) * out[3];
      bc.hp -= power;
      c.energy -= 0.02 * c.m * out[3];
      c.attacking = 1;
      bc.hurt = this.tick;
      bc.lastAttacker = c.id;
      bc.lastAttackerDiet = t.diet;
      if (bc.hp <= 0 && !bc.dead) { c.kills++; this.kill(bc, 'predation'); }
    }

    // --- Choroba ---
    if (c.immune > 0) c.immune--;
    if (c.infected) {
      c.hp -= 0.025 * c.m * 1.2;
      if (bc && !bc.infected && bc.immune <= 0 && bcd < (c.r + bc.r + 10) ** 2 && chance(0.02)) bc.infected = 1;
      if (bmate && !bmate.infected && bmate.immune <= 0 && bmated < (c.r + bmate.r + 10) ** 2 && chance(0.02)) bmate.infected = 1;
      if (chance(1 / 1500)) { c.infected = 0; c.immune = this.cfg.yearLength; }
      if (c.hp <= 0) { this.kill(c, 'disease'); return; }
    } else if (c.hp < c.maxHp && c.energy > c.maxE * 0.3) {
      c.hp = Math.min(c.maxHp, c.hp + 0.01 * c.m);
    }

    // --- Rozmnażanie ---
    const mature = c.age > cfg.maturity * t.lifespan * cfg.yearLength;
    c.ready = mature && c.cooldown <= 0 && !c.infected && c.energy > c.maxE * (0.62 - 0.3 * t.fertility) && c.hp > c.maxHp * 0.5;
    if (c.ready && out[2] > 0 && bmate && bmate.ready && bmate.out[2] > 0 && !bmate.dead &&
      bmated < (c.r + bmate.r + 8) ** 2 &&
      this.creatures.length + this.newborn.length < cfg.maxCreatures &&
      distVec(c.vec, bmate.vec) < cfg.mateThreshold) {
      this.mate(c, bmate);
    }

    // --- Śmierć ---
    if (c.energy <= 0) { this.kill(c, stress > 6 ? 'cold' : 'starvation'); return; }
    if (c.age > t.lifespan * cfg.yearLength * c.ageVar) this.kill(c, 'age');
  }

  mate(a, b) {
    const cfg = this.cfg;
    const invA = a.maxE * (0.4 - 0.22 * a.g.t.fertility) * cfg.reproCost;
    const invB = b.maxE * (0.4 - 0.22 * b.g.t.fertility) * cfg.reproCost;
    a.energy -= invA; b.energy -= invB;
    const fert = (a.g.t.fertility + b.g.t.fertility) / 2;
    const kids = chance(fert * 0.45) && this.creatures.length + this.newborn.length + 2 <= cfg.maxCreatures ? 2 : 1;
    const pool = (invA + invB) * 0.85 / kids;
    for (let k = 0; k < kids; k++) {
      const g = crossover(a.g, b.g, cfg);
      const childMaxE = 100 * (g.t.size / 6) ** 2;
      const ang = rand(0, TAU);
      let x = a.x + Math.cos(ang) * a.r * 1.5, y = a.y + Math.sin(ang) * a.r * 1.5;
      if (!this.terrain.passable(x, y)) { x = a.x; y = a.y; }
      const c = this.spawnCreature(g, x, y, {
        energy: Math.min(1, pool / childMaxE), gen: Math.max(a.gen, b.gen) + 1,
        parents: [a.sp, b.sp], parentIds: [a.id, b.id],
      });
      c.angle = a.angle;
    }
    const cd = cfg.yearLength * 0.08 * (1.6 - fert);
    a.cooldown = cd; b.cooldown = cd;
    a.children += kids; b.children += kids;
    a.ready = false; b.ready = false;
    this.births += kids;
    this.addFx('birth', (a.x + b.x) / 2, (a.y + b.y) / 2, { hue: this.species.get(a.sp)?.hue ?? 0 });
  }

  kill(c, cause) {
    if (c.dead) return;
    c.dead = true;
    c.cause = cause;
    this.deaths[cause] = (this.deaths[cause] || 0) + 1;
    const sp = this.species.get(c.sp);
    if (sp) sp.count = Math.max(0, sp.count - 1);
    if (cause !== 'meteor') {
      this.meat.push({ x: c.x, y: c.y, energy: 75 * c.m + Math.max(0, c.energy) * 0.5, age: 0 });
    }
    this.addFx('death', c.x, c.y, { r: c.r, cause });
    // pula genów do wsparcia populacji
    const fit = c.children * 3 + c.age / this.cfg.yearLength + c.kills * 0.5;
    if (fit > 0.3) {
      this.genePool.push({ g: c.g, fit, tick: this.tick, sp: c.sp, gen: c.gen });
      if (this.genePool.length > 60) {
        const old = this.tick - 3 * this.cfg.yearLength;
        this.genePool = this.genePool.filter(e => e.tick > old).sort((x, y) => y.fit - x.fit).slice(0, 40);
      }
    }
  }

  assistPopulation() {
    const cfg = this.cfg;
    if (!cfg.assistPopulation || this.tick % 20 !== 0) return;
    const alive = this.creatures.length;
    if (alive >= cfg.minCreatures || alive >= cfg.maxCreatures) return;
    let g, parents = null, gen = 0;
    const pool = this.genePool.length >= 2 ? this.genePool : null;
    const tourn = arr => { let best = null; for (let i = 0; i < 3; i++) { const e = pick(arr); if (!best || e.fit > best.fit) best = e; } return best; };
    if (pool) {
      const a = tourn(pool), b = tourn(pool);
      g = crossover(a.g, b.g, cfg);
      parents = [a.sp, b.sp];
      gen = Math.max(a.gen || 0, b.gen || 0) + 1;
    } else if (this.creatures.length >= 1) {
      const a = pick(this.creatures);
      g = mutate(cloneGenome(a.g), cfg);
      parents = [a.sp];
      gen = a.gen + 1;
    } else {
      const base = defaultTraits();
      base.diet = this.opts.initialDiet;
      g = makeGenome(randomizeTraits(base, this.opts.diversity), this.opts.brain);
    }
    // nowy osobnik pojawia się obok żyjącego stworka (jeśli taki jest), żeby miał szansę znaleźć partnera
    let pos = null;
    if (this.creatures.length) {
      const near = pick(this.creatures);
      for (let k = 0; k < 10 && !pos; k++) {
        const x = near.x + gauss() * 50, y = near.y + gauss() * 50;
        if (this.terrain.passable(x, y)) pos = { x, y };
      }
    }
    if (!pos) pos = this.terrain.randomPassable(b => !b.water);
    this.spawnCreature(g, pos.x, pos.y, { energy: 0.7, parents, gen, direct: true });
    this.addFx('spawn', pos.x, pos.y, {});
  }

  updatePlants() {
    const cfg = this.cfg, T = this.terrain;
    const fert = this.fertMul, off = this.tempOffset;
    const lifeTicks = cfg.plantLifespan * cfg.yearLength;
    const cap = cfg.maxPlants;
    let count = this.plants.length;
    for (const p of this.plants) {
      if (p.dead) continue;
      p.age++;
      if (p.tv !== T.version) { p.ci = T.idx(p.x, p.y); p.baseT = T.tempAt(p.x, p.y); p.tv = T.version; }
      const b = BIOMES[T.biome[p.ci]];
      if (!b.pass) { p.dead = true; continue; }
      const g = p.g;
      const hab = b.water ? g.water : 1 - g.water * 0.85;
      const dev = (p.baseT + off - g.tempOpt) / 14;
      const tf = 1 - dev * dev;
      if (tf > 0) {
        if (p.energy < g.maxE) p.energy = Math.min(g.maxE, p.energy + g.growth * b.fert * fert * hab * tf * (1 - 0.5 * g.tox) * cfg.plantGrowth);
      } else {
        p.energy += tf * 0.01;
      }
      if (p.energy < 0.3 || p.age > p.life * lifeTicks) { p.dead = true; continue; }
      // rozsiewanie
      if (p.energy > 0.6 * g.maxE && count < cap && Math.random() < 0.003 * cfg.plantSeedRate) {
        const a = rand(0, TAU), d = rand(6, g.seedRange);
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (!T.passable(x, y)) continue;
        let crowded = false;
        this.plantGrid.query(x, y, 8, q => { if (!crowded && (q.x - x) ** 2 + (q.y - y) ** 2 < 64) crowded = true; });
        if (crowded) continue;
        p.energy -= 0.25 * g.maxE;
        this.spawnPlant(mutatePlant(g, cfg.plantMutation), x, y, 2);
        count++;
      }
    }
    if (count < cap && chance(cfg.plantSpontaneous / 60)) this.spawnRandomPlant(false);
  }

  updateMeat() {
    const decay = 0.015 * this.cfg.meatDecay;
    let any = false;
    for (const m of this.meat) { m.energy -= decay; m.age++; if (m.energy <= 0.5) any = true; }
    if (any) this.meat = this.meat.filter(m => m.energy > 0.5);
    if (this.meat.length > 400) this.meat.splice(0, this.meat.length - 400);
  }

  updateSpecies() {
    const extinct = this.species.update(this.creatures, this.tick);
    for (const s of extinct) {
      if (s.peak >= 3 || s.total >= 5) this.log(`Wymarł gatunek ${s.name} (istniał ${((this.tick - s.born) / this.cfg.yearLength).toFixed(1)} lat).`, 'extinct');
    }
    if (this.creatures.length === 0 && !this.extinctLogged) {
      this.extinctLogged = true;
      this.log('Całkowite wymarcie! Włącz wsparcie populacji albo dodaj stworki ręcznie.', 'extinct');
    } else if (this.creatures.length > 0) this.extinctLogged = false;
  }

  recordHistory() {
    const n = this.creatures.length;
    const rec = { t: this.tick, herb: 0, omni: 0, carn: 0, plants: this.plants.length, species: 0, temp: this.tempOffset, traits: {}, ptraits: {} };
    for (const d of TRAITS) {
      let s = 0, s2 = 0;
      for (const c of this.creatures) { const v = c.g.t[d.key]; s += v; s2 += v * v; }
      const mean = n ? s / n : NaN;
      rec.traits[d.key] = [mean, n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : NaN];
    }
    for (const c of this.creatures) { const k = dietClass(c.g.t.diet); if (k === 0) rec.herb++; else if (k === 1) rec.omni++; else rec.carn++; }
    const pn = this.plants.length;
    for (const d of PLANT_TRAITS) {
      let s = 0, s2 = 0;
      for (const p of this.plants) { const v = p.g[d.key]; s += v; s2 += v * v; }
      const mean = pn ? s / pn : NaN;
      rec.ptraits[d.key] = [mean, pn ? Math.sqrt(Math.max(0, s2 / pn - mean * mean)) : NaN];
    }
    for (const s of this.species.map.values()) if (s.extinct === null && s.count > 0) rec.species++;
    this.history.push(rec);
    if (this.history.length > 1600) {
      this.history = this.history.filter((_, i) => i % 2 === 0);
      this.historyEvery *= 2;
    }
  }

  // ---------- Narzędzia „boga” ----------
  creatureAt(x, y, extra = 4) {
    let best = null, bd = Infinity;
    for (const c of this.creatures) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < (c.r + extra) ** 2 && d < bd) { bd = d; best = c; }
    }
    return best;
  }
  plantAt(x, y) {
    let best = null, bd = 64;
    for (const p of this.plants) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  addFood(x, y, r, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!this.terrain.passable(px, py)) continue;
      this.spawnRandomPlant(true, { x: px, y: py });
    }
  }
  addMeat(x, y, r, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * r;
      this.meat.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, energy: 40, age: 0 });
    }
  }
  smite(x, y, r) {
    let k = 0;
    for (const c of this.creatures) if (!c.dead && (c.x - x) ** 2 + (c.y - y) ** 2 < r * r) { this.kill(c, 'god'); k++; }
    this.creatures = this.creatures.filter(c => !c.dead);
    this.addFx('smite', x, y, { r });
    return k;
  }
  // Wpuszcza stworki o podanym genomie (np. z kreatora). Wszystkie trafiają do jednego gatunku.
  introduce(genome, n, x, y, spread = 40) {
    let spId = null;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (this.creatures.length >= this.cfg.maxCreatures) break;
      const g = cloneGenome(genome);
      if (i > 0) { const keep = this.cfg.mutationScale; this.cfg.mutationScale = 0.3; mutate(g, this.cfg); this.cfg.mutationScale = keep; }
      let px = x, py = y;
      for (let k = 0; k < 10; k++) {
        px = x + gauss() * spread; py = y + gauss() * spread;
        if (this.terrain.passable(px, py)) break;
      }
      if (!this.terrain.passable(px, py)) { const q = this.terrain.randomPassable(); px = q.x; py = q.y; }
      let c;
      if (spId === null) {
        const sp = this.species.create(null, toVec(g), this.tick, g.t);
        this.log(`Wprowadzono nowy gatunek: ${sp.name}.`, 'species');
        spId = sp.id;
      }
      c = this.spawnCreature(g, px, py, { energy: 0.8, speciesId: spId, direct: true });
      out.push(c);
      this.addFx('spawn', px, py, {});
    }
    this.updateSpecies();
    return out;
  }

  // ---------- Zapis / odczyt ----------
  serialize() {
    const r2 = v => Math.round(v * 100) / 100;
    return {
      format: 'ewolucja-save', v: 1,
      tick: this.tick, nextId: this.nextId, opts: this.opts, cfg: this.cfg,
      terrain: this.terrain.serialize(),
      creatures: this.creatures.map(c => ({
        id: c.id, x: r2(c.x), y: r2(c.y), angle: r2(c.angle), g: serializeGenome(c.g), sp: c.sp, gen: c.gen,
        age: c.age, ageVar: c.ageVar, energy: r2(c.energy), hp: r2(c.hp), cooldown: c.cooldown, children: c.children,
        kills: c.kills, parents: c.parents, born: c.born, infected: c.infected, immune: c.immune, mem: c.mem,
        eatenPlant: r2(c.eatenPlant), eatenMeat: r2(c.eatenMeat),
      })),
      plants: this.plants.map(p => ({ x: r2(p.x), y: r2(p.y), g: p.g, energy: r2(p.energy), age: p.age, life: p.life })),
      meat: this.meat.map(m => ({ x: r2(m.x), y: r2(m.y), energy: r2(m.energy), age: m.age })),
      species: this.species.serialize(),
      history: this.history, historyEvery: this.historyEvery,
      events: this.events, deaths: this.deaths, births: this.births, maxGen: this.maxGen,
      disasters: this.disasters,
      genePool: this.genePool.map(e => ({ ...e, g: serializeGenome(e.g) })),
    };
  }

  load(s) {
    if (!s || s.format !== 'ewolucja-save') throw new Error('To nie jest plik zapisu symulacji.');
    Object.assign(this.cfg, s.cfg);
    this.opts = s.opts;
    this.terrain = Terrain.deserialize(WORLD_W, WORLD_H, s.terrain);
    this.initState();
    this.tick = s.tick;
    this.species = SpeciesTracker.deserialize(s.species);
    for (const o of s.creatures) {
      const g = deserializeGenome(o.g);
      const m = (g.t.size / 6) ** 2;
      this.creatures.push(Object.assign({
        g, vec: toVec(g), m, r: g.t.size, maxE: 100 * m, maxHp: 50 * m,
        inp: new Float32Array(NI), hidden: new Float32Array(NH), out: new Float32Array(NO),
        speedNow: 0, ready: false, dead: false, cause: null, localT: 0, stress: 0, attacking: 0,
        eatenPlant: 0, eatenMeat: 0,
      }, o, { g }));
    }
    this.plants = s.plants.map(p => Object.assign({ id: 0, dead: false, ci: -1, tv: -1 }, p));
    this.meat = s.meat;
    this.history = s.history || [];
    this.historyEvery = s.historyEvery || 30;
    this.events = s.events || [];
    this.deaths = Object.assign(this.deaths, s.deaths);
    this.births = s.births || 0;
    this.maxGen = s.maxGen || 0;
    this.disasters = s.disasters || [];
    this.genePool = (s.genePool || []).map(e => ({ ...e, g: deserializeGenome(e.g) }));
    this.nextId = s.nextId;
    for (const p of this.plants) p.id = this.nextId++;
    this.log('Wczytano zapis.', 'info');
  }
}
