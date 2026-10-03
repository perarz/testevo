// Geny stworków i roślin. Stworki są diploidalne: każda cecha ma dwa allele (po jednym od każdego
// rodzica), a cecha widoczna (fenotyp, g.t) to ich średnia. Dzięki temu — jak w prawdziwym życiu —
// potomstwo jest zmienne, a populacja przechowuje „ukrytą” zmienność genetyczną.
import { clamp, gauss, chance, rand } from './util.js';
import { NW, randomWeights, instinctWeights, crossWeights, mutateWeights } from './brain.js';

export const TRAITS = [
  { key: 'size', name: 'Rozmiar', min: 3, max: 14, def: 6, fmt: 1, desc: 'Większy: więcej energii w zapasie, wygrywa walki, lepiej znosi zimno. Ale więcej je, wolniej skręca i dłużej dorasta.' },
  { key: 'speed', name: 'Prędkość', min: 0.4, max: 2.8, def: 1.3, fmt: 2, desc: 'Maksymalna prędkość. Ruch kosztuje energię proporcjonalnie do kwadratu prędkości.' },
  { key: 'vision', name: 'Zasięg wzroku', min: 25, max: 220, def: 90, fmt: 0, desc: 'Jak daleko stworek widzi. Dalszy wzrok kosztuje energię.' },
  { key: 'fov', name: 'Pole widzenia', min: 60, max: 360, def: 220, fmt: 0, unit: '°', desc: 'Szerokie pole (jak u ofiar) pozwala zauważyć drapieżnika z boku, ale skraca zasięg. Wąskie (jak u drapieżników) — daleko, ale tylko przed sobą.' },
  { key: 'diet', name: 'Mięsożerność', min: 0, max: 1, def: 0.1, fmt: 2, desc: '0 = czysty roślinożerca, 1 = czysty mięsożerca. Wszystkożercy trawią oba pokarmy, ale słabiej.' },
  { key: 'tempOpt', name: 'Optymalna temp.', min: -15, max: 45, def: 16, fmt: 1, unit: '°C', desc: 'Temperatura komfortu. Odchylenie o więcej niż 9°C kosztuje energię.' },
  { key: 'toxRes', name: 'Odporność na toksyny', min: 0, max: 1, def: 0.1, fmt: 2, desc: 'Chroni przed trującymi roślinami, ale zwiększa metabolizm.' },
  { key: 'fertility', name: 'Płodność', min: 0, max: 1, def: 0.5, fmt: 2, desc: 'Wysoka: częste, tanie, ale małe i słabe potomstwo (strategia r). Niska: rzadkie, duże i silne (strategia K).' },
  { key: 'lifespan', name: 'Długość życia', min: 0.4, max: 5, def: 2, fmt: 2, unit: ' lat', desc: 'Po ok. 70% życia zaczyna się starzenie: spada sprawność i rośnie ryzyko śmierci. Dłuższe życie trochę zwiększa metabolizm.' },
  { key: 'mutRate', name: 'Tempo mutacji', min: 0.01, max: 0.4, def: 0.08, fmt: 3, desc: 'Prawdopodobieństwo mutacji każdego allelu u potomka. Samo też ewoluuje.' },
  { key: 'hue', name: 'Ubarwienie', min: 0, max: 360, def: 30, fmt: 0, circular: true, desc: 'Kolor ciała. Ubarwienie podobne do otoczenia to kamuflaż (trudniej cię zauważyć). Jednocześnie partnerzy oceniają kolor — dobór płciowy może ciągnąć w inną stronę.' },
  { key: 'prefHue', name: 'Preferowana barwa partnera', min: 0, max: 360, def: 30, fmt: 0, circular: true, desc: 'Jaki kolor partnera wybierają samice. Różne preferencje mogą rozdzielić populację na gatunki.' },
  { key: 'choosy', name: 'Wybredność', min: 0, max: 1, def: 0.3, fmt: 2, desc: 'Jak bardzo samica trzyma się swojej preferencji. Wybredne samice rzadziej się rozmnażają, ale wzmacniają dobór płciowy.' },
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

const wrap = v => ((v % 360) + 360) % 360;
export function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

export function defaultTraits() {
  const t = {};
  for (const d of TRAITS) t[d.key] = d.def;
  return t;
}

// Fenotyp z dwóch alleli (dla barwy — średnia na kole kolorów)
function express(d, a, b) {
  if (!d.circular) return (a + b) / 2;
  const diff = ((b - a + 540) % 360) - 180;
  return wrap(a + diff / 2);
}
export function expressAll(g) {
  for (const d of TRAITS) { const al = g.a[d.key]; g.t[d.key] = express(d, al[0], al[1]); }
  return g;
}

// Genom z podanych cech; allele lekko się różnią (heterozygota), żeby była zmienność do selekcji.
export function makeGenome(traits = {}, brain = 'instinct', spread = 0.02) {
  const t = Object.assign(defaultTraits(), traits);
  const a = {};
  for (const d of TRAITS) {
    const e = gauss() * (d.max - d.min) * spread;
    a[d.key] = d.circular ? [wrap(t[d.key] + e * 0.3), wrap(t[d.key] - e * 0.3)] : [clamp(t[d.key] + e, d.min, d.max), clamp(t[d.key] - e, d.min, d.max)];
  }
  const w = brain === 'random' ? randomWeights(1) : brain instanceof Float32Array ? brain : instinctWeights(0.25, t.diet);
  return expressAll({ t: {}, a, w });
}

export function randomizeTraits(base, amount) {
  const t = Object.assign({}, base);
  for (const d of TRAITS) {
    if (d.circular) { t[d.key] = wrap(t[d.key] + gauss() * 40 * amount); continue; }
    t[d.key] = clamp(t[d.key] + gauss() * (d.max - d.min) * 0.15 * amount, d.min, d.max);
  }
  return t;
}

function mutateAllele(d, v, rate, big) {
  const range = d.max - d.min;
  if (chance(rate)) v += gauss() * range * 0.05;
  if (chance(big)) v += gauss() * range * 0.3;
  if (d.circular) return wrap(v);
  return clamp(v, d.min, d.max);
}

// Rozmnażanie płciowe: z każdej pary alleli rodzica losowo jeden trafia do potomka (prawo Mendla).
export function crossover(a, b, cfg) {
  const al = {};
  for (const d of TRAITS) {
    const pa = a.a[d.key], pb = b.a[d.key];
    al[d.key] = [pa[Math.random() < 0.5 ? 0 : 1], pb[Math.random() < 0.5 ? 0 : 1]];
  }
  const g = { t: {}, a: al, w: crossWeights(a.w, b.w) };
  expressAll(g);
  mutate(g, cfg);
  return g;
}

export function mutate(g, cfg) {
  const rate = clamp(g.t.mutRate * cfg.mutationScale, 0, 1);
  const big = cfg.bigMutationChance;
  for (const d of TRAITS) {
    const al = g.a[d.key];
    al[0] = mutateAllele(d, al[0], rate, big);
    al[1] = mutateAllele(d, al[1], rate, big);
  }
  expressAll(g);
  mutateWeights(g.w, rate * 0.5 * cfg.brainMutation, Math.max(0.2, cfg.brainMutation), big);
  return g;
}

export function cloneGenome(g) {
  const a = {};
  for (const k in g.a) a[k] = g.a[k].slice();
  return { t: Object.assign({}, g.t), a, w: new Float32Array(g.w) };
}

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

const r3 = v => Math.round(v * 1000) / 1000;
export function serializeGenome(g) {
  const a = {};
  for (const k in g.a) a[k] = g.a[k].map(r3);
  return { t: g.t, a, w: Array.from(g.w, r3) };
}
export function deserializeGenome(o) {
  const t = Object.assign(defaultTraits(), o.t);
  const w = new Float32Array(o.w && o.w.length === NW ? o.w : instinctWeights(0.25, t.diet));
  if (o.a) {
    const a = {};
    for (const d of TRAITS) a[d.key] = o.a[d.key] ? o.a[d.key].slice() : [t[d.key], t[d.key]];
    return expressAll({ t, a, w });
  }
  // starszy format (bez alleli)
  const g = makeGenome(t, w, 0);
  return g;
}

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
