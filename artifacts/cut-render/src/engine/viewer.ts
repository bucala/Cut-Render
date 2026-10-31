import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

export type EnvironmentId = 'studio' | 'softbox' | 'workshop' | 'sunset' | 'night';

export interface EnvironmentInfo {
  id: EnvironmentId;
  label: string;
  description: string;
}

export const ENVIRONMENTS: EnvironmentInfo[] = [
  { id: 'studio', label: 'Fotoštúdio', description: 'Neutrálne štúdio s veľkými softboxmi.' },
  { id: 'softbox', label: 'Produktový softbox', description: 'Jasné, rovnomerné svetlo pre fotky obalov.' },
  { id: 'workshop', label: 'Dielňa', description: 'Teplé interiérové svetlo s odleskami okien.' },
  { id: 'sunset', label: 'Zlatá hodinka', description: 'Nízke teplé slnko a dlhé odlesky — vynikne na laku aj fólii.' },
  { id: 'night', label: 'Nočný showroom', description: 'Tmavá miestnosť s dramatickými svetelnými pásmi.' },
];

export interface ViewerStats {
  mode: 'raster' | 'pathtracing';
  /** Accumulated path-tracing samples */
  samples: number;
  maxSamples: number;
  /** True once maxSamples is reached */
  converged: boolean;
}

// ---------------------------------------------------------------------------
// Procedural HDR environments (equirectangular, linear, half-float)
// ---------------------------------------------------------------------------

interface LightPanel {
  /** azimuth / elevation of the panel centre in degrees */
  az: number;
  el: number;
  /** half size in degrees */
  w: number;
  h: number;
  intensity: number;
  color: [number, number, number];
  /** 0 = hard edge, 1 = very soft */
  soft?: number;
}

interface EnvSpec {
  top: [number, number, number];
  horizon: [number, number, number];
  bottom: [number, number, number];
  panels: LightPanel[];
  background: string;
  ground: { color: string; roughness: number; metalness?: number; clearcoat?: number };
  key: { az: number; el: number; intensity: number; color: string };
  envIntensity: number;
}

const ENV_SPECS: Record<EnvironmentId, EnvSpec> = {
  studio: {
    top: [0.16, 0.16, 0.17],
    horizon: [0.07, 0.07, 0.075],
    bottom: [0.02, 0.02, 0.02],
    panels: [
      { az: -50, el: 32, w: 22, h: 16, intensity: 9, color: [1, 0.98, 0.95], soft: 0.4 },
      { az: 65, el: 18, w: 26, h: 20, intensity: 2.6, color: [0.95, 0.97, 1], soft: 0.6 },
      { az: 175, el: 42, w: 55, h: 5, intensity: 8, color: [1, 1, 1], soft: 0.3 },
      { az: 0, el: 82, w: 30, h: 12, intensity: 3.5, color: [1, 1, 1], soft: 0.5 },
    ],
    background: '#1b1d21',
    ground: { color: '#2f3237', roughness: 0.82 },
    key: { az: -50, el: 32, intensity: 1.6, color: '#fff8f0' },
    envIntensity: 1,
  },
  softbox: {
    top: [0.95, 0.95, 0.95],
    horizon: [0.75, 0.75, 0.74],
    bottom: [0.35, 0.35, 0.34],
    panels: [
      { az: 0, el: 75, w: 50, h: 22, intensity: 6, color: [1, 1, 1], soft: 0.6 },
      { az: -70, el: 25, w: 25, h: 25, intensity: 4, color: [1, 1, 1], soft: 0.7 },
      { az: 70, el: 25, w: 25, h: 25, intensity: 4, color: [1, 1, 1], soft: 0.7 },
    ],
    background: '#dcdcd8',
    ground: { color: '#e8e7e3', roughness: 0.9 },
    key: { az: -30, el: 60, intensity: 0.9, color: '#ffffff' },
    envIntensity: 0.85,
  },
  workshop: {
    top: [0.28, 0.2, 0.13],
    horizon: [0.2, 0.14, 0.09],
    bottom: [0.06, 0.04, 0.03],
    panels: [
      { az: 95, el: 18, w: 9, h: 14, intensity: 14, color: [0.85, 0.92, 1], soft: 0.15 },
      { az: 118, el: 18, w: 9, h: 14, intensity: 14, color: [0.85, 0.92, 1], soft: 0.15 },
      { az: 141, el: 18, w: 9, h: 14, intensity: 12, color: [0.85, 0.92, 1], soft: 0.15 },
      { az: -60, el: 55, w: 4, h: 4, intensity: 60, color: [1, 0.75, 0.45], soft: 0.5 },
      { az: -120, el: 50, w: 4, h: 4, intensity: 45, color: [1, 0.72, 0.42], soft: 0.5 },
    ],
    background: '#211a14',
    ground: { color: '#4a3828', roughness: 0.62, clearcoat: 0.2 },
    key: { az: 118, el: 20, intensity: 1.4, color: '#e6f0ff' },
    envIntensity: 1,
  },
  sunset: {
    top: [0.12, 0.2, 0.42],
    horizon: [1.4, 0.62, 0.26],
    bottom: [0.08, 0.05, 0.04],
    panels: [
      { az: -35, el: 5, w: 1.6, h: 1.6, intensity: 900, color: [1, 0.62, 0.3], soft: 0.3 },
      { az: -35, el: 6, w: 14, h: 6, intensity: 6, color: [1, 0.55, 0.25], soft: 1 },
    ],
    background: '#2c2224',
    ground: { color: '#3a302b', roughness: 0.7 },
    key: { az: -35, el: 8, intensity: 2.4, color: '#ffb066' },
    envIntensity: 1,
  },
  night: {
    top: [0.012, 0.014, 0.02],
    horizon: [0.008, 0.009, 0.012],
    bottom: [0.002, 0.002, 0.003],
    panels: [
      { az: -40, el: 55, w: 70, h: 1.6, intensity: 40, color: [0.85, 0.92, 1], soft: 0.2 },
      { az: 50, el: 40, w: 70, h: 1.4, intensity: 30, color: [0.85, 0.92, 1], soft: 0.2 },
      { az: 160, el: 25, w: 50, h: 1.2, intensity: 26, color: [1, 0.85, 0.95], soft: 0.2 },
    ],
    background: '#06070a',
    ground: { color: '#0c0e12', roughness: 0.28, clearcoat: 1 },
    key: { az: -40, el: 55, intensity: 1.2, color: '#dfe9ff' },
    envIntensity: 1,
  },
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const envCache = new Map<EnvironmentId, THREE.DataTexture>();

function buildEnvTexture(id: EnvironmentId): THREE.DataTexture {
  const cached = envCache.get(id);
  if (cached) return cached;
  const spec = ENV_SPECS[id];
  const W = 1024;
  const H = 512;
  const data = new Uint16Array(W * H * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const D2R = Math.PI / 180;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const el = (v - 0.5) * Math.PI;
    const elDeg = el / D2R;
    const cosEl = Math.cos(el);
    // sky gradient
    let base: [number, number, number];
    if (el >= 0) {
      const t = Math.pow(Math.min(1, el / (Math.PI / 2)), 0.6);
      base = [0, 1, 2].map((k) => spec.horizon[k] * (1 - t) + spec.top[k] * t) as [number, number, number];
    } else {
      const t = Math.pow(Math.min(1, -el / (Math.PI / 2)), 0.4);
      base = [0, 1, 2].map((k) => spec.horizon[k] * (1 - t) + spec.bottom[k] * t) as [number, number, number];
    }
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const azDeg = (u - 0.5) * 360;
      let r = base[0];
      let g = base[1];
      let b = base[2];
      for (const p of spec.panels) {
        let dAz = azDeg - p.az;
        dAz = ((((dAz + 180) % 360) + 360) % 360) - 180;
        const x = Math.abs(dAz * cosEl);
        const y = Math.abs(elDeg - p.el);
        const s = (p.soft ?? 0.3) * Math.min(p.w, p.h) + 0.15;
        const f = (1 - smoothstep(p.w - s, p.w + s, x)) * (1 - smoothstep(p.h - s, p.h + s, y));
        if (f > 0) {
          r += p.color[0] * p.intensity * f;
          g += p.color[1] * p.intensity * f;
          b += p.color[2] * p.intensity * f;
        }
      }
      const o = (j * W + i) * 4;
      data[o] = toHalf(r);
      data[o + 1] = toHalf(g);
      data[o + 2] = toHalf(b);
      data[o + 3] = toHalf(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  envCache.set(id, tex);
  return tex;
}

function dirFromAzEl(az: number, el: number): THREE.Vector3 {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  // matches the equirect mapping used above (u = atan2(z, x))
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat) continue;
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    }
  });
}

/**
 * Photoreal 3D viewer. Real-time PBR raster preview while interacting,
 * switching to progressive GPU path tracing (ray traced global illumination,
 * reflections, refraction, soft shadows) as soon as the camera rests.
 */
export class Viewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
  private controls: OrbitControls;
  private pathTracer: WebGLPathTracer | null = null;
  private content: THREE.Object3D | null = null;
  private contentRoot = new THREE.Group();
  private ground: THREE.Mesh;
  private groundMat: THREE.MeshPhysicalMaterial;
  private keyLight: THREE.DirectionalLight;
  private envId: EnvironmentId = 'studio';
  private pathTracingEnabled = true;
  private maxSamples = 256;
  private autoRotate = false;
  private lastInteraction = performance.now();
  private sceneDirty = true;
  private ptReady = false;
  private raf = 0;
  private disposed = false;
  private listeners = new Set<(s: ViewerStats) => void>();
  private lastStats: ViewerStats | null = null;
  private resizeObserver: ResizeObserver;
  private needsRaster = true;
  private radius = 1;
  private ptFailed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('Tento prehliadač alebo zariadenie nepodporuje WebGL, preto 3D náhľad nie je dostupný. Strih a exporty fungujú aj bez neho.');
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene.add(this.contentRoot);

    this.groundMat = new THREE.MeshPhysicalMaterial({ color: '#2f3237', roughness: 0.8 });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 96), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.radius = 6;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.onCameraChange());
    this.controls.addEventListener('start', () => this.touch());

    try {
      const pt = new WebGLPathTracer(renderer);
      pt.tiles.set(2, 2);
      pt.bounces = 6;
      pt.transmissiveBounces = 8;
      pt.filterGlossyFactor = 0.5;
      pt.minSamples = 2;
      pt.fadeDuration = 350;
      pt.renderDelay = 0;
      pt.dynamicLowRes = false;
      pt.rasterizeScene = true;
      pt.renderToCanvas = true;
      pt.renderScale = 1;
      this.pathTracer = pt;
    } catch {
      this.pathTracer = null;
      this.ptFailed = true;
    }

    this.camera.position.set(1.5, 1, 2);
    this.controls.target.set(0, 0.3, 0);
    this.applyEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Replace the displayed object. frame=true fits the camera to it. */
  setContent(object: THREE.Object3D | null, options?: { frame?: boolean }): void {
    if (this.content) {
      this.contentRoot.remove(this.content);
      disposeObject(this.content);
    }
    this.content = object;
    if (object) {
      object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if (m.castShadow === false && m.receiveShadow === false) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        }
      });
      this.contentRoot.add(object);
    }
    this.fitStage();
    if (options?.frame) this.frame();
    this.invalidate();
    this.touch(120);
  }

  setEnvironment(id: EnvironmentId): void {
    if (!ENV_SPECS[id] || id === this.envId) return;
    this.envId = id;
    this.applyEnvironment();
    if (this.ptReady && this.pathTracer) {
      this.withoutRasterLights(() => {
        this.pathTracer!.updateEnvironment();
        this.pathTracer!.updateMaterials();
      });
    }
    this.needsRaster = true;
  }

  /** Tone-mapping exposure, default 1 */
  setExposure(value: number): void {
    this.renderer.toneMappingExposure = Math.max(0.05, value);
    this.pathTracer?.reset();
    this.needsRaster = true;
  }

  /** Enable / disable progressive path tracing (enabled by default) */
  setPathTracing(enabled: boolean): void {
    this.pathTracingEnabled = enabled;
    this.pathTracer?.reset();
    this.needsRaster = true;
  }

  setMaxSamples(samples: number): void {
    this.maxSamples = Math.max(1, Math.round(samples));
    this.needsRaster = true;
  }

  setShowGround(visible: boolean): void {
    if (this.ground.visible === visible) return;
    this.ground.visible = visible;
    this.invalidate();
  }

  setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
    this.controls.autoRotate = enabled;
    this.controls.autoRotateSpeed = 1.2;
    this.touch();
  }

  /** Fit the camera to the current content */
  frame(): void {
    const box = new THREE.Box3();
    if (this.content) box.setFromObject(this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.01);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(this.camera.aspect, 0.5);
    const fit = r / Math.sin(fov / 2) / Math.min(1, aspect);
    const dist = fit * 1.08;
    const dir = new THREE.Vector3(0.9, 0.62, 1.25).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 200, 0.0005);
    this.camera.far = dist * 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = r * 0.3;
    this.controls.maxDistance = dist * 6;
    this.controls.update();
    this.onCameraChange();
  }

  /** Call after mutating materials / geometry of the current content in place */
  invalidate(): void {
    this.sceneDirty = true;
    this.needsRaster = true;
    this.pathTracer?.reset();
  }

  /** Content changed in place during a continuous edit (e.g. dragging artwork): show raster preview, then resume path tracing. */
  refresh(): void {
    this.invalidate();
    this.touch();
  }

  /** Orbit to a named camera position around the current target, keeping the distance. Content faces +z. */
  setView(view: 'front' | 'back' | 'side' | 'three-quarter'): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const dirs = {
      front: new THREE.Vector3(0, 0.12, 1),
      back: new THREE.Vector3(0, 0.12, -1),
      side: new THREE.Vector3(1, 0.12, 0),
      'three-quarter': new THREE.Vector3(0.9, 0.62, 1.25),
    };
    const dir = dirs[view].normalize();
    this.controls.autoRotate = false;
    this.autoRotate = false;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.onCameraChange();
  }

  onStats(callback: (stats: ViewerStats) => void): () => void {
    this.listeners.add(callback);
    if (this.lastStats) callback(this.lastStats);
    return () => this.listeners.delete(callback);
  }

  /** PNG of the current frame at 2x resolution */
  async snapshot(): Promise<Blob> {
    const canvas = this.renderer.domElement;
    if (this.container.clientWidth < 32 || this.container.clientHeight < 32) {
      throw new Error('3D náhľad nemá na obrazovke dosť miesta. Zväčšite panel s náhľadom a skúste to znova.');
    }
    const pathTraced = this.isPathTracing() && this.pathTracer && this.pathTracer.samples > 0;
    let source: HTMLCanvasElement = canvas;
    if (!pathTraced) {
      // re-render the raster frame at twice the resolution
      const pr = this.renderer.getPixelRatio();
      const size = this.renderer.getSize(new THREE.Vector2());
      this.renderer.setPixelRatio(pr * 2);
      this.renderer.setSize(size.x, size.y, false);
      this.renderer.render(this.scene, this.camera);
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
      source = copy;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(size.x, size.y, false);
      this.needsRaster = true;
    }
    return new Promise((resolve, reject) => source.toBlob((b) => (b ? resolve(b) : reject(new Error('Snímku sa nepodarilo vytvoriť'))), 'image/png'));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.content) disposeObject(this.content);
    this.ground.geometry.dispose();
    this.groundMat.dispose();
    try {
      this.pathTracer?.dispose();
    } catch {
      /* ignore */
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ internals

  private touch(extraMs = 0) {
    this.lastInteraction = performance.now() + extraMs;
    this.needsRaster = true;
  }

  private onCameraChange() {
    this.touch();
    if (this.pathTracer && this.ptReady) this.pathTracer.updateCamera();
  }

  private isPathTracing(): boolean {
    return (
      this.pathTracingEnabled &&
      !!this.pathTracer &&
      !this.ptFailed &&
      !this.autoRotate &&
      !!this.content &&
      performance.now() - this.lastInteraction > 400
    );
  }

  private withoutRasterLights(fn: () => void) {
    const vis = this.keyLight.visible;
    this.keyLight.visible = false;
    try {
      fn();
    } finally {
      this.keyLight.visible = vis;
    }
  }

  private applyEnvironment() {
    const spec = ENV_SPECS[this.envId];
    const env = buildEnvTexture(this.envId);
    this.scene.environment = env;
    this.scene.environmentIntensity = spec.envIntensity;
    this.scene.background = new THREE.Color(spec.background);
    this.groundMat.color.set(spec.ground.color);
    this.groundMat.roughness = spec.ground.roughness;
    this.groundMat.metalness = spec.ground.metalness ?? 0;
    this.groundMat.clearcoat = spec.ground.clearcoat ?? 0;
    this.groundMat.clearcoatRoughness = 0.15;
    this.keyLight.color.set(spec.key.color);
    this.keyLight.intensity = spec.key.intensity;
    this.positionKeyLight();
    this.container.style.background = spec.background;
  }

  private positionKeyLight() {
    const spec = ENV_SPECS[this.envId];
    const r = this.radius;
    const dir = dirFromAzEl(spec.key.az, Math.max(spec.key.el, 12));
    this.keyLight.position.copy(dir.multiplyScalar(r * 6));
    this.keyLight.target.position.set(0, 0, 0);
    const cam = this.keyLight.shadow.camera;
    cam.left = -r * 1.6;
    cam.right = r * 1.6;
    cam.top = r * 1.6;
    cam.bottom = -r * 1.6;
    cam.near = r * 0.5;
    cam.far = r * 14;
    cam.updateProjectionMatrix();
  }

  private fitStage() {
    const box = new THREE.Box3();
    if (this.content) box.setFromObject(this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const size = box.getSize(new THREE.Vector3());
    this.radius = Math.max(size.length() / 2, 0.01);
    this.ground.scale.setScalar(this.radius * 40);
    this.ground.position.y = Math.min(0, box.min.y) - this.radius * 0.0005;
    this.positionKeyLight();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.pathTracer && this.ptReady) this.pathTracer.updateCamera();
    this.needsRaster = true;
  }

  private emit(stats: ViewerStats) {
    const l = this.lastStats;
    if (l && l.mode === stats.mode && l.samples === stats.samples && l.maxSamples === stats.maxSamples && l.converged === stats.converged) return;
    this.lastStats = stats;
    for (const cb of this.listeners) cb(stats);
  }

  private loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.autoRotate) this.needsRaster = true;

    const pt = this.pathTracer;
    if (this.isPathTracing() && pt) {
      try {
        if (this.sceneDirty || !this.ptReady) {
          this.withoutRasterLights(() => pt.setScene(this.scene, this.camera));
          this.sceneDirty = false;
          this.ptReady = true;
        }
        const converged = pt.samples >= this.maxSamples;
        if (!converged) {
          pt.pausePathTracing = false;
          pt.renderSample();
        } else if (this.needsRaster) {
          // redraw the converged image once (e.g. after a resize of the canvas)
          pt.pausePathTracing = true;
          pt.renderSample();
        }
        this.needsRaster = false;
        const samples = Math.min(Math.floor(pt.samples), this.maxSamples);
        this.emit({ mode: 'pathtracing', samples, maxSamples: this.maxSamples, converged: pt.samples >= this.maxSamples });
        return;
      } catch (e) {
        // Path tracing not supported on this GPU: fall back to raster permanently
        console.warn('Path tracing disabled:', e);
        this.ptFailed = true;
      }
    }

    if (this.needsRaster || this.controls.autoRotate) {
      this.renderer.render(this.scene, this.camera);
      this.needsRaster = false;
    }
    this.emit({ mode: 'raster', samples: 0, maxSamples: this.maxSamples, converged: false });
  }
}
