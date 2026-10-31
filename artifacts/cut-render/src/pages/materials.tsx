import { MATERIALS, BASE_PAINTS, type MaterialPreset } from '@/engine';
import { PRODUCT_SK, CATEGORY_SK, PROP_SK, MATERIAL_DESC_SK, PAINT_SK, propValue, num } from '@/lib/sk';

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden"><div className="h-full bg-accent origin-left" style={{ transform: `scaleX(${value})` }} /></div>
      <span className="font-mono w-8 text-right tnum">{num(value, 2)}</span>
    </div>
  );
}

function Swatch({ m }: { m: MaterialPreset }) {
  const ph = m.physical;
  const gloss = 1 - ph.roughness;
  return (
    <div className="relative h-24 rounded-md overflow-hidden" style={{ background: m.swatch }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(70% 90% at 30% 20%, rgba(255,255,255,${0.15 + gloss * 0.55}), transparent 60%)` }} />
      {ph.metalness > 0.5 && <div className="absolute inset-0" style={{ background: 'linear-gradient(115deg, transparent 30%, rgba(255,255,255,.45) 45%, transparent 60%)' }} />}
      {ph.sheen ? <div className="absolute inset-0 mix-blend-overlay" style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,.12) 0 2px, transparent 2px 4px)' }} /> : null}
      {m.tintable && <span className="absolute bottom-1.5 right-1.5 font-mono text-[9px] uppercase tracking-wider bg-black/35 text-white px-1.5 py-0.5 rounded">tónovateľný</span>}
    </div>
  );
}

export default function Materials() {
  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1400px]">
      <div className="rise">
        <div className="rule-label">Fyzikálne presné predvoľby PBR</div>
        <h1 className="font-display font-extrabold text-4xl mt-2">Knižnica materiálov</h1>
        <p className="text-muted-foreground mt-2 max-w-xl">Každý materiál nesie reálne parametre — gramáž, hrúbku, pružnosť — a optické vlastnosti, ktoré path tracer simuluje: drsnosť, lesk, sheen, transmisiu, číry lak.</p>
      </div>
      {(['apparel', 'packaging', 'ppf'] as const).map((t) => {
        const mats = MATERIALS.filter((m) => m.productType === t);
        const cats = Array.from(new Set(mats.map((m) => m.category)));
        return (
          <section key={t} className="mt-12">
            <div className="flex items-baseline gap-3 border-b pb-2">
              <h2 className="font-display font-bold text-2xl">{PRODUCT_SK[t].name}</h2>
              <span className="text-sm text-muted-foreground">{PRODUCT_SK[t].tagline} · {mats.length} materiálov</span>
            </div>
            {cats.map((c) => (
              <div key={c} className="mt-5">
                <div className="rule-label mb-2">{CATEGORY_SK[c] ?? c}</div>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {mats.filter((m) => m.category === c).map((m) => (
                    <article key={m.id} className="border rounded-lg bg-card p-3 flex gap-4 hover:border-accent/40 transition-colors" data-testid={`card-material-${m.id}`}>
                      <div className="w-28 shrink-0"><Swatch m={m} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-tight">{m.name}</div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{MATERIAL_DESC_SK[m.id] ?? m.description}</p>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-[11px]">
                          {m.properties.map((p) => (<div key={p.label} className="contents"><dt className="text-muted-foreground">{PROP_SK[p.label] ?? p.label}</dt><dd className="font-mono text-right">{propValue(p.value)}</dd></div>))}
                        </dl>
                        <div className="mt-2 space-y-1">
                          <Bar label="Drsnosť" value={m.physical.roughness} />
                          <Bar label="Kovovosť" value={m.physical.metalness} />
                          {m.physical.clearcoat !== undefined && <Bar label="Číry lak" value={m.physical.clearcoat} />}
                          {m.physical.sheen !== undefined && <Bar label="Sheen" value={m.physical.sheen} />}
                          {m.physical.transmission !== undefined && <Bar label="Priepustnosť" value={m.physical.transmission} />}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
            {t === 'ppf' && (
              <div className="mt-6">
                <div className="rule-label mb-2">Základné laky pod fóliou</div>
                <div className="flex flex-wrap gap-2">
                  {BASE_PAINTS.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 border rounded-full bg-card pl-1 pr-3 py-1 text-sm" data-testid={`paint-${p.id}`}>
                      <span className="w-6 h-6 rounded-full border" style={{ background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), transparent 55%), ${p.color}` }} />
                      {PAINT_SK[p.id] ?? p.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
