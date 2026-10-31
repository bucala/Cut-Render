import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Projects from '@/pages/projects';
import NewProject from '@/pages/new-project';
import Studio from '@/pages/studio';
import Materials from '@/pages/materials';
import { Shell } from '@/components/shell';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

// REQUIRED — resolves the key from the hostname so the same build serves custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(12 86% 52%)',
    colorForeground: 'hsl(222 32% 12%)',
    colorMutedForeground: 'hsl(222 10% 40%)',
    colorDanger: 'hsl(352 72% 44%)',
    colorBackground: 'hsl(42 36% 97%)',
    colorInput: 'hsl(0 0% 100%)',
    colorInputForeground: 'hsl(222 32% 12%)',
    colorNeutral: 'hsl(222 20% 30%)',
    fontFamily: "'Instrument Sans', system-ui, sans-serif",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(42_36%_97%)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[hsl(38_18%_80%)] shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(222_32%_12%)] font-semibold',
    headerSubtitle: 'text-[hsl(222_10%_40%)]',
    socialButtonsBlockButtonText: 'text-[hsl(222_32%_12%)]',
    formFieldLabel: 'text-[hsl(222_32%_12%)]',
    footerActionLink: 'text-[hsl(12_86%_46%)] font-medium',
    footerActionText: 'text-[hsl(222_10%_40%)]',
    dividerText: 'text-[hsl(222_10%_40%)]',
    identityPreviewEditButton: 'text-[hsl(12_86%_46%)]',
    formFieldSuccessText: 'text-emerald-700',
    alertText: 'text-[hsl(222_32%_12%)]',
    logoBox: 'h-12 justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border border-[hsl(38_16%_74%)] bg-white hover:bg-[hsl(40_20%_92%)]',
    formButtonPrimary: 'bg-[hsl(12_86%_52%)] hover:bg-[hsl(12_86%_46%)] text-white',
    formFieldInput: 'bg-white border-[hsl(38_16%_74%)] text-[hsl(222_32%_12%)]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(38_16%_74%)]',
    alert: 'border border-[hsl(38_18%_80%)] bg-white',
    otpCodeFieldInput: 'border-[hsl(38_16%_74%)] text-[hsl(222_32%_12%)]',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4 py-10">
      {children}
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) qc.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route>
        {/* Keep a shared shell (sidebar, navbar) outside the boundary so it survives a page crash. */}
        <Shell>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/projects" component={Projects} />
              <Route path="/new/:productType" component={NewProject} />
              <Route path="/studio/:id" component={Studio} />
              <Route path="/materials" component={Materials} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </Shell>
      </Route>
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Prihlásenie do Cut & Render', subtitle: 'Prihláste sa a nahrávajte vlastné potlače' } },
        signUp: { start: { title: 'Vytvorte si účet', subtitle: 'Účet slúži na ukladanie obrázkov potlače' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
