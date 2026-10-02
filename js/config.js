// Wszystkie parametry symulacji. Można je zmieniać na żywo z panelu.

export const DEFAULTS = {
  // Symulacja
  maxCreatures: 100,
  minCreatures: 18,
  assistPopulation: true,
  yearLength: 3600,

  // Świat
  seasonAmplitude: 10,
  climateOffset: 0,
  fertility: 1,
  randomDisasters: true,
  disasterRate: 0.4,

  // Rośliny
  maxPlants: 650,
  plantGrowth: 1,
  plantSeedRate: 1,
  plantSpontaneous: 0.5,
  plantLifespan: 3,
  plantMutation: 0.1,

  // Stworki
  metabolism: 1,
  moveCost: 1,
  visionCost: 1,
  tempCost: 1,
  attackPower: 1,
  plantNutrition: 1,
  meatNutrition: 1,
  meatDecay: 1,
  maturity: 0.12,
  reproCost: 1,

  // Ewolucja
  mutationScale: 1,
  bigMutationChance: 0.02,
  brainMutation: 1,
  speciesThreshold: 0.3,
  mateThreshold: 0.45,
};

// Schemat wykorzystywany do zbudowania suwaków w panelu.
export const SCHEMA = [
  { group: 'sim', key: 'maxCreatures', label: 'Maks. liczba stworków', min: 10, max: 100, step: 1, tip: 'Twardy limit populacji: przy pełnej populacji nowe stworki się nie rodzą.' },
  { group: 'sim', key: 'minCreatures', label: 'Wsparcie populacji poniżej', min: 0, max: 50, step: 1, tip: 'Gdy populacja spadnie poniżej tej liczby, pojawiają się nowe osobniki powstałe z genów najlepiej przystosowanych zmarłych. Zapobiega wymarciu na starcie.' },
  { group: 'sim', key: 'assistPopulation', label: 'Wsparcie populacji włączone', type: 'bool' },
  { group: 'sim', key: 'yearLength', label: 'Długość roku (ticki)', min: 600, max: 12000, step: 100, tip: '60 ticków to 1 sekunda przy prędkości x1.' },

  { group: 'world', key: 'seasonAmplitude', label: 'Siła pór roku (°C)', min: 0, max: 25, step: 0.5, tip: 'O ile stopni zmienia się temperatura między latem a zimą.' },
  { group: 'world', key: 'climateOffset', label: 'Klimat (przesunięcie °C)', min: -25, max: 25, step: 0.5, tip: 'Globalne ocieplenie lub ochłodzenie całego świata.' },
  { group: 'world', key: 'fertility', label: 'Żyzność gleby', min: 0, max: 3, step: 0.05, tip: 'Mnożnik tempa wzrostu wszystkich roślin.' },
  { group: 'world', key: 'randomDisasters', label: 'Losowe katastrofy', type: 'bool' },
  { group: 'world', key: 'disasterRate', label: 'Częstość katastrof (na rok)', min: 0, max: 3, step: 0.05 },

  { group: 'plants', key: 'maxPlants', label: 'Maks. liczba roślin', min: 50, max: 1500, step: 10 },
  { group: 'plants', key: 'plantGrowth', label: 'Tempo wzrostu', min: 0, max: 4, step: 0.05 },
  { group: 'plants', key: 'plantSeedRate', label: 'Rozsiewanie nasion', min: 0, max: 5, step: 0.05 },
  { group: 'plants', key: 'plantSpontaneous', label: 'Nasiona z wiatrem (na sek.)', min: 0, max: 5, step: 0.05, tip: 'Losowe nowe rośliny pojawiające się w dowolnym miejscu mapy.' },
  { group: 'plants', key: 'plantLifespan', label: 'Długość życia roślin (lata)', min: 0.5, max: 10, step: 0.1 },
  { group: 'plants', key: 'plantMutation', label: 'Mutacje roślin', min: 0, max: 0.5, step: 0.01 },

  { group: 'creatures', key: 'metabolism', label: 'Metabolizm (koszt życia)', min: 0.2, max: 3, step: 0.05, tip: 'Ile energii zużywa samo istnienie. Większe ciało zużywa jej więcej.' },
  { group: 'creatures', key: 'moveCost', label: 'Koszt ruchu', min: 0, max: 4, step: 0.05, tip: 'Rośnie z kwadratem prędkości i z masą ciała.' },
  { group: 'creatures', key: 'visionCost', label: 'Koszt wzroku', min: 0, max: 4, step: 0.05 },
  { group: 'creatures', key: 'tempCost', label: 'Koszt złej temperatury', min: 0, max: 4, step: 0.05 },
  { group: 'creatures', key: 'attackPower', label: 'Siła ataku', min: 0, max: 4, step: 0.05 },
  { group: 'creatures', key: 'plantNutrition', label: 'Wartość odżywcza roślin', min: 0.1, max: 4, step: 0.05 },
  { group: 'creatures', key: 'meatNutrition', label: 'Wartość odżywcza mięsa', min: 0.1, max: 4, step: 0.05 },
  { group: 'creatures', key: 'meatDecay', label: 'Tempo gnicia mięsa', min: 0, max: 5, step: 0.05 },
  { group: 'creatures', key: 'maturity', label: 'Dojrzałość (część życia)', min: 0.02, max: 0.5, step: 0.01, tip: 'Po jakiej części życia stworek może się rozmnażać.' },
  { group: 'creatures', key: 'reproCost', label: 'Koszt rozmnażania', min: 0.2, max: 3, step: 0.05 },

  { group: 'evo', key: 'mutationScale', label: 'Mnożnik mutacji', min: 0, max: 5, step: 0.05, tip: 'Każdy stworek ma też własny gen „tempo mutacji”, który może ewoluować. To jest globalny mnożnik.' },
  { group: 'evo', key: 'bigMutationChance', label: 'Szansa dużej mutacji', min: 0, max: 0.3, step: 0.005, tip: 'Rzadka, skokowa zmiana cechy zamiast drobnej korekty.' },
  { group: 'evo', key: 'brainMutation', label: 'Mutacje mózgu', min: 0, max: 5, step: 0.05, tip: 'Jak mocno mutują wagi sieci neuronowej.' },
  { group: 'evo', key: 'speciesThreshold', label: 'Próg nowego gatunku', min: 0.05, max: 1.5, step: 0.01, tip: 'Odległość genetyczna od średniej gatunku, po której przekroczeniu potomek zakłada nowy gatunek.' },
  { group: 'evo', key: 'mateThreshold', label: 'Próg zgodności partnerów', min: 0.05, max: 2, step: 0.01, tip: 'Maksymalna odległość genetyczna, przy której dwa stworki mogą mieć potomstwo (izolacja rozrodcza).' },
];

export const GROUPS = {
  sim: 'Symulacja',
  world: 'Świat i klimat',
  plants: 'Rośliny',
  creatures: 'Stworki (fizjologia)',
  evo: 'Ewolucja i genetyka',
};
