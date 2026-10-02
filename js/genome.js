// Geny stworków i roślin: definicje, krzyżowanie, mutacje, odległość genetyczna.
import { clamp, gauss, chance, rand } from './util.js';
import { NW, randomWeights, instinctWeights, crossWeights, mutateWeights } from './brain.js';

export const TRAITS = [
  { key: 'size', name: 'Rozmiar', min: 3, max: 14, def: 6, fmt: 1, desc: 'Większy: więcej energii w zapasie, wygrywa walki, lepiej znosi zimno. Ale więcej je i wolniej skręca.' },
  { key: 'speed', name: 'Prędkość', min: 0.4, max: 2.8, def: 1.3, fmt: 2, desc: 'Maksymalna prędkość. Ruch kosztuje energię proporcjonalnie do kwadratu prędkości.' },
  { key: 'vision', name: 'Zasięg wzroku', min: 25, max: 220, def: 90, fmt: 0, desc: 'Jak daleko stworek widzi. Dalszy wzrok kosztuje energię.' },
  { key: 'diet', name: 'Mięsożerność', min: 0, max: 1, def: 0.1, fmt: 2, desc: '0 = czysty roślinożerca, 1 = czysty mięsożerca. Wszystkożercy trawią oba pokarmy, ale słabiej.' },
  { key: 'tempOpt', name: 'Optymalna temp.', min: -15, max: 45, def: 16, fmt: 1, unit: '°C', desc: 'Temperatura komfortu. Odchylenie o więcej niż 9°C kosztuje energię.' },
  { key: 'toxRes', name: 'Odporność na toksyny', min: 0, max: 1, def: 0.1, fmt: 2, desc: 'Chroni przed trującymi roślinami, ale zwiększa metabolizm.' },
  { key: 'fertility', name: 'Płodność', min: 0, max: 1, def: 0.5, fmt: 2, desc: 'Wysoka: częste, tanie, ale słabe potomstwo (strategia r). Niska: rzadkie, silne potomstwo (strategia K).' },
  { key: 'lifespan', name: 'Długość życia', min: 0.4, max: 5, def: 2, fmt: 2, unit: ' lat', desc: 'Maksymalny wiek. Dłuższe życie trochę zwiększa metabolizm.' },
  { key: 'mutRate', name: 'Tempo mutacji', min: 0.01, max: 0.4, def: 0.08, fmt: 3, desc: 'Prawdopodobieństwo mutacji każdego genu u potomka. Samo też ewoluuje.' },
  { key: 'hue', name: 'Barwa (gen neutralny)', min: 0, max: 360, def: 180, fmt: 0, circular: true, desc: 'Nie wpływa na przeżycie. Pokazuje dryf genetyczny.' },
];
export const TRAIT_MAP = Object.fromEntries(TRAITS.map(t => [t.key, t]));

export const PLANT_TRAITS = [
  { key: 'maxE', name: 'Rozmiar rośliny', min: 6, max: 60, def: 24, fmt: 1, desc: 'Ile energii roślina może zgromadzić. Duże rosną dłużej.' },
  { key: 'growth', name: 'Tempo wzrostu', min: 0.004, max: 0.06, def: 0.022, fmt: 3 },
  { key: 'seedRange', name: 'Zasięg nasion', min: 8, max: 140, def: 50, fmt: 0 },
  { key: 'tempOpt', name: 'Optymalna temp.', min: -15, max: 45, def: 18, fmt: 1, unit: '°C' },
  { key: 'tox', name: 'Toksyczność', min: 0, max: 1, def: 0.05, fmt: 2, desc: 'Trucizna zniechęca roślinożerców, ale spowalnia wzrost.' },
  { key: 'water', name: 'Przystosowanie do wody', min: 0, max: 1, def: 0.15, fmt: 2, desc: '1 = glon, 0 = roślina lądowa.' },
];

export function defaultTraits() {
  const t = {};
  for (const d of TRAITS) t[d.key] = d.def;
  return t;
}

export function makeGenome(traits = {}, brain = 'instinct') {
  const t = Object.assign(defaultTraits(), traits);
  const w = brain === 'random' ? randomWeights(1) : brain instanceof Float32Array ? brain : instinctWeights(0.25, t.diet);
  return { t, w };
}

export function randomizeTraits(base, amount) {
  const t = Object.assign({}, base);
  for (const d of TRAITS) {
    if (d.key === 'hue') { t.hue = ((t.hue + gauss() * 40 * amount) % 360 + 360) % 360; continue; }
    t[d.key] = clamp(t[d.key] + gauss() * (d.max - d.min) * 0.15 * amount, d.min, d.max);
  }
  return t;
}

function mutateTrait(d, v, rate, big) {
  const range = d.max - d.min;
  if (chance(rate)) v += gauss() * range * 0.05;
  if (chance(big)) v += gauss() * range * 0.3;
  if (d.circular) return ((v % 360) + 360) % 360;
  return clamp(v, d.min, d.max);
}

export function crossover(a, b, cfg) {
  const t = {};
  for (const d of TRAITS) {
    const r = Math.random();
    if (d.circular) t[d.key] = r < 0.5 ? a.t[d.key] : b.t[d.key];
    else t[d.key] = r < 0.4 ? a.t[d.key] : r < 0.8 ? b.t[d.key] : (a.t[d.key] + b.t[d.key]) / 2;
  }
  const w = crossWeights(a.w, b.w);
  const g = { t, w };
  mutate(g, cfg);
  return g;
}

export function mutate(g, cfg) {
  const rate = clamp(g.t.mutRate * cfg.mutationScale, 0, 1);
  const big = cfg.bigMutationChance;
  for (const d of TRAITS) g.t[d.key] = mutateTrait(d, g.t[d.key], rate, big);
  mutateWeights(g.w, rate * 0.5 * cfg.brainMutation, Math.max(0.2, cfg.brainMutation), big);
  return g;
}

export function cloneGenome(g) { return { t: Object.assign({}, g.t), w: new Float32Array(g.w) }; }

// Wektor genomu (cechy znormalizowane + wagi) — do liczenia średnich gatunków.
export const VEC_LEN = TRAITS.length + NW;
export function toVec(g, out = new Float32Array(VEC_LEN)) {
  for (let i = 0; i < TRAITS.length; i++) {
    const d = TRAITS[i];
    out[i] = (g.t[d.key] - d.min) / (d.max - d.min);
  }
  out.set(g.w, TRAITS.length);
  return out;
}

// Odległość genetyczna: cechy liczą się mocniej niż wagi mózgu.
export function distVec(a, b) {
  let dt = 0;
  for (let i = 0; i < TRAITS.length; i++) {
    let d = Math.abs(a[i] - b[i]);
    if (TRAITS[i].circular) d = Math.min(d, 1 - d);
    dt += d;
  }
  dt /= TRAITS.length;
  let dw = 0;
  for (let i = TRAITS.length; i < VEC_LEN; i++) dw += Math.abs(a[i] - b[i]);
  dw /= NW;
  return dt * 2 + dw * 0.35;
}

export function serializeGenome(g) { return { t: g.t, w: Array.from(g.w, v => Math.round(v * 1000) / 1000) }; }
export function deserializeGenome(o) { return { t: Object.assign(defaultTraits(), o.t), w: new Float32Array(o.w.length === NW ? o.w : randomWeights(1)) }; }

// --- Rośliny ---
export function defaultPlantGenome(water = false) {
  const g = {};
  for (const d of PLANT_TRAITS) g[d.key] = d.def;
  if (water) g.water = 0.85;
  return g;
}
export function mutatePlant(p, rate) {
  const g = Object.assign({}, p);
  for (const d of PLANT_TRAITS) {
    if (chance(rate)) g[d.key] = clamp(g[d.key] + gauss() * (d.max - d.min) * 0.07, d.min, d.max);
  }
  return g;
}
export function randomPlantGenome(water) {
  const g = defaultPlantGenome(water);
  for (const d of PLANT_TRAITS) g[d.key] = clamp(g[d.key] + gauss() * (d.max - d.min) * 0.1, d.min, d.max);
  g.tempOpt = rand(-5, 35);
  return g;
}
