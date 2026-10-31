import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, Plus, Trash2, ExternalLink } from 'lucide-react';
import {
  useListProjects, getListProjectsQueryKey, useDeleteProject, useDuplicateProject,
  getGetProjectsSummaryQueryKey, getGetRecentActivityQueryKey, type ProjectSummary,
} from '@workspace/api-client-react';
import { deleteModelFile } from '@/engine';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { ProductGlyph } from '@/components/shell';
import { ErrorBox } from '@/pages/home';
import { PRODUCT_SK, ago, mm, pct, templateName } from '@/lib/sk';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'apparel' | 'packaging' | 'ppf';

export default function Projects() {
  const [filter, setFilter] = useState<Filter>('all');
  const params = filter === 'all' ? undefined : { productType: filter };
  const q = useListProjects(params, { query: { queryKey: getListProjectsQueryKey(params) } });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/projects'] });
    qc.invalidateQueries({ queryKey: getGetProjectsSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRecentActivityQueryKey().slice(0, 1) });
  };
  const del = useDeleteProject({ mutation: { onSuccess: () => { invalidate(); toast({ title: 'Projekt zmazaný' }); } } });
  const dup = useDuplicateProject({ mutation: { onSuccess: (p) => { invalidate(); toast({ title: 'Kópia vytvorená', description: p.name }); } } });
  const list = (q.data ?? []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  void getListProjectsQueryKey;

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4 rise">
        <div>
          <div className="rule-label">Archív výkresov</div>
          <h1 className="font-display font-extrabold text-4xl mt-2">Projekty</h1>
        </div>
        <Link href="/new/packaging" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:brightness-105" data-testid="link-new-project">
          <Plus className="w-4 h-4" /> Nový projekt
        </Link>
      </div>
      <div className="mt-6 inline-flex border rounded-md bg-card p-0.5" role="tablist">
        {(['all', 'apparel', 'packaging', 'ppf'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}
            className={cn('px-3 py-1.5 text-sm rounded transition-colors', filter === f ? 'bg-sidebar text-sidebar-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {f === 'all' ? 'Všetky' : PRODUCT_SK[f].name}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {q.isLoading ? <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
          : q.isError ? <ErrorBox message="Projekty sa nepodarilo načítať." onRetry={() => q.refetch()} />
          : list.length === 0 ? (
            <div className="border border-dashed rounded-lg p-14 text-center grid-paper">
              <ProductGlyph type={filter === 'all' ? 'ppf' : filter} className="w-20 h-20 mx-auto text-accent/50" />
              <div className="font-display font-bold text-xl mt-3">Žiadne projekty v tejto kategórii</div>
              <p className="text-sm text-muted-foreground mt-1">Začnite novým plánom — šablónu vyberiete v ďalšom kroku.</p>
              <Link href={`/new/${filter === 'all' ? 'packaging' : filter}`} className="inline-flex mt-5 items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm" data-testid="link-empty-new"><Plus className="w-4 h-4" />Vytvoriť projekt</Link>
            </div>
          ) : (
            <div className="border rounded-lg bg-card overflow-hidden">
              <div className="hidden md:grid grid-cols-[2.4fr_1fr_0.8fr_0.9fr_0.7fr_0.9fr_40px] gap-3 px-4 py-2 rule-label border-b bg-muted/40">
                <span>Názov</span><span>Typ</span><span>Diely</span><span>Rez</span><span>Využitie</span><span>Upravené</span><span />
              </div>
              {list.map((p, i) => (
                <div key={p.id} style={{ animationDelay: `${i * 25}ms` }} className="rise grid grid-cols-[1fr_40px] md:grid-cols-[2.4fr_1fr_0.8fr_0.9fr_0.7fr_0.9fr_40px] gap-3 px-4 py-3 items-center border-b last:border-0 hover:bg-muted/40 transition-colors" data-testid={`row-project-${p.id}`}>
                  <Link href={`/studio/${p.id}`} className="flex items-center gap-3 min-w-0" data-testid={`link-open-${p.id}`}>
                    <ProductGlyph type={p.productType} className="w-9 h-9 text-accent shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{templateName(p.productType, p.template)}{p.modelFileName ? ` · ${p.modelFileName}` : ''}</div>
                    </div>
                  </Link>
                  <span className="hidden md:block text-sm">{PRODUCT_SK[p.productType].name}</span>
                  <span className="hidden md:block font-mono text-sm tnum">{p.planStats?.pieceCount ?? '—'}</span>
                  <span className="hidden md:block font-mono text-sm tnum">{p.planStats ? mm(p.planStats.cutLengthMm) : '—'}</span>
                  <span className="hidden md:block font-mono text-sm tnum">{p.planStats ? pct(p.planStats.utilization) : '—'}</span>
                  <span className="hidden md:block text-xs text-muted-foreground">{ago(p.updatedAt)}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="p-2 rounded hover:bg-muted" data-testid={`button-menu-${p.id}`} aria-label="Akcie"><MoreHorizontal className="w-4 h-4" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => nav(`/studio/${p.id}`)} data-testid={`menu-open-${p.id}`}><ExternalLink className="w-4 h-4 mr-2" />Otvoriť v štúdiu</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => dup.mutate({ id: p.id })} data-testid={`menu-duplicate-${p.id}`}><Copy className="w-4 h-4 mr-2" />Duplikovať</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(p)} data-testid={`menu-delete-${p.id}`}><Trash2 className="w-4 h-4 mr-2" />Zmazať</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Zmazať „{toDelete?.name}“?</AlertDialogTitle>
            <AlertDialogDescription>Strihový plán, nastavenia renderu a história exportov sa natrvalo odstránia. Túto akciu nie je možné vrátiť.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Zrušiť</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (toDelete) { const id = toDelete.id; del.mutate({ id }); deleteModelFile(id).catch(() => undefined); } setToDelete(null); }}>
              Zmazať projekt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
