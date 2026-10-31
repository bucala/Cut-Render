import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Box, Check, FileWarning, Loader2, Upload } from 'lucide-react';
import { useCreateProject, getGetProjectsSummaryQueryKey, getGetRecentActivityQueryKey, type ProductType } from '@workspace/api-client-react';
import {
  getTemplatesFor, defaultParametersFor, getDefaultMaterialId, detectFormat, importModel, saveModelFile,
  UnsupportedFormatError, ACCEPT_ATTRIBUTE, SUPPORTED_FORMATS, SAMPLE_MODELS,
  type DetectionResult, type ImportedModel, type ProgressInfo,
} from '@/engine';
import { ProductGlyph } from '@/components/shell';
import { useToast } from '@/hooks/use-toast';
import { PRODUCT_SK, TEMPLATE_SK, SAMPLE_SK, engineError, num } from '@/lib/sk';
import NotFound from '@/pages/not-found';
import { cn } from '@/lib/utils';

const SUGGEST_SK: Record<string, string> = { apparel: 'odev', packaging: 'obal (krabica)', ppf: 'PPF fólia' };

export default function NewProject() {
  const { productType } = useParams<{ productType: string }>();
  const search = useSearch();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const type = productType as ProductType;
  const valid = type === 'apparel' || type === 'packaging' || type === 'ppf';
  const boxDims = useMemo(() => {
    const sp = new URLSearchParams(search);
    const l = Number(sp.get('l')), w = Number(sp.get('w')), h = Number(sp.get('h'));
    return l && w && h ? { l, w, h } : null;
  }, [search]);

  const templates = useMemo(() => (valid && type !== 'ppf' ? safe(() => getTemplatesFor(type), []) : []), [type, valid]);
  const [template, setTemplate] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [detect, setDetect] = useState<DetectionResult | null>(null);
  const [model, setModel] = useState<ImportedModel | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [importErr, setImportErr] = useState<{ title: string; hint: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateProject();

  if (!valid) return <NotFound />;
  const effectiveTemplate = template ?? (type !== 'ppf' ? templates[0]?.id ?? null : null);

  const runImport = async (f: File) => {
    setFile(f); setDetect(null); setModel(null); setImportErr(null); setTemplate('imported');
    setProgress({ stage: 'Rozpoznávam formát', progress: 0.02 });
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
    try {
      const d = await detectFormat(f);
      setDetect(d);
      const m = await importModel(f, setProgress);
      setModel(m);
    } catch (e) {
      if (e instanceof UnsupportedFormatError) setImportErr({ title: e.format ? `${e.format.label} nie je možné načítať priamo` : 'Neznámy formát súboru', hint: slovakHint(e.format?.id, e.hint) });
      else setImportErr({ title: 'Import zlyhal', hint: engineError(e) });
    } finally { setProgress(null); }
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) runImport(f); };

  const canCreate = name.trim().length > 0 && !!effectiveTemplate && (type !== 'ppf' || effectiveTemplate.startsWith('sample:') || !!model) && !create.isPending;

  const submit = () => {
    if (!effectiveTemplate) return;
    let parameters: Record<string, unknown> = {};
    try { parameters = defaultParametersFor(type, type === 'ppf' ? 'imported' : effectiveTemplate); } catch { parameters = {}; }
    if (type === 'packaging' && boxDims) parameters = { ...parameters, lengthMm: boxDims.l, widthMm: boxDims.w, heightMm: boxDims.h };
    if (type === 'ppf' && model && effectiveTemplate === 'imported') parameters = { ...parameters, mmPerUnit: model.unitGuess.mmPerUnit };
    let materialId = 'kraft-corrugated';
    try { materialId = getDefaultMaterialId(type); } catch { /* keep */ }
    const imported = type === 'ppf' && effectiveTemplate === 'imported' && file;
    create.mutate({ data: {
      name: name.trim(), productType: type, template: effectiveTemplate, materialId, parameters,
      renderSettings: { environment: type === 'ppf' ? 'sunset' : type === 'packaging' ? 'softbox' : 'studio', exposure: 1, pathTracing: true },
      modelFileName: imported ? file!.name : null, modelFormat: imported ? (model?.format.id ?? detect?.format.id ?? null) : null,
    } }, {
      onSuccess: async (p) => {
        if (imported) { try { await saveModelFile(p.id, file!); } catch { toast({ title: 'Model sa neuložil v prehliadači', description: 'V štúdiu ho budete môcť načítať znova.' }); } }
        qc.invalidateQueries({ queryKey: ['/api/projects'] });
        qc.invalidateQueries({ queryKey: getGetProjectsSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
        nav(`/studio/${p.id}`);
      },
      onError: () => toast({ title: 'Projekt sa nepodarilo vytvoriť', variant: 'destructive' }),
    });
  };

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1200px]">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="w-4 h-4" />Prehľad</Link>
      <div className="mt-4 flex items-start gap-5 rise">
        <ProductGlyph type={type} className="w-16 h-16 text-accent shrink-0 hidden sm:block" />
        <div>
          <div className="rule-label">Nový projekt · {PRODUCT_SK[type].tagline}</div>
          <h1 className="font-display font-extrabold text-4xl mt-1">{PRODUCT_SK[type].name}</h1>
          <p className="text-muted-foreground mt-1 max-w-xl">{PRODUCT_SK[type].description}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {(['apparel', 'packaging', 'ppf'] as const).map((t) => (
          <Link key={t} href={`/new/${t}`} data-testid={`link-type-${t}`} className={cn('text-xs px-2.5 py-1 rounded-full border', t === type ? 'bg-sidebar text-sidebar-foreground border-sidebar' : 'hover:bg-muted')}>{PRODUCT_SK[t].name}</Link>
        ))}
      </div>

      <div className="mt-8 grid lg:grid-cols-[1fr_340px] gap-8">
        <div>
          <div className="rule-label mb-3">01 · {type === 'ppf' ? 'Zdroj tvaru' : 'Šablóna'}</div>
          {type !== 'ppf' ? (
            templates.length === 0 ? <EngineWait /> : (
              <div className="grid sm:grid-cols-2 gap-3">
                {templates.map((t) => {
                  const on = effectiveTemplate === t.id;
                  return (
                    <button key={t.id} onClick={() => setTemplate(t.id)} data-testid={`button-template-${t.id}`}
                      className={cn('text-left border rounded-lg p-4 bg-card transition-all relative', on ? 'border-primary ring-2 ring-primary/20' : 'hover:border-accent/40')}>
                      {on && <Check className="absolute top-3 right-3 w-4 h-4 text-primary" />}
                      <div className="font-semibold pr-6">{TEMPLATE_SK[t.id]?.name ?? t.name}</div>
                      <p className="text-sm text-muted-foreground mt-1">{TEMPLATE_SK[t.id]?.description ?? t.description}</p>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="space-y-5">
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                onClick={() => inputRef.current?.click()} data-testid="dropzone-model"
                className={cn('relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center grid-paper transition-all', drag ? 'border-primary scale-[1.01]' : 'hover:border-accent/50')}>
                <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} className="hidden" data-testid="input-model-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) runImport(f); e.target.value = ''; }} />
                <Upload className="w-8 h-8 mx-auto text-accent" />
                <div className="font-display font-semibold text-lg mt-2">Pretiahnite 3D alebo CAD súbor</div>
                <p className="text-sm text-muted-foreground">alebo kliknite a vyberte — formát rozpoznáme automaticky podľa obsahu</p>
                <div className="mt-4 flex flex-wrap justify-center gap-1">
                  {SUPPORTED_FORMATS.map((f) => (
                    <span key={f.id} className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded border', f.supported ? 'bg-card' : 'border-dashed text-muted-foreground')}>{f.label}</span>
                  ))}
                </div>
                {progress && (
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-card/95 backdrop-blur border-t text-left" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between text-xs"><span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />{progress.stage}</span><span className="font-mono">{Math.round(progress.progress * 100)} %</span></div>
                    <div className="h-1 bg-muted rounded mt-2 overflow-hidden"><div className="h-full bg-primary origin-left transition-transform" style={{ transform: `scaleX(${progress.progress})` }} /></div>
                  </div>
                )}
              </div>

              {importErr && (
                <div className="border border-amber-500/40 bg-amber-50 rounded-lg p-4 flex gap-3 rise" data-testid="alert-import-error">
                  <FileWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div><div className="font-semibold">{importErr.title}</div><p className="text-sm mt-1">{importErr.hint}</p></div>
                </div>
              )}

              {model && (
                <div className="border rounded-lg bg-card p-4 rise" data-testid="panel-detected">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{model.fileName}</div>
                    <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-accent text-accent-foreground">{model.format.label}</span>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                    <Stat k="Rozpoznanie" v={detect?.confidence === 'signature' ? 'podľa obsahu' : 'podľa prípony'} />
                    <Stat k="Trojuholníky" v={num(model.triangleCount)} />
                    <Stat k="Rozmer" v={`${num(model.size.x * model.unitGuess.mmPerUnit)} x ${num(model.size.y * model.unitGuess.mmPerUnit)} x ${num(model.size.z * model.unitGuess.mmPerUnit)} mm`} />
                    <Stat k="Jednotka" v={`${model.unitGuess.unit} (1 = ${num(model.unitGuess.mmPerUnit, 1)} mm)`} />
                  </dl>
                  <div className="mt-3 text-sm border-t pt-3">
                    <span className="text-muted-foreground">Odporúčanie: </span><b>{SUGGEST_SK[model.analysis.suggestedProduct]}</b>
                    <span className="text-muted-foreground"> — {model.analysis.reason}</span>
                    <span className="font-mono text-xs ml-2">zhoda s kvádrom {Math.round(model.analysis.boxFit * 100)} %</span>
                  </div>
                  {model.analysis.suggestedProduct === 'packaging' && model.analysis.boxDimsMm && (
                    <button data-testid="button-switch-packaging" onClick={() => { const d = model.analysis.boxDimsMm!; nav(`/new/packaging?l=${Math.round(d.length)}&w=${Math.round(d.width)}&h=${Math.round(d.height)}`); }}
                      className="mt-3 w-full flex items-center gap-3 border border-primary/40 bg-primary/5 rounded-md p-3 text-left hover:bg-primary/10">
                      <Box className="w-5 h-5 text-primary" />
                      <span className="text-sm">Tvar vyzerá ako krabica. <b>Prepnúť na obal</b> s rozmermi {num(model.analysis.boxDimsMm.length)} x {num(model.analysis.boxDimsMm.width)} x {num(model.analysis.boxDimsMm.height)} mm</span>
                    </button>
                  )}
                </div>
              )}

              <div>
                <div className="rule-label mb-2">alebo vstavaná vzorka</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {SAMPLE_MODELS.map((s) => {
                    const id = `sample:${s.id}`; const on = effectiveTemplate === id;
                    return (
                      <button key={s.id} data-testid={`button-sample-${s.id}`} onClick={() => { setTemplate(id); if (!name) setName(SAMPLE_SK[s.id]?.name ?? s.name); }}
                        className={cn('text-left border rounded-lg p-3 bg-card transition-all', on ? 'border-primary ring-2 ring-primary/20' : 'hover:border-accent/40')}>
                        <div className="font-medium text-sm">{SAMPLE_SK[s.id]?.name ?? s.name}</div>
                        <div className="text-xs text-muted-foreground">{SAMPLE_SK[s.id]?.description ?? s.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-8 self-start border rounded-lg bg-card p-5">
          <div className="rule-label mb-3">02 · Pomenovanie</div>
          <label className="text-sm font-medium" htmlFor="name">Názov projektu</label>
          <input id="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={type === 'apparel' ? 'Mikina Tatry, veľkosť M' : type === 'packaging' ? 'Poštová krabica 300 x 200' : 'Kapota Octavia RS'}
            data-testid="input-name" className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
          {boxDims && type === 'packaging' && <p className="text-xs mt-2 text-accent font-mono">Rozmery z modelu: {boxDims.l} x {boxDims.w} x {boxDims.h} mm</p>}
          <div className="mt-4 text-xs text-muted-foreground space-y-1">
            <div>Šablóna: <span className="text-foreground">{effectiveTemplate ? (effectiveTemplate.startsWith('sample:') ? SAMPLE_SK[effectiveTemplate.slice(7)]?.name : TEMPLATE_SK[effectiveTemplate]?.name ?? effectiveTemplate) : 'nevybraná'}</span></div>
            <div>Jednotky: <span className="text-foreground">milimetre</span></div>
          </div>
          <button disabled={!canCreate} onClick={submit} data-testid="button-create"
            className="mt-5 w-full bg-primary text-primary-foreground rounded-md py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 hover:brightness-105">
            {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Otvoriť v štúdiu
          </button>
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div><dt className="rule-label">{k}</dt><dd className="font-mono text-xs mt-0.5">{v}</dd></div>;
}

function EngineWait() {
  return <div className="border border-dashed rounded-lg p-6 text-sm text-muted-foreground">Šablóny sa načítavajú z výpočtového jadra. Ak sa nezobrazia, jadro sa ešte dokončuje — skúste obnoviť stránku o chvíľu.</div>;
}

function safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }

function slovakHint(id: string | undefined, hint: string) {
  if (id === 'blend') return 'Súbory .blend sú interný formát Blenderu. V Blenderi zvoľte File > Export > glTF 2.0 (.glb) alebo FBX a importujte vzniknutý súbor sem.';
  if (id === 'unreal') return 'Assety Unreal Engine (.uasset, .umap) nie je možné čítať mimo editora. Kliknite pravým na asset > Asset Actions > Export, zvoľte FBX alebo glTF a importujte ten súbor.';
  return hint;
}
