import { useEffect, useState, type RefObject } from 'react';
import { Viewer, type ViewerStats } from './viewer';

/** Mounts a Viewer into the referenced element for the component's lifetime. */
export function useViewer(containerRef: RefObject<HTMLElement | null>): { viewer: Viewer | null; stats: ViewerStats | null } {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const v = new Viewer(el);
    const off = v.onStats(setStats);
    setViewer(v);
    return () => {
      off();
      v.dispose();
      setViewer(null);
    };
  }, [containerRef]);
  return { viewer, stats };
}
