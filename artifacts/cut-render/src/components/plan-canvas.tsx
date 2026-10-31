import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type MouseEvent as RME } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { LINE_STYLES, artworkHref, artworkSvg, type ArtworkLayer, type CutPlan, type PanelId, type PlanPiece } from '@/engine';
import { LINE_SK, mm, num } from '@/lib/sk';
import { cn } from '@/lib/utils';

interface View { x: number; y: number; w: number; h: number }

export function PlanCanvas({ plan, selectedId, onSelect, hoverId, onHover, artwork }: {
  plan: CutPlan; selectedId: string | null; onSelect: (id: string | null) => void; hoverId: string | null; onHover: (id: string | null) => void;
  /** garment print shown on the pieces that carry a printable panel */
  artwork?: ArtworkLayer[];
}) {
  const ref = useRef<SVGSVGElement>(null);
  const fit = useMemo<View>(() => {
    const pad = Math.max(plan.sheet.width, plan.sheet.height) * 0.06;
    return { x: -pad, y: -pad, w: plan.sheet.width + pad * 2, h: plan.sheet.height + pad * 2 };
  }, [plan.sheet.width, plan.sheet.height]);
  const [view, setView] = useState<View>(fit);
  useEffect(() => setView(fit), [fit]);
  const drag = useRef<{ px: number; py: number; v: View; moved: boolean } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const toPlan = (cx: number, cy: number, v = view) => {
    const r = ref.current!.getBoundingClientRect();
    const s = Math.max(v.w / r.width, v.h / r.height);
    const ox = v.x + (v.w - r.width * s) / 2, oy = v.y + (v.h - r.height * s) / 2;
    return { x: ox + (cx - r.left) * s, y: oy + (cy - r.top) * s, s };
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const p = toPlan(e.clientX, e.clientY, v);
        const k = Math.exp(e.deltaY * 0.0015);
        const w = Math.min(Math.max(v.w * k, 20), fit.w * 8), h = (w / v.w) * v.h;
        return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  const zoom = (k: number) => setView((v) => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, w = v.w * k, h = v.h * k;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  });

  const onDown = (e: RPE) => { drag.current = { px: e.clientX, py: e.clientY, v: view, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: RPE) => {
    const p = toPlan(e.clientX, e.clientY);
    setCursor({ x: p.x, y: p.y });
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) * p.s, dy = (e.clientY - d.py) * p.s;
    if (Math.abs(dx) + Math.abs(dy) > p.s * 3) d.moved = true;
    setView({ ...d.v, x: d.v.x - dx, y: d.v.y - dy });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d && !d.moved) onSelect(null); };

  const pieceClick = (p: PlanPiece) => (e: RME) => { e.stopPropagation(); onSelect(p.id === selectedId ? null : p.id); };

  return (
    <div className="relative w-full h-full grid-paper overflow-hidden select-none">
      <svg ref={ref} data-testid="canvas-plan" className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setCursor(null)}>
        <rect x={0} y={0} width={plan.sheet.width} height={plan.sheet.height} fill="hsl(42 40% 98% / .75)" stroke="hsl(208 62% 34% / .45)" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        {plan.pieces.map((p) => {
          const active = p.id === selectedId, hover = p.id === hoverId, dim = !!selectedId && !active;
          const outline = p.paths.find((pa) => pa.kind === 'cut' && pa.closed);
          return (
            <g key={p.id} onPointerDown={(e) => e.stopPropagation()} onClick={pieceClick(p)} onPointerEnter={() => onHover(p.id)} onPointerLeave={() => onHover(null)}
              className="cursor-pointer" style={{ opacity: dim ? 0.35 : 1, transition: 'opacity .2s' }} data-testid={`piece-${p.id}`}>
              {outline && <polygon points={outline.points.map((q) => `${q.x},${q.y}`).join(' ')} fill={p.color} fillOpacity={active ? 0.32 : hover ? 0.22 : 0.1} style={{ transition: 'fill-opacity .15s' }} />}
              {outline && p.print && artwork?.some((l) => l.visible && l.panel === p.print!.panel) && (
                <>
                  <clipPath id={`print-clip-${p.id}`}><polygon points={outline.points.map((q) => `${q.x},${q.y}`).join(' ')} /></clipPath>
                  <g clipPath={`url(#print-clip-${p.id})`} style={{ pointerEvents: 'none' }}>
                    <g transform={`matrix(${p.print.matrix.join(' ')})`} dangerouslySetInnerHTML={{ __html: artworkSvg(artwork, p.print.panel as PanelId, artworkHref) }} />
                  </g>
                </>
              )}
              {p.paths.map((pa) => {
                const st = LINE_STYLES[pa.kind];
                const pts = pa.points.map((q) => `${q.x},${q.y}`).join(' ');
                const props = { fill: 'none', stroke: st.color, strokeWidth: (active ? 2 : 1.25) * (pa.kind === 'cut' ? 1 : 0.85), strokeDasharray: st.dash.map((d) => d * 1.2).join(' '), vectorEffect: 'non-scaling-stroke' as const };
                return pa.closed ? <polygon key={pa.id} points={pts} {...props} /> : <polyline key={pa.id} points={pts} {...props} />;
              })}
              {p.labels.map((l, i) => (
                <text key={i} x={l.position.x} y={l.position.y} fontSize={l.size} textAnchor="middle" dominantBaseline="middle"
                  transform={l.rotation ? `rotate(${l.rotation} ${l.position.x} ${l.position.y})` : undefined}
                  fill="hsl(222 32% 14%)" style={{ fontFamily: 'JetBrains Mono', pointerEvents: 'none' }}>{l.text}</text>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="absolute top-3 left-3 font-mono text-[10px] uppercase tracking-widest text-accent/80 bg-card/80 backdrop-blur px-2 py-1 rounded">
        {plan.sheet.label} · {num(plan.sheet.width)} x {num(plan.sheet.height)} mm
      </div>
      <div className="absolute bottom-3 left-3 font-mono text-[10px] text-muted-foreground bg-card/80 backdrop-blur px-2 py-1 rounded tnum" data-testid="text-cursor">
        {cursor ? `x ${num(cursor.x, 1)}  y ${num(cursor.y, 1)} mm` : 'Koliesko: zoom · ťahanie: posun'}
      </div>
      <div className="absolute bottom-3 right-3 flex bg-card/90 backdrop-blur rounded-md border overflow-hidden">
        <button className="p-1.5 hover:bg-muted" onClick={() => zoom(0.8)} data-testid="button-zoom-in" aria-label="Priblížiť"><Plus className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted border-x" onClick={() => zoom(1.25)} data-testid="button-zoom-out" aria-label="Oddialiť"><Minus className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted" onClick={() => setView(fit)} data-testid="button-zoom-fit" aria-label="Prispôsobiť"><Maximize2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

export function Legend({ plan, className }: { plan: CutPlan; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1.5', className)} data-testid="legend-plan">
      {plan.legend.map((k) => {
        const st = LINE_STYLES[k];
        return (
          <div key={k} className="flex items-center gap-1.5 text-xs">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={st.color} strokeWidth="1.6" strokeDasharray={st.dash.map((d) => d * 1.2).join(' ')} /></svg>
            <span>{LINE_SK[k] ?? st.label}</span>
            <span className="font-mono text-[9px] text-muted-foreground">{st.layer}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PieceInfo({ piece }: { piece: PlanPiece }) {
  const w = piece.bounds.maxX - piece.bounds.minX, h = piece.bounds.maxY - piece.bounds.minY;
  const rows: [string, string][] = [
    ['Rozmer', `${num(w)} x ${num(h)} mm`], ['Plocha', `${num(piece.areaMm2 / 100, 1)} cm²`],
    ['Dĺžka rezu', mm(piece.cutLengthMm)], ['Dĺžka ohybov', mm(piece.foldLengthMm)], ['Počet', `${piece.quantity} ks`],
    ...Object.entries(piece.meta).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  return (
    <div className="rise" data-testid={`info-piece-${piece.id}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-3 h-3 rounded-sm" style={{ background: piece.color }} />
        <span className="font-display font-semibold">{piece.name}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-mono tnum text-right">{v}</dd></Fragment>))}
      </dl>
    </div>
  );
}
