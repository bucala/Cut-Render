import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUser } from '@clerk/react';
import { Vector2, type Object3D } from 'three';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Camera, Check, CircleAlert, Download, FileUp, Loader2, Maximize, RotateCw, Sparkles, TriangleAlert,
  Box as BoxIcon, Columns2, Scissors,
} from 'lucide-react';
import {
  useGetProject, getGetProjectQueryKey, useUpdateProject, useListProjectExports, getListProjectExportsQueryKey,
  useRecordProjectExport, getGetProjectsSummaryQueryKey, getGetRecentActivityQueryKey, type Project, type ExportFormat,
} from '@workspace/api-client-react';
import {
  useViewer, generateParametricPlan, buildBoxObject, buildGarmentObject, buildPpfObject, generatePpfPlan, createSampleModel,
  loadModelFile, saveModelFile, importModel, getMaterialsFor, BASE_PAINTS, BOX_STYLES, GARMENT_TEMPLATES, SIZES,
  exportPlan, exportGarmentGlb, ACCEPT_ATTRIBUTE, type Viewer, type ViewerStats, type CutPlan, type ImportedModel, type PpfResult, type ProgressInfo,
  type BoxParams, type GarmentParams, type PpfParams, type PlanExportFormat,
  getPrintPanels, garmentSupportsArtwork, sanitizeArtwork, ensureArtworkFonts, onArtworkAssets, newLayerId,
  type ArtworkLayer, type PanelId, type PrintPanel,
} from '@/engine';
import { DesignBoard } from '@/components/design-board';
import { ArtworkPanel } from '@/components/artwork-panel';
import { VisualizerPanel, StudioRenderProgress, type VisualizerSettings } from '@/components/visualizer-panel';
import { useSignInHref } from '@/components/account';
import { uploadArtworkImage } from '@/lib/upload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PlanCanvas, Legend, PieceInfo } from '@/components/plan-canvas';
import { Logo } from '@/components/shell';
import {
  PRODUCT_SK, TEMPLATE_SK, PAINT_SK, MATERIAL_DESC_SK, CATEGORY_SK, area, mm, num, pct, dateTime, engineError, templateName,
} from '@/lib/sk';
import { cn } from '@/lib/utils';

type RS = VisualizerSettings & { color: string | null; showPieces: boolean; wrinkles: number; hanger: boolean; hangerFinish: 'white' | 'birch'; knitSize: number; fabricStrength: number; sheen: number; gobo: boolean; goboPattern: 'leaves' | 'window'; presentation: 'realistic' | 'marketing' };
const RS_DEFAULT: RS = { environment: 'studio', exposure: 1, pathTracing: true, maxSamples: 512, showGround: true, autoRotate: false, color: null, showPieces: true, wrinkles: 1, hanger: true, hangerFinish: 'white', knitSize: 0.8, fabricStrength: 0.65, sheen: 0.45, gobo: false, goboPattern: 'leaves', presentation: 'realistic', textures: true, normalMaps: true, roughness: null, metalness: null, shadowQuality: 'soft' };

/** Common garment fabric colours. */
const FABRIC_SWATCHES: { c: string; n: string }[] = [
  { c: '#f4f3ef', n: 'Biela' }, { c: '#1c1c1e', n: 'Čierna' }, { c: '#9b9da1', n: 'Melír sivá' }, { c: '#1f2a44', n: 'Námornícka' },
  { c: '#a8232c', n: 'Červená' }, { c: '#2f4a35', n: 'Lesná zelená' }, { c: '#d9c8a9', n: 'Piesková' }, { c: '#9fc3df', n: 'Nebesky modrá' },
  { c: '#e7b9c4', n: 'Ružová' }, { c: '#d5a33b', n: 'Horčicová' }, { c: '#5b3f8c', n: 'Fialová' }, { c: '#e2662b', n: 'Oranžová' },
];

type Layout = '3d' | 'split' | 'pattern';

/* ---------------------------------------------------------------- small bits */

function isDark(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

class LocalBoundary extends Component<{ fallback: (err: Error) => ReactNode; children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { return this.state.err ? this.props.fallback(this.state.err) : this.props.children; }
}

function ViewerStage({ onViewer, onStats }: { onViewer: (v: Viewer | null) => void; onStats: (s: ViewerStats | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { viewer, stats } = useViewer(ref);
  const a = useRef(onViewer); a.current = onViewer;
  const b = useRef(onStats); b.current = onStats;
  useEffect(() => { a.current(viewer); }, [viewer]);
  useEffect(() => { b.current(stats); }, [stats]);
  return <div ref={ref} className="absolute inset-0" data-testid="viewer-container" />;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b px-4 py-4">
      <div className="flex items-center justify-between mb-3"><h3 className="rule-label !text-foreground/70">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, unit = 'mm', id }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; id: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const commit = (s: string) => { const n = Number(s.replace(',', '.')); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); else setTxt(String(value)); };
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
        <div className="flex items-center border border-input rounded bg-background focus-within:ring-2 focus-within:ring-ring/25">
          <input id={id} data-testid={`input-${id}`} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
            className="w-16 bg-transparent px-1.5 py-1 text-right font-mono text-xs tnum outline-none" inputMode="decimal" />
          <span className="pr-1.5 font-mono text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider className="mt-2" min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} data-testid={`slider-${id}`} />
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, id }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="flex flex-wrap border rounded-md p-0.5 bg-muted/50 mb-3">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} data-testid={`seg-${id}-${o.v}`}
          className={cn('flex-1 px-2 py-1 text-xs rounded transition-colors', value === o.v ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>{o.l}</button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function Studio() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const q = useGetProject(id, { query: { enabled: Number.isFinite(id) && id > 0, queryKey: getGetProjectQueryKey(id) } });
  if (!Number.isFinite(id) || id <= 0 || (q.isError && !q.data)) {
    return (
      <div className="min-h-[100dvh] grid place-items-center grid-paper px-6">
        <div className="text-center">
          <h1 className="font-display font-bold text-3xl">Projekt sa nenašiel</h1>
          <p className="text-muted-foreground mt-2">Mohol byť zmazaný, alebo je server dočasne nedostupný.</p>
          <div className="mt-5 flex gap-2 justify-center">
            <button onClick={() => q.refetch()} className="border rounded-md px-4 py-2 text-sm hover:bg-muted" data-testid="button-retry-project">Skúsiť znova</button>
            <Link href="/projects" className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm" data-testid="link-projects">Na projekty</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!q.data) return <StudioSkeleton />;
  return <Workspace key={q.data.id} project={q.data} />;
}

function StudioSkeleton() {
  return (
    <div className="h-[100dvh] flex flex-col">
      <div className="h-14 bg-sidebar" />
      <div className="flex-1 grid lg:grid-cols-[300px_1fr_320px]">
        <div className="p-4 space-y-3 border-r">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        <div className="darkroom relative overflow-hidden"><div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/5 to-transparent scan" /></div>
        <div className="p-4 space-y-3 border-l hidden lg:block">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      </div>
    </div>
  );
}

function Workspace({ project }: { project: Project }) {
  const type = project.productType;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [params, setParams] = useState<Record<string, unknown>>(() => {
    const { artwork: _a, ...rest } = (project.parameters ?? {}) as Record<string, unknown>;
    return rest;
  });
  // print artwork is kept apart from the drafting parameters so dragging a layer never re-drafts the pattern
  const [artwork, setArtwork] = useState<ArtworkLayer[]>(() => sanitizeArtwork((project.parameters as Record<string, unknown> | null)?.artwork));
  const [selLayer, setSelLayer] = useState<string | null>(null);
  const [assetsVersion, setAssetsVersion] = useState(0);
  useEffect(() => onArtworkAssets(() => setAssetsVersion((v) => v + 1)), []);
  useEffect(() => { ensureArtworkFonts(artwork); }, [artwork]);
  const [materialId, setMaterialId] = useState(project.materialId);
  const [rs, setRs] = useState<RS>({ ...RS_DEFAULT, ...(project.renderSettings as Partial<RS>) });
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const applyLogo = async (file: File, point?: Vector2) => {
    if (!viewer || logoBusy) return;
    setLogoBusy(true);
    try {
      await viewer.setLogo(file, point);
      setLogoName(file.name);
      setR('textures', true);
    } catch (e) { toast({ title: 'Logo sa nepodarilo aplikovať', description: engineError(e), variant: 'destructive' }); }
    finally { setLogoBusy(false); }
  };
  const [fold, setFold] = useState(type === 'packaging' ? 0 : 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const printable = type === 'apparel' && garmentSupportsArtwork(params.garment);
  const [tab, setTab] = useState<'design' | 'material' | 'render' | 'export'>(type === 'apparel' ? 'design' : 'material');
  const [board, setBoard] = useState<'design' | 'marker'>('design');
  const [layout, setLayout] = useState<Layout>('split');
  const topPanel = useRef<ImperativePanelHandle>(null);
  const bottomPanel = useRef<ImperativePanelHandle>(null);
  const applyLayout = (l: Layout) => {
    setLayout(l);
    if (l === '3d') { topPanel.current?.expand(); bottomPanel.current?.collapse(); }
    else if (l === 'pattern') { bottomPanel.current?.expand(); topPanel.current?.collapse(); }
    else { topPanel.current?.expand(); bottomPanel.current?.expand(); topPanel.current?.resize(56); }
  };
  const set = (k: string, v: unknown) => setParams((p) => ({ ...p, [k]: v }));
  const setR = <K extends keyof RS>(k: K, v: RS[K]) => setRs((r) => ({ ...r, [k]: v }));
  const materials = useMemo(() => getMaterialsFor(type), [type]);
  const material = materials.find((m) => m.id === materialId) ?? materials[0];
  const fabricColor = rs.color ?? material?.color ?? '#f4f3ef';

  /* -------- print artwork */
  const printPanels = useMemo<PrintPanel[]>(() => {
    if (!printable) return [];
    try { return getPrintPanels(params as unknown as GarmentParams); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printable, JSON.stringify(params)]);
  const [activePanel, setActivePanel] = useState<PanelId>('front');
  const panelFor = (id: PanelId) => printPanels.find((p) => p.id === id) ?? printPanels[0];
  const { isSignedIn } = useUser();
  const signInHref = useSignInHref();
  const [uploading, setUploading] = useState(false);
  const addImage = async (file: File, panel?: PanelId, at?: { x: number; y: number }) => {
    const pp = panelFor(panel ?? activePanel);
    if (!pp) return;
    if (!isSignedIn) { toast({ title: 'Prihláste sa', description: 'Na nahrávanie obrázkov sa prihláste. Text môžete pridať aj bez prihlásenia.' }); return; }
    setUploading(true);
    try {
      const up = await uploadArtworkImage(file);
      const width = Math.round(Math.min(pp.printWidth, (pp.printWidth * 1.3) / Math.max(0.3, up.aspect)));
      const layer: ArtworkLayer = { id: newLayerId(), kind: 'image', name: up.name, panel: pp.id, visible: true, x: at?.x ?? pp.anchor.x, y: at?.y ?? pp.anchor.y, rotation: 0, opacity: 1, width, src: up.src, aspect: up.aspect };
      setArtwork((a) => [...a, layer]);
      setSelLayer(layer.id);
      setBoard('design');
    } catch (e) {
      toast({ title: 'Obrázok sa nepodarilo nahrať', description: engineError(e), variant: 'destructive' });
    } finally { setUploading(false); }
  };
  const addText = () => {
    const pp = panelFor(activePanel);
    if (!pp) return;
    const size = pp.id.startsWith('sleeve') ? 14 : 42;
    const layer: ArtworkLayer = { id: newLayerId(), kind: 'text', name: 'Text', panel: pp.id, visible: true, x: pp.anchor.x, y: pp.anchor.y, rotation: 0, opacity: 1, width: 200, text: 'CUT & RENDER', font: 'Anton', size, color: isDark(fabricColor) ? '#ffffff' : '#111111', bold: false, italic: false };
    setArtwork((a) => [...a, layer]);
    setSelLayer(layer.id);
    setBoard('design');
  };

  /* -------- PPF model loading */
  const [model, setModel] = useState<ImportedModel | null>(null);
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'missing' | 'error'>(type === 'ppf' ? 'loading' : 'idle');
  const [modelProgress, setModelProgress] = useState<ProgressInfo | null>(null);
  const [modelErr, setModelErr] = useState('');
  const reimportRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (type !== 'ppf') return;
    let cancel = false;
    (async () => {
      try {
        if (project.template.startsWith('sample:')) { const m = createSampleModel(project.template.slice(7)); if (!cancel) { setModel(m); setModelState('idle'); } return; }
        const f = await loadModelFile(project.id);
        if (!f) { if (!cancel) setModelState('missing'); return; }
        const m = await importModel(f, (p) => !cancel && setModelProgress(p));
        if (!cancel) { setModel(m); setModelState('idle'); }
      } catch (e) { if (!cancel) { setModelErr(engineError(e)); setModelState('error'); } }
      finally { if (!cancel) setModelProgress(null); }
    })();
    return () => { cancel = true; };
  }, [type, project.id, project.template]);

  const reimport = async (f: File) => {
    setModelState('loading'); setModelErr('');
    try {
      const m = await importModel(f, setModelProgress);
      await saveModelFile(project.id, f).catch(() => undefined);
      setModel(m); setModelState('idle');
      updRef.current({ id: project.id, data: { modelFileName: f.name, modelFormat: m.format.id } });
    } catch (e) { setModelErr(engineError(e)); setModelState('error'); }
    finally { setModelProgress(null); }
  };

  /* -------- plan generation */
  const paramsKey = JSON.stringify(params);
  const parametric = useMemo<{ plan: CutPlan | null; error: string | null }>(() => {
    if (type === 'ppf') return { plan: null, error: null };
    try { return { plan: generateParametricPlan(type, params), error: null }; } catch (e) { return { plan: null, error: engineError(e) }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, paramsKey]);

  const [ppf, setPpf] = useState<PpfResult | null>(null);
  const [ppfBusy, setPpfBusy] = useState<ProgressInfo | null>(null);
  const [ppfErr, setPpfErr] = useState<string | null>(null);
  const ppfKey = JSON.stringify({ ...params, paintId: undefined });
  useEffect(() => {
    if (type !== 'ppf' || !model) return;
    let cancel = false;
    const t = setTimeout(async () => {
      setPpfBusy({ stage: 'Segmentujem povrch', progress: 0 }); setPpfErr(null);
      try {
        const r = await generatePpfPlan(model, params as unknown as PpfParams, (p) => !cancel && setPpfBusy(p));
        if (!cancel) setPpf(r);
      } catch (e) { if (!cancel) setPpfErr(engineError(e)); }
      finally { if (!cancel) setPpfBusy(null); }
    }, 450);
    return () => { cancel = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, model, ppfKey]);

  const plan: CutPlan | null = type === 'ppf' ? ppf?.plan ?? null : parametric.plan;
  const planErr = type === 'ppf' ? ppfErr : parametric.error;
  const selectedPiece = plan?.pieces.find((p) => p.id === selected) ?? null;

  /* -------- fold animation on load */
  useEffect(() => {
    if (type !== 'packaging') return;
    let raf = 0; const start = performance.now() + 500;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - start) / 1800));
      setFold(k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [type]);

  /* -------- viewer wiring */
  useEffect(() => { if (viewer) try { viewer.setEnvironment(rs.environment); } catch { /* engine pending */ } }, [viewer, rs.environment]);
  useEffect(() => { if (viewer) try { viewer.setExposure(rs.exposure); } catch { /* */ } }, [viewer, rs.exposure]);
  useEffect(() => { if (viewer) try { viewer.setPathTracing(rs.pathTracing); } catch { /* */ } }, [viewer, rs.pathTracing]);
  useEffect(() => { if (viewer) try { viewer.setMaxSamples(rs.maxSamples); } catch { /* */ } }, [viewer, rs.maxSamples]);
  useEffect(() => { if (viewer) try { viewer.setShowGround(rs.showGround); } catch { /* */ } }, [viewer, rs.showGround]);
  useEffect(() => { if (viewer) try { viewer.setAutoRotate(rs.autoRotate); } catch { /* */ } }, [viewer, rs.autoRotate]);
  useEffect(() => { viewer?.setShadowQuality(rs.shadowQuality); }, [viewer, rs.shadowQuality]);
  useEffect(() => { viewer?.setGobo(type === 'apparel' && rs.gobo ? rs.goboPattern : 'off'); }, [viewer, type, rs.gobo, rs.goboPattern]);
  useEffect(() => { viewer?.setGarmentPresentation(rs.presentation); }, [viewer, rs.presentation]);
  useEffect(() => {
    viewer?.setMaterialControls({ textures: rs.textures, normalMaps: rs.normalMaps, roughness: rs.roughness, metalness: rs.metalness });
  }, [viewer, rs.textures, rs.normalMaps, rs.roughness, rs.metalness]);

  const framed = useRef(false);
  const artworkRef = useRef(artwork); artworkRef.current = artwork;
  const contentRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!viewer) return;
    if (type === 'ppf' && !model) return;
    const timer = window.setTimeout(() => { try {
      const obj = type === 'packaging' ? buildBoxObject(params as unknown as BoxParams, materialId, { fold, color: rs.color })
        : type === 'apparel' ? buildGarmentObject(params as unknown as GarmentParams, materialId, { color: rs.color, artwork: artworkRef.current, wrinkles: rs.wrinkles, hanger: rs.hanger, hangerFinish: rs.hangerFinish, knitSize: rs.knitSize, fabricStrength: rs.fabricStrength, sheen: rs.sheen, presentation: rs.presentation })
        : buildPpfObject(model!, ppf, params as unknown as PpfParams, materialId, { showPieces: rs.showPieces, color: rs.color });
      viewer.setContent(obj, { frame: !framed.current });
      contentRef.current = obj;
      framed.current = true; setBuildErr(null);
    } catch (e) { setBuildErr(engineError(e)); } }, type === 'apparel' ? 120 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, type, paramsKey, materialId, rs.color, rs.showPieces, rs.wrinkles, rs.hanger, rs.hangerFinish, rs.knitSize, rs.fabricStrength, rs.sheen, rs.presentation, fold, model, ppf]);

  // redraw the print textures in place (no geometry rebuild) when layers change or images/fonts arrive
  const artworkKey = JSON.stringify(artwork);
  const artFrame = useRef(0);
  useEffect(() => {
    if (!viewer || type !== 'apparel') return;
    cancelAnimationFrame(artFrame.current);
    artFrame.current = requestAnimationFrame(() => {
      const upd = contentRef.current?.userData.updateArtwork as ((l: ArtworkLayer[]) => void) | undefined;
      if (!upd) return;
      upd(artworkRef.current);
      viewer.refresh();
    });
    return () => cancelAnimationFrame(artFrame.current);
  }, [viewer, type, artworkKey, assetsVersion]);
  const showView = useCallback((v: 'front' | 'back' | 'side') => {
    if (!viewer) return;
    setRs((r) => (r.autoRotate ? { ...r, autoRotate: false } : r));
    try { viewer.setView(v); } catch { /* */ }
  }, [viewer]);

  /* -------- autosave */
  const update = useUpdateProject();
  const updRef = useRef(update.mutate); updRef.current = update.mutate;
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const lastSaved = useRef<string | null>(null);
  const payload = useMemo(() => {
    const template = type === 'packaging' ? (params.style as string | undefined) : type === 'apparel' ? (params.garment as string | undefined) : undefined;
    return { parameters: type === 'apparel' ? { ...params, artwork } : params, materialId, renderSettings: rs as unknown as Record<string, unknown>, ...(plan ? { plan: plan as unknown as Record<string, unknown>, planStats: plan.stats } : {}), ...(template ? { template } : {}) };
  }, [params, artwork, materialId, rs, plan, type]);
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    if (lastSaved.current === null) { lastSaved.current = payloadKey; if (!plan || project.plan) return; }
    if (lastSaved.current === payloadKey && project.plan) return;
    setSaveState('pending');
    const t = setTimeout(() => {
      setSaveState('saving');
      lastSaved.current = payloadKey;
      updRef.current({ id: project.id, data: JSON.parse(payloadKey) }, {
        onSuccess: (p) => {
          setSaveState('saved');
          qc.setQueryData(getGetProjectQueryKey(project.id), p);
          qc.invalidateQueries({ queryKey: ['/api/projects'], exact: false, refetchType: 'none' });
          qc.invalidateQueries({ queryKey: getGetProjectsSummaryQueryKey() });
        },
        onError: () => setSaveState('error'),
      });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  const saveName = () => {
    const n = name.trim();
    if (!n || n === project.name) { setName(project.name); return; }
    updRef.current({ id: project.id, data: { name: n } }, {
      onSuccess: (p) => { qc.setQueryData(getGetProjectQueryKey(project.id), p); qc.invalidateQueries({ queryKey: ['/api/projects'] }); toast({ title: 'Projekt premenovaný' }); },
    });
  };

  /* -------- exports */
  const exportsQ = useListProjectExports(project.id, { query: { queryKey: getListProjectExportsQueryKey(project.id) } });
  const record = useRecordProjectExport({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListProjectExportsQueryKey(project.id) });
    qc.invalidateQueries({ queryKey: getGetProjectsSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
    qc.invalidateQueries({ queryKey: ['/api/projects'] });
  } } });
  const baseName = (name || 'plan').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'plan';
  const doExport = async (f: PlanExportFormat) => {
    if (!plan) return;
    try {
      const fileName = await exportPlan(plan, f, baseName, type === 'apparel' ? artwork : undefined);
      record.mutate({ id: project.id, data: { format: f as ExportFormat, fileName } });
      toast({ title: `Export ${f.toUpperCase()} pripravený`, description: fileName });
    } catch (e) { toast({ title: 'Export zlyhal', description: engineError(e), variant: 'destructive' }); }
  };
  const doGarmentExport = async () => {
    if (!contentRef.current) {
      toast({ title: 'Model sa pripravuje', description: 'Počkajte, kým sa 3D odev načíta.' });
      return;
    }
    try {
      const fileName = await exportGarmentGlb(contentRef.current, baseName);
      toast({ title: 'Export GLB pripravený', description: fileName });
    } catch (e) { toast({ title: 'Export GLB zlyhal', description: engineError(e), variant: 'destructive' }); }
  };
  const [snapBusy, setSnapBusy] = useState(false);
  const [studioProgress, setStudioProgress] = useState<number | null>(null);
  const studioAbort = useRef<AbortController | null>(null);
  useEffect(() => () => studioAbort.current?.abort(), []);
  const saveSnapshot = async (studio = false) => {
    if (!viewer) return;
    const abort = new AbortController();
    if (studio) { studioAbort.current = abort; setStudioProgress(0); }
    setSnapBusy(true);
    try {
      const blob = studio
        ? await viewer.studioRender({ signal: abort.signal, onProgress: setStudioProgress })
        : await viewer.snapshot();
      const fileName = `${baseName}-${studio ? 'studio-4k' : 'render'}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      record.mutate({ id: project.id, data: { format: 'png', fileName } });
      toast({ title: 'Render uložený', description: fileName });
    } catch (e) {
      if (!abort.signal.aborted) toast({ title: 'Snímku sa nepodarilo vytvoriť', description: engineError(e), variant: 'destructive' });
    }
    finally { setSnapBusy(false); setStudioProgress(null); studioAbort.current = null; }
  };
  const snapshot = () => saveSnapshot();

  /* -------- render */
  const progress = stats ? Math.min(1, stats.samples / Math.max(1, stats.maxSamples)) : 0;
  const converged = !!stats?.converged;

  return (
    <div className="h-[100dvh] flex flex-col bg-background">
      {studioProgress !== null && <StudioRenderProgress progress={studioProgress} onCancel={() => studioAbort.current?.abort()} />}
      {/* top bar */}
      <header className="h-14 shrink-0 bg-sidebar text-sidebar-foreground flex items-center gap-3 px-3 md:px-4">
        <Link href="/projects" className="p-1.5 rounded hover:bg-sidebar-accent" data-testid="link-back-projects" aria-label="Späť"><ArrowLeft className="w-4 h-4" /></Link>
        <Link href="/" aria-label="Domov" data-testid="link-home-logo"><Logo className="w-7 h-7 text-sidebar-foreground/50" /></Link>
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            data-testid="input-project-name" maxLength={120}
            className="font-display font-semibold text-base bg-transparent outline-none border-b border-transparent hover:border-sidebar-foreground/20 focus:border-sidebar-primary min-w-0 w-full max-w-[22rem]" />
          <span className="hidden md:inline font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/45 whitespace-nowrap">{PRODUCT_SK[type].name} · {templateName(type, project.template)}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/60" data-testid="status-save">
          {saveState === 'saved' && <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="hidden sm:inline">Uložené</span></>}
          {saveState === 'pending' && <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="hidden sm:inline">Neuložené</span></>}
          {saveState === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline">Ukladám</span></>}
          {saveState === 'error' && <><CircleAlert className="w-3.5 h-3.5 text-rose-400" /><span className="hidden sm:inline">Chyba ukladania</span></>}
        </div>
        <div className="flex bg-sidebar-accent/60 rounded-md p-0.5" role="group" aria-label="Rozloženie">
          {([['pattern', 'Strih', Scissors], ['split', 'Split', Columns2], ['3d', '3D', BoxIcon]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => applyLayout(k)} data-testid={`button-layout-${k}`} title={k === 'pattern' ? 'Len strih' : k === 'split' ? '3D aj strih' : 'Len 3D'}
              className={cn('inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors', layout === k ? 'bg-sidebar text-sidebar-foreground shadow-sm' : 'text-sidebar-foreground/60 hover:text-sidebar-foreground')}>
              <Icon className="w-3.5 h-3.5" /><span className="hidden md:inline">{l}</span>
            </button>
          ))}
        </div>
        <button onClick={snapshot} disabled={!viewer || snapBusy} data-testid="button-snapshot"
          className="ml-1 inline-flex items-center gap-1.5 bg-sidebar-primary text-sidebar-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-40">
          {snapBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}<span className="hidden sm:inline">Snímka PNG</span>
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[290px_1fr_330px] overflow-y-auto lg:overflow-hidden">
        {/* parameters */}
        <aside className="lg:border-r bg-card lg:overflow-y-auto order-2 lg:order-1" data-testid="panel-parameters">
          <Section title="Parametre">
            {type === 'packaging' && <PackagingParams p={params} set={set} fold={fold} setFold={setFold} />}
            {type === 'apparel' && <ApparelParams p={params} set={set} />}
            {type === 'ppf' && <PpfParamsPanel p={params} set={set} model={model} />}
          </Section>
          {plan && (
            <Section title={`Diely · ${plan.pieces.length}`}>
              <ul className="space-y-0.5 -mx-1">
                {plan.pieces.map((pc) => (
                  <li key={pc.id}>
                    <button onClick={() => setSelected(pc.id === selected ? null : pc.id)} onMouseEnter={() => setHover(pc.id)} onMouseLeave={() => setHover(null)} data-testid={`button-piece-${pc.id}`}
                      className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left', pc.id === selected ? 'bg-sidebar text-sidebar-foreground' : pc.id === hover ? 'bg-muted' : 'hover:bg-muted/60')}>
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: pc.color }} />
                      <span className="truncate flex-1">{pc.name}</span>
                      <span className="font-mono text-[10px] opacity-70">x{pc.quantity}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>

        {/* center: darkroom + drawing board */}
        <div className="order-1 lg:order-2 shrink-0 lg:shrink min-h-0 h-[88svh] lg:h-auto">
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel ref={topPanel} defaultSize={56} minSize={20} collapsible collapsedSize={0}
              onCollapse={() => setLayout('pattern')} onExpand={() => setLayout((l) => (l === 'pattern' ? 'split' : l))}>
              <div className="relative h-full darkroom overflow-hidden"
                onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (!file) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  void applyLogo(file, new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2));
                }}>
                <LocalBoundary fallback={(e) => <ViewerPending text={engineError(e)} />}>
                  <ViewerStage onViewer={setViewer} onStats={setStats} />
                </LocalBoundary>
                {(buildErr || (type === 'ppf' && modelState !== 'idle')) && (
                  <div className="absolute inset-0 grid place-items-center p-6 pointer-events-none">
                    <div className="pointer-events-auto max-w-sm text-center text-sidebar-foreground">
                      {type === 'ppf' && modelState === 'loading' && (
                        <><Loader2 className="w-6 h-6 animate-spin mx-auto opacity-70" /><div className="mt-2 text-sm">{modelProgress?.stage ?? 'Načítavam model'}</div>
                          <div className="h-0.5 bg-white/10 mt-3 w-48 mx-auto overflow-hidden"><div className="h-full bg-sidebar-primary origin-left" style={{ transform: `scaleX(${modelProgress?.progress ?? 0.05})` }} /></div></>
                      )}
                      {type === 'ppf' && modelState === 'missing' && (
                        <><FileUp className="w-7 h-7 mx-auto text-sidebar-primary" /><div className="font-display font-semibold text-lg mt-2">Model nie je v tomto prehliadači</div>
                          <p className="text-sm text-sidebar-foreground/60 mt-1">Súbor {project.modelFileName ? <b>{project.modelFileName}</b> : 'modelu'} sa ukladá len lokálne. Importujte ho znova a plán sa prepočíta.</p>
                          <button onClick={() => reimportRef.current?.click()} className="mt-4 bg-sidebar-primary text-sidebar-primary-foreground rounded-md px-4 py-2 text-sm" data-testid="button-reimport">Importovať súbor</button></>
                      )}
                      {type === 'ppf' && modelState === 'error' && (
                        <><TriangleAlert className="w-7 h-7 mx-auto text-amber-400" /><div className="font-display font-semibold mt-2">Model sa nepodarilo načítať</div><p className="text-sm text-sidebar-foreground/60 mt-1">{modelErr}</p>
                          <button onClick={() => reimportRef.current?.click()} className="mt-4 border border-white/20 rounded-md px-4 py-2 text-sm hover:bg-white/5" data-testid="button-reimport-error">Vybrať iný súbor</button></>
                      )}
                      {modelState === 'idle' && buildErr && <ViewerPending text={buildErr} />}
                    </div>
                  </div>
                )}
                <input ref={reimportRef} type="file" accept={ACCEPT_ATTRIBUTE} className="hidden" data-testid="input-reimport" onChange={(e) => { const f = e.target.files?.[0]; if (f) reimport(f); e.target.value = ''; }} />

                {/* render HUD */}
                <div className="absolute top-3 left-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/80">
                  <span className={cn('px-2 py-1 rounded backdrop-blur', converged ? 'bg-emerald-500/25 text-emerald-200' : 'bg-white/10')} data-testid="status-render-mode">
                    {!stats ? 'Inicializácia' : stats.mode === 'pathtracing' ? (converged ? 'Fotorealistický obraz' : 'Path tracing') : 'Náhľad v reálnom čase'}
                  </span>
                  {stats?.mode === 'pathtracing' && <span className="tnum" data-testid="text-samples">{stats.samples} / {stats.maxSamples} vzoriek</span>}
                </div>
                {converged && <div key={String(converged)} className="develop absolute top-3 right-3 flex items-center gap-1.5 text-xs text-emerald-200 bg-black/30 backdrop-blur px-2.5 py-1 rounded"><Sparkles className="w-3.5 h-3.5" />Vyvolané</div>}
                <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/5"><div className="h-full origin-left transition-transform duration-300" style={{ transform: `scaleX(${rs.pathTracing ? progress : 0})`, background: converged ? 'hsl(152 60% 50%)' : 'hsl(var(--primary))' }} /></div>
                <div className="absolute bottom-3 right-3 flex gap-1">
                  <button onClick={() => setR('autoRotate', !rs.autoRotate)} className={cn('p-2 rounded backdrop-blur text-white/80 hover:text-white', rs.autoRotate ? 'bg-sidebar-primary/70' : 'bg-white/10')} data-testid="button-autorotate" aria-label="Automatické otáčanie"><RotateCw className="w-4 h-4" /></button>
                  <button onClick={() => { try { viewer?.frame(); } catch { /* */ } }} className="p-2 rounded bg-white/10 backdrop-blur text-white/80 hover:text-white" data-testid="button-frame" aria-label="Zarámovať"><Maximize className="w-4 h-4" /></button>
                </div>
                {type === 'apparel' && (
                  <div className="absolute bottom-3 left-3 flex flex-wrap gap-1 max-w-[70%]">
                    {([['front', 'Spredu'], ['back', 'Zozadu'], ['side', 'Zboku']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => showView(k)} data-testid={`button-view-${k}`}
                        className="px-2.5 py-1.5 rounded bg-white/10 backdrop-blur text-xs text-white/85 hover:text-white hover:bg-white/20">{l}</button>
                    ))}
                    {params.garment !== 'tote' && params.garment !== 'trousers' && params.garment !== 'skirt' && (
                      <button onClick={() => setR('hanger', !rs.hanger)} data-testid="button-hanger"
                        className={cn('px-2.5 py-1.5 rounded backdrop-blur text-xs hover:text-white', rs.hanger ? 'bg-sidebar-primary/70 text-white' : 'bg-white/10 text-white/85')}>Vešiak</button>
                    )}
                  </div>
                )}
                {type === 'packaging' && (
                  <div className="absolute bottom-4 left-4 w-56 bg-black/35 backdrop-blur rounded-md px-3 py-2 text-white/85">
                    <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest"><span>Sieť</span><span className="tnum">{Math.round(fold * 100)} %</span><span>Krabica</span></div>
                    <Slider className="mt-2" min={0} max={1} step={0.01} value={[fold]} onValueChange={([v]) => setFold(v)} data-testid="slider-fold-viewer" />
                  </div>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel ref={bottomPanel} defaultSize={44} minSize={20} collapsible collapsedSize={0}
              onCollapse={() => setLayout('3d')} onExpand={() => setLayout((l) => (l === '3d' ? 'split' : l))}>
              <div className="relative h-full">
                {printable && printPanels.length > 0 && (
                  <div className="absolute top-3 right-3 z-10 flex bg-card/95 backdrop-blur border rounded-md p-0.5 shadow-sm" role="group" aria-label="Plocha">
                    {([['design', 'Dizajn potlače'], ['marker', 'Strih na látke']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setBoard(k)} data-testid={`button-board-${k}`}
                        className={cn('px-2.5 py-1 text-xs rounded transition-colors', board === k ? 'bg-sidebar text-sidebar-foreground' : 'text-muted-foreground hover:text-foreground')}>{l}</button>
                    ))}
                  </div>
                )}
                {printable && printPanels.length > 0 && board === 'design' ? (
                  <DesignBoard panels={printPanels} layers={artwork} selectedId={selLayer} onSelect={(id) => { setSelLayer(id); if (id) setTab('design'); }}
                    onChange={setArtwork} fabricColor={fabricColor} onDropFile={(f, panel, x, y) => addImage(f, panel, { x, y })} />
                ) : plan ? (
                  <PlanCanvas plan={plan} selectedId={selected} onSelect={setSelected} hoverId={hover} onHover={setHover} artwork={type === 'apparel' ? artwork : undefined} />
                ) : (
                  <div className="h-full grid-paper grid place-items-center p-6 text-center">
                    {planErr ? (
                      <div className="max-w-sm"><TriangleAlert className="w-6 h-6 mx-auto text-amber-600" /><div className="font-display font-semibold mt-2">Plán sa zatiaľ nedá vygenerovať</div><p className="text-sm text-muted-foreground mt-1">{planErr}</p></div>
                    ) : (
                      <div className="w-64"><div className="text-sm">{ppfBusy?.stage ?? (type === 'ppf' && !model ? 'Čakám na model' : 'Rysujem plán')}</div>
                        <div className="h-1 bg-muted rounded mt-3 overflow-hidden"><div className="h-full bg-accent origin-left transition-transform" style={{ transform: `scaleX(${ppfBusy?.progress ?? 0.1})` }} /></div></div>
                    )}
                  </div>
                )}
                {plan && ppfBusy && (
                  <div className="absolute top-3 right-3 bg-card/95 border rounded px-2.5 py-1.5 text-xs flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{ppfBusy.stage} {Math.round(ppfBusy.progress * 100)} %</div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* right panel */}
        <aside className="lg:border-l bg-card lg:overflow-y-auto order-3" data-testid="panel-inspector">
          <div className="sticky top-0 z-10 bg-card border-b px-2 pt-2 flex gap-1">
            {((type === 'apparel' ? [['design', 'Dizajn'], ['material', 'Látka'], ['render', 'Render'], ['export', 'Export']] : [['material', 'Materiál'], ['render', 'Render'], ['export', 'Export']]) as [typeof tab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
                className={cn('px-3 py-2 text-sm border-b-2 -mb-px transition-colors', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>{l}</button>
            ))}
          </div>

          {tab === 'design' && type === 'apparel' && (
            printable && printPanels.length > 0 ? (
              <ArtworkPanel panels={printPanels} layers={artwork} onChange={setArtwork} selectedId={selLayer}
                onSelect={(id) => { setSelLayer(id); const l = artwork.find((x) => x.id === id); if (l) setActivePanel(l.panel); if (id) setBoard('design'); }}
                activePanel={activePanel} onActivePanel={setActivePanel} onAddImage={(f) => addImage(f)} onAddText={addText}
                uploading={uploading} signedIn={!!isSignedIn} signInHref={signInHref} />
            ) : (
              <Section title="Potlač"><p className="text-xs text-muted-foreground" data-testid="text-print-unsupported">Potlač je dostupná pre tričko, mikinu a plátennú tašku. Vyberte jeden z týchto strihov v parametroch.</p></Section>
            )
          )}

          {tab === 'material' && (
            <>
              <Section title="Materiál">
                <div className="space-y-1.5">
                  {materials.map((m) => (
                    <button key={m.id} onClick={() => setMaterialId(m.id)} data-testid={`button-material-${m.id}`}
                      className={cn('w-full flex items-center gap-3 p-2 rounded-md border text-left transition-all', m.id === materialId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60')}>
                      <span className="w-9 h-9 rounded shrink-0 border" style={{ background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,${0.2 + (1 - m.physical.roughness) * 0.5}), transparent 60%), ${m.swatch}` }} />
                      <span className="min-w-0"><span className="block text-sm font-medium truncate">{m.name}</span><span className="block text-[11px] text-muted-foreground">{CATEGORY_SK[m.category] ?? m.category}</span></span>
                    </button>
                  ))}
                </div>
                {material && <p className="text-xs text-muted-foreground mt-3">{MATERIAL_DESC_SK[material.id] ?? material.description}</p>}
              </Section>
              {material?.tintable && (
                <Section title={type === 'apparel' ? 'Farba látky' : 'Farba materiálu'} right={rs.color ? <button className="text-xs text-accent" onClick={() => setR('color', null)} data-testid="button-reset-color">Pôvodná</button> : null}>
                  {type === 'apparel' && (
                    <div className="grid grid-cols-6 gap-1.5 mb-3">
                      {FABRIC_SWATCHES.map((sw) => (
                        <button key={sw.c} title={sw.n} aria-label={sw.n} onClick={() => setR('color', sw.c)} data-testid={`button-fabric-${sw.c.slice(1)}`}
                          className={cn('aspect-square rounded-full border-2 transition-transform hover:scale-110', (rs.color ?? '').toLowerCase() === sw.c ? 'border-primary' : 'border-black/10')}
                          style={{ background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.35), transparent 60%), ${sw.c}` }} />
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <input type="color" value={rs.color ?? material.color} onChange={(e) => setR('color', e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent" data-testid="input-color" />
                    <span className="font-mono text-xs uppercase">{rs.color ?? material.color}</span>
                  </div>
                </Section>
              )}
              {type === 'apparel' && (
                <Section title="Vzhľad">
                  <NumField id="wrinkles" label="Vrásky látky" unit="%" value={Math.round(rs.wrinkles * 100)} min={0} max={250} step={5} onChange={(v) => setR('wrinkles', v / 100)} />
                  <NumField id="knit-size" label="Veľkosť úpletu / väzby" unit="mm" value={rs.knitSize} min={0.6} max={2.5} step={0.1} onChange={(v) => setR('knitSize', v)} />
                  <NumField id="fabric-strength" label="Reliéf vlákien" unit="%" value={Math.round(rs.fabricStrength * 100)} min={0} max={200} step={5} onChange={(v) => setR('fabricStrength', v / 100)} />
                  <NumField id="fabric-sheen" label="Jemný lesk vlákien" unit="%" value={Math.round(rs.sheen * 100)} min={0} max={100} step={5} onChange={(v) => setR('sheen', v / 100)} />
                  {params.garment !== 'tote' && params.garment !== 'trousers' && params.garment !== 'skirt' && (
                    <label className="flex items-center justify-between text-sm">Vešiak<Switch checked={rs.hanger} onCheckedChange={(v) => setR('hanger', v)} data-testid="switch-hanger" /></label>
                  )}
                </Section>
              )}
              {type === 'ppf' && (
                <Section title="Lak pod fóliou">
                  <div className="grid grid-cols-7 gap-1.5">
                    {BASE_PAINTS.map((p) => (
                      <button key={p.id} title={PAINT_SK[p.id] ?? p.name} onClick={() => set('paintId', p.id)} data-testid={`button-paint-${p.id}`}
                        className={cn('aspect-square rounded-full border-2 transition-transform hover:scale-110', params.paintId === p.id ? 'border-primary' : 'border-transparent')}
                        style={{ background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), transparent 55%), ${p.color}` }} />
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">{PAINT_SK[String(params.paintId)] ?? 'Vyberte lak'}</div>
                  <label className="flex items-center justify-between mt-3 text-sm">Zvýrazniť fóliové diely<Switch checked={rs.showPieces} onCheckedChange={(v) => setR('showPieces', v)} data-testid="switch-show-pieces" /></label>
                </Section>
              )}
            </>
          )}

          {tab === 'render' && (<>
            {type === 'apparel' && <Section title="Odevné štúdio">
              <div className="text-xs text-muted-foreground mb-1">Zobrazenie</div>
              <Seg id="presentation" value={rs.presentation} onChange={(v) => setR('presentation', v as RS['presentation'])}
                options={[{ v: 'realistic', l: 'Realistické' }, { v: 'marketing', l: 'Marketingové' }]} />
              <p className="text-xs text-muted-foreground mt-1 mb-3">{rs.presentation === 'marketing'
                ? 'Plný objem ako na katalógovej fotke, pokojnejšie záhyby a pozadie vo farbe odevu.'
                : 'Odev visí pod vlastnou váhou, ako na skutočnej fotke.'}</p>
              <div className="text-xs text-muted-foreground mb-1">Svetelný vzor</div>
              <Seg id="gobo" value={rs.gobo ? rs.goboPattern : 'off'} onChange={(v) => {
                if (v === 'off') setR('gobo', false);
                else { setR('gobo', true); setR('goboPattern', v as RS['goboPattern']); }
              }} options={[{ v: 'off', l: 'Žiadny' }, { v: 'leaves', l: 'Listy' }, { v: 'window', l: 'Okno' }]} />
              {params.garment !== 'tote' && params.garment !== 'trousers' && params.garment !== 'skirt' && <>
                <label className="flex items-center justify-between text-sm mb-3">Ramienko<Switch checked={rs.hanger} onCheckedChange={(v) => setR('hanger', v)} data-testid="switch-studio-hanger" /></label>
                {rs.hanger && <Seg id="hanger-finish" value={rs.hangerFinish} onChange={(v) => setR('hangerFinish', v)}
                  options={[{ v: 'white', l: 'Biela matná' }, { v: 'birch', l: 'Prírodná breza' }]} />}
              </>}
              <p className="text-xs text-muted-foreground">Farbu steny a svetiel určuje zvolené prostredie. Vrásky a štruktúru vlákien upravíte v karte Materiál.</p>
            </Section>}
            <VisualizerPanel settings={rs} onChange={setR} stats={stats}
              onSnapshot={snapshot} onStudioRender={() => saveSnapshot(true)} busy={snapBusy}
              ready={!!viewer && !!contentRef.current && !buildErr} defaults={material?.physical ?? { roughness: 0.9, metalness: 0 }}
              logoBusy={logoBusy} logoName={logoName} onLogo={(file) => { void applyLogo(file); }}
              onClearLogo={() => { viewer?.clearLogo(); setLogoName(null); }} />
          </>)}

          {tab === 'export' && (
            <>
              {type === 'apparel' && <Section title="Model odevu">
                <p className="text-xs text-muted-foreground mb-3">Stiahnite si samostatný 3D model s geometriou, PBR materiálmi a textúrami.</p>
                <button onClick={() => void doGarmentExport()} disabled={!plan}
                  data-testid="button-export-glb" className="w-full border rounded-md p-3 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-40 transition-colors">
                  <div className="flex items-center justify-between font-mono font-semibold text-sm">GLB · model 3D<Download className="w-3.5 h-3.5 opacity-60" /></div>
                  <div className="text-[11px] text-muted-foreground">Jeden súbor, pripravený pre Three.js, Blender a ďalšie nástroje</div>
                </button>
              </Section>}
              <Section title="Export plánu">
                <div className="grid grid-cols-2 gap-2">
                  {([['svg', 'Vektor 1:1'], ['dxf', 'CAD, vrstvy'], ['pdf', 'Tlač 1:1'], ['json', 'Dáta plánu']] as const).map(([f, d]) => (
                    <button key={f} disabled={!plan} onClick={() => doExport(f)} data-testid={`button-export-${f}`}
                      className="group border rounded-md p-3 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-40 transition-colors">
                      <div className="flex items-center justify-between font-mono font-semibold text-sm">{f.toUpperCase()}<Download className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100" /></div>
                      <div className="text-[11px] text-muted-foreground">{d}</div>
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="História exportov">
                {exportsQ.isLoading ? <Skeleton className="h-16" /> : exportsQ.isError ? (
                  <button className="text-sm text-destructive" onClick={() => exportsQ.refetch()} data-testid="button-retry-exports">Nepodarilo sa načítať — skúsiť znova</button>
                ) : (exportsQ.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Zatiaľ žiadne exporty. Prvý súbor pre plotter alebo laser je na jedno kliknutie.</p> : (
                  <ul className="space-y-1.5">
                    {exportsQ.data!.slice().reverse().map((x) => (
                      <li key={x.id} className="flex items-center gap-2 text-xs" data-testid={`row-export-${x.id}`}>
                        <span className="font-mono text-[10px] w-9 text-center rounded bg-sidebar text-sidebar-foreground py-0.5">{x.format.toUpperCase()}</span>
                        <span className="truncate flex-1">{x.fileName}</span>
                        <span className="text-muted-foreground whitespace-nowrap">{dateTime(x.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}

          {plan && (
            <>
              <Section title="Štatistika plánu">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2" data-testid="panel-plan-stats">
                  {[['Diely', num(plan.stats.pieceCount)], ['Plocha', area(plan.stats.totalAreaMm2)], ['Rez', mm(plan.stats.cutLengthMm)], ['Ohyby', mm(plan.stats.foldLengthMm)],
                    ['Hárok', `${num(plan.stats.sheetWidthMm)} x ${num(plan.stats.sheetHeightMm)}`], ['Využitie', pct(plan.stats.utilization)]].map(([k, v]) => (
                    <div key={k}><dt className="rule-label">{k}</dt><dd className="font-mono text-sm tnum">{v}</dd></div>
                  ))}
                </dl>
                <div className="h-1.5 bg-muted rounded mt-3 overflow-hidden"><div className="h-full bg-accent origin-left" style={{ transform: `scaleX(${plan.stats.utilization})` }} /></div>
              </Section>
              <Section title="Legenda čiar"><Legend plan={plan} /></Section>
              {selectedPiece && <Section title="Vybraný diel"><PieceInfo piece={selectedPiece} /></Section>}
              {plan.warnings.length > 0 && (
                <Section title={`Upozornenia · ${plan.warnings.length}`}>
                  <ul className="space-y-1.5" data-testid="list-warnings">
                    {plan.warnings.map((w, i) => <li key={i} className="flex gap-2 text-xs bg-amber-50 border border-amber-200 rounded p-2"><TriangleAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />{w}</li>)}
                  </ul>
                </Section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ViewerPending({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-sidebar-foreground">
      <div className="max-w-xs"><Sparkles className="w-6 h-6 mx-auto opacity-60" /><div className="font-display font-semibold mt-2">Fotoštúdio sa pripravuje</div><p className="text-xs text-sidebar-foreground/55 mt-1">{text}</p></div>
    </div>
  );
}

/* ---------------------------------------------------------------- parameter panels */

type SetFn = (k: string, v: unknown) => void;
const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function PackagingParams({ p, set, fold, setFold }: { p: Record<string, unknown>; set: SetFn; fold: number; setFold: (v: number) => void }) {
  return (
    <>
      <div className="text-xs text-muted-foreground mb-1.5">Konštrukcia</div>
      <select value={String(p.style ?? 'rsc')} onChange={(e) => set('style', e.target.value)} data-testid="select-box-style"
        className="w-full mb-4 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
        {BOX_STYLES.map((s) => <option key={s.id} value={s.id}>{TEMPLATE_SK[s.id]?.name ?? `${s.name} · ${s.code}`}</option>)}
      </select>
      <div className="rule-label mb-2">Vnútorné rozmery</div>
      <NumField id="length" label="Dĺžka" value={n(p.lengthMm, 300)} min={20} max={1200} onChange={(v) => set('lengthMm', v)} />
      <NumField id="width" label="Šírka" value={n(p.widthMm, 200)} min={20} max={1000} onChange={(v) => set('widthMm', v)} />
      <NumField id="height" label="Výška" value={n(p.heightMm, 120)} min={10} max={1000} onChange={(v) => set('heightMm', v)} />
      <div className="rule-label mb-2 mt-4">Materiál a tlač</div>
      <NumField id="thickness" label="Hrúbka lepenky" value={n(p.thicknessMm, 1.5)} min={0.2} max={8} step={0.05} onChange={(v) => set('thicknessMm', v)} />
      <NumField id="glue" label="Lepiaca chlopňa" value={n(p.glueFlapMm, 30)} min={0} max={60} onChange={(v) => set('glueFlapMm', v)} />
      <NumField id="bleed" label="Spadávka" value={n(p.bleedMm, 0)} min={0} max={10} step={0.5} onChange={(v) => set('bleedMm', v)} />
      <div className="rule-label mb-2 mt-4">Skladanie</div>
      <NumField id="fold" label="Poskladanie" unit="%" value={Math.round(fold * 100)} min={0} max={100} onChange={(v) => setFold(v / 100)} />
    </>
  );
}

function ApparelParams({ p, set }: { p: Record<string, unknown>; set: SetFn }) {
  const g = GARMENT_TEMPLATES.find((x) => x.id === p.garment);
  return (
    <>
      <div className="text-xs text-muted-foreground mb-1.5">Strih</div>
      <select value={String(p.garment ?? 'tshirt')} onChange={(e) => set('garment', e.target.value)} data-testid="select-garment"
        className="w-full mb-4 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
        {GARMENT_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{TEMPLATE_SK[x.id]?.name ?? x.name}</option>)}
      </select>
      <div className="text-xs text-muted-foreground mb-1.5">Veľkosť</div>
      <Seg id="size" value={String(p.size ?? 'M')} onChange={(v) => set('size', v)} options={SIZES.map((s) => ({ v: s as string, l: s }))} />
      <div className="text-xs text-muted-foreground mb-1.5">Strihová voľnosť</div>
      <Seg id="fit" value={String(p.fit ?? 'regular')} onChange={(v) => set('fit', v)} options={[{ v: 'slim', l: 'Priliehavý' }, { v: 'regular', l: 'Bežný' }, { v: 'oversized', l: 'Oversize' }]} />
      {g?.hasSleeves !== false && (<>
        <div className="text-xs text-muted-foreground mb-1.5">Rukáv</div>
        <Seg id="sleeve" value={String(p.sleeve ?? 'short')} onChange={(v) => set('sleeve', v)} options={[{ v: 'short', l: 'Krátky' }, { v: 'long', l: 'Dlhý' }]} />
      </>)}
      <div className="rule-label mb-2 mt-2">Prídavky</div>
      <NumField id="seam" label="Švový prídavok" value={n(p.seamAllowanceMm, 10)} min={0} max={30} step={0.5} onChange={(v) => set('seamAllowanceMm', v)} />
      <NumField id="hem" label="Prídavok na lem" value={n(p.hemAllowanceMm, 25)} min={0} max={60} onChange={(v) => set('hemAllowanceMm', v)} />
      <NumField id="length-adjust" label="Úprava dĺžky" value={n(p.lengthAdjustMm, 0)} min={-150} max={150} onChange={(v) => set('lengthAdjustMm', v)} />
      <NumField id="fabric-width" label="Šírka látky" value={n(p.fabricWidthMm, 1500)} min={900} max={3200} step={10} onChange={(v) => set('fabricWidthMm', v)} />
    </>
  );
}

function PpfParamsPanel({ p, set, model }: { p: Record<string, unknown>; set: SetFn; model: ImportedModel | null }) {
  return (
    <>
      {model && (
        <div className="mb-4 rounded-md bg-muted/60 p-2.5 text-xs">
          <div className="font-medium truncate">{model.fileName}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{model.format.label} · {num(model.triangleCount)} trojuholníkov</div>
          <div className="font-mono text-[10px] text-muted-foreground">{num(model.size.x * n(p.mmPerUnit, 1))} x {num(model.size.y * n(p.mmPerUnit, 1))} x {num(model.size.z * n(p.mmPerUnit, 1))} mm</div>
        </div>
      )}
      <NumField id="mm-per-unit" label="Mierka (mm na jednotku)" unit="mm" value={n(p.mmPerUnit, 1)} min={0.01} max={1000} step={0.01} onChange={(v) => set('mmPerUnit', v)} />
      <NumField id="max-angle" label="Max. uhol v diele" unit="°" value={n(p.maxAngleDeg, 35)} min={5} max={90} onChange={(v) => set('maxAngleDeg', v)} />
      <p className="text-[11px] text-muted-foreground -mt-1 mb-3">Nižší uhol = viac menších, plochejších dielov s nižším napätím fólie.</p>
      <NumField id="wrap" label="Presah na zahnutie" value={n(p.wrapMm, 15)} min={0} max={60} onChange={(v) => set('wrapMm', v)} />
      <NumField id="roll" label="Šírka role" value={n(p.rollWidthMm, 1524)} min={300} max={1830} step={1} onChange={(v) => set('rollWidthMm', v)} />
      <NumField id="spacing" label="Rozostup dielov" value={n(p.spacingMm, 10)} min={0} max={50} onChange={(v) => set('spacingMm', v)} />
    </>
  );
}
