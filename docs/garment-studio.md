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
  pliec. V strede sa drevo dvíha do zaobleného vrcholu, ktorý vidno cez výstrih.
  Chrómový hák má drôt 5 mm, rovnú stopku a zahnutý oblúk s guľôčkou na konci.
- Výstrih je pri simulácii pripnutý v nakreslenom tvare, pretože ho drží rebrový lem.
  Plecia na ramienku dostanú oproti strihu ďalší sklon približne 12°.
- Povrch ramienka: matná biela alebo breza, samostatný kovový materiál
  `hanger-chrome` má metalness 1 a roughness 0,1.

## Parametre štúdia

Implementácia je v `artifacts/cut-render/src/engine/garment-stage.ts`.
Pozície a rozmery sú lokálne voči skupine štúdia, ktorá sa škáluje polomerom modelu.

| Svetlo | Farba | Intenzita | Pozícia | Rozmery |
| --- | --- | --- | --- | --- |
| Hlavný softbox, RectAreaLight | `#fff7ed` | 2,4 | `(-3, 5, 3)` | `2 × 2,8` |
| Výplň, RectAreaLight | `#e9f1ff` | 0,7 | `(3.5, 2, 2)` | `2,4 × 3` |
| Gobo, SpotLight | `#fff5e8` | 0,9 pri zapnutí | `(-2.5, 3, 2.5)` | uhol 0,42 rad |

Gobo používa skutočné listové clony, nie premietnutý obrázok. Svetlo má penumbra 0,7,
shadow mapu 2048² a shadow radius 3. Prepínač je v karte **Render → Odevné štúdio**.
V path tracingu rozmazanie tieňov závisí od veľkosti zdroja; shadow radius patrí
do rasterizačného náhľadu.

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
