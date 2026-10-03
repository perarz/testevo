# EwoSym — symulator ewolucji

Symulator doboru naturalnego w przeglądarce. Stworki z sieciami neuronowymi zamiast mózgów jedzą, uciekają, polują, rozmnażają się płciowo i mutują. Z czasem powstają nowe gatunki, a stare wymierają.

## Uruchomienie

To statyczna strona bez kroku budowania (czysty HTML + moduły JavaScript).

**Lokalnie** (moduły ES wymagają serwera, samo otwarcie pliku nie zadziała):

```bash
npx serve .
# albo
python3 -m http.server 8000
```

**Vercel:** *Add New → Project* i zaimportuj to repozytorium. Jako *Framework Preset* wybierz **Other**, a *Build Command* i *Output Directory* zostaw puste. Każdy push na gałąź wdroży się sam.

## Co jest w środku

- **Świat 2D z biomami** (woda, plaże, pustynie, stepy, łąki, lasy, tundra, góry, skały). Na północy jest zimno, na południu gorąco, są pory roku, a zimą pada śnieg. Do tego **widok 3D** (przycisk „3D” albo klawisz V).
- **Genetyka diploidalna**: każda cecha ma dwa allele, po jednym od matki i ojca, a fenotyp to ich średnia. Dziedziczenie działa według prawa Mendla, mutacje dotyczą pojedynczych alleli (drobne i rzadkie duże).
- **Geny**: rozmiar, prędkość, zasięg wzroku, pole widzenia, mięsożerność, optymalna temperatura, odporność na toksyny, płodność, długość życia, tempo mutacji (samo ewoluuje), ubarwienie, preferowana barwa partnera i wybredność.
- **Sieć neuronowa** (24 wejścia → 12 neuronów → 6 wyjść, z dwiema komórkami pamięci), której wagi są w genach. Stworek widzi tylko w swoim polu widzenia: najbliższą roślinę, mięso, zagrożenie, ofiarę i stado. Partnera słyszy z daleka. Zna swoją energię, zdrowie, wiek, kondycję i temperaturę. Startowe instynkty (jedz, uciekaj, trzymaj się stada, szukaj partnera, odpoczywaj po posiłku, sprintuj w pościgu) ewolucja może zmieniać.
- **Kompromisy**:
  - większe ciało daje zapas energii, wygrane walki i odporność na zimno, ale więcej kosztuje i dłużej dorasta;
  - koszt ruchu rośnie z kwadratem prędkości;
  - sprint daje +35% prędkości kosztem kondycji;
  - szerokie pole widzenia skraca zasięg wzroku;
  - kamuflaż kłóci się z doborem płciowym;
  - wybór między strategią r (dużo małych młodych) a K (mniej, ale większych).
- **Dwie płcie i dobór płciowy**: samica ponosi większy koszt rozrodu i wybiera partnera po kolorze. Różne preferencje mogą rozdzielić populację na gatunki.
- **Cykl życia**: młode rodzą się małe i rosną. Po około 70% życia zaczyna się starzenie, a ryzyko śmierci rośnie wykładniczo (prawo Gompertza).
- **Gatunki** wykrywane automatycznie (odległość genetyczna, izolacja rozrodcza), z nazwami, kolorami i drzewem filogenetycznym.
- **Ekosystem**:
  - rośliny też ewoluują (toksyny, rozmiar, glony);
  - gleba ma składniki odżywcze, które rośliny zużywają, a odchody i rozkładające się ciała oddają;
  - padlina jest pokarmem padlinożerców.
- **Katastrofy**: susza, epoka lodowcowa, ocieplenie, urodzaj, zaraza roślin, epidemia, meteoryt.
- **Narzędzia „boga”**: sadzenie roślin, mięso, malowanie terenu, piorun, meteoryt, zarażanie, wpuszczanie stworków z kreatora.
- **Kreator stworków** z eksportem i importem genomu (JSON).
- **Statystyki**:
  - populacja według diety;
  - średnia ± odchylenie dowolnej cechy w czasie (także ubarwienia, liczonego na kole kolorów);
  - wykres rozrzutu;
  - przyczyny śmierci i statystyki rozmnażania;
  - kronika wydarzeń;
  - inspektor osobnika z allelami i mózgiem na żywo.
- **Prędkość** od x0.1 do MAX, przewijanie o 1–100 lat, zapis i odczyt.

## Struktura

```
index.html        układ strony
css/style.css     wygląd
js/main.js        pętla główna, mysz, klawiatura, zapis/odczyt
js/sim.js         rdzeń symulacji (bez DOM, działa też w Node)
js/genome.js      geny, krzyżowanie, mutacje, odległość genetyczna
js/brain.js       sieć neuronowa i instynkty startowe
js/species.js     wykrywanie gatunków
js/terrain.js     generowanie terenu i biomy
js/render.js      rysowanie świata 2D
js/render3d.js    widok 3D (Three.js)
js/vendor/        Three.js r169 (licencja MIT) dołączony do repo, bez CDN
js/charts.js      wykresy, drzewo filogenetyczne, podgląd mózgu
js/ui.js          panele boczne
js/config.js      parametry i ich opisy
```
