// Mała sieć neuronowa: wejścia -> warstwa ukryta (tanh) -> wyjścia (tanh), z dwiema komórkami pamięci
// (wyjścia wracają jako wejścia w następnym kroku). Wagi są częścią genomu, więc dziedziczą się,
// krzyżują i mutują.
import { gauss, chance } from './util.js';

export const INPUTS = [
  'Energia', 'Zdrowie', 'Wiek',
  'Roślina: kierunek', 'Roślina: bliskość',
  'Mięso: kierunek', 'Mięso: bliskość',
  'Zagrożenie: kierunek', 'Zagrożenie: bliskość',
  'Ofiara: kierunek', 'Ofiara: bliskość', 'Ofiara: osłabienie',
  'Stado: kierunek', 'Stado: liczebność', 'Polowanie stada: kierunek',
  'Rodzic: kierunek', 'Rodzic: bliskość',
  'Partner: kierunek', 'Partner: bliskość',
  'Temperatura (stres)', 'Lepsza temp.: lewo/prawo', 'Teren przed sobą', 'Lepszy teren: lewo/prawo',
  'Zapach ofiar: lewo/prawo', 'Zapach ofiar: siła', 'Zapach pastwisk: lewo/prawo', 'Głód (czas bez jedzenia)', 'Gotowy do godów', 'Kondycja (sprint)',
  'Pamięć 1', 'Pamięć 2', 'Zegar wewnętrzny', 'Stała (bias)',
];
export const OUTPUTS = ['Skręt', 'Ruch', 'Chęć godów', 'Atak', 'Pamięć 1', 'Pamięć 2'];
export const IN = Object.fromEntries([
  'energy', 'hp', 'age', 'plantA', 'plantD', 'meatA', 'meatD', 'threatA', 'threatD', 'preyA', 'preyD', 'preyWeak',
  'herdA', 'herdN', 'packA', 'parentA', 'parentD', 'mateA', 'mateD', 'temp', 'tempDir', 'terrain', 'terrainDir', 'preyScentDir', 'preyScent', 'foodScentDir', 'hungerT', 'ready', 'stamina', 'mem1', 'mem2', 'clock', 'bias',
].map((k, i) => [k, i]));
export const NI = INPUTS.length, NH = 16, NO = OUTPUTS.length;
export const W1 = NH * (NI + 1), W2 = NO * (NH + 1);
export const NW = W1 + W2;

export function randomWeights(scale = 1) {
  const w = new Float32Array(NW);
  for (let i = 0; i < NW; i++) w[i] = gauss() * scale;
  return w;
}

// Mózg z „instynktem” — sensowne zachowanie na start, które ewolucja może wzmocnić, osłabić albo zmienić.
export function instinctWeights(noise = 0.25, diet = 0.1) {
  const w = randomWeights(noise);
  const s1 = (h, inp, v) => { w[h * (NI + 1) + inp] = v; };
  const s2 = (o, h, v) => { w[W1 + o * (NH + 1) + h] = v; };
  // neurony z instynktem mają mniej szumu
  for (let h = 0; h < 14; h++) for (let i = 0; i <= NI; i++) w[h * (NI + 1) + i] *= 0.3;
  for (let o = 0; o < NO; o++) for (let h = 0; h < 14; h++) w[W1 + o * (NH + 1) + h] *= 0.3;
  const herb = 1 - diet, carn = Math.max(0, diet - 0.3);
  // mniej szumu w skręcie (wyjście 0) i od „zegara” — inaczej startowe mózgi kręcą się w kółko
  for (let h = 0; h < NH; h++) { w[W1 + h] *= 0.3; w[h * (NI + 1) + IN.clock] *= 0.3; }
  w[W1 + NH] *= 0.3;
  // h0: skręt w stronę pożywienia (rośliny, mięso, ofiara — zależnie od diety)
  s1(0, IN.plantA, 2.4 * herb);
  s1(0, IN.meatA, 2.4 * diet);
  s1(0, IN.preyA, 2.6 * carn * 2);
  s2(0, 0, 1.8);
  // h1: skręt w stronę partnera
  s1(1, IN.mateA, 3.0);
  s2(0, 1, 2.8);
  // h2: „idź do przodu” spokojnym tempem
  s1(2, IN.bias, 1.5); s1(2, IN.energy, -0.4 - 1.4 * diet); // najedzony odpoczywa (zwłaszcza drapieżnik)
  s2(1, 2, 0.7);
  // h9: młode trzymają się rodzica (gdy rodzica nie ma, kierunek = 0 i neuron milczy)
  s1(9, IN.parentA, 2.5);
  s2(0, 9, 2.2);
  // h10: dołączanie do polowania stada (drapieżniki)
  s1(10, IN.packA, 2.5);
  s2(0, 10, 1.2 * carn * 2);
  // h11: tropienie — skręt w stronę silniejszego zapachu ofiar (drapieżniki)
  s1(11, IN.preyScentDir, 2.5);
  s2(0, 11, 1.6 * carn * 2);
  // h12: wędrówka ku bogatszym pastwiskom (roślinożercy)
  s1(12, IN.foodScentDir, 2.5);
  s2(0, 12, 1.1 * herb);
  // h13: omijanie wody i trudnego terenu
  s1(13, IN.terrainDir, 2.5);
  s2(0, 13, 1.3);
  // głód pcha do wędrówki (dłuższe, prostsze trasy zamiast krążenia w miejscu)
  s1(2, IN.hungerT, 0.9); w[2 * (NI + 1) + IN.bias] += 0.9; // głód ma zakres -1..1 — wyrównanie, żeby najedzony nie stał w miejscu
  // h8: termotaksja — skręt w stronę lepszej temperatury (sygnał rośnie z dyskomfortem)
  s1(8, IN.tempDir, 2.0);
  s2(0, 8, 1.2);
  // h7: sprint — przy ucieczce przed zagrożeniem albo w pościgu za ofiarą
  s1(7, IN.threatD, 3 * herb); s1(7, IN.preyD, 4 * carn * 2); s1(7, IN.bias, -0.6 - 1.2 * herb - 2.6 * carn * 2); // sprint dopiero z bliska
  s2(1, 7, 1.6);
  // neuron sprintu w spoczynku daje ok. -1 — wyrównanie w stałej wyjścia, żeby nie hamował zwykłego marszu
  w[W1 + 1 * (NH + 1) + NH] += -1.6 * Math.tanh(w[7 * (NI + 1) + IN.bias] + w[7 * (NI + 1) + NI]);
  // h3: chęć godów, gdy gotowy
  s1(3, IN.ready, 2.5); s1(3, IN.bias, -0.8);
  s2(2, 3, 2.0);
  // h4: atak na bliską ofiarę, tylko gdy głodny (mięsożercy)
  s1(4, IN.preyD, 3.2 * diet); s1(4, IN.preyWeak, 1.2 * diet); s1(4, IN.energy, -2.5 * diet); s1(4, IN.bias, -1.6);
  s2(3, 4, 2.5 * diet); s2(3, 2, -1.0);
  // h5: ucieczka — skręt od zagrożenia (gdy nic nie grozi, kierunek = 0 i neuron milczy)
  s1(5, IN.threatA, 2.5);
  s2(0, 5, -1.6 * herb);
  // h6: trzymanie się stada (słaby odruch — „samolubne stado”)
  s1(6, IN.herdA, 2.0);
  s2(0, 6, 0.5 * herb);
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

// Krzyżowanie po neuronach: każdy neuron bierze wszystkie wagi wejściowe od jednego rodzica
// (geny jednego neuronu są ze sobą „sprzężone”, jak geny leżące blisko na chromosomie).
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
