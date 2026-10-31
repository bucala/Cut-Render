import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ImagePlus, Loader2, Sparkles, Sun, X } from 'lucide-react';
import {
  ENVIRONMENTS, LOGO_ACCEPT, type EnvironmentId, type MaterialControls, type ShadowQuality, type ViewerStats,
} from '@/engine';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface VisualizerSettings extends MaterialControls {
  environment: EnvironmentId;
  exposure: number;
  pathTracing: boolean;
  maxSamples: number;
  shadowQuality: ShadowQuality;
  showGround: boolean;
  autoRotate: boolean;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-b p-4 space-y-3"><h3 className="rule-label !text-foreground/70">{title}</h3>{children}</section>;
}

function Toggle({ label, checked, onChange, id, disabled }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; id: string; disabled?: boolean;
}) {
  return <label className="flex items-center justify-between gap-3 text-sm" htmlFor={id}>
    {label}<Switch id={id} data-testid={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </label>;
}

function Range({ label, value, min = 0, max = 1, step = 0.01, onChange, id }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; id: string;
}) {
  return <div className="space-y-2">
    <div className="flex justify-between text-xs"><label id={`${id}-label`}>{label}</label><output className="font-mono">{value.toFixed(step < 1 ? 2 : 0)}</output></div>
    <Slider aria-labelledby={`${id}-label`} data-testid={id} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
  </div>;
}

export function TextureDropzone({ onFile, busy, name, onClear }: {
  onFile: (file: File) => void; busy: boolean; name: string | null; onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return <div className="space-y-2">
    <button type="button" disabled={busy} data-testid="dropzone-logo"
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) onFile(file);
      }}
      className={cn('w-full rounded-xl border border-dashed p-5 text-center transition-colors disabled:opacity-50', over ? 'border-primary bg-primary/10' : 'bg-muted/40 hover:border-primary')}>
      {busy ? <Loader2 className="mx-auto mb-2 size-5 animate-spin" /> : <ImagePlus className="mx-auto mb-2 size-5 text-primary" />}
      <span className="block text-sm font-medium">Presuňte sem vlastné logo</span>
      <span className="mt-1 block text-[11px] text-muted-foreground">alebo vyberte PNG, JPG či WebP · do 25 MB</span>
    </button>
    <input ref={input} className="hidden" type="file" accept={LOGO_ACCEPT} aria-label="Vlastné logo"
      onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ''; }} />
    {name && <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-xs">
      <span className="flex-1 truncate">{name}</span><button onClick={onClear} aria-label="Odstrániť logo" className="p-1"><X className="size-3.5" /></button>
    </div>}
    <p className="text-[11px] text-muted-foreground">Logo môžete pustiť priamo na 3D povrch. Je lokálne a dočasné; trvalú potlač odevu uložte v karte Dizajn.</p>
  </div>;
}

export function VisualizerPanel({ settings: s, onChange, stats, onSnapshot, onStudioRender, busy, ready, logoBusy, logoName, onLogo, onClearLogo, defaults }: {
  settings: VisualizerSettings;
  onChange: <K extends keyof VisualizerSettings>(key: K, value: VisualizerSettings[K]) => void;
  stats: ViewerStats | null;
  onSnapshot: () => void;
  onStudioRender: () => void;
  busy: boolean; ready: boolean;
  logoBusy: boolean; logoName: string | null;
  onLogo: (file: File) => void; onClearLogo: () => void;
  defaults: { roughness: number; metalness: number };
}) {
  const supported = stats?.pathTracingAvailable ?? false;
  const canExport = ready && supported && s.pathTracing && s.shadowQuality === 'soft' && !busy;
  return <>
    <div className="p-4 bg-gradient-to-br from-primary/10 to-transparent border-b">
      <div className="flex items-center gap-2 font-display font-semibold"><Sparkles className="size-4 text-primary" />Produktové fotoštúdio</div>
      <p className="mt-1 text-xs text-muted-foreground">Vzhľad produktu na jedno kliknutie.</p>
    </div>
    <Group title="Kvalita zobrazenia">
      <Toggle id="switch-pathtracing" label="RTX · GPU path tracing" checked={s.pathTracing} onChange={(v) => onChange('pathTracing', v)} disabled={!supported} />
      <p className="text-[11px] text-muted-foreground">{supported ? 'Globálne osvetlenie a odrazy cez WebGL. Nevyžaduje kartu NVIDIA RTX.' : 'Path tracing na tomto GPU nie je dostupný. Používa sa WebGL náhľad.'}</p>
      <div className="text-xs text-muted-foreground">Tiene</div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Kvalita tieňov">
        {([['off', 'Vypnuté'], ['hard', 'Tvrdé'], ['soft', 'Mäkké']] as const).map(([value, label]) =>
          <button key={value} aria-pressed={s.shadowQuality === value} data-testid={`shadow-${value}`} onClick={() => onChange('shadowQuality', value)}
            className={cn('rounded-md px-1 py-2 text-xs', s.shadowQuality === value ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground')}>{label}</button>)}
      </div>
      {s.pathTracing && s.shadowQuality !== 'soft' && <p className="text-[11px] text-muted-foreground">Tvrdé a vypnuté tiene používajú rasterizovaný náhľad. Pre path tracing vyberte mäkké tiene.</p>}
      <Range id="slider-samples" label="Vzorky renderu" min={32} max={2048} step={32} value={s.maxSamples} onChange={(v) => onChange('maxSamples', v)} />
    </Group>
    <Group title="Materiály">
      <Toggle id="switch-textures" label="Textúrovaný model" checked={s.textures} onChange={(v) => onChange('textures', v)} />
      <Toggle id="switch-normal-maps" label="Normálové mapy" checked={s.normalMaps} onChange={(v) => onChange('normalMaps', v)} disabled={!s.textures} />
      <Range id="slider-roughness" label="Drsnosť · Roughness" value={s.roughness ?? defaults.roughness} onChange={(v) => onChange('roughness', v)} />
      <Range id="slider-metalness" label="Kovovosť · Metalness" value={s.metalness ?? defaults.metalness} onChange={(v) => onChange('metalness', v)} />
      <button className="text-xs text-primary underline underline-offset-4" onClick={() => { onChange('roughness', null); onChange('metalness', null); }}>Obnoviť vlastnosti materiálu</button>
    </Group>
    <Group title="Prostredie · HDRI">
      <div className="grid grid-cols-2 gap-2">
        {ENVIRONMENTS.map((env) => <button key={env.id} title={env.description} aria-pressed={s.environment === env.id} onClick={() => onChange('environment', env.id)}
          data-testid={`button-env-${env.id}`} className={cn('rounded-lg border p-3 text-left transition-colors', s.environment === env.id ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
          <Sun className="size-4 mb-2 text-primary" /><span className="text-xs font-medium">{env.label}</span>
        </button>)}
      </div>
      <Range id="slider-exposure" label="Expozícia" min={0.2} max={3} step={0.05} value={s.exposure} onChange={(v) => onChange('exposure', v)} />
      <Toggle id="switch-ground" label="Podlaha" checked={s.showGround} onChange={(v) => onChange('showGround', v)} />
      <Toggle id="switch-autorotate" label="Automatické otáčanie" checked={s.autoRotate} onChange={(v) => onChange('autoRotate', v)} />
    </Group>
    <Group title="Vlastná textúra">
      <TextureDropzone onFile={onLogo} busy={logoBusy || !ready} name={logoName} onClear={onClearLogo} />
    </Group>
    <Group title="Studio Render">
      <p className="text-xs text-muted-foreground">Skutočný 4K PNG bez rozhrania, 3840 × 2160 px. Vyšší počet vzoriek znižuje šum, ale predlžuje render.</p>
      <button onClick={onStudioRender} disabled={!canExport} data-testid="button-studio-render"
        className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-40">
        <Sparkles className="size-4" />Exportovať 4K PNG
      </button>
      {!canExport && <p className="text-[11px] text-muted-foreground">Vyžaduje načítaný objekt, dostupný path tracing a mäkké tiene.</p>}
      <button onClick={onSnapshot} disabled={!ready || busy} className="w-full rounded-lg border py-2 text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40">
        <Camera className="size-3.5" />Rýchla snímka PNG
      </button>
      <div className="text-[11px] text-muted-foreground" aria-live="polite">{stats?.mode === 'pathtracing' ? `${stats.samples} / ${stats.maxSamples} vzoriek${stats.converged ? ' · Hotovo' : ''}` : 'Živý náhľad'}</div>
    </Group>
  </>;
}

export function StudioRenderProgress({ progress, onCancel }: { progress: number; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="studio-render-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}
    className="fixed inset-0 m-auto w-[min(90vw,400px)] rounded-2xl border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/60">
    <Sparkles className="size-6 text-primary mb-3" />
    <h2 id="studio-render-title" className="font-display font-semibold text-lg">Vyvolávam Studio Render</h2>
    <p className="mt-2 text-xs text-muted-foreground">3840 × 2160 px · GPU path tracing. Na slabšom zariadení môže render trvať niekoľko minút.</p>
    <progress className="w-full mt-4 accent-primary" value={progress} max={1} aria-label="Priebeh 4K renderu" />
    <p className="mt-1 font-mono text-xs">{Math.floor(progress * 100)} %</p>
    <button autoFocus onClick={onCancel} className="mt-5 w-full rounded-lg border py-2 text-sm">Zrušiť render</button>
  </dialog>;
}
