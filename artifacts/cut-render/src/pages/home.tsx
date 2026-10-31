import { Link } from 'wouter';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import {
  useGetProjectsSummary, getGetProjectsSummaryQueryKey, useListProjects, getListProjectsQueryKey,
  useGetRecentActivity, getGetRecentActivityQueryKey,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductGlyph } from '@/components/shell';
import { PRODUCT_SK, ACTIVITY_SK, ago, area, mm, num, pct, templateName } from '@/lib/sk';
import { cn } from '@/lib/utils';

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border border-destructive/30 bg-destructive/5 rounded-md p-4 flex items-center justify-between gap-3 text-sm">
      <span>{message}</span>
      <button onClick={onRetry} data-testid="button-retry" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-destructive/40 hover:bg-destructive/10">
        <RefreshCw className="w-3.5 h-3.5" /> Skúsiť znova
      </button>
    </div>
  );
}

const ACT_COLOR: Record<string, string> = { created: 'bg-emerald-600', updated: 'bg-accent', exported: 'bg-primary', duplicated: 'bg-amber-500', deleted: 'bg-destructive' };

export default function Home() {
  const summary = useGetProjectsSummary({ query: { queryKey: getGetProjectsSummaryQueryKey() } });
  const projects = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey() } });
  const activity = useGetRecentActivity({ limit: 12 }, { query: { queryKey: getGetRecentActivityQueryKey({ limit: 12 }) } });
  const s = summary.data;
  const recent = (projects.data ?? []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1400px]">
      <header className="rise">
        <div className="rule-label">Produkčné štúdio · všetky rozmery v mm</div>
        <h1 className="font-display font-extrabold text-4xl md:text-6xl mt-3 max-w-3xl leading-[0.98]">
          Z tvaru na strih.<br /><span className="text-primary">Zo strihu na fotku.</span>
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">Rysovacia doska s presnosťou na desatinu milimetra a fotoštúdio s ray tracingom v jednom nástroji.</p>
      </header>

      <section className="mt-10 grid md:grid-cols-[1.35fr_1fr_1fr] gap-3">
        {(['apparel', 'packaging', 'ppf'] as const).map((t, i) => (
          <Link key={t} href={`/new/${t}`} data-testid={`card-start-${t}`} style={{ animationDelay: `${80 + i * 70}ms` }}
            className={cn('rise group relative overflow-hidden rounded-lg border p-5 flex flex-col transition-transform hover:-translate-y-0.5',
              i === 0 ? 'bg-sidebar text-sidebar-foreground border-sidebar md:row-span-1 min-h-[230px]' : 'bg-card min-h-[230px]')}>
            <div className="flex justify-between items-start">
              <span className={cn('font-mono text-xs', i === 0 ? 'text-sidebar-primary' : 'text-primary')}>0{i + 1} / {PRODUCT_SK[t].tagline}</span>
              <ArrowUpRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
            </div>
            <ProductGlyph type={t} className={cn('absolute right-5 top-11 w-20 h-20 transition-transform duration-500 group-hover:scale-105', i === 0 ? 'text-sidebar-foreground/30' : 'text-accent/35')} />
            <div className="mt-auto pt-24">
              <div className="font-display font-bold text-2xl">{PRODUCT_SK[t].name}</div>
              <p className={cn('text-sm mt-1', i === 0 ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>{PRODUCT_SK[t].description}</p>
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-10">
        {summary.isError ? <ErrorBox message="Štatistiky sa nepodarilo načítať." onRetry={() => summary.refetch()} /> : (
          <div className="grid grid-cols-2 md:grid-cols-5 border rounded-lg bg-card divide-x divide-y md:divide-y-0 overflow-hidden">
            {[
              ['Projekty', s ? num(s.totalProjects) : null, s ? `${s.byType.apparel} odevy · ${s.byType.packaging} obaly · ${s.byType.ppf} PPF` : ''],
              ['Diely', s ? num(s.totalPieces) : null, 'vo všetkých plánoch'],
              ['Dĺžka rezu', s ? mm(s.totalCutLengthMm) : null, 'spolu pre nôž a nožnice'],
              ['Plocha materiálu', s ? area(s.totalAreaMm2) : null, 'čistá plocha dielov'],
              ['Exporty', s ? num(s.totalExports) : null, s ? Object.entries(s.exportsByFormat).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ') || 'zatiaľ žiadne' : ''],
            ].map(([label, value, sub]) => (
              <div key={label} className="p-4 md:p-5" data-testid={`stat-${label}`}>
                <div className="rule-label">{label}</div>
                {value === null ? <Skeleton className="h-8 w-20 mt-2" /> : <div className="font-display font-bold text-2xl md:text-3xl mt-1 tnum">{value}</div>}
                <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 grid lg:grid-cols-[1.6fr_1fr] gap-8">
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-bold text-xl">Naposledy upravené</h2>
            <Link href="/projects" className="text-sm text-accent hover:underline" data-testid="link-all-projects">Všetky projekty</Link>
          </div>
          {projects.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : projects.isError ? <ErrorBox message="Projekty sa nepodarilo načítať." onRetry={() => projects.refetch()} /> : recent.length === 0 ? (
            <div className="border border-dashed rounded-lg p-10 text-center grid-paper">
              <ProductGlyph type="packaging" className="w-16 h-16 mx-auto text-accent/50" />
              <div className="font-display font-semibold mt-3">Rysovacia doska je prázdna</div>
              <p className="text-sm text-muted-foreground mt-1">Vyberte typ produktu vyššie a pripravte prvý strihový plán.</p>
            </div>
          ) : (
            <div className="border rounded-lg bg-card divide-y">
              {recent.map((p) => (
                <Link key={p.id} href={`/studio/${p.id}`} data-testid={`row-recent-${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
                  <ProductGlyph type={p.productType} className="w-9 h-9 text-accent shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{PRODUCT_SK[p.productType].name} · {templateName(p.productType, p.template)}</div>
                  </div>
                  <div className="hidden sm:block text-right font-mono text-xs tnum">
                    <div>{p.planStats ? `${p.planStats.pieceCount} dielov` : '—'}</div>
                    <div className="text-muted-foreground">{p.planStats ? pct(p.planStats.utilization) : ''}</div>
                  </div>
                  <div className="text-xs text-muted-foreground w-28 text-right">{ago(p.updatedAt)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="font-display font-bold text-xl mb-3">Denník aktivít</h2>
          {activity.isLoading ? <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            : activity.isError ? <ErrorBox message="Aktivity sa nepodarilo načítať." onRetry={() => activity.refetch()} />
            : (activity.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-6">Zatiaľ ticho. Každá zmena, export a kópia sa zapíše sem.</p>
            : (
              <ol className="relative border-l ml-1.5">
                {activity.data!.map((a) => (
                  <li key={a.id} className="pl-5 pb-4 relative" data-testid={`activity-${a.id}`}>
                    <span className={cn('absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-background', ACT_COLOR[a.kind])} />
                    <div className="text-sm">
                      {a.projectId && a.kind !== 'deleted' ? <Link href={`/studio/${a.projectId}`} className="font-medium hover:underline">{a.projectName}</Link> : <span className="font-medium">{a.projectName}</span>}
                      <span className="text-muted-foreground"> — {ACTIVITY_SK[a.kind]}</span>
                    </div>
                    {a.detail && <div className="text-xs text-muted-foreground truncate">{a.detail}</div>}
                    <div className="font-mono text-[10px] text-muted-foreground/80 mt-0.5">{ago(a.createdAt)}</div>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </section>
    </div>
  );
}
