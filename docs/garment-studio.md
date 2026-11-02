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
- **Marketingové**: odev má plný objem ako na fotke s neviditeľnou figurínou a látka sa
  gravitačne nesimuluje. Tričko a mikina sa obalia okolo tvaru tela: každý riadok strihu
  si zachová svoju šírku ako dĺžku oblúka, takže obrys sa pri plnení zúži (namiesto vankúša
  širokého ako plochý strih). Trup má eliptický prierez (hĺbka polovica šírky, mikina 0,55),
  ktorý sa pri ramenách zatvára k ramennému švu nad ramienkom. Rukávy sú rúrky zavesené
  z hornej hrany rukáva; pri prišití k telu sú ploché (pomer 0,45), k lemu sa zaobľujú (0,75)
  a odstávajú šikmo nadol (krátke 50°, dlhé 62°). Sukňa (3,2×), taška (2,6×) a nohavice
  (2,4×) majú len hlbšie vrstvy. Záhyby majú vlastný katalógový vzor: ťahové záhyby
  od podpazušia k hrudi, mäkké vlny a zvislé riasenie pri leme (lem je zvlnený aj v obryse,
  rebrový lem mikiny ostáva napnutý) a mierne riasenie v podpazuší rukávov.
  Do vertexových farieb sa zapečie mierny tieň od hlavného svetla zľava zhora. Úplet dostane
  jemný melír (svetlé a tmavšie vlákna 1 – 8 mm), aby bol viditeľný aj v náhľade.
  Stena má stredný, menej sýty odtieň
  farby odevu, za odevom ju rozjasňuje mäkký kužeľ svetla a listy sú väčšie a rozmazanejšie.
  Svetlo je kontrastnejšie (menej výplne, silnejší hlavný zdroj).

Prechod ramena do rukáva sa v priestorovom modeli zaobľuje v okolí 36 mm bez zmeny
súradníc strihu alebo potlače. Obvod otvoru rukáva má jemnejšie vzorkovanie; krátky rukáv
sa pri okraji mierne prehne a má skutočný zaoblený lem s polomerom 0,8 mm.
Predná a zadná vrstva majú na uzavretých švoch presne spoločnú polohu aj normálu;
výstrih a voľné lemy sa nezatvárajú. Stehy sledujú hustejšie vzorkovaný povrch a dostávajú
rovnaké lokálne zatienenie ako látka, aby na okrajoch nevytvárali svetlé zúbky.
Spodná hrana rukáva sa pri zostavovaní siete drží mimo boku trupu, aby sa obrys nekrižoval.
Numericky nulové trojuholníky na rovných hranách sa po triangulácii vynechávajú: pri
obalení na zakrivený povrch by sa z nich inak stali skutočné výčnelky.

V oboch režimoch je vnútorná strana látky (viditeľná cez výstrih, rukávy a lem) v náhľade
tmavšia, ako keby ju tienil samotný odev. Path tracer počíta toto zatienenie sám.

Text v aplikácii sa ťahaním myši neoznačuje. Označiť sa dá iba obsah polí a editovateľný text.

Viewer používa procedurálne HDR prostredie, predvolene `studio`, expozíciu 1,
lineárny výpočet osvetlenia a sRGB výstup. Path tracer má 6 odrazov a výstup
Studio Render sa počíta samostatne v rozlíšení 3840 × 2160.

## Látka a obmedzenia

Predvolená normal mapa úpletu má 1024² pixelov na dlaždicu 128 mm, melír má 512² pixelov.
Rozstup úpletu je 0,8 mm, sila reliéfu 0,65 a sheen 0,45.
Ovládač vrások mení makro-geometriu, nie normal mapu úpletu.

Lokálne zatienenie záhybov je aproximované vertexovými farbami. Nie je to samostatná
ray-traced AO textúra. PBD simulácia je rýchla aproximácia, nie offline simulácia
z Marvelous Designer alebo Blenderu. Marketingový tvar je procedurálny model na produktový
náhľad, nie sken konkrétneho ušitého výrobku ani záruka presnej zhody s referenčnou fotografiou.

## Zostavenie a overovanie

Meranie výkonnosti rozlišuje zostavenie modelu od jeho vykreslenia. Triangulácia používa
na meranie vzdialeností pôvodné úsečky strihu, nie ich zbytočne delené kópie.
Pamäťová cache uchováva najviac osem topológií a po štyri pixelové buffery úpletu a melíru.
Kľúče zahŕňajú obrys, vnútorné švy, hustotu siete a parametre textúr. Každý model dostane
vlastné body, indexy a GPU textúry, takže zmena farby, orientácia trojuholníkov ani
uvoľnenie starého modelu nepoškodia ďalší model.

Párové lokálne meranie marketingového trička veľkosti M porovnalo pôvodný commit
`9bbd518` s touto úpravou v jednom prehliadači, striedavo v oboch poradiach.
V poslednom meraní bol medián po vynechaní prvého zo šiestich zostavení 482 ms oproti 158 ms,
teda približne o 67 % menej. Ide o opakované zostavenie samotného modelu, nie o čas
načítania aplikácie, nahrania textúr do GPU alebo dokončenia path tracingu.

`pnpm --dir artifacts/cut-render test` kontroluje okrem drapérie a GLB aj spojitosť
zaobleného ramena, presné spojenie švov, otvorené lemy, geometriu stehov a nezávislosť cache.
Regresia s otočeným obrysom zachytáva aj nulové trojuholníky a vetviace sa hrany. Audit
skutočného predného a zadného plášťa predvoleného trička po spojení našiel iba štyri
jednoduché otvory (výstrih, spodný lem, dva rukávy), bez vedľajších dier či neplatných hrán.
Pri spustenom Vite je na `/tests/browser-garments.html` dostupný testovací vstup používajúci
skutočný generátor a `Viewer`, bez potreby účtu či API. Umožňuje prepnúť rukávy, mikinu,
prezentáciu a path tracing. Stav uvádza režim a skutočný počet vzoriek; samotné zapnutie
prepínača nie je dôkaz, že path tracer úspešne renderuje.

Záverečná lokálna kontrola v Chromium na Windows (WebGL2, RTX 4060) overila zelené
marketingové tričko a krémovú mikinu v skutočnej slučke produkčného `Viewer`.
Oba modely dosiahli 256 vzoriek, `converged: true` a `ptFailed: false`, so zapnutou
štúdiovou stenou. Zachytený bol priamo výstup path tracera, bez následného rasterového
prekreslenia alebo odšumenia. Počet vzoriek nie je meranie rýchlosti renderovania.
Vizuálne sa overili aj dlhé rukávy, realistické tričko, nohavice, sukňa a taška;
kontrola ich geometrických atribútov a indexov nenašla neplatné číselné hodnoty.

Pri veľkom priblížení zostávajú na obryse ramena drobné kroky siete a lem rukáva má
stále definovanú šikmú hranu. Path tracing pri 256 vzorkách obsahuje viditeľné zrno;
krémová mikina v ňom vychádza tmavšia než v rasterovom náhľade. Tieto rozdiely sa
pri overovaní nezakrývali úpravou snímok.

Štúdiová stena pokrýva aj široký trojštvrťový záber, aby v rohu nevznikala čierna plocha.
Je to fyzická stena za odevom, preto pri kontrole zadnej strany modelu môže zakryť pohľad;
samotný exportovaný GLB stenu neobsahuje.

Workspace zámerne vylučuje natívne build závislosti Windows v `pnpm-workspace.yaml`.
Na lokálny build vo Windows treba balíky `@rollup/rollup-win32-x64-msvc`, `@esbuild/win32-x64`,
`lightningcss-win32-x64-msvc` a `@tailwindcss/oxide-win32-x64-msvc` doplniť ručne do `node_modules`.
