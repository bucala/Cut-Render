import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="min-h-[80dvh] grid place-items-center px-6 grid-paper">
      <div className="text-center rise">
        <svg viewBox="0 0 200 120" className="w-64 mx-auto text-accent">
          <path d="M20 100 V20 H120 L180 60 V100 Z" fill="none" stroke="currentColor" strokeDasharray="6 4" />
          <path d="M120 20 V60 H180" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          <text x="70" y="75" textAnchor="middle" fontFamily="Bricolage Grotesque" fontWeight="800" fontSize="40" fill="currentColor">404</text>
        </svg>
        <h1 className="font-display font-bold text-3xl mt-4">Tento diel na výkrese chýba</h1>
        <p className="text-muted-foreground mt-2">Stránka neexistuje alebo bola odstrihnutá z plánu.</p>
        <Link href="/" className="inline-block mt-6 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm" data-testid="link-home">Späť na prehľad</Link>
      </div>
    </div>
  );
}
