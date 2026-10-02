// Mała sieć neuronowa: wejścia -> warstwa ukryta (tanh) -> wyjścia (tanh).
// Wagi są częścią genomu, więc dziedziczą się, krzyżują i mutują.
import { gauss, chance } from './util.js';

export const INPUTS = [
  'Energia', 'Zdrowie',
  'Roślina: kierunek', 'Roślina: bliskość',
  'Mięso: kierunek', 'Mięso: bliskość',
  'Inny stworek: kierunek', 'Inny stworek: bliskość', 'Inny: względny rozmiar', 'Inny: mięsożerność',
  'Partner: kierunek', 'Partner: bliskość',
  'Temperatura (stres)', 'Teren przed sobą', 'Gotowy do rozmnażania',
  'Pamięć', 'Zegar wewnętrzny', 'Inny: mój gatunek', 'Stała (bias)',
];
export const OUTPUTS = ['Skręt', 'Ruch', 'Chęć godów', 'Atak', 'Pamięć'];
export const NI = INPUTS.length, NH = 10, NO = OUTPUTS.length;
export const W1 = NH * (NI + 1), W2 = NO * (NH + 1);
export const NW = W1 + W2;

export function randomWeights(scale = 1) {
  const w = new Float32Array(NW);
  for (let i = 0; i < NW; i++) w[i] = gauss() * scale;
  return w;
}

// Mózg z „instynktem” — sensowne zachowanie na start, które ewolucja może zmienić.
export function instinctWeights(noise = 0.25, diet = 0.1) {
  const w = randomWeights(noise);
  const s1 = (h, inp, v) => { w[h * (NI + 1) + inp] = v; };
  const s2 = (o, h, v) => { w[W1 + o * (NH + 1) + h] = v; };
  for (let h = 0; h < 7; h++) for (let i = 0; i <= NI; i++) w[h * (NI + 1) + i] *= 0.3;
  for (let o = 0; o < NO; o++) for (let h = 0; h < 7; h++) w[W1 + o * (NH + 1) + h] *= 0.3;
  // h0: skręt w stronę pożywienia (roślinożerca -> rośliny, mięsożerca -> mięso i ofiary)
  s1(0, 2, 2.4 * (1 - diet));
  s1(0, 4, 2.4 * diet);
  s1(0, 6, 1.8 * Math.max(0, diet - 0.3));
  // h1: skręt w stronę partnera, gdy gotowy
  s1(1, 10, 2.0);
  // h2: „idź do przodu”
  s1(2, 18, 1.5);
  // h3: gotowość do godów
  s1(3, 14, 2.5); s1(3, 18, -0.8);
  s2(0, 0, 1.8); s2(0, 1, 1.6);
  s2(1, 2, 1.5);
  s2(2, 3, 2.0);
  s2(3, 2, -1.0);
  // h5/h6: ucieczka przed mięsożercą (para neuronów „bramkowana” mięsożernością widzianego stworka)
  const flee = 1 - diet;
  s1(5, 9, 5); s1(5, 6, 2); s1(5, 18, -3);
  s1(6, 9, 5); s1(6, 6, -2); s1(6, 18, -3);
  s2(0, 5, -1.2 * flee); s2(0, 6, 1.2 * flee);
  // h4: atak, gdy ktoś jest blisko (tylko u mięsożerców)
  s1(4, 7, 3 * diet); s1(4, 0, -2.5 * diet); s1(4, 9, -1.5 * diet); s1(4, 17, -4 * diet); s1(4, 18, -1.6);
  s2(3, 4, 2.5 * diet);
  return w;
}

export function think(w, inp, hidden, out) {
  let k = 0;
  for (let h = 0; h < NH; h++) {
    let s = 0;
    for (let i = 0; i < NI; i++) s += w[k++] * inp[i];
    s += w[k++];
    hidden[h] = Math.tanh(s);
  }
  for (let o = 0; o < NO; o++) {
    let s = 0;
    for (let h = 0; h < NH; h++) s += w[k++] * hidden[h];
    s += w[k++];
    out[o] = Math.tanh(s);
  }
}

// Krzyżowanie po neuronach: każdy neuron bierze wszystkie wagi wejściowe od jednego rodzica.
export function crossWeights(a, b) {
  const w = new Float32Array(NW);
  for (let h = 0; h < NH; h++) {
    const src = Math.random() < 0.5 ? a : b;
    const o = h * (NI + 1);
    for (let i = 0; i <= NI; i++) w[o + i] = src[o + i];
  }
  for (let q = 0; q < NO; q++) {
    const src = Math.random() < 0.5 ? a : b;
    const o = W1 + q * (NH + 1);
    for (let i = 0; i <= NH; i++) w[o + i] = src[o + i];
  }
  return w;
}

export function mutateWeights(w, rate, scale, bigChance) {
  for (let i = 0; i < NW; i++) {
    if (chance(rate)) w[i] += gauss() * 0.2 * scale;
    if (chance(bigChance * rate)) w[i] = gauss() * 1.5;
    if (w[i] > 6) w[i] = 6; else if (w[i] < -6) w[i] = -6;
  }
}
