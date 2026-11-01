# Nasadenie mimo Replitu: Render + Neon + Cloudflare R2

Web a API bežia spolu v jednom Docker kontajneri na Renderi. Databáza je v Neone,
obrázky v súkromnom R2 buckete. Lokálny disk Renderu sa na dáta nepoužíva.

Po nastavení: **push do `main` → kontroly → schéma Neonu → deploy hook Renderu**.
Pull requesty iba spúšťajú kontroly, nemajú prístup k produkčným secrets.
Úspešný deploy hook znamená prijatie požiadavky, nie dokončený deploy.
Výsledok buildu a nasadenia sleduj v Render → Events.

Nič z nasledujúceho sa vytvorením súborov automaticky neobjednáva ani nemigruje.
Render Blueprint používa **bezplatný plán**. Služba po nečinnosti zaspí a prvá
požiadavka potom trvá dlhšie. Pre stálu prevádzku zmeň v `render.yaml`
`plan: free` na platený `plan: starter` (cenu potvrď v Renderi).

## 1. Neon: PostgreSQL

1. Vytvor projekt v [Neone](https://console.neon.tech/), ideálne vo Frankfurte.
2. Zvoľ databázu a rolu vlastníka. Skopíruj connection string s `sslmode=require`.
3. Pre aplikáciu použi pooled URL (host obsahuje `-pooler`).
   Pre inicializáciu, migráciu a GitHub Actions použi **direct/unpooled URL**.
4. Vytvor prázdnu schému pomocou aktuálneho kódu. Nasledujúce príkazy sú pre
   **Replit Shell / Linux**, nie PowerShell:

   ```bash
   # NEON_DATABASE_URL nastav ako Replit Secret, nie priamo do príkazu.
   DATABASE_URL="$NEON_DATABASE_URL" pnpm --filter @workspace/db push
   ```

Tento príkaz smeruj výhradne na nový Neon, nie na pôvodnú databázu Replitu.
Pri existujúcej databáze si pred zmenami vytvor zálohu alebo Neon branch.
Nepoužívaj `push-force`.

## 2. Cloudflare R2: obrázky

1. V Cloudflare → R2 vytvor bucket, napríklad `cut-render-artwork`.
   R2 môže vyžadovať aktiváciu účtovania. Over limity a ceny.
2. Bucket nechaj **súkromný**. Nezapínaj verejnú `r2.dev` adresu.
3. Vytvor R2 S3 API token s oprávnením **Object Read & Write**, obmedzený iba na tento bucket.
4. Ulož si **Account ID**, **Access Key ID**, **Secret Access Key** a názov bucketu.
   Nejde o bežný Cloudflare Bearer token.
5. Bucket → Settings → CORS policy. Po vytvorení Render služby vlož jej skutočnú adresu:

   ```json
   [
     {
       "AllowedOrigins": ["https://cut-render-XXXX.onrender.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

Pri vlastnej doméne doplň aj jej presný origin. Nepoužívaj `*`.
Prehliadač nahráva cez časovo obmedzenú PUT URL priamo do R2, preto je CORS nutný.
Čítanie obrázkov ide cez `/api/storage/objects/...` na API.
Názov `private` označuje prefix v buckete, nie oprávnenia k projektu:
ako doteraz, obrázky vie načítať každý, kto pozná ich odkaz.

## 3. Clerk: prihlásenie

Replit spravované prihlásenie nemožno len skopírovať do Renderu.
Vytvor vlastnú aplikáciu v [Clerk Dashboard](https://dashboard.clerk.com/).

- Na prvé spustenie na `onrender.com` použi development instance: `pk_test_...` a `sk_test_...`.
- Zapni požadované spôsoby prihlásenia a povoľ adresu aplikácie podľa nastavení Clerk.
- Rovnaký publishable key nastav ako `CLERK_PUBLISHABLE_KEY` aj `VITE_CLERK_PUBLISHABLE_KEY`.
- **`VITE_CLERK_PROXY_URL` nechaj prázdne.** Nekopíruj Replit proxy URL.
- Používatelia si vytvoria nové účty. Tento migračný skript nekopíruje Clerk účty ani heslá.
- Development instance slúži na skúšanie. Pre ostrú prevádzku nastav vlastnú doménu,
  Clerk production instance, DNS záznamy a produkčné OAuth credentials.
  Súčasný kód pre `pk_live_` odvodzuje Clerk host ako `clerk.<doména aplikácie>`,
  preto doména aplikácie musí zodpovedať produkčnej Clerk doméne.

Publishable key je verejný a zabuduje sa do webu. Po jeho zmene treba **nový build**.
Secret key patrí iba do runtime prostredia, nikdy do `VITE_*`.

## 4. Render: jeden web service

1. Nahraj tento kód do GitHub repozitára.
2. Render → New → Blueprint → pripoj `bucala/Cut-Render`, branch `main`.
   Render použije `render.yaml` a koreňový `Dockerfile`.
3. Vyplň hodnoty:

   | Premenná | Hodnota |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled URL |
   | `CLERK_PUBLISHABLE_KEY` | Vlastný Clerk publishable key |
   | `VITE_CLERK_PUBLISHABLE_KEY` | Ten istý publishable key, dostupný aj pri Docker builde |
   | `CLERK_SECRET_KEY` | Clerk secret key |
   | `R2_ACCOUNT_ID` | Cloudflare Account ID |
   | `R2_ACCESS_KEY_ID` | R2 S3 access key |
   | `R2_SECRET_ACCESS_KEY` | R2 S3 secret |
   | `R2_BUCKET` | Názov súkromného bucketu |

   `NODE_ENV`, `PORT` a `STATIC_DIR` už nastavuje Blueprint.
   `R2_PRIVATE_PREFIX=private` a `R2_PUBLIC_PREFIX=public` sú predvolené.
   Nemusíš ich pridávať. Ak ich zmeníš, rovnaké hodnoty musia byť aj pri migrácii.
   Premenné R2 ani databázy nepatria do Docker build argumentov.
4. Prvý build spustí Render pri vytvorení služby. Schéma z kroku 1 musí už existovať.
5. Po spustení doplň adresu služby do R2 CORS a Clerk nastavení.
6. Over `/api/healthz`, otvor `/projects`, prihlás sa, vytvor projekt,
   nahraj PNG, ulož a obnov stránku.

Health endpoint kontroluje HTTP server, nie dostupnosť databázy či R2.
Preto samotný zelený health check nenahrádza skúšku uloženia projektu a obrázka.

## 5. GitHub Actions: automatické nasadenie

1. Render → služba → Settings → Deploy Hook: skopíruj tajnú URL.
2. GitHub → repozitár → Settings → Environments → vytvor `production`.
   V tomto prostredí pridaj secrets:
   - `DATABASE_URL`: **direct** Neon connection string pre schému.
   - `RENDER_DEPLOY_HOOK_URL`: tajná deploy hook URL Renderu.
3. V Renderi nechaj **Auto-Deploy vypnutý**, ako určuje Blueprint.
   Inak by Render nasadzoval ešte pred dokončením CI.
4. Po pushi do `main` workflow `.github/workflows/deploy.yml`:
   - overí typy webu a API, testy, Docker build a HTTP smoke test;
   - spustí `drizzle-kit push` bez `--force`;
   - zavolá Render hook pre presné SHA overeného commitu.
5. Workflow možno opakovať cez Actions → Validate and deploy → Run workflow, branch `main`.

Schéma sa mení ešte počas behu starej verzie. Automaticky nasadzuj iba spätne
kompatibilné zmeny, napríklad nové tabuľky a nullable stĺpce.
Zmazanie alebo premenovanie stĺpcov rieš samostatnou kontrolovanou migráciou.
Ak Drizzle potrebuje interaktívne potvrdenie, krok zlyhá alebo skončí timeoutom.
Nenasadí sa nová verzia. Neprechádzaj to pridaním `--force`.
Zlyhanie Render buildu po úspešnom kroku schémy databázu automaticky nevráti.

## 6. Prenos existujúcich projektov a obrázkov

Tieto skripty spúšťaj **v pôvodnom Replit workspace**, kde je dostupná pôvodná
databáza aj storage sidecar. Vyžadujú Node 24 a nainštalované závislosti.
Najprv vytvor zálohu pôvodnej databázy a samostatnú Neon branch/zálohu.
Migráciu do nového prostredia spusti len raz a až po overení správnych cieľov.

1. Pridaj do Replit Secrets:
   - `SOURCE_DATABASE_URL`: pôvodná Replit databáza.
   - `TARGET_DATABASE_URL`: nový Neon, direct URL.
   - všetky štyri premenné `R2_*` z tabuľky vyššie.
   - `PRIVATE_OBJECT_DIR` a prípadný `PUBLIC_OBJECT_SEARCH_PATHS` ponechaj z Replitu.
2. Neon musí mať inicializovanú schému a **prázdne** tabuľky. Render zatiaľ
   nepoužívaj na tvorbu projektov. Počas finálneho kopírovania zastav úpravy a uploady
   v oboch aplikáciách.
3. Najprv nezapisujúci dry run:

   ```bash
   node scripts/migrate-database.mjs
   node --experimental-strip-types scripts/migrate-objects.mjs
   ```

4. Keď sedia počty a cieľové prostredie:

   ```bash
   node scripts/migrate-database.mjs --apply
   node --experimental-strip-types scripts/migrate-objects.mjs --apply
   ```

Databázový skript kopíruje `projects`, `project_exports` a `activity`, zachová ID,
JSON dáta aj dátumy a posunie sekvencie. Zápisy cieľa sú v jednej transakcii.
Neprázdny cieľ odmietne, nič nemaže. Pôvodnú databázu iba číta.
Nie je to náhrada plnej databázovej zálohy ani všeobecný nástroj na migráciu ďalších tabuliek.

Skript obrázkov mapuje pôvodný súkromný adresár na `private/` a verejné adresáre na
`public/`. `/objects/uploads/...` v projektoch zostáva rovnaké. Súbory streamuje,
po nahratí kontroluje veľkosť. Existujúce objekty rovnakej veľkosti preskočí, rozdielnu
veľkosť odmietne; nevykonáva úplné porovnanie hashov.
Použi nový bucket, nemiešaj doň nesúvisiace súbory.
Ak dva pôvodné verejné adresáre obsahujú rovnaký názov, zachová sa prvý v poradí
`PUBLIC_OBJECT_SEARCH_PATHS` (rovnako ako pri pôvodnom vyhľadávaní).
Pri prerušení možno kopírovanie obrázkov zopakovať.

Po prenose porovnaj počty projektov a vizuálne otvor staršie projekty s potlačou.
Replit dáta nemaž, kým na Renderi neoveríš aj export a opätovné uloženie.
Prechod používateľov zo starej aplikácie urob až po tomto overení.

## Lokálne overenie

S Docker Desktop (Linux containers), z koreňa repozitára:

```text
docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE -t cut-render .
docker run --rm --env-file .env -p 10000:10000 cut-render
```

Skopíruj `.env.example` do `.env` a vyplň ho. Node nenačítava `.env` automaticky,
tu ho načíta Docker. V Dockeri musí byť `STATIC_DIR=/app/artifacts/cut-render/dist/public`.
Pridaj `http://localhost:10000` do R2 CORS, iba ak chceš lokálne skúšať uploady.

Bez Dockeru, po builde webu a API: `node scripts/smoke-production.mjs`.
Smoke test používa fiktívne kľúče bez prihlásenia, kontroluje HTTP, SPA, cache
a odmietnutie anonymného uploadu. Nepotvrdzuje funkčné pripojenie ku cloudovým službám.

Súbory `.env*`, databázové dumpy ani deploy hook URL necommituj.
Skutočné runtime secrets nastavuj iba v dashboardoch služieb.

Referencie: [Render Docker](https://render.com/docs/docker),
[deploy hooks](https://render.com/docs/deploy-hooks),
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
