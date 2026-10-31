import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPE } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { artworkHref, artworkSvg, layerCorners, layerSize, type ArtworkLayer, type PanelId, type PrintPanel } from '@/engine';

interface View { x: number; y: number; w: number; h: number }
type Drag =
  | { mode: 'pan'; px: number; py: number; v: View; moved: boolean }
  | { mode: 'move'; id: string; start: { x: number; y: number }; orig: ArtworkLayer }
  | { mode: 'scale' | 'rotate'; id: string; start: { x: number; y: number }; center: { x: number; y: number }; orig: ArtworkLayer };

const GAP = 70;

/** Upright garment panels with their print artwork; layers can be moved, scaled and rotated directly. */
export function DesignBoard({ panels, layers, selectedId, onSelect, onChange, fabricColor, onDropFile }: {
  panels: PrintPanel[];
  layers: ArtworkLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (layers: ArtworkLayer[]) => void;
  fabricColor: string;
  onDropFile?: (file: File, panel: PanelId, x: number, y: number) => void;
}) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);

  // lay the panels out side by side, tops aligned
  const placed = useMemo(() => {
    let cursor = 0;
    return panels.map((p) => {
      const w = p.bounds.maxX - p.bounds.minX;
      const o = { panel: p, ox: cursor - p.bounds.minX, oy: -p.bounds.minY };
      cursor += w + GAP;
      return o;
    });
  }, [panels]);
  const fit = useMemo<View>(() => {
    const w = Math.max(100, placed.reduce((s, p) => s + p.panel.bounds.maxX - p.panel.bounds.minX, 0) + GAP * (placed.length - 1));
    const h = Math.max(100, ...placed.map((p) => p.panel.bounds.maxY - p.panel.bounds.minY)) + 40;
    const pad = Math.max(w, h) * 0.05;
    return { x: -pad, y: -pad, w: w + pad * 2, h: h + pad * 2 };
  }, [placed]);
  const [view, setView] = useState<View>(fit);
  const fitKey = `${Math.round(fit.w)}x${Math.round(fit.h)}`;
  useEffect(() => setView(fit), [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<Drag | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const toBoard = (cx: number, cy: number) => {
    const svg = ref.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };
  const offsetOf = (panel: PanelId) => placed.find((p) => p.panel.id === panel) ?? null;
  const panelAt = (bx: number, by: number) =>
    placed.find(({ panel, ox, oy }) => bx >= panel.bounds.minX + ox && bx <= panel.bounds.maxX + ox && by >= panel.bounds.minY + oy && by <= panel.bounds.maxY + oy) ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toBoard(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.exp(e.deltaY * 0.0015);
        const w = Math.min(Math.max(v.w * k, 40), fit.w * 6);
        const h = (w / v.w) * v.h;
        return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, placed]);

  const zoom = (k: number) => setView((v) => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, w = v.w * k, h = v.h * k;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  });

  const patch = (id: string, ch: Partial<ArtworkLayer>) => onChange(layersRef.current.map((l) => (l.id === id ? { ...l, ...ch } : l)));

  const startLayer = (e: RPE, l: ArtworkLayer, mode: 'move' | 'scale' | 'rotate') => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect(l.id);
    const start = toBoard(e.clientX, e.clientY);
    const o = offsetOf(l.panel);
    if (mode === 'move') drag.current = { mode, id: l.id, start, orig: l };
    else drag.current = { mode, id: l.id, start, orig: l, center: { x: l.x + (o?.ox ?? 0), y: l.y + (o?.oy ?? 0) } };
  };

  const onDown = (e: RPE) => {
    drag.current = { mode: 'pan', px: e.clientX, py: e.clientY, v: view, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPE) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      const r = ref.current!.getBoundingClientRect();
      const s = Math.max(d.v.w / r.width, d.v.h / r.height);
      const dx = (e.clientX - d.px) * s, dy = (e.clientY - d.py) * s;
      if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true;
      setView({ ...d.v, x: d.v.x - dx, y: d.v.y - dy });
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    if (d.mode === 'move') {
      const o = offsetOf(d.orig.panel);
      if (!o) return;
      const bx = d.orig.x + o.ox + (p.x - d.start.x);
      const by = d.orig.y + o.oy + (p.y - d.start.y);
      const target = panelAt(bx, by) ?? o;
      patch(d.id, { panel: target.panel.id, x: Math.round((bx - target.ox) * 10) / 10, y: Math.round((by - target.oy) * 10) / 10 });
    } else if (d.mode === 'scale') {
      const k = Math.hypot(p.x - d.center.x, p.y - d.center.y) / Math.max(1, Math.hypot(d.start.x - d.center.x, d.start.y - d.center.y));
      if (d.orig.kind === 'image') patch(d.id, { width: Math.round(Math.min(2000, Math.max(5, d.orig.width * k))) });
      else patch(d.id, { size: Math.round(Math.min(600, Math.max(3, (d.orig.size ?? 40) * k)) * 10) / 10 });
    } else {
      const a0 = Math.atan2(d.start.y - d.center.y, d.start.x - d.center.x);
      const a1 = Math.atan2(p.y - d.center.y, p.x - d.center.x);
      let deg = d.orig.rotation + ((a1 - a0) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      const snap = Math.round(deg / 45) * 45;
      if (Math.abs(deg - snap) < 4) deg = snap;
      patch(d.id, { rotation: Math.round(deg) });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'pan' && !d.moved) onSelect(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !onDropFile) return;
    const p = toBoard(e.clientX, e.clientY);
    const hit = panelAt(p.x, p.y) ?? placed[0];
    if (!hit) return;
    onDropFile(file, hit.panel.id, p.x - hit.ox, p.y - hit.oy);
  };

  const px = view.w / Math.max(1, ref.current?.clientWidth ?? 800); // mm per screen pixel
  const sel = layers.find((l) => l.id === selectedId) ?? null;
  const selOff = sel ? offsetOf(sel.panel) : null;
  const poly = (pts: { x: number; y: number }[]) => pts.map((q) => `${q.x},${q.y}`).join(' ');
  const pathD = (pts: { x: number; y: number }[]) => 'M' + pts.map((q) => `${q.x} ${q.y}`).join('L') + 'Z';

  return (
    <div className="relative w-full h-full grid-paper overflow-hidden select-none" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg ref={ref} data-testid="canvas-design" className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <defs>
          {placed.map(({ panel }) => (
            <clipPath key={panel.id} id={`${uid}-clip-${panel.id}`}><polygon points={poly(panel.cut)} /></clipPath>
          ))}
        </defs>
        {placed.map(({ panel, ox, oy }) => {
          const cx = (panel.bounds.minX + panel.bounds.maxX) / 2;
          return (
            <g key={panel.id} transform={`translate(${ox} ${oy})`} data-testid={`design-panel-${panel.id}`}>
              <polygon points={poly(panel.cut)} fill={fabricColor} stroke="hsl(222 32% 14% / .55)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <g clipPath={`url(#${uid}-clip-${panel.id})`} style={{ pointerEvents: 'none' }}
                dangerouslySetInnerHTML={{ __html: artworkSvg(layers, panel.id, artworkHref) }} />
              {/* seam allowance band: printed there but hidden inside the seam */}
              <path d={pathD(panel.cut) + pathD(panel.seam)} fillRule="evenodd" fill="hsl(0 0% 100% / .45)" style={{ pointerEvents: 'none' }} />
              <polygon points={poly(panel.seam)} fill="none" stroke="hsl(152 55% 35% / .8)" strokeWidth={1} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
              <line x1={cx} x2={cx} y1={panel.bounds.minY} y2={panel.bounds.maxY} stroke="hsl(208 62% 34% / .25)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
              <text x={cx} y={panel.bounds.maxY + 16 * Math.max(1, px * 0.9)} textAnchor="middle" fontSize={12 * Math.max(1, px * 0.9)}
                fill="hsl(222 32% 14% / .7)" style={{ fontFamily: 'JetBrains Mono', pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '.08em' }}>{panel.name}</text>
            </g>
          );
        })}
        {/* hit areas for every visible layer */}
        {layers.filter((l) => l.visible).map((l) => {
          const o = offsetOf(l.panel);
          if (!o) return null;
          const c = layerCorners(l).map((q) => ({ x: q.x + o.ox, y: q.y + o.oy }));
          return <polygon key={l.id} points={poly(c)} fill="transparent" className="cursor-move" data-testid={`design-layer-${l.id}`}
            onPointerDown={(e) => startLayer(e, l, 'move')} />;
        })}
        {sel && selOff && (() => {
          const c = layerCorners(sel).map((q) => ({ x: q.x + selOff.ox, y: q.y + selOff.oy }));
          const { h } = layerSize(sel);
          const a = (sel.rotation * Math.PI) / 180;
          const top = { x: sel.x + selOff.ox + Math.sin(a) * (h / 2 + 24 * px), y: sel.y + selOff.oy - Math.cos(a) * (h / 2 + 24 * px) };
          const mid = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
          const r = 6 * px;
          return (
            <g>
              <polygon points={poly(c)} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
              <line x1={mid.x} y1={mid.y} x2={top.x} y2={top.y} stroke="hsl(var(--primary))" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <circle cx={top.x} cy={top.y} r={r} fill="white" stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="cursor-grab"
                onPointerDown={(e) => startLayer(e, sel, 'rotate')} data-testid="handle-rotate" />
              {c.map((q, i) => (
                <rect key={i} x={q.x - r} y={q.y - r} width={r * 2} height={r * 2} fill="white" stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                  className="cursor-nwse-resize" onPointerDown={(e) => startLayer(e, sel, 'scale')} data-testid={`handle-scale-${i}`} />
              ))}
            </g>
          );
        })()}
      </svg>
      <div className="absolute bottom-3 left-3 font-mono text-[10px] text-muted-foreground bg-card/80 backdrop-blur px-2 py-1 rounded">
        {layers.length ? 'Ťahajte potlač · rohy: veľkosť · krúžok: otočenie' : 'Pridajte obrázok alebo text v paneli Dizajn'}
      </div>
      <div className="absolute bottom-3 right-3 flex bg-card/90 backdrop-blur rounded-md border overflow-hidden">
        <button className="p-1.5 hover:bg-muted" onClick={() => zoom(0.8)} data-testid="button-design-zoom-in" aria-label="Priblížiť"><Plus className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted border-x" onClick={() => zoom(1.25)} data-testid="button-design-zoom-out" aria-label="Oddialiť"><Minus className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted" onClick={() => setView(fit)} data-testid="button-design-zoom-fit" aria-label="Prispôsobiť"><Maximize2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}
