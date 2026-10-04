// Pomocnicze funkcje matematyczne, losowość i szum do generowania terenu.

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function chance(p) { return Math.random() < p; }

let spare = null;
export function gauss() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m;
  return u * m;
}

export function angleDiff(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Szum wartości (value noise) z interpolacją i fBm.
export function makeNoise(rng) {
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  const sm = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  return function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
}

// Siatka przestrzenna do szybkiego wyszukiwania sąsiadów (listy jednokierunkowe na tablicach typowanych —
// czyszczenie i wstawianie nie tworzą nowych obiektów).
export class Grid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell);
    this.rows = Math.ceil(h / cell);
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(1024);
    this.items = [];
  }
  clear() { this.head.fill(-1); this.items.length = 0; }
  insert(o) {
    const cx = clamp(Math.floor(o.x / this.cell), 0, this.cols - 1);
    const cy = clamp(Math.floor(o.y / this.cell), 0, this.rows - 1);
    const ci = cy * this.cols + cx;
    const i = this.items.length;
    this.items.push(o);
    if (i >= this.next.length) { const n = new Int32Array(this.next.length * 2); n.set(this.next); this.next = n; }
    this.next[i] = this.head[ci];
    this.head[ci] = i;
  }
  // Wywołuje fn(obj) dla obiektów w komórkach pokrywających okrąg.
  query(x, y, r, fn) {
    const c = this.cell, cols = this.cols, head = this.head, next = this.next, items = this.items;
    const x0 = clamp(Math.floor((x - r) / c), 0, cols - 1);
    const x1 = clamp(Math.floor((x + r) / c), 0, cols - 1);
    const y0 = clamp(Math.floor((y - r) / c), 0, this.rows - 1);
    const y1 = clamp(Math.floor((y + r) / c), 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * cols;
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = head[row + cx]; i !== -1; i = next[i]) fn(items[i]);
      }
    }
  }
}

const SYL_A = ['ka', 'lo', 'mi', 'ra', 'te', 'zu', 'no', 'vi', 'sa', 'pe', 'do', 'ri', 'xa', 'mo', 'fu', 'le', 'bra', 'gri', 'chlo', 'pty', 'sto', 'qua', 'ne', 'ty', 'or', 'en', 'ul', 'am'];
const SUF = ['us', 'ia', 'um', 'ax', 'is', 'on', 'ella', 'ops', 'ix', 'ora', 'ides', 'ens'];
export function speciesName() {
  const n = randInt(1, 2);
  let g = '';
  for (let i = 0; i < n + 1; i++) g += pick(SYL_A);
  g += pick(SUF);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(SYL_A);
  s += pick(['i', 'a', 'is', 'us', 'ensis', 'oides']);
  return g[0].toUpperCase() + g.slice(1) + ' ' + s;
}

export function hsl(h, s, l, a = 1) { return a === 1 ? `hsl(${h},${s}%,${l}%)` : `hsla(${h},${s}%,${l}%,${a})`; }
