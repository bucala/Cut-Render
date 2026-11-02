// Browser entry point for the production Viewer and garment engine, without account/backend setup.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer } from '../src/engine/viewer';
import { buildGarmentObject, defaultGarmentParams, type GarmentId, type GarmentObjectOptions, type GarmentParams } from '../src/engine/apparel';

function EngineQA() {
  const stage = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [garment, setGarment] = useState<GarmentId>('tshirt');
  const [finish, setFinish] = useState<'white' | 'birch'>('white');
  const [gobo, setGobo] = useState(false);
  const [pt, setPt] = useState(false);
  const [presentation, setPresentation] = useState<'marketing' | 'realistic'>('marketing');
  const [sleeve, setSleeve] = useState<'short' | 'long'>('short');
  const [stats, setStats] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => {
    const v = new Viewer(stage.current!);
    v.setPathTracing(false);
    const unsubscribe = v.onStats((s) => {
      setStats(`${s.mode}, ${s.samples} samples`);
      Object.assign(window, { garmentRenderStats: s });
    });
    setViewer(v);
    Object.assign(window, { garmentQA: {
      viewer: v,
      build: (id: GarmentId, options: GarmentObjectOptions = {}, params: Partial<GarmentParams> = {}) => {
        const start = performance.now();
        const obj = buildGarmentObject({ ...defaultGarmentParams(id), ...params }, 'cotton-jersey', { hanger: true, presentation: 'marketing', ...options });
        v.setContent(obj, { frame: true }); v.setGarmentPresentation(options.presentation ?? 'marketing'); v.setView('front');
        Object.assign(window, { garmentObject: obj });
        return { object: obj, milliseconds: performance.now() - start };
      },
    } });
    return () => { unsubscribe(); v.dispose(); };
  }, []);
  useEffect(() => {
    if (!viewer) return;
    const start = performance.now();
    const object = buildGarmentObject({ ...defaultGarmentParams(garment), sleeve }, 'cotton-jersey', { hanger: true, hangerFinish: finish, presentation, color: '#f2f0e9' });
    viewer.setContent(object, { frame: true });
    viewer.setGarmentPresentation(presentation);
    viewer.setView('front');
    setResult(`${garment}, ${Math.round(performance.now() - start)} ms`);
    Object.assign(window, { garmentObject: object });
  }, [viewer, garment, finish, presentation, sleeve]);
  useEffect(() => { viewer?.setGobo(gobo); }, [viewer, gobo]);
  useEffect(() => { viewer?.setPathTracing(pt); viewer?.setMaxSamples(32); }, [viewer, pt]);
  return <main style={{ height: '100vh', margin: 0, fontFamily: 'sans-serif' }}>
    {/* Fixed size keeps the canvas renderable when the browser pane is collapsed. */}
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 900 }} ref={stage} />
    <nav style={{ position: 'absolute', top: 12, left: 12, background: 'white', padding: 12, display: 'flex', gap: 12 }}>
      <button onClick={() => setGarment('tshirt')}>Tričko</button>
      <button onClick={() => setGarment('hoodie')}>Mikina</button>
      <button onClick={() => setSleeve(sleeve === 'short' ? 'long' : 'short')}>Rukáv: {sleeve}</button>
      <button onClick={() => setPresentation(presentation === 'marketing' ? 'realistic' : 'marketing')}>Tvar: {presentation}</button>
      <button onClick={() => setFinish(finish === 'white' ? 'birch' : 'white')}>Povrch: {finish}</button>
      <button onClick={() => setGobo(!gobo)}>Listy: {String(gobo)}</button>
      <button onClick={() => setPt(!pt)}>Path tracing: {String(pt)}</button>
      <span>{result}; {stats}</span>
    </nav>
  </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<EngineQA />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
