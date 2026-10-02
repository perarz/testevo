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

- **Świat 2D z biomami**: woda, plaże, pustynie, stepy, łąki, lasy, tundra, góry i skały (ściany). Na północy jest zimno, na południu gorąco. Pory roku zmieniają temperaturę, zimą pojawia się śnieg.
- **Stworki** z 10 genami: rozmiar, prędkość, wzrok, mięsożerność, optymalna temperatura, odporność na toksyny, płodność, długość życia, tempo mutacji (samo ewoluuje) i neutralna barwa (pokazuje dryf genetyczny).
- **Kompromisy (trade-offy)**: większe ciało oznacza większy zapas energii, lepszą odporność na zimno i wygrane walki, ale też większe zużycie energii i wolniejsze skręty. Koszt ruchu rośnie z kwadratem prędkości. Wzrok kosztuje energię. Wszystkożercy trawią oba pokarmy, ale słabiej.
- **Sieć neuronowa** (19 wejść → 10 neuronów ukrytych → 5 wyjść). Wagi są w genomie, więc dziedziczą się, krzyżują i mutują. Na start można dać stworkom „instynkt” albo w pełni losowe mózgi.
- **Rozmnażanie płciowe** z krzyżowaniem genów, drobnymi i rzadkimi dużymi mutacjami oraz izolacją rozrodczą.
- **Gatunki**: wykrywane automatycznie na podstawie odległości genetycznej, z nazwami, kolorami i drzewem filogenetycznym.
- **Ewoluujące rośliny**: rozmiar, tempo wzrostu, zasięg nasion, temperatura, toksyczność (koewolucja z odpornością roślinożerców), przystosowanie do wody (glony).
- **Katastrofy**: susza, epoka lodowcowa, globalne ocieplenie, urodzaj, zaraza roślin, epidemia, meteoryt. Mogą być losowe albo wywoływane ręcznie.
- **Narzędzia „boga”**: sadzenie roślin, rzucanie mięsa, malowanie terenu, piorun, meteoryt, zarażanie i wpuszczanie stworków z kreatora.
- **Kreator stworków**: ustawiasz geny i mózg, a potem wpuszczasz nowy gatunek. Genomy można eksportować i importować jako pliki JSON.
- **Statystyki**: populacja według diety, średnia i odchylenie dowolnej cechy w czasie, wykres rozrzutu populacji (widać rozdzielanie się gatunków), rośliny, liczba gatunków, przyczyny śmierci i kronika wydarzeń.
- **Inspektor osobnika**: energia, zdrowie, wiek, potomstwo, geny i podgląd mózgu na żywo.
- **Prędkość** od x1 do MAX oraz przewijanie ewolucji o 1–100 lat.
- **Zapis i odczyt** świata do pliku albo szybki zapis w przeglądarce.

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
js/render.js      rysowanie świata
js/charts.js      wykresy, drzewo filogenetyczne, podgląd mózgu
js/ui.js          panele boczne
js/config.js      parametry i ich opisy
```
