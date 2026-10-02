// Lekkie wykresy na canvasie (bez bibliotek): liniowy z najechaniem, punktowy, drzewo, mózg.
import { clamp, lerp } from './util.js';
import { INPUTS, OUTPUTS, NI, NH, NO, W1 } from './brain.js';

const INK = '#a3afbd', MUTED = '#6b7785', GRID = 'rgba(255,255,255,0.06)', SURFACE = '#121821';

function setup(canvas, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300;
  if (!canvas._baseH) canvas._baseH = Number(canvas.getAttribute('height')) || 150;
  const H = cssH || canvas._baseH;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  return { ctx, w, h: H };
}

export function niceNum(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function ticks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

// Wykres liniowy. series: [{label, color, values:number[], band?:[lo[], hi[]]}], xs: lata
export function lineChart(canvas, { xs, series, yMin, yMax, unit = '', fmt = niceNum }) {
  const { ctx, w, h } = setup(canvas);
  canvas._chart = { xs, series, unit, fmt };
  const padL = 34, padR = 8, padT = 6, padB = 18;
  const pw = w - padL - padR, ph = h - padT - padB;
  if (!xs.length) {
    ctx.fillStyle = MUTED; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Zbieranie danych…', w / 2, h / 2);
    return;
  }
  let lo = Infinity, hi = -Infinity;
  for (const s of series) {
    const arrs = s.band ? [s.band[0], s.band[1]] : [s.values];
    for (const a of arrs) for (const v of a) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (yMin !== undefined) lo = Math.min(lo, yMin);
  if (yMax !== undefined) hi = Math.max(hi, yMax);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { hi += 1; lo -= yMin === 0 ? 0 : 1; }
  const pad = (hi - lo) * 0.06;
  if (yMin === undefined) lo -= pad;
  hi += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1;
  const X = x => padL + (x1 === x0 ? pw : (x - x0) / (x1 - x0) * pw);
  const Y = v => padT + ph - (v - lo) / (hi - lo) * ph;
  canvas._chart.geom = { X, Y, padL, pw, x0, x1, padT, ph };

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of ticks(lo, hi, 4)) {
    const y = Y(v);
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(fmt(v), padL - 4, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const span = x1 - x0;
  const dec = span < 0.04 ? 3 : span < 0.4 ? 2 : span < 4 ? 1 : 0;
  for (const v of ticks(x0, x1, 4)) ctx.fillText(v.toFixed(dec), X(v), h - padB + 4);

  for (const s of series) {
    if (s.band) {
      ctx.fillStyle = s.bandColor || 'rgba(79,209,197,0.18)';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < xs.length; i++) {
        const v = s.band[1][i]; if (!Number.isFinite(v)) continue;
        if (!started) { ctx.moveTo(X(xs[i]), Y(v)); started = true; } else ctx.lineTo(X(xs[i]), Y(v));
      }
      for (let i = xs.length - 1; i >= 0; i--) { const v = s.band[0][i]; if (Number.isFinite(v)) ctx.lineTo(X(xs[i]), Y(v)); }
      ctx.closePath(); ctx.fill();
    }
    if (!s.values) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < xs.length; i++) {
      const v = s.values[i];
      if (!Number.isFinite(v)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X(xs[i]), Y(v)); pen = true; } else ctx.lineTo(X(xs[i]), Y(v));
    }
    ctx.stroke();
  }

  // najechanie myszą: pionowa linia + wartości
  const hov = canvas._hoverX;
  if (hov !== undefined && hov >= padL && hov <= padL + pw) {
    const xv = x0 + (hov - padL) / pw * (x1 - x0);
    let idx = 0, bd = Infinity;
    for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - xv); if (d < bd) { bd = d; idx = i; } }
    const cx = X(xs[idx]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + ph); ctx.stroke();
    const lines = [`rok ${xs[idx].toFixed(2)}`];
    for (const s of series) {
      if (!s.values) continue;
      const v = s.values[idx];
      if (Number.isFinite(v)) {
        ctx.fillStyle = s.color; ctx.strokeStyle = SURFACE; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, Y(v), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        lines.push(`${s.label}: ${fmt(v)}${unit}${s.band ? ' ± ' + fmt((s.band[1][idx] - s.band[0][idx]) / 2) : ''}`);
      }
    }
    ctx.font = '11px Inter, sans-serif';
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14;
    const th = lines.length * 15 + 8;
    let tx = cx + 10; if (tx + tw > w) tx = cx - tw - 10;
    ctx.fillStyle = 'rgba(12,16,22,0.95)'; ctx.strokeStyle = '#2a3542'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tx, padT + 2, tw, th, 6); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? MUTED : '#e6edf3'; ctx.fillText(l, tx + 7, padT + 7 + i * 15); });
  }
}

export function attachHover(canvas, redraw) {
  canvas.addEventListener('pointermove', e => { canvas._hoverX = e.offsetX; redraw(); });
  canvas.addEventListener('pointerleave', () => { canvas._hoverX = undefined; redraw(); });
}

// Wykres punktowy: points [{x, y, color, label}]
export function scatterChart(canvas, { points, xr, yr, xLabel, yLabel }) {
  const { ctx, w, h } = setup(canvas);
  const padL = 34, padR = 8, padT = 6, padB = 28;
  const pw = w - padL - padR, ph = h - padT - padB;
  const X = v => padL + (v - xr[0]) / (xr[1] - xr[0]) * pw;
  const Y = v => padT + ph - (v - yr[0]) / (yr[1] - yr[0]) * ph;
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = MUTED;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of ticks(yr[0], yr[1], 4)) {
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke();
    ctx.fillText(niceNum(v), padL - 4, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of ticks(xr[0], xr[1], 4)) {
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(X(v), padT); ctx.lineTo(X(v), padT + ph); ctx.stroke();
    ctx.fillText(niceNum(v), X(v), padT + ph + 3);
  }
  ctx.fillStyle = INK; ctx.font = '11px Inter, sans-serif';
  ctx.fillText(xLabel, padL + pw / 2, h - 13);
  ctx.save(); ctx.translate(9, padT + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(yLabel, 0, 0); ctx.restore();
  canvas._points = points.map(p => ({ ...p, sx: X(p.x), sy: Y(p.y) }));
  for (const p of canvas._points) {
    ctx.fillStyle = p.color; ctx.strokeStyle = SURFACE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, p.sel ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.sel) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(p.sx, p.sy, 8, 0, Math.PI * 2); ctx.stroke(); }
  }
  const hp = canvas._hoverPt;
  if (hp) {
    ctx.font = '11px Inter, sans-serif';
    const tw = ctx.measureText(hp.label).width + 12;
    let tx = hp.sx + 8; if (tx + tw > w) tx = hp.sx - tw - 8;
    ctx.fillStyle = 'rgba(12,16,22,0.95)'; ctx.strokeStyle = '#2a3542';
    ctx.beginPath(); ctx.roundRect(tx, hp.sy - 22, tw, 18, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(hp.label, tx + 6, hp.sy - 13);
  }
}

// Poziomy wykres słupkowy (przyczyny śmierci)
export function barChart(canvas, items) {
  const rowH = 20;
  const { ctx, w } = setup(canvas, Math.max(40, items.length * rowH + 4));
  const max = Math.max(1, ...items.map(i => i.value));
  const labelW = 120;
  ctx.font = '11.5px Inter, sans-serif'; ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const y = i * rowH + 2;
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.fillText(it.label, 0, y + rowH / 2);
    const bw = (w - labelW - 50) * it.value / max;
    ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.roundRect(labelW, y + 5, Math.max(2, bw), rowH - 10, [0, 4, 4, 0]); ctx.fill();
    ctx.fillStyle = '#e6edf3'; ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(String(it.value), labelW + bw + 6, y + rowH / 2);
    ctx.font = '11.5px Inter, sans-serif';
  });
}

// Drzewo filogenetyczne
export function treeChart(canvas, sim, minPeak, highlight) {
  const all = [...sim.species.map.values()];
  const shown = new Set(all.filter(s => s.extinct === null || s.peak >= minPeak).map(s => s.id));
  // najbliższy widoczny przodek
  const visParent = s => { let p = s.parent; while (p !== null && p !== undefined && !shown.has(p)) { const ps = sim.species.get(p); p = ps ? ps.parent : null; } return p ?? null; };
  const list = all.filter(s => shown.has(s.id));
  const kids = new Map();
  const roots = [];
  for (const s of list) {
    const p = visParent(s);
    if (p === null) roots.push(s); else { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(s); }
  }
  const order = [];
  const visit = s => { order.push(s); for (const k of (kids.get(s.id) || []).sort((a, b) => a.born - b.born)) visit(k); };
  roots.sort((a, b) => a.born - b.born).forEach(visit);
  const rowH = 16;
  const { ctx, w, h } = setup(canvas, Math.max(260, order.length * rowH + 40));
  const padL = 16, padR = 120, padT = 10, padB = 22;
  const now = sim.tick, yl = sim.cfg.yearLength;
  const t0 = 0;
  const X = t => padL + (t - t0) / Math.max(1, now - t0) * (w - padL - padR);
  const yOf = new Map();
  order.forEach((s, i) => yOf.set(s.id, padT + i * rowH + rowH / 2));
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of ticks(0, now / yl, 5)) {
    const x = X(v * yl);
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.fillText(`${v} r.`, x, h - padB + 4);
  }
  canvas._rows = [];
  for (const s of order) {
    const y = yOf.get(s.id);
    const xa = X(s.born), xb = X(s.extinct ?? now);
    const alive = s.extinct === null;
    const col = `hsla(${s.hue},80%,62%,${alive ? 1 : 0.55})`;
    const p = visParent(s);
    if (p !== null && yOf.has(p)) {
      ctx.strokeStyle = `hsla(${s.hue},60%,55%,0.45)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xa, yOf.get(p)); ctx.lineTo(xa, y); ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = alive ? 2 + Math.min(4, s.count / 10) : 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(Math.max(xa + 1, xb), y); ctx.stroke();
    if (highlight === s.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(xa - 3, y - 6, Math.max(6, xb - xa) + 6, 12); }
    ctx.fillStyle = alive ? '#e6edf3' : MUTED; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(alive ? `${s.name} (${s.count})` : s.name + ' †', Math.max(xa, xb) + 6, y);
    canvas._rows.push({ id: s.id, y });
  }
  if (!order.length) { ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Brak gatunków', w / 2, h / 2); }
}

// Diagram sieci neuronowej
export function brainChart(canvas, c) {
  const { ctx, w, h } = setup(canvas, 330);
  const w8 = c.g.w;
  const colX = [118, w / 2 + 25, w - 72];
  const yIn = i => 10 + i * ((h - 20) / (NI - 1));
  const yHid = i => 30 + i * ((h - 60) / (NH - 1));
  const yOut = i => 50 + i * ((h - 100) / (NO - 1));
  ctx.lineWidth = 1;
  for (let hh = 0; hh < NH; hh++) for (let i = 0; i < NI; i++) {
    const v = w8[hh * (NI + 1) + i];
    const a = clamp(Math.abs(v) / 3, 0, 1) * 0.55 * (0.3 + Math.abs(c.inp[i]) * 0.7);
    if (a < 0.03) continue;
    ctx.strokeStyle = v > 0 ? `rgba(79,209,197,${a})` : `rgba(248,113,113,${a})`;
    ctx.beginPath(); ctx.moveTo(colX[0], yIn(i)); ctx.lineTo(colX[1], yHid(hh)); ctx.stroke();
  }
  for (let o = 0; o < NO; o++) for (let hh = 0; hh < NH; hh++) {
    const v = w8[W1 + o * (NH + 1) + hh];
    const a = clamp(Math.abs(v) / 3, 0, 1) * 0.7 * (0.3 + Math.abs(c.hidden[hh]) * 0.7);
    if (a < 0.03) continue;
    ctx.strokeStyle = v > 0 ? `rgba(79,209,197,${a})` : `rgba(248,113,113,${a})`;
    ctx.lineWidth = 1 + Math.abs(v) * 0.3;
    ctx.beginPath(); ctx.moveTo(colX[1], yHid(hh)); ctx.lineTo(colX[2], yOut(o)); ctx.stroke();
  }
  const node = (x, y, v) => {
    ctx.fillStyle = v >= 0 ? `rgba(79,209,197,${0.25 + Math.abs(v) * 0.75})` : `rgba(248,113,113,${0.25 + Math.abs(v) * 0.75})`;
    ctx.strokeStyle = '#2a3542'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  ctx.font = '10px Inter, sans-serif'; ctx.textBaseline = 'middle';
  for (let i = 0; i < NI; i++) {
    node(colX[0], yIn(i), c.inp[i]);
    ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(INPUTS[i], colX[0] - 9, yIn(i));
  }
  for (let i = 0; i < NH; i++) node(colX[1], yHid(i), c.hidden[i]);
  for (let i = 0; i < NO; i++) {
    node(colX[2], yOut(i), c.out[i]);
    ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(OUTPUTS[i], colX[2] + 9, yOut(i));
  }
}
