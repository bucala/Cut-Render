# Cut & Render

A product studio for designing apparel, packaging and PPF-film-wrapped objects, producing exact cut plans (SVG/DXF/PDF at 1:1 mm) and photoreal path-traced 3D previews.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/cut-render` — the web app (React + Vite, previewPath `/`)
  - `src/engine/` — all geometry/3D logic, framework-free: `packaging.ts` (box dielines + fold animation), `apparel.ts` (garment patterns + nesting), `ppf.ts` (segmentation, LSCM flattening, roll nesting), `importers.ts` (format detection + loaders, OCCT wasm for STEP/IGES/BREP), `viewer.ts` (three.js + three-gpu-pathtracer), `exporters.ts`, `materials.ts`
  - `src/lib/sk.ts` — Slovak UI labels and number/date formatting
- `artifacts/api-server` — projects CRUD, summary, duplicate, exports log, activity feed
- `lib/api-spec/openapi.yaml` — API contract; `lib/db/src/schema/` — Drizzle tables (projects, project_exports, activity)

## Architecture decisions

- Cut plans are generated in the browser and saved to the project as JSON (`plan`, `planStats`); the server never computes geometry.
- Imported 3D model files live only in the browser's IndexedDB — a project with an imported model opened on another browser asks to re-import the file.
- Plan units are mm, y-down. 3D scene is metres (box/garment scaled 0.001; PPF root scaled mmPerUnit/1000).
- "RTX" look = WebGL path tracing (starts after 400 ms camera idle) over a raster preview; PBR Neutral tone mapping (keeps dye/ink colours true; AgX turned saturated reds pink), procedural HDR environments. Dyed tintable fabrics take their sheen colour from the dye.
- PPF template ids: `imported` for user files, `sample:<id>` for built-in sample shapes.
- Print artwork (apparel): layers saved in `project.parameters.artwork`, kept out of the drafting params in the studio so moving a print never re-drafts the pattern. Coordinates are the panel drafting frame (mm; T-shirt x=0 centre, y from HPS). One layer set drives the design board, the 3D overlay textures (redrawn in place) and SVG/PDF exports (DXF has no artwork). Prints are never mirrored.
- Uploaded print images go to App Storage; uploading requires Clerk sign-in, everything else (projects, viewing) stays public. Objects are served same-origin via `/api/storage/objects/*` so canvases stay untainted.

## Product

- Odevy: parametric T-shirt, hoodie, trousers, skirt, tote; sizes XS–XXL, seam/hem allowances, nesting on fabric width.
- 3D tops (T-shirt, hoodie) are built from the drafted pattern itself (`engine/garmentMesh.ts`, cdt2d): front/back pieces + sleeves sewn into the armholes form one flat silhouette, meshed and inflated into front/back layers that meet at closed seams. Silhouette = cut plan; sleeves are part of the body surface. Trousers/skirt/tote still use ring tubes.
- Obaly: FEFCO 0201, ECMA tuck-end, FEFCO 0427 mailer, FEFCO 0300 tray with live 3D folding.
- PPF: import STEP/IGES/STL/OBJ/PLY/3MF/GLB/FBX/DAE/USDZ/BREP (auto-detected), split into film pieces by max angle, flatten with stretch report, nest on roll.
- Exports SVG, DXF, PDF (1:1), JSON; PNG snapshot of the 3D view.
- Apparel design: image/text print layers on front/back/sleeves (tote: both sides), fabric colour swatches, wrinkle slider, hanger, front/back/side camera, Strih/Split/3D layout.

## User preferences

- UI language is Slovak.
- .blend / .uasset cannot be read directly — users export to GLB/FBX first (the app explains this).

## Gotchas

- The screenshot tool's browser has no WebGL; to check the 3D viewer use headless `/repl/tools/bin/chromium` with `--use-angle=swiftshader --enable-unsafe-swiftshader` (e.g. via puppeteer-core in /tmp).
- The studio polls `/api/healthz`, so "network idle" waits never settle — wait on selectors/timeouts instead.
- PDF/DXF text is ASCII-folded (jsPDF standard fonts); diacritics are stripped in exported labels.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
