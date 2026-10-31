import { Show, useClerk, useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Path of the sign-in page that returns the user to the current page afterwards. */
export function useSignInHref(): string {
  const [loc] = useLocation();
  return `/sign-in?redirect_url=${encodeURIComponent(`${window.location.origin}${basePath}${loc}`)}`;
}

export function AccountControl({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const signInHref = useSignInHref();
  const label = user?.firstName || user?.primaryEmailAddress?.emailAddress || 'Účet';
  return (
    <div className={cn('flex items-center gap-2 min-w-0', className)} data-testid="account-control">
      <Show when="signed-out">
        <Link href={signInHref} data-testid="link-sign-in"
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent/60">
          <LogIn className="w-4 h-4" />{!compact && <span>Prihlásiť sa</span>}
        </Link>
      </Show>
      <Show when="signed-in">
        {user?.imageUrl
          ? <img src={user.imageUrl} alt="" className="w-7 h-7 rounded-full shrink-0" />
          : <span className="w-7 h-7 rounded-full bg-sidebar-primary shrink-0" />}
        {!compact && <span className="text-sm truncate text-sidebar-foreground/80" data-testid="text-user">{label}</span>}
        <button onClick={() => signOut({ redirectUrl: basePath || '/' })} title="Odhlásiť sa" aria-label="Odhlásiť sa" data-testid="button-sign-out"
          className="ml-auto p-1.5 rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60">
          <LogOut className="w-4 h-4" />
        </button>
      </Show>
    </div>
  );
}
