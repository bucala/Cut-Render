import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutGrid, FolderOpen, Layers, Plus } from 'lucide-react';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { AccountControl } from '@/components/account';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="2" y="2" width="28" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M9 23 L16 7 L23 23 Z" fill="hsl(var(--primary))" />
      <circle cx="16" cy="18" r="3" fill="hsl(var(--sidebar))" />
    </svg>
  );
}

const NAV = [
  { href: '/', label: 'Prehľad', icon: LayoutGrid },
  { href: '/projects', label: 'Projekty', icon: FolderOpen },
  { href: '/materials', label: 'Materiály', icon: Layers },
];

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const ok = health.data?.status === 'ok' || (!!health.data && !health.isError);
  if (loc.startsWith('/studio/')) return <>{children}</>;
  return (
    <div className="min-h-[100dvh] md:flex">
      <aside className="md:w-60 shrink-0 bg-sidebar text-sidebar-foreground md:min-h-[100dvh] md:sticky md:top-0 md:h-[100dvh] flex md:flex-col">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-4 md:py-6" data-testid="link-logo">
          <Logo className="w-8 h-8 text-sidebar-foreground/60" />
          <div className="leading-none">
            <div className="font-display font-bold text-lg">Cut &amp; Render</div>
            <div className="rule-label !text-sidebar-foreground/45 mt-1 hidden md:block">rez · ohyb · svetlo</div>
          </div>
        </Link>
        <nav className="flex md:flex-col gap-0.5 px-2 md:px-3 items-center md:items-stretch overflow-x-auto">
          {NAV.map((n) => {
            const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} data-testid={`link-nav-${n.href.slice(1) || 'home'}`}
                className={cn('group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/50')}>
                <n.icon className={cn('w-4 h-4', active && 'text-sidebar-primary')} />
                <span>{n.label}</span>
                {active && <span className="ml-auto hidden md:block w-1.5 h-1.5 rounded-full bg-sidebar-primary" />}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block px-3 mt-6">
          <div className="rule-label !text-sidebar-foreground/40 px-3 mb-2">Nový projekt</div>
          {(['apparel', 'packaging', 'ppf'] as const).map((t) => (
            <Link key={t} href={`/new/${t}`} data-testid={`link-new-${t}`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-sidebar-foreground/65 hover:text-sidebar-foreground rounded-md hover:bg-sidebar-accent/50">
              <Plus className="w-3.5 h-3.5" />
              {t === 'apparel' ? 'Odev' : t === 'packaging' ? 'Obal' : 'PPF fólia'}
            </Link>
          ))}
        </div>
        <AccountControl className="ml-auto md:ml-0 md:mt-auto px-3 md:px-5 md:pt-4" compact={false} />
        <div className="hidden md:flex px-5 py-5 items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/45" data-testid="status-health">
          <span className={cn('w-1.5 h-1.5 rounded-full', health.isLoading ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-rose-500')} />
          {health.isLoading ? 'Pripájam' : ok ? 'Server online' : 'Server nedostupný'}
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

export function ProductGlyph({ type, className }: { type: string; className?: string }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' as const };
  if (type === 'apparel')
    return (
      <svg viewBox="0 0 100 100" className={className}>
        <path {...s} d="M30 15 L42 12 Q50 20 58 12 L70 15 L88 32 L78 44 L70 38 L70 88 L30 88 L30 38 L22 44 L12 32 Z" />
        <path {...s} strokeDasharray="3 3" d="M34 20 L44 17 Q50 24 56 17 L66 20 L82 33 L77 38 L66 32 L66 84 L34 84 L34 32 L23 38 L18 33 Z" />
        <path {...s} d="M50 45 L50 75 M46 49 L50 45 L54 49" />
      </svg>
    );
  if (type === 'packaging')
    return (
      <svg viewBox="0 0 100 100" className={className}>
        <path {...s} d="M30 10 H70 V30 H90 V70 H70 V90 H30 V70 H10 V30 H30 Z" />
        <path {...s} strokeDasharray="4 3" d="M30 30 H70 V70 H30 Z M30 30 V70 M70 30 V70" />
      </svg>
    );
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <path {...s} d="M12 62 Q20 30 50 26 Q80 30 88 62 Q50 76 12 62 Z" />
      <path {...s} strokeDasharray="4 3" d="M30 33 Q36 58 30 69 M70 33 Q64 58 70 69 M18 50 Q50 58 82 50" />
    </svg>
  );
}
