// Rdzeń symulacji. Nie korzysta z DOM, więc da się go uruchomić także w Node.
import { clamp, rand, randInt, gauss, chance, pick, angleDiff, Grid, TAU } from './util.js';
import { Terrain, BIOMES } from './terrain.js';
import { think, NI, NH, NO, IN } from './brain.js';
import {
  TRAITS, PLANT_TRAITS, makeGenome, randomizeTraits, defaultTraits, crossover, cloneGenome, mutate,
  toVec, distVec, serializeGenome, deserializeGenome, hueDist,
  defaultPlantGenome, mutatePlant, randomPlantGenome,
} from './genome.js';
import { SpeciesTracker } from './species.js';

export const WORLD_W = 2400;
export const WORLD_H = 1500;

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
  initialCreatures: 90,
  initialPlants: 1000,
  initialDiet: 0.1,
  carnivoreShare: 0.05,
  diversity: 0.5,
  brain: 'instinct',
};

// usuwa elementy w miejscu (bez tworzenia nowej tablicy)
function compact(arr, keep) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}

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
      this.spawnCreature(g, pos.x, pos.y, { energy: 0.7, founder: true, sex: i % 2 });
    }
    this.log(`Nowy świat (ziarno ${this.opts.seed}). Startowa populacja: ${n} stworków.`, 'info');
  }

  initState() {
    this.byId = new Map();
    this.carnPool = [];
    this.lastImmigration = -1e9;
    this.careGiven = 0;
    this.packKills = 0;
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
    this.rejections = 0;
    this.maxGen = 0;
    this.fx = [];
    this.tempOffset = 0;
    this.fertMul = 1;
    // składniki odżywcze w glebie (1 = normalnie); użyźniają je odchody i rozkładające się ciała
    this.nutr = new Float32Array(this.terrain.cols * this.terrain.rows).fill(1);
    // mapy zapachów (komórka 50 jednostek): ślady ofiar/padliny i bogactwo pastwisk; rozchodzą się i zanikają
    this.scentCell = 50;
    this.scentCols = Math.ceil(WORLD_W / 50); this.scentRows = Math.ceil(WORLD_H / 50);
    this.preyScent = new Float32Array(this.scentCols * this.scentRows);
    this.foodScent = new Float32Array(this.scentCols * this.scentRows);
    this.scentTmp = new Float32Array(this.scentCols * this.scentRows);
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
    const c = {
      id: this.nextId++, x, y, angle: rand(0, TAU),
      g, vec, gf: o.gf ?? 1, gf0: o.gf ?? 1, sex: o.sex ?? (chance(0.5) ? 1 : 0),
      age: o.gf !== undefined && o.gf < 1 ? 0 : Math.floor(this.cfg.maturity * t.lifespan * this.cfg.yearLength * (o.founder ? rand(0.5, 2) : 1)),
      ageVar: 1, cooldown: 0, gen: o.gen || 0,
      sp: sp.id, parents: o.parentIds || [], children: 0, kills: 0, born: this.tick,
      eatenPlant: 0, eatenMeat: 0,
      inp: new Float32Array(NI), hidden: new Float32Array(NH), out: new Float32Array(NO),
      mem: 0, mem2: 0, stam: 1, fed: 0, infected: 0, immune: 0, speedNow: 0, ready: false, dead: false, cause: null,
      localT: 0, stress: 0, attacking: 0,
    };
    this.setBody(c);
    c.energy = c.maxE * (o.energy ?? 0.6);
    if (c.gen > this.maxGen) this.maxGen = c.gen;
    this.byId.set(c.id, c);
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
    for (const c of this.creatures) if (!c.dead) this.creatureGrid.insert(c);
    // rośliny i mięso się nie ruszają — ich siatki wystarczy odświeżać co kilka ticków
    // (martwe są pomijane w zapytaniach, a nowe pojawiają się z małym opóźnieniem)
    if (this.tick % 6 === 0 || this.plantGrid.items.length === 0) {
      this.plantGrid.clear();
      for (const p of this.plants) if (!p.dead) this.plantGrid.insert(p);
    }
    if (this.tick % 3 === 0) {
      this.meatGrid.clear();
      for (const m of this.meat) this.meatGrid.insert(m);
    }

    for (const c of this.creatures) if (!c.dead) this.updateCreature(c);
    this.updatePlants();
    this.updateMeat();

    // sprzątanie
    compact(this.creatures, c => !c.dead);
    if (this.newborn.length) { for (const c of this.newborn) this.creatures.push(c); this.newborn.length = 0; }
    compact(this.plants, p => !p.dead);
    if (this.newPlants.length) { for (const p of this.newPlants) this.plants.push(p); this.newPlants.length = 0; }

    this.assistPopulation();

    if (this.tick % 10 === 0) this.updateScent();
    if (this.tick % 60 === 0) this.updateSpecies();
    if (this.tick % 300 === 0) this.immigrate();
    if (this.tick % this.historyEvery === 0) this.recordHistory();
  }

  // Ciało rośnie od urodzenia do dojrzałości; masa, zapas energii i zdrowie zależą od bieżącego rozmiaru.
  setBody(c) {
    const t = c.g.t;
    const oldHp = c.maxHp || 1;
    c.r = t.size * c.gf;
    c.m = (c.r / 6) ** 2;
    c.maxE = 100 * c.m * (1 + 0.7 * t.diet); // mięsożercy mogą się „obżerać” i długo pościć
    c.maxHp = 50 * c.m;
    c.hp = c.hp === undefined ? c.maxHp : c.hp * c.maxHp / oldHp;
    if (c.energy > c.maxE) c.energy = c.maxE;
  }

  updateCreature(c) {
    const cfg = this.cfg, T = this.terrain, t = c.g.t, yl = cfg.yearLength;
    c.px = c.x; c.py = c.y;
    c.age++;
    if (c.cooldown > 0) c.cooldown--;
    const matureTicks = cfg.maturity * t.lifespan * yl;
    const mature = c.age > matureTicks;
    if (c.gf < 1 && c.age % 15 === 0) { c.gf = Math.min(1, c.gf0 + (1 - c.gf0) * c.age / matureTicks); this.setBody(c); }
    const ageFrac = c.age / (t.lifespan * yl);
    const ci = T.idx(c.x, c.y);
    const biome = BIOMES[T.biome[ci]];
    const localT = T.tempAt(c.x, c.y) + this.tempOffset;
    c.localT = localT;

    // --- Zmysły ---
    // Szerokie pole widzenia skraca zasięg (kompromis: ofiary widzą dookoła, drapieżniki daleko przed sobą).
    const halfFov = t.fov / 360 * Math.PI;
    const vis = t.vision * biome.vision * (1.3 - 0.5 * t.fov / 360);
    const vis2 = vis * vis;
    const cx = c.x, cy = c.y, ang = c.angle;
    const seen = (ox, oy, d2, extra) => {
      if (d2 < (c.r + extra + 10) ** 2) return true; // dotyk / bardzo blisko — zawsze
      return Math.abs(angleDiff(Math.atan2(oy - cy, ox - cx) - ang)) <= halfFov;
    };
    let bp = null, bpd = vis2, bm = null, bmd = vis2;
    this.plantGrid.query(cx, cy, vis, p => {
      if (p.dead || p.energy < 2) return;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bpd && seen(p.x, p.y, d, 0)) { bpd = d; bp = p; }
    });
    this.meatGrid.query(cx, cy, vis, m => {
      if (m.energy <= 0.5) return;
      const d = (m.x - cx) ** 2 + (m.y - cy) ** 2;
      if (d < bmd && seen(m.x, m.y, d, 0)) { bmd = d; bm = m; }
    });
    // Partnera słychać z 3x większej odległości („nawoływanie godowe”) i niezależnie od kierunku.
    const hear = vis * 3;
    const mateThr = cfg.mateThreshold;
    let bmate = null, bmated = hear * hear;
    let bthreat = null, btd = Infinity, bprey = null, bpyd = Infinity, bnear = null, bnd = Infinity;
    let hx = 0, hy = 0, hn = 0, pack = null, packD = Infinity, kinNear = 0;
    const iAmPredator = t.diet > 0.3;
    let bpw = 0, bpyScore = Infinity;
    // czujność: zwierzę z głową w trawie gorzej wypatruje drapieżników
    const vigil = c.eating ? 0.35 : 1;
    const nose = 40 + 0.25 * t.vision, nose2 = nose * nose;
    // daleki „słuch” potrzebny jest tylko gotowym do godów; reszta przeszukuje okolicę w zasięgu wzroku
    this.creatureGrid.query(cx, cy, c.ready ? hear : vis, o => {
      if (o === c || o.dead) return;
      const dx = o.x - cx, dy = o.y - cy, d = dx * dx + dy * dy;
      const kin = o.sp === c.sp;
      if (kin && d < 90000) kinNear++;
      if (d < bnd) { bnd = d; bnear = o; }
      if (o.ready && c.ready && o.sex !== c.sex && d < bmated && (kin || distVec(c.vec, o.vec) < mateThr)) { bmated = d; bmate = o; }
      // kamuflaż (kolor jak otoczenie) i bezruch (ruch zdradza) zmniejszają odległość, z której widać stworka
      const ob = T.at(o.x, o.y);
      const camo = 0.65 + 0.35 * hueDist(o.g.t.hue, ob.hue) / 180;
      const motion = 0.72 + 0.28 * Math.min(1, o.speedNow / 0.9);
      const vf = camo * motion;
      // węch z bliska: w promieniu „nosa” zwierzę jest wyczuwalne bez względu na kamuflaż, bezruch i kierunek patrzenia
      const smelled = d < nose2;
      if (!smelled && (d > vis2 * vf * vf || !seen(o.x, o.y, d, o.r))) return;
      if (kin) {
        hx += dx; hy += dy; hn++;
        // ktoś z mojego gatunku właśnie poluje — można dołączyć
        if (o.attacking && o.attackTarget && !o.attackTarget.dead && d < packD) { packD = d; pack = o.attackTarget; }
        return;
      }
      const od = o.g.t.diet;
      if (od > 0.45 && o.r > c.r * 0.6 && od > t.diet - 0.2 && d < btd && (smelled || d < vis2 * vf * vf * vigil)) { btd = d; bthreat = o; }
      if (iAmPredator && (o.r < c.r * 1.4 || (cfg.packHunting && o.packTick >= this.tick - 1 && o.packSp === c.sp && o.r < c.r * 2.5))) {
        // drapieżnik woli słabe ofiary: młode, stare, ranne, chore
        const oa = o.age / (o.g.t.lifespan * yl);
        const weak = clamp(Math.max(1 - o.hp / o.maxHp, (1 - o.gf) * 1.6, (oa - 0.7) * 2.5, o.infected ? 0.6 : 0), 0, 1);
        const score = d * (1 - 0.65 * weak);
        if (score < bpyScore) { bpyScore = score; bpyd = d; bprey = o; bpw = weak; }
      }
    });

    const inp = c.inp;
    const rel = (x, y) => angleDiff(Math.atan2(y - cy, x - cx) - ang) / Math.PI;
    const near = (d2, range) => 1 - Math.sqrt(d2) / range;
    inp[IN.energy] = c.energy / c.maxE * 2 - 1;
    inp[IN.hp] = c.hp / c.maxHp * 2 - 1;
    inp[IN.age] = clamp(ageFrac, 0, 1) * 2 - 1;
    if (bp) { inp[IN.plantA] = rel(bp.x, bp.y); inp[IN.plantD] = near(bpd, vis); } else { inp[IN.plantA] = 0; inp[IN.plantD] = 0; }
    if (bm) { inp[IN.meatA] = rel(bm.x, bm.y); inp[IN.meatD] = near(bmd, vis); } else { inp[IN.meatA] = 0; inp[IN.meatD] = 0; }
    if (bthreat) { inp[IN.threatA] = rel(bthreat.x, bthreat.y); inp[IN.threatD] = Math.max(0, near(btd, vis)); } else { inp[IN.threatA] = 0; inp[IN.threatD] = 0; }
    if (bprey) { inp[IN.preyA] = rel(bprey.x, bprey.y); inp[IN.preyD] = Math.max(0, near(bpyd, vis)); inp[IN.preyWeak] = bpw; } else { inp[IN.preyA] = 0; inp[IN.preyD] = 0; inp[IN.preyWeak] = 0; }
    if (hn) { inp[IN.herdA] = rel(cx + hx / hn, cy + hy / hn); inp[IN.herdN] = Math.min(1, hn / 6); } else { inp[IN.herdA] = 0; inp[IN.herdN] = 0; }
    if (bmate) { inp[IN.mateA] = rel(bmate.x, bmate.y); inp[IN.mateD] = near(bmated, hear); } else { inp[IN.mateA] = 0; inp[IN.mateD] = 0; }
    inp[IN.temp] = clamp((localT - t.tempOpt) / 20, -1, 1);
    // termotaksja: porównanie temperatury z przodu po lewej i po prawej (co kilka ticków, bo to wolna zmienna)
    if (c.age % 8 === 0) {
      const probe = da => {
        const px = cx + Math.cos(ang + da) * 60, py = cy + Math.sin(ang + da) * 60;
        if (!T.passable(px, py)) return -1e3;
        return -Math.abs(T.tempAt(px, py) + this.tempOffset - t.tempOpt);
      };
      const here = Math.abs(localT - t.tempOpt);
      c.tempDir = here > 4 ? clamp((probe(0.7) - probe(-0.7)) / 4, -1, 1) * Math.min(1, (here - 4) / 8) : 0;
    }
    inp[IN.tempDir] = c.tempDir || 0;
    // zmysły dalekiego zasięgu (co 4 ticki): teren, zapach ofiar i pastwisk po lewej i po prawej
    if (c.age % 4 === 0) {
      const at = (da, dist) => { const a2 = ang + da; return [cx + Math.cos(a2) * dist, cy + Math.sin(a2) * dist]; };
      const [lx, ly] = at(-0.7, 45), [rx, ry] = at(0.7, 45);
      const mv = (x, y) => T.passable(x, y) ? T.at(x, y).move : -0.5;
      c.terrainDir = clamp((mv(rx, ry) - mv(lx, ly)) * 1.5, -1, 1);
      const [slx, sly] = at(-0.7, 160), [srx, sry] = at(0.7, 160);
      const pl = this.preyScent[this.scentIdx(slx, sly)], pr = this.preyScent[this.scentIdx(srx, sry)];
      c.preyScentDir = (pr - pl) / (pr + pl + 0.05);
      c.preyScent = Math.min(1, Math.log1p(this.preyScent[this.scentIdx(cx, cy)]) / 3);
      const fl = this.foodScent[this.scentIdx(slx, sly)], fr = this.foodScent[this.scentIdx(srx, sry)];
      c.foodScentDir = (fr - fl) / (fr + fl + 0.05);
    }
    // skupienie uwagi: gdy widać konkretny cel (ofiarę, roślinę, zagrożenie), sygnały z daleka cichną
    const focus = (bthreat || (iAmPredator && bprey) || (!iAmPredator && bp)) ? 0.15 : 1;
    inp[IN.terrainDir] = (c.terrainDir || 0) * (focus < 1 ? 0.5 : 1);
    inp[IN.preyScentDir] = (c.preyScentDir || 0) * focus;
    inp[IN.preyScent] = c.preyScent || 0;
    inp[IN.foodScentDir] = (c.foodScentDir || 0) * focus;
    inp[IN.tempDir] *= focus;
    inp[IN.herdA] *= bthreat ? 1 : focus;
    inp[IN.hungerT] = clamp((this.tick - (c.lastMeal ?? c.born)) / (0.3 * yl), 0, 1) * 2 - 1;
    const ax = cx + Math.cos(ang) * (c.r + 14), ay = cy + Math.sin(ang) * (c.r + 14);
    inp[IN.terrain] = T.passable(ax, ay) ? 1 - T.at(ax, ay).move : 1;
    inp[IN.ready] = c.ready ? 1 : 0;
    inp[IN.stamina] = c.stam * 2 - 1;
    inp[IN.mem1] = c.mem;
    inp[IN.mem2] = c.mem2;
    inp[IN.clock] = Math.sin(c.age * 0.05);
    inp[IN.packA] = pack ? rel(pack.x, pack.y) : 0;
    // młode wyczuwają rodzica (matkę, a gdy jej nie ma — ojca)
    let parent = null;
    if (c.gf < 1 && c.parents.length) {
      parent = this.byId.get(c.parents[0]) || this.byId.get(c.parents[1]) || null;
      if (parent && (parent.x - cx) ** 2 + (parent.y - cy) ** 2 > hear * hear) parent = null;
    }
    if (parent) { const pd = Math.hypot(parent.x - cx, parent.y - cy); inp[IN.parentA] = rel(parent.x, parent.y); inp[IN.parentD] = Math.max(0, 1 - pd / hear); }
    else { inp[IN.parentA] = 0; inp[IN.parentD] = 0; }
    inp[IN.bias] = 1;

    // --- Myślenie ---
    think(c.g.w, inp, c.hidden, c.out);
    const out = c.out;

    // --- Ruch ---
    // bezwładność skrętu: szybkie wahania sygnału się uśredniają, więc ruch jest płynny, a trasy prostsze
    c.turn = (c.turn || 0) * 0.55 + out[0] * 0.45;
    c.angle += c.turn * 0.16 / Math.sqrt(c.m);
    // Sprint: zryw do 135% prędkości, ale wyczerpuje kondycję, która wraca w czasie spokojnego ruchu.
    let thrust = Math.max(0, out[1]), sprint = 1;
    if (thrust > 0.85 && c.stam > 0.05) { sprint = 1.35; c.stam -= 0.012; }
    else { c.stam = Math.min(1, c.stam + 0.004); if (thrust > 0.85) thrust = 0.85; }
    let spd = thrust * sprint * t.speed * biome.move;
    if (c.hp < c.maxHp * 0.3) spd *= 0.7;
    if (c.infected) spd *= 0.8;
    if (c.gripped > this.tick) spd *= 0.3;
    if (ageFrac > 0.7) spd *= Math.max(0.45, 1 - (ageFrac - 0.7) * 1.4); // starość
    if (spd > 0) {
      const nx = cx + Math.cos(c.angle) * spd, ny = cy + Math.sin(c.angle) * spd;
      if (T.passable(nx, ny)) { c.x = nx; c.y = ny; }
      else { c.angle += Math.PI * rand(0.5, 1); spd = 0; }
    }
    c.speedNow = spd;
    c.mem = out[4];
    c.mem2 = out[5];

    // --- Koszty energetyczne ---
    let cost = 0.015 * c.m * cfg.metabolism * (1 + t.toxRes * 0.3 + t.lifespan / 5 * 0.25);
    // głodne zwierzę w spoczynku zwalnia metabolizm (oszczędzanie energii)
    if (c.energy < c.maxE * 0.35 && spd < t.speed * 0.3) cost *= 0.55;
    cost += 0.012 * cfg.moveCost * c.m * spd * spd;
    cost += 0.006 * cfg.visionCost * Math.pow(t.vision / 100, 1.3);
    cost += biome.cost * 0.02 * c.m * (spd > 0 ? 1 : 0.3);
    let dev = localT - t.tempOpt;
    dev = dev < 0 ? dev / (0.6 + 0.4 * c.m) : dev * (0.8 + 0.2 * c.m);
    const stress = Math.max(0, Math.abs(dev) - 9);
    c.stress = stress;
    cost += stress * 0.002 * cfg.tempCost * Math.sqrt(c.m);
    c.energy -= cost;
    // odchody użyźniają glebę
    this.nutr[ci] = Math.min(3, this.nutr[ci] + cost * 0.06);

    // --- Jedzenie ---
    // specjalizacja: trawienie rośnie nieliniowo, więc „pół na pół” daje razem ok. 2/3, a nie 100%
    const plantEff = Math.pow(1 - t.diet, 1.6), meatEff = Math.pow(t.diet, 1.6);
    c.eating = false;
    if (bp && plantEff > 0.03 && c.energy < c.maxE && bpd < (c.r + 3) ** 2) {
      // zjadanie zostawia korzeń — roślina odrasta
      const bite = Math.min(bp.energy - 1, 1.5 * c.m + 0.5);
      bp.energy -= bite;
      const tox = bp.g.tox * (1 - t.toxRes);
      const gain = bite * plantEff * cfg.plantNutrition * (1 - tox);
      c.energy += gain;
      c.eatenPlant += gain;
      c.eating = true;
      c.lastMeal = this.tick;
      if (tox > 0.02) { c.hp -= bite * tox * 0.6; if (c.hp <= 0) { this.kill(c, 'toxin'); return; } }
    }
    if (bm && meatEff > 0.03 && c.energy < c.maxE && bmd < (c.r + 4) ** 2) {
      const bite = Math.min(bm.energy, 3 * c.m + 0.5);
      bm.energy -= bite;
      const gain = bite * meatEff * cfg.meatNutrition;
      c.energy += gain;
      c.eatenMeat += gain;
      if (bm.kill) c.eatenKill = (c.eatenKill || 0) + gain;
      c.eating = true;
      c.lastMeal = this.tick;
    }
    if (c.energy > c.maxE) c.energy = c.maxE;

    // --- Atak (na ofiarę, a w obronie — na napastnika) ---
    c.attacking = 0;
    c.attackTarget = null;
    let target = null;
    // skok: drapieżnik z bliska rzuca się na ofiarę (kosztem kondycji)
    if (out[3] > 0 && bprey && t.diet > 0.4 && c.stam > 0.35) {
      const pd = Math.sqrt(bpyd), gap = pd - c.r - bprey.r - 2;
      if (gap > 0 && gap < 22) {
        const jump = Math.min(gap, 16);
        const nx = cx + (bprey.x - cx) / pd * jump, ny = cy + (bprey.y - cy) / pd * jump;
        if (T.passable(nx, ny)) {
          c.x = nx; c.y = ny; c.stam -= 0.35;
          bpyd = (bprey.x - nx) ** 2 + (bprey.y - ny) ** 2;
          c.pounced = this.tick;
        }
      }
    }
    if (bprey && bpyd < (c.r + bprey.r + 5) ** 2) target = bprey;
    else if (bthreat && btd < (c.r + bthreat.r + 3) ** 2) target = bthreat;
    if (out[3] > 0 && target) {
      // polowanie w stadzie: każdy inny napastnik z mojego gatunku w ostatnich ticach zwiększa obrażenia
      if (target.packTick !== this.tick - 1 && target.packTick !== this.tick) { target.packSp = c.sp; target.packN = 0; target.packIds = []; }
      if (target.packSp === c.sp && !target.packIds.includes(c.id)) { target.packIds.push(c.id); target.packN = target.packIds.length; }
      target.packTick = this.tick;
      const allies = cfg.packHunting && target.packSp === c.sp ? target.packN : 1;
      const power = 5 * cfg.attackPower * c.m * (0.15 + 0.85 * t.diet) * out[3] * Math.min(1.8, 1 + 0.3 * (allies - 1));
      target.hp -= power;
      c.attackTarget = target;
      // chwyt: drapieżnik przytrzymuje ofiarę, która przez chwilę ledwo się rusza
      if (t.diet > 0.4) target.gripped = this.tick + 12;
      c.energy -= 0.02 * c.m * out[3];
      c.attacking = 1;
      target.hurt = this.tick;
      target.lastAttacker = c.id;
      target.lastAttackerDiet = t.diet;
      if (target.hp <= 0 && !target.dead) {
        c.kills++;
        if (allies > 1) this.packKills++;
        this.kill(target, 'predation');
      }
    }

    // --- Opieka: rodzic karmi młode, które są tuż obok (matka mocniej, ojciec słabiej) ---
    if (parent && cfg.parentalCare && c.energy < c.maxE * 0.9 && (parent.x - cx) ** 2 + (parent.y - cy) ** 2 < (c.r + parent.r + 12) ** 2) {
      const isMother = parent.id === c.parents[0];
      const reserve = parent.maxE * 0.6; // rodzic nie oddaje energii, której sam potrzebuje
      if (parent.energy > reserve) {
        const amount = Math.min(parent.energy - reserve, parent.g.t.care * 0.2 * parent.m * (isMother ? 1 : 0.5));
        parent.energy -= amount;
        c.energy = Math.min(c.maxE, c.energy + amount * 0.9);
        c.fed += amount * 0.9;
        this.careGiven += amount;
        c.beingFed = this.tick;
      }
    }

    // --- Choroba ---
    if (c.immune > 0) c.immune--;
    if (c.infected) {
      c.hp -= 0.025 * c.m * 1.2;
      if (bnear && !bnear.infected && bnear.immune <= 0 && bnd < (c.r + bnear.r + 10) ** 2 && chance(0.02)) bnear.infected = 1;
      if (chance(1 / 1500)) { c.infected = 0; c.immune = yl; }
      if (c.hp <= 0) { this.kill(c, 'disease'); return; }
    } else if (c.hp < c.maxHp && c.energy > c.maxE * 0.3 && ageFrac < 0.85) {
      c.hp = Math.min(c.maxHp, c.hp + 0.01 * c.m);
    }

    // --- Rozmnażanie (dwie płcie; samica ponosi większy koszt i wybiera partnera) ---
    const female = c.sex === 1;
    // terytorialność drapieżników: w zatłoczonym przez swój gatunek terenie (promień 300) nie przystępują do rozrodu
    if (c.ready) c.kinNear = kinNear;
    const crowded = cfg.territoriality && t.diet > 0.5 && (c.kinNear || 0) >= 10;
    c.ready = mature && c.cooldown <= 0 && !c.infected && ageFrac < 1 && !crowded &&
      c.energy > 100 * c.m * (female ? 0.62 - 0.3 * t.fertility : 0.4) && c.hp > c.maxHp * 0.5;
    if (crowded && c.age % 300 === 0) c.kinNear = 0; // co jakiś czas sprawdza teren ponownie
    if (c.ready && out[2] > 0 && bmate && bmate.ready && bmate.out[2] > 0 && !bmate.dead &&
      bmated < (c.r + bmate.r + 8) ** 2 &&
      this.roomFor(t.diet) > 0) {
      const f = female ? c : bmate, m = female ? bmate : c;
      const tolerance = 180 * (1 - f.g.t.choosy) + 20;
      if (hueDist(m.g.t.hue, f.g.t.prefHue) <= tolerance) this.mate(f, m);
      else { m.cooldown = 90; this.rejections = (this.rejections || 0) + 1; }
    }

    // --- Śmierć: głód, a z wiekiem coraz większe ryzyko (prawo Gompertza) ---
    if (c.energy <= 0) { this.kill(c, stress > 6 ? 'cold' : 'starvation'); return; }
    if (ageFrac > 0.75 && (chance(0.00004 * Math.exp(9 * (ageFrac - 0.75))) || ageFrac > 1.4)) this.kill(c, 'age');
  }

  // Ile jeszcze może się urodzić. Limit jest tylko zabezpieczeniem wydajności — żeby roślinożercy
  // nie zapchali go w całości (i nie zablokowali rozrodu drapieżników), mogą zająć najwyżej 85% miejsc.
  roomFor(diet) {
    const max = this.cfg.maxCreatures;
    const total = this.creatures.length + this.newborn.length;
    if (diet >= 0.33) return max - total;
    let herb = 0;
    for (const c of this.creatures) if (c.g.t.diet < 0.33) herb++;
    for (const c of this.newborn) if (c.g.t.diet < 0.33) herb++;
    return Math.min(max - total, Math.floor(max * 0.85) - herb);
  }

  // f — samica, m — samiec
  mate(f, m) {
    const cfg = this.cfg;
    const fert = f.g.t.fertility;
    const invF = 100 * f.m * (0.42 - 0.22 * fert) * cfg.reproCost;
    const invM = 100 * m.m * 0.08 * cfg.reproCost;
    f.energy -= invF; m.energy -= invM;
    const room = this.roomFor(f.g.t.diet);
    let kids = 1 + (chance(fert * 0.5) ? 1 : 0) + (fert > 0.7 && chance(0.35) ? 1 : 0);
    kids = Math.max(1, Math.min(kids, room));
    const pool = (invF * 0.85 + invM * 0.5) / kids;
    for (let k = 0; k < kids; k++) {
      const g = crossover(f.g, m.g, cfg);
      // strategia K (niska płodność) — większe noworodki
      const gf0 = 0.35 + 0.3 * (1 - fert);
      const childMaxE = 100 * (g.t.size * gf0 / 6) ** 2 * (1 + 0.7 * g.t.diet);
      const ang = rand(0, TAU);
      let x = f.x + Math.cos(ang) * f.r * 1.5, y = f.y + Math.sin(ang) * f.r * 1.5;
      if (!this.terrain.passable(x, y)) { x = f.x; y = f.y; }
      const c = this.spawnCreature(g, x, y, {
        energy: Math.min(1, pool / childMaxE), gen: Math.max(f.gen, m.gen) + 1, gf: gf0,
        parents: [f.sp, m.sp], parentIds: [f.id, m.id],
      });
      c.angle = f.angle;
    }
    f.cooldown = cfg.yearLength * 0.1 * (1.6 - fert);
    m.cooldown = cfg.yearLength * 0.02;
    f.children += kids; m.children += kids;
    f.ready = false; m.ready = false;
    this.births += kids;
    this.addFx('birth', (f.x + m.x) / 2, (f.y + m.y) / 2, { hue: this.species.get(f.sp)?.hue ?? 0 });
  }

  kill(c, cause) {
    if (c.dead) return;
    c.dead = true;
    c.cause = cause;
    this.byId.delete(c.id);
    this.deaths[cause] = (this.deaths[cause] || 0) + 1;
    const sp = this.species.get(c.sp);
    if (sp) sp.count = Math.max(0, sp.count - 1);
    if (cause !== 'meteor') {
      // ilość mięsa zależy od kondycji: zagłodzone ciało to głównie skóra i kości
      this.meat.push({ x: c.x, y: c.y, energy: 100 * c.m * (0.25 + 0.75 * clamp(c.energy / (100 * c.m), 0, 1)), age: 0, kill: cause === 'predation' });
    }
    const ni = this.terrain.idx(c.x, c.y);
    this.nutr[ni] = Math.min(3, this.nutr[ni] + 0.2 * c.m);
    this.addFx('death', c.x, c.y, { r: c.r, cause });
    // pula genów do wsparcia populacji
    const fit = c.children * 3 + c.age / this.cfg.yearLength + c.kills * 0.5;
    if (fit > 0.3) {
      this.genePool.push({ g: c.g, fit, tick: this.tick, sp: c.sp, gen: c.gen });
      // osobna pamięć genów udanych drapieżników (źródło imigrantów)
      if (c.g.t.diet > 0.6 && (c.kills > 0 || c.children > 0)) {
        this.carnPool.push({ g: c.g, fit: fit + c.kills, sp: c.sp, gen: c.gen });
        if (this.carnPool.length > 40) this.carnPool.sort((a, b) => b.fit - a.fit).length = 25;
      }
      if (this.genePool.length > 60) {
        const old = this.tick - 3 * this.cfg.yearLength;
        this.genePool = this.genePool.filter(e => e.tick > old).sort((x, y) => y.fit - x.fit).slice(0, 40);
      }
    }
  }

  // Efekt ratunkowy: gdy drapieżników prawie nie ma, a ofiar jest dużo, z sąsiednich terenów
  // (krawędź mapy) przychodzi para drapieżników o genach wcześniejszych, udanych łowców.
  immigrate() {
    const cfg = this.cfg;
    if (!cfg.immigration || this.tick - this.lastImmigration < cfg.yearLength * 0.5) return;
    let carn = 0, herb = 0;
    for (const c of this.creatures) { if (c.g.t.diet > 0.6) carn++; else if (c.g.t.diet < 0.33) herb++; }
    if (carn >= 4 || herb < 50 || this.roomFor(1) < 2) return;
    this.lastImmigration = this.tick;
    let src;
    if (this.carnPool.length) src = this.carnPool.slice().sort((a, b) => b.fit - a.fit).slice(0, 6);
    // miejsce: ląd przy losowej krawędzi mapy
    let pos = null;
    for (let k = 0; k < 40 && !pos; k++) {
      const side = randInt(0, 3), u = Math.random();
      const x = side === 0 ? 40 : side === 1 ? WORLD_W - 40 : u * WORLD_W;
      const y = side === 2 ? 40 : side === 3 ? WORLD_H - 40 : u * WORLD_H;
      if (this.terrain.passable(x, y) && !this.terrain.at(x, y).water) pos = { x, y };
    }
    if (!pos) return;
    for (let i = 0; i < 2; i++) {
      let g;
      if (src) { const a = pick(src), b = pick(src); g = crossover(a.g, b.g, cfg); }
      else {
        const base = defaultTraits(); base.diet = 0.9; base.size = 7.5; base.speed = 1.5; base.vision = 120;
        g = makeGenome(randomizeTraits(base, 0.3), this.opts.brain);
      }
      const c = this.spawnCreature(g, pos.x + gauss() * 15, pos.y + gauss() * 15, { energy: 0.8, direct: true, sex: i, parents: src ? [src[0].sp] : null });
      this.addFx('spawn', c.x, c.y, {});
    }
    this.immigrants = (this.immigrants || 0) + 2;
    this.log('Imigracja: para drapieżników przybyła z sąsiednich terenów (efekt ratunkowy).', 'species');
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
    this.assistSex = 1 - (this.assistSex || 0);
    this.spawnCreature(g, pos.x, pos.y, { energy: 0.7, parents, gen, direct: true, sex: this.assistSex });
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
        if (p.energy < g.maxE) {
          const nu = this.nutr[p.ci];
          const grow = g.growth * b.fert * fert * hab * tf * (1 - 0.5 * g.tox) * cfg.plantGrowth * (0.35 + 0.65 * Math.min(nu, 2));
          p.energy = Math.min(g.maxE, p.energy + grow);
          this.nutr[p.ci] = Math.max(0, nu - grow * 0.012);
        }
      } else {
        p.energy += tf * 0.01;
      }
      if (p.energy < 0.3 || p.age > p.life * lifeTicks) { p.dead = true; this.nutr[p.ci] = Math.min(3, this.nutr[p.ci] + 0.05 + p.energy * 0.01); continue; }
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
    // gleba powoli wraca do stanu wyjściowego (wietrzenie skał, wymywanie)
    if (this.tick % 30 === 0) { const n = this.nutr; for (let i = 0; i < n.length; i++) n[i] += (1 - n[i]) * 0.006; }
  }

  scentIdx(x, y) {
    const cx = clamp(Math.floor(x / this.scentCell), 0, this.scentCols - 1);
    const cy = clamp(Math.floor(y / this.scentCell), 0, this.scentRows - 1);
    return cy * this.scentCols + cx;
  }
  // Ofiary i padlina zostawiają zapach, pastwiska „pachną” roślinami. Zapach dyfunduje do sąsiednich
  // komórek i zanika, więc powstaje gradient wyczuwalny daleko poza zasięgiem wzroku.
  updateScent() {
    const P = this.preyScent, F = this.foodScent, cols = this.scentCols, rows = this.scentRows;
    for (const c of this.creatures) if (c.g.t.diet < 0.5) P[this.scentIdx(c.x, c.y)] += 0.6 * c.m;
    for (const m of this.meat) P[this.scentIdx(m.x, m.y)] += m.energy * 0.01;
    if (this.tick % 30 === 0) for (const p of this.plants) F[this.scentIdx(p.x, p.y)] += p.energy * 0.004;
    const diffuse = (A, decay) => {
      const T = this.scentTmp;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let s = 0, n = 0;
        if (x > 0) { s += A[i - 1]; n++; } if (x < cols - 1) { s += A[i + 1]; n++; }
        if (y > 0) { s += A[i - cols]; n++; } if (y < rows - 1) { s += A[i + cols]; n++; }
        T[i] = (A[i] * 0.5 + 0.5 * s / n) * decay;
      }
      A.set(T);
    };
    diffuse(P, 0.9);
    if (this.tick % 30 === 0) diffuse(F, 0.85);
  }

  updateMeat() {
    const decay = 0.015 * this.cfg.meatDecay;
    let any = false;
    const T = this.terrain;
    for (const m of this.meat) {
      m.energy -= decay; m.age++;
      if (m.energy <= 0.5) any = true;
      if ((m.age & 15) === 0) { const i = T.idx(m.x, m.y); this.nutr[i] = Math.min(3, this.nutr[i] + decay * 16 * 0.02); }
    }
    if (any) this.meat = this.meat.filter(m => m.energy > 0.5);
    if (this.meat.length > 800) this.meat.splice(0, this.meat.length - 800);
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
      if (d.circular) {
        // średnia na kole kolorów (żeby 350° i 10° dawały 0°, a nie 180°)
        let sx = 0, sy = 0;
        for (const c of this.creatures) { const a = c.g.t[d.key] * Math.PI / 180; sx += Math.cos(a); sy += Math.sin(a); }
        const R = n ? Math.hypot(sx, sy) / n : 0;
        const mean = n ? ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360 : NaN;
        rec.traits[d.key] = [mean, n ? Math.sqrt(-2 * Math.log(Math.max(R, 1e-6))) * 180 / Math.PI : NaN];
        continue;
      }
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
      c = this.spawnCreature(g, px, py, { energy: 0.8, speciesId: spId, direct: true, sex: i % 2 });
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
      format: 'ewolucja-save', v: 2,
      tick: this.tick, nextId: this.nextId, opts: this.opts, cfg: this.cfg,
      terrain: this.terrain.serialize(),
      creatures: this.creatures.map(c => ({
        id: c.id, x: r2(c.x), y: r2(c.y), angle: r2(c.angle), g: serializeGenome(c.g), sp: c.sp, gen: c.gen,
        age: c.age, ageVar: c.ageVar, energy: r2(c.energy), hp: r2(c.hp), cooldown: c.cooldown, children: c.children,
        kills: c.kills, parents: c.parents, born: c.born, infected: c.infected, immune: c.immune, mem: c.mem, mem2: c.mem2,
        eatenPlant: r2(c.eatenPlant), eatenMeat: r2(c.eatenMeat), fed: r2(c.fed || 0), sex: c.sex, gf: r2(c.gf), gf0: r2(c.gf0),
      })),
      nutr: Array.from(this.nutr, r2),
      plants: this.plants.map(p => ({ x: r2(p.x), y: r2(p.y), g: p.g, energy: r2(p.energy), age: p.age, life: p.life })),
      meat: this.meat.map(m => ({ x: r2(m.x), y: r2(m.y), energy: r2(m.energy), age: m.age })),
      species: this.species.serialize(),
      history: this.history, historyEvery: this.historyEvery,
      events: this.events, deaths: this.deaths, births: this.births, maxGen: this.maxGen, rejections: this.rejections || 0,
      careGiven: this.careGiven, packKills: this.packKills,
      disasters: this.disasters,
      genePool: this.genePool.map(e => ({ ...e, g: serializeGenome(e.g) })),
      carnPool: this.carnPool.map(e => ({ ...e, g: serializeGenome(e.g) })), immigrants: this.immigrants || 0,
    };
  }

  load(s) {
    if (!s || s.format !== 'ewolucja-save') throw new Error('To nie jest plik zapisu symulacji.');
    Object.assign(this.cfg, s.cfg);
    this.opts = s.opts;
    if (s.terrain.biome.length !== Math.ceil(WORLD_W / 20) * Math.ceil(WORLD_H / 20)) throw new Error('Ten zapis pochodzi ze starszej wersji z mniejszą mapą i nie da się go wczytać.');
    this.terrain = Terrain.deserialize(WORLD_W, WORLD_H, s.terrain);
    this.initState();
    this.tick = s.tick;
    this.species = SpeciesTracker.deserialize(s.species);
    for (const o of s.creatures) {
      const g = deserializeGenome(o.g);
      const c = Object.assign({
        vec: toVec(g), gf: 1, gf0: 1, sex: chance(0.5) ? 1 : 0, mem2: 0, stam: 1,
        inp: new Float32Array(NI), hidden: new Float32Array(NH), out: new Float32Array(NO),
        speedNow: 0, ready: false, dead: false, cause: null, localT: 0, stress: 0, attacking: 0,
        eatenPlant: 0, eatenMeat: 0,
      }, o, { g });
      const hp = c.hp, energy = c.energy;
      delete c.hp;
      this.setBody(c);
      c.hp = Math.min(hp, c.maxHp); c.energy = Math.min(energy, c.maxE);
      this.creatures.push(c);
      this.byId.set(c.id, c);
    }
    this.plants = s.plants.map(p => Object.assign({ id: 0, dead: false, ci: -1, tv: -1 }, p));
    if (s.nutr && s.nutr.length === this.nutr.length) this.nutr.set(s.nutr);
    this.meat = s.meat;
    this.history = s.history || [];
    this.historyEvery = s.historyEvery || 30;
    this.events = s.events || [];
    this.deaths = Object.assign(this.deaths, s.deaths);
    this.births = s.births || 0;
    this.rejections = s.rejections || 0;
    this.careGiven = s.careGiven || 0;
    this.packKills = s.packKills || 0;
    this.maxGen = s.maxGen || 0;
    this.disasters = s.disasters || [];
    this.genePool = (s.genePool || []).map(e => ({ ...e, g: deserializeGenome(e.g) }));
    this.carnPool = (s.carnPool || []).map(e => ({ ...e, g: deserializeGenome(e.g) }));
    this.immigrants = s.immigrants || 0;
    this.nextId = s.nextId;
    for (const p of this.plants) p.id = this.nextId++;
    this.log('Wczytano zapis.', 'info');
  }
}
