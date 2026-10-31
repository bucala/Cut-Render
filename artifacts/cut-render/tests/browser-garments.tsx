// Local visual regression fixture, no account or backend required.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer } from '../src/engine/viewer';
import { buildGarmentObject, defaultGarmentParams, type GarmentId, type GarmentObjectOptions } from '../src/engine/apparel';

function Fixture() {
  const stage = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [garment, setGarment] = useState<GarmentId>('tshirt');
  const [finish, setFinish] = useState<'white' | 'birch'>('white');
  const [gobo, setGobo] = useState(false);
  const [pt, setPt] = useState(false);
  const [result, setResult] = useState('');
  useEffect(() => {
    const v = new Viewer(stage.current!);
    v.setPathTracing(false);
    setViewer(v);
    Object.assign(window, { garmentQA: {
      viewer: v,
      build: (id: GarmentId, options: GarmentObjectOptions = {}) => {
        const start = performance.now();
        const obj = buildGarmentObject(defaultGarmentParams(id), 'cotton-jersey', { hanger: true, ...options });
        v.setContent(obj, { frame: true }); v.setView('front');
        return { object: obj, milliseconds: performance.now() - start };
      },
    } });
    return () => v.dispose();
  }, []);
  useEffect(() => {
    if (!viewer) return;
    const start = performance.now();
    const object = buildGarmentObject(defaultGarmentParams(garment), 'cotton-jersey', { hanger: true, hangerFinish: finish, color: '#f2f0e9' });
    viewer.setContent(object, { frame: true });
    viewer.setView('front');
    setResult(`${garment}, ${Math.round(performance.now() - start)} ms`);
    Object.assign(window, { garmentObject: object });
  }, [viewer, garment, finish]);
  useEffect(() => { viewer?.setGobo(gobo); }, [viewer, gobo]);
  useEffect(() => { viewer?.setPathTracing(pt); viewer?.setMaxSamples(32); }, [viewer, pt]);
  return <main style={{ height: '100vh', margin: 0, fontFamily: 'sans-serif' }}>
    {/* Fixed size keeps the canvas renderable when the browser pane is collapsed. */}
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 900 }} ref={stage} />
    <nav style={{ position: 'absolute', top: 12, left: 12, background: 'white', padding: 12, display: 'flex', gap: 12 }}>
      <button onClick={() => setGarment('tshirt')}>Tričko</button>
      <button onClick={() => setGarment('hoodie')}>Mikina</button>
      <button onClick={() => setFinish(finish === 'white' ? 'birch' : 'white')}>Povrch: {finish}</button>
      <button onClick={() => setGobo(!gobo)}>Listy: {String(gobo)}</button>
      <button onClick={() => setPt(!pt)}>Path tracing: {String(pt)}</button>
      <span>{result}</span>
    </nav>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
