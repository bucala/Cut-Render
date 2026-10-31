// Isolated browser fixture. No backend, account, or production route is required.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Viewer, type ViewerStats } from '../src/engine/viewer';
import { DEFAULT_MATERIAL_CONTROLS } from '../src/engine/render-materials';
import { VisualizerPanel, StudioRenderProgress, type VisualizerSettings } from '../src/components/visualizer-panel';

function Fixture() {
  const stage = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [settings, setSettings] = useState<VisualizerSettings>({
    ...DEFAULT_MATERIAL_CONTROLS, environment: 'studio', exposure: 1, pathTracing: false,
    maxSamples: 32, shadowQuality: 'soft', showGround: true, autoRotate: false,
  });
  const [logo, setLogo] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const v = new Viewer(stage.current!);
    const material = new THREE.MeshPhysicalMaterial({ color: '#47745c', roughness: 0.7 });
    const content = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 24), material);
    v.setContent(content, { frame: true });
    const off = v.onStats(setStats);
    Object.assign(window, { qa: { viewer: v, content, material } });
    setViewer(v);
    return () => { off(); v.dispose(); };
  }, []);
  useEffect(() => {
    if (!viewer) return;
    viewer.setEnvironment(settings.environment);
    viewer.setPathTracing(settings.pathTracing);
    viewer.setShadowQuality(settings.shadowQuality);
    viewer.setMaterialControls(settings);
    viewer.setMaxSamples(settings.maxSamples);
    viewer.setExposure(settings.exposure);
    viewer.setShowGround(settings.showGround);
    viewer.setAutoRotate(settings.autoRotate);
  }, [viewer, settings]);
  return <main className="h-screen flex bg-background">
    <div className="flex-1 relative" ref={stage} />
    <aside className="w-[330px] overflow-auto">
      <VisualizerPanel settings={settings} onChange={(key, value) => setSettings((s) => ({ ...s, [key]: value }))}
        stats={stats} ready={!!viewer} busy={progress !== null} defaults={{ roughness: 0.7, metalness: 0 }}
        logoBusy={false} logoName={logo} onLogo={async (file) => { await viewer!.setLogo(file); setLogo(file.name); }}
        onClearLogo={() => { viewer?.clearLogo(); setLogo(null); }} onSnapshot={() => { void viewer?.snapshot(); }}
        onStudioRender={async () => {
          abort.current = new AbortController();
          setProgress(0);
          try { await viewer!.studioRender({ signal: abort.current.signal, onProgress: setProgress }); }
          catch (error) { Object.assign(window, { exportError: String(error) }); }
          finally { setProgress(null); }
        }} />
    </aside>
    {progress !== null && <StudioRenderProgress progress={progress} onCancel={() => abort.current?.abort()} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
