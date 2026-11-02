# Odevné produktové štúdio

## Model a export

Odev sa generuje zo zvolenej konfigurácie. V karte **Export → Model odevu → GLB**
sa stiahne jeden súbor s viditeľnou geometriou, PBR materiálmi, textúrami a potlačou.
Ramienko sa zahrnie, ak je zapnuté. Pozadie a osvetlenie nie sú súčasťou modelu.
Rozmery modelu sú v metroch.

- Makro-záhyby sú v geometrii, jemný úplet je v opakovanej normal mape.
- Odev visí pred plynulým pozadím štúdia; podlaha sa pri odevoch nezobrazuje.
- Počiatočný strihový tvar sa uvoľní deterministickou PBD simuláciou.
- Ramienko je jeden plochý diel s hrúbkou 13 mm a bevelom 3 mm. Ramená kopírujú sklon
  pliec a pri koncoch majú zárezy na ramienka. V strede sa ramienko dvíha do zaobleného
  vrcholu, ktorý vidno cez výstrih. Medzi koncami ramien je brezová tyčka na nohavice.
  Biele ramienko má brezový stred.
  Chrómový hák má drôt 5 mm. Stopka sa mierne nakloní, prejde do otvoreného oblúka
  s polomerom 26 mm a koniec sa jemne vyhne von. Celá dráha je hladká, bez zlomov.
- Výstrih je pri simulácii pripnutý v nakreslenom tvare, pretože ho drží rebrový lem.
  Plecia na ramienku dostanú oproti strihu ďalší sklon približne 17°.
- Každý voľný bod látky má tether k najbližšiemu uchytenému bodu, takže sa odev pod
  vlastnou váhou nenaťahuje a dĺžka zodpovedá strihu.
- Povrch ramienka: matná biela alebo breza, samostatný kovový materiál
  `hanger-chrome` má metalness 1 a roughness 0,1.

## Parametre štúdia

Implementácia je v `artifacts/cut-render/src/engine/garment-stage.ts`, štýly prostredí
v `ENV_SPECS` v `viewer.ts`. Pozície sú lokálne voči skupine štúdia, ktorá sa škáluje
polomerom modelu.

Pri odevoch prostredie neurčuje len HDRI odrazy. Mení aj farbu steny, farbu, silu
a smer hlavného svetla, výplň a zadné svetlo:

| Prostredie | Stena | Hlavné svetlo | Zvláštnosť |
| --- | --- | --- | --- |
| Fotoštúdio | `#d5d1c8` | teplé biele zhora zľava | neutrálne |
| Okno | `#c3cbc6` | chladné denné zboku | pásy svetla z okna |
| Softbox | `#efeeea` | biele, silná výplň | ploché a svetlé |
| Dielňa | `#9a8068` | teplé žiarovkové | teplé zadné svetlo |
| Zlatá hodinka | `#c2a28c` | nízke oranžové | teplé pásy z okna |
| Nočný showroom | `#252931` | úzke chladné | silné modré zadné svetlo |

Softboxy (RectAreaLight) v náhľade nevrhajú tiene. Preto pri hlavnom softboxe svieti
SpotLight s mäkkým tieňom, ktorý vrhá tiene rukávov a ramienka na odev aj na stenu.

Svetelný vzor v karte **Render → Odevné štúdio**: *Žiadny*, *Listy* (veľké mäkké tiene listov)
alebo *Okno* (okenné tabule, ktoré vrhajú šikmé pásy svetla cez odev aj stenu). Oba vzory
tvoria skutočné prekážky pred svetlom, nie premietnutý obrázok.

## Zobrazenie: realistické a marketingové

- **Realistické**: odev visí pod vlastnou váhou, stena má farbu prostredia.
- **Marketingové**: odev má plný objem ako na fotke s neviditeľnou figurínou
  (tričko 4,2×, mikina 3,6×, sukňa 3,2×, taška 2,6×, nohavice 2,4× hlbšie vrstvy),
  látka sa gravitačne nesimuluje a záhyby majú vlastný katalógový vzor: ťahové záhyby
  od podpazušia k hrudi, mäkké vlny a zvislé riasenie pri leme (lem je zvlnený aj v obryse,
  rebrový lem mikiny ostáva napnutý) a záhyby v podpazuší rukávov. Telo má oválny prierez,
  rukávy sú o štvrtinu tenšie a odstávajú šikmo nadol (krátke 44°, dlhé 56°).
  Do vertexových farieb sa zapečie tieň od hlavného svetla zľava zhora, takže boky a záhyby
  ostanú čitateľné aj v mäkkom náhľade. Stena má stredný, menej sýty odtieň
  farby odevu, za odevom ju rozjasňuje mäkký kužeľ svetla a listy sú väčšie a rozmazanejšie.
  Svetlo je kontrastnejšie (menej výplne, silnejší hlavný zdroj).

Text v aplikácii sa ťahaním myši neoznačuje. Označiť sa dá iba obsah polí a editovateľný text.

Viewer používa procedurálne HDR prostredie, predvolene `studio`, expozíciu 1,
lineárny výpočet osvetlenia a sRGB výstup. Path tracer má 6 odrazov a výstup
Studio Render sa počíta samostatne v rozlíšení 3840 × 2160.

## Látka a obmedzenia

Predvolená normal mapa úpletu má 512² pixelov na dlaždicu 128 mm.
Rozstup úpletu je 0,8 mm, sila reliéfu 0,65 a sheen 0,45.
Ovládač vrások mení makro-geometriu, nie normal mapu úpletu.

Lokálne zatienenie záhybov je aproximované vertexovými farbami. Nie je to samostatná
ray-traced AO textúra. PBD simulácia je rýchla aproximácia, nie offline simulácia
z Marvelous Designer alebo Blenderu. Referenčné súbory `image_*.png` a AVIF neboli
v tomto pracovnom priestore dostupné, preto zhoda s referenciami ani fotorealistická
kvalita výsledného renderu zatiaľ neboli vizuálne overené.

Workspace zámerne vylučuje natívne build závislosti Windows v `pnpm-workspace.yaml`.
Na lokálny build vo Windows treba balíky `@rollup/rollup-win32-x64-msvc`, `@esbuild/win32-x64`,
`lightningcss-win32-x64-msvc` a `@tailwindcss/oxide-win32-x64-msvc` doplniť ručne do `node_modules`.
