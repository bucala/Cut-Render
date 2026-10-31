import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowUp, Bold, Copy, Eye, EyeOff, ImagePlus, Italic, Loader2, LogIn, Trash2, Type } from 'lucide-react';
import { ARTWORK_FONTS, artworkHref, artworkImageFailed, type ArtworkLayer, type PanelId, type PrintPanel } from '@/engine';
import { Slider } from '@/components/ui/slider';
import { ARTWORK_ACCEPT } from '@/lib/upload';
import { cn } from '@/lib/utils';

function Block({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b px-4 py-4">
      <div className="flex items-center justify-between mb-3"><h3 className="rule-label !text-foreground/70">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

function Num({ label, value, onChange, min, max, step = 1, unit, id }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit: string; id: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const commit = (s: string) => { const n = Number(s.replace(',', '.')); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); else setTxt(String(value)); };
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
        <div className="flex items-center border border-input rounded bg-background">
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

const INK = ['#111111', '#ffffff', '#c8102e', '#1d4ed8', '#f59e0b', '#16a34a', '#7c3aed', '#ec4899'];

export function ArtworkPanel({ panels, layers, onChange, selectedId, onSelect, activePanel, onActivePanel, onAddImage, onAddText, uploading, signedIn, signInHref }: {
  panels: PrintPanel[];
  layers: ArtworkLayer[];
  onChange: (layers: ArtworkLayer[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  activePanel: PanelId;
  onActivePanel: (p: PanelId) => void;
  onAddImage: (file: File) => void;
  onAddText: () => void;
  uploading: boolean;
  signedIn: boolean;
  signInHref: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sel = layers.find((l) => l.id === selectedId) ?? null;
  const patch = (id: string, ch: Partial<ArtworkLayer>) => onChange(layers.map((l) => (l.id === id ? { ...l, ...ch } : l)));
  const move = (id: string, dir: -1 | 1) => {
    const i = layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const next = layers.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const panelName = (id: PanelId) => panels.find((p) => p.id === id)?.name ?? id;
  const selPanel = sel ? panels.find((p) => p.id === sel.panel) : null;

  return (
    <>
      <Block title="Pridať potlač">
        <div className="text-xs text-muted-foreground mb-1.5">Diel</div>
        <div className="flex flex-wrap border rounded-md p-0.5 bg-muted/50 mb-3">
          {panels.map((p) => (
            <button key={p.id} onClick={() => onActivePanel(p.id)} data-testid={`seg-print-panel-${p.id}`}
              className={cn('flex-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap', activePanel === p.id ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>{p.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {signedIn ? (
            <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-add-image"
              className="inline-flex items-center justify-center gap-2 border rounded-md py-2.5 text-sm hover:border-primary hover:bg-primary/5 disabled:opacity-50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}Obrázok
            </button>
          ) : (
            <Link href={signInHref} data-testid="link-sign-in-upload"
              className="inline-flex items-center justify-center gap-2 border rounded-md py-2.5 text-sm hover:border-primary hover:bg-primary/5">
              <LogIn className="w-4 h-4" />Obrázok
            </Link>
          )}
          <button onClick={onAddText} data-testid="button-add-text"
            className="inline-flex items-center justify-center gap-2 border rounded-md py-2.5 text-sm hover:border-primary hover:bg-primary/5">
            <Type className="w-4 h-4" />Text
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          {signedIn ? 'PNG, JPG, WebP, SVG alebo GIF do 25 MB. Obrázok môžete pustiť aj priamo na diel.' : 'Na nahratie obrázka sa prihláste. Text môžete pridať aj bez prihlásenia.'}
        </p>
        <input ref={fileRef} type="file" accept={ARTWORK_ACCEPT} className="hidden" data-testid="input-artwork-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddImage(f); e.target.value = ''; }} />
      </Block>

      <Block title={`Vrstvy · ${layers.length}`}>
        {layers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Zatiaľ bez potlače. Pridajte logo, ilustráciu alebo nápis.</p>
        ) : (
          <ul className="space-y-1 -mx-1" data-testid="list-layers">
            {layers.slice().reverse().map((l) => (
              <li key={l.id}>
                <div onClick={() => onSelect(l.id === selectedId ? null : l.id)} data-testid={`row-layer-${l.id}`}
                  className={cn('flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer', l.id === selectedId ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/60')}>
                  <span className="w-8 h-8 shrink-0 rounded border bg-muted/50 grid place-items-center overflow-hidden">
                    {l.kind === 'image' && l.src
                      ? (artworkImageFailed(l.src) ? <span className="text-[9px] text-destructive">chyba</span> : <img src={artworkHref(l.src)} alt="" className="max-w-full max-h-full object-contain" />)
                      : <span className="font-semibold text-xs" style={{ color: l.color, fontFamily: l.font }}>Aa</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', !l.visible && 'text-muted-foreground line-through')}>{l.kind === 'text' ? (l.text || 'Text').split('\n')[0] : l.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{panelName(l.panel)}</span>
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); patch(l.id, { visible: !l.visible }); }} className="p-1 rounded hover:bg-muted" aria-label={l.visible ? 'Skryť' : 'Zobraziť'} data-testid={`button-layer-visible-${l.id}`}>
                    {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {sel && (
        <Block title={sel.kind === 'text' ? 'Text' : 'Obrázok'} right={
          <div className="flex items-center gap-0.5">
            <button onClick={() => move(sel.id, 1)} className="p-1 rounded hover:bg-muted" aria-label="Vyššie" data-testid="button-layer-up"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button onClick={() => move(sel.id, -1)} className="p-1 rounded hover:bg-muted" aria-label="Nižšie" data-testid="button-layer-down"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button onClick={() => { const c = { ...sel, id: Math.random().toString(36).slice(2, 10), x: sel.x + 15, y: sel.y + 15 }; onChange([...layers, c]); onSelect(c.id); }} className="p-1 rounded hover:bg-muted" aria-label="Duplikovať" data-testid="button-layer-duplicate"><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={() => { onChange(layers.filter((l) => l.id !== sel.id)); onSelect(null); }} className="p-1 rounded hover:bg-muted text-destructive" aria-label="Zmazať" data-testid="button-layer-delete"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        }>
          {sel.kind === 'text' && (
            <>
              <textarea value={sel.text ?? ''} onChange={(e) => patch(sel.id, { text: e.target.value.slice(0, 400) })} rows={2} data-testid="input-layer-text"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm mb-3 resize-y" />
              <div className="flex gap-2 mb-3">
                <select value={sel.font} onChange={(e) => patch(sel.id, { font: e.target.value })} data-testid="select-layer-font"
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm" style={{ fontFamily: sel.font }}>
                  {ARTWORK_FONTS.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.label}</option>)}
                </select>
                <button onClick={() => patch(sel.id, { bold: !sel.bold })} className={cn('p-2 rounded-md border', sel.bold && 'bg-primary/10 border-primary')} aria-label="Tučné" data-testid="button-layer-bold"><Bold className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(sel.id, { italic: !sel.italic })} className={cn('p-2 rounded-md border', sel.italic && 'bg-primary/10 border-primary')} aria-label="Kurzíva" data-testid="button-layer-italic"><Italic className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center gap-1.5 mb-3">
                {INK.map((c) => (
                  <button key={c} onClick={() => patch(sel.id, { color: c })} aria-label={c} data-testid={`button-ink-${c.slice(1)}`}
                    className={cn('w-6 h-6 rounded-full border-2', sel.color === c ? 'border-primary' : 'border-black/10')} style={{ background: c }} />
                ))}
                <input type="color" value={sel.color ?? '#111111'} onChange={(e) => patch(sel.id, { color: e.target.value })} className="w-7 h-7 rounded bg-transparent cursor-pointer ml-auto" data-testid="input-layer-color" />
              </div>
              <Num id="layer-size" label="Veľkosť písma" unit="mm" value={sel.size ?? 40} min={3} max={300} step={0.5} onChange={(v) => patch(sel.id, { size: v })} />
            </>
          )}
          {sel.kind === 'image' && (
            <Num id="layer-width" label="Šírka" unit="mm" value={sel.width} min={5} max={Math.round((selPanel ? selPanel.bounds.maxX - selPanel.bounds.minX : 700) * 1.2)} onChange={(v) => patch(sel.id, { width: v })} />
          )}
          <div className="text-xs text-muted-foreground mb-1.5">Diel</div>
          <select value={sel.panel} onChange={(e) => { const p = panels.find((x) => x.id === e.target.value); if (p) patch(sel.id, { panel: p.id, x: p.anchor.x, y: p.anchor.y }); }} data-testid="select-layer-panel"
            className="w-full mb-3 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {selPanel && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selPanel.presets.map((pr) => (
                <button key={pr.id} onClick={() => patch(sel.id, sel.kind === 'image' ? { x: pr.x, y: pr.y, width: pr.width, rotation: 0 } : { x: pr.x, y: pr.y, rotation: 0 })} data-testid={`button-preset-${pr.id}`}
                  className="px-2 py-1 text-xs rounded-full border hover:border-primary hover:bg-primary/5">{pr.label}</button>
              ))}
            </div>
          )}
          <Num id="layer-x" label="Poloha X (od stredu)" unit="mm" value={Math.round(sel.x * 10) / 10} min={-800} max={800} step={0.5} onChange={(v) => patch(sel.id, { x: v })} />
          <Num id="layer-y" label="Poloha Y (od ramena)" unit="mm" value={Math.round(sel.y * 10) / 10} min={-50} max={1200} step={0.5} onChange={(v) => patch(sel.id, { y: v })} />
          <Num id="layer-rotation" label="Otočenie" unit="°" value={sel.rotation} min={-180} max={180} onChange={(v) => patch(sel.id, { rotation: v })} />
          <Num id="layer-opacity" label="Krytie" unit="%" value={Math.round(sel.opacity * 100)} min={5} max={100} onChange={(v) => patch(sel.id, { opacity: v / 100 })} />
        </Block>
      )}
    </>
  );
}
