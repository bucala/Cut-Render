import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { HdrTransition } from './hdr-transition';
import { RenderMaterials, DEFAULT_MATERIAL_CONTROLS, type MaterialControls } from './render-materials';
import { loadLogoTexture, projectLogo } from './projected-logo';
import { GarmentStage, type GarmentPresentation, type GoboPattern, type StageStyle } from './garment-stage';

export type EnvironmentId = 'studio' | 'window' | 'softbox' | 'workshop' | 'sunset' | 'night';
export type ShadowQuality = 'off' | 'hard' | 'soft';

export interface EnvironmentInfo {
  id: EnvironmentId;
  label: string;
  description: string;
}

export const ENVIRONMENTS: EnvironmentInfo[] = [
  { id: 'studio', label: 'Fotoštúdio', description: 'Neutrálne štúdio s veľkými softboxmi.' },
  { id: 'window', label: 'Prirodzené svetlo z okna', description: 'Chladné denné svetlo cez veľké okno a jemná teplá výplň.' },
  { id: 'softbox', label: 'Produktový softbox', description: 'Jasné, rovnomerné svetlo pre fotky obalov.' },
  { id: 'workshop', label: 'Dielňa', description: 'Teplé interiérové svetlo s odleskami okien.' },
  { id: 'sunset', label: 'Zlatá hodinka', description: 'Nízke teplé slnko a dlhé odlesky — vynikne na laku aj fólii.' },
  { id: 'night', label: 'Nočný showroom', description: 'Tmavá miestnosť s dramatickými svetelnými pásmi.' },
];

export interface ViewerStats {
  pathTracingAvailable: boolean;
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
  /** Backdrop and lights of the garment studio; garments hide the ground and key light. */
  stage: StageStyle;
}

const ENV_SPECS: Record<EnvironmentId, EnvSpec> = {
  window: {
    top: [0.3, 0.38, 0.48], horizon: [0.18, 0.22, 0.25], bottom: [0.035, 0.04, 0.035],
    panels: [
      { az: -55, el: 28, w: 20, h: 30, intensity: 12, color: [0.88, 0.95, 1], soft: 0.15 },
      { az: 100, el: 20, w: 40, h: 25, intensity: 1.3, color: [1, 0.92, 0.8], soft: 0.8 },
    ],
    background: '#526457', ground: { color: '#657367', roughness: 0.92 },
    key: { az: -55, el: 28, intensity: 2, color: '#e0efff' }, envIntensity: 1,
    stage: {
      wall: '#c3cbc6',
      key: { color: '#e3eeff', intensity: 2.1, position: [-4, 3.2, 1.5] },
      fill: { color: '#ffe6c8', intensity: 0.32, position: [3.5, 1.5, 2.5] },
      shafts: { color: '#f2f7ff', intensity: 1.3 },
    },
  },
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
    stage: {
      wall: '#d5d1c8',
      key: { color: '#fff7ed', intensity: 2.4, position: [-3, 5, 3] },
      fill: { color: '#e9f1ff', intensity: 0.7, position: [3.5, 2, 2] },
    },
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
    stage: {
      wall: '#efeeea',
      key: { color: '#ffffff', intensity: 1.7, position: [-1.5, 5, 3.5] },
      fill: { color: '#ffffff', intensity: 1, position: [3, 2.5, 3] },
      rim: { color: '#ffffff', intensity: 0.6 },
    },
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
    stage: {
      wall: '#9a8068',
      key: { color: '#ffcb94', intensity: 2.1, position: [-3, 4, 2.5] },
      fill: { color: '#cddfff', intensity: 0.45, position: [3.5, 2, 1.5] },
      rim: { color: '#ffb874', intensity: 1 },
    },
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
    stage: {
      wall: '#c2a28c',
      key: { color: '#ffbd88', intensity: 2, position: [-4.5, 1.8, 2.5] },
      fill: { color: '#8da4d6', intensity: 0.4, position: [3, 3, 2] },
      rim: { color: '#ff9a55', intensity: 0.8 },
      shafts: { color: '#ffb46e', intensity: 1.3 },
    },
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
    stage: {
      wall: '#252931',
      key: { color: '#dfe9ff', intensity: 1.5, position: [-2.5, 5, 2] },
      fill: { color: '#7e8db8', intensity: 0.15, position: [3.5, 2, 2] },
      rim: { color: '#9fc4ff', intensity: 2.4 },
    },
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
  private garmentStage = new GarmentStage();
  private envId: EnvironmentId = 'studio';
  private presentation: GarmentPresentation = 'realistic';
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
  private groundWanted = true;
  private ptFailed = false;
  private materialControls = { ...DEFAULT_MATERIAL_CONTROLS };
  private materials = new RenderMaterials();
  private shadows: ShadowQuality = 'soft';
  private transition: HdrTransition | null = null;
  private transitionBackground = new THREE.Color();
  private transitionPmrem: THREE.PMREMGenerator | null = null;
  private transitionTarget: ReturnType<THREE.PMREMGenerator['fromEquirectangular']> | null = null;
  private transitionStyle: {
    ground: THREE.Color; key: THREE.Color; keyPosition: THREE.Vector3;
    roughness: number; metalness: number; clearcoat: number; keyIntensity: number; envIntensity: number;
  } | null = null;
  private exporting = false;
  private logo: THREE.Mesh | null = null;
  private logoTexture: THREE.CanvasTexture | null = null;
  private logoVersion = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('Tento prehliadač alebo zariadenie nepodporuje WebGL, preto 3D náhľad nie je dostupný. Strih a exporty fungujú aj bez neho.');
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // PBR Neutral keeps base colours (fabric dyes, print inks) true to the chosen swatch;
    // AgX visibly desaturated strong reds into pink
    renderer.toneMapping = THREE.NeutralToneMapping;
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
    this.scene.add(this.garmentStage.root);

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
    this.removeLogoMesh();
    this.materials.restore();
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
      this.materials.apply(object, this.materialControls);
    }
    this.fitStage();
    if (options?.frame) this.frame();
    if (object && this.logoTexture) {
      try { this.attachLogo(); } catch { /* New geometry may not cover the centre of the view. */ }
    }
    this.invalidate();
    this.touch(120);
  }

  setEnvironment(id: EnvironmentId): void {
    if (!ENV_SPECS[id] || id === this.envId) return;
    const previous = this.transition?.texture ?? this.scene.environment as THREE.DataTexture;
    const transition = new HdrTransition(previous, buildEnvTexture(id));
    this.transition?.dispose();
    this.transition = transition;
    this.transitionBackground.copy(this.scene.background as THREE.Color);
    this.transitionStyle = {
      ground: this.groundMat.color.clone(), key: this.keyLight.color.clone(), keyPosition: this.keyLight.position.clone(),
      roughness: this.groundMat.roughness, metalness: this.groundMat.metalness, clearcoat: this.groundMat.clearcoat,
      keyIntensity: this.keyLight.intensity, envIntensity: this.scene.environmentIntensity,
    };
    this.envId = id;
    this.applyEnvironment();
    this.scene.environment = transition.texture;
    this.scene.background = this.transitionBackground.clone();
    this.invalidate();
    this.touch();
  }

  setShadowQuality(quality: ShadowQuality): void {
    this.shadows = quality;
    this.renderer.shadowMap.enabled = quality !== 'off';
    this.renderer.shadowMap.type = quality === 'hard' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.keyLight.castShadow = quality !== 'off';
    for (const light of [this.garmentStage.goboLight, this.garmentStage.shaftLight, this.garmentStage.shadowKey]) {
      light.castShadow = quality !== 'off';
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
    this.keyLight.shadow.map?.dispose();
    this.keyLight.shadow.map = null;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.needsUpdate = true;
    });
    this.invalidate();
    this.touch();
  }

  setGobo(pattern: GoboPattern | boolean): void {
    this.garmentStage.setGobo(pattern);
    this.invalidate();
    this.touch();
  }

  /** Marketing tints the backdrop with the garment's own colour and uses catalogue lighting. */
  setGarmentPresentation(mode: GarmentPresentation): void {
    this.presentation = mode;
    this.applyPresentation();
    this.invalidate();
    this.touch();
  }

  private applyPresentation() {
    const color = this.content?.userData.fabricColor as string | undefined;
    this.garmentStage.setPresentation(this.presentation, color ? new THREE.Color(color) : null);
  }

  setMaterialControls(controls: MaterialControls): void {
    const unit = (v: number | null) => v === null || !Number.isFinite(v) ? null : THREE.MathUtils.clamp(v, 0, 1);
    this.materialControls = { ...controls, roughness: unit(controls.roughness), metalness: unit(controls.metalness) };
    if (this.content) this.materials.apply(this.content, this.materialControls);
    if (this.logo) this.logo.visible = controls.textures;
    this.refresh();
  }

  async setLogo(file: File, point?: THREE.Vector2): Promise<void> {
    const version = ++this.logoVersion;
    const texture = await loadLogoTexture(file);
    if (this.disposed || version !== this.logoVersion) { texture.dispose(); return; }
    try {
      if (!this.content) throw new Error('Najprv načítajte 3D objekt.');
      const mesh = projectLogo(this.content, this.camera, texture, point);
      this.removeLogoMesh();
      this.logoTexture?.dispose();
      this.logoTexture = texture;
      this.logo = mesh;
      mesh.visible = this.materialControls.textures;
      this.contentRoot.add(mesh);
      this.refresh();
    } catch (error) { texture.dispose(); throw error; }
  }

  clearLogo(): void {
    this.logoVersion++;
    this.removeLogoMesh();
    this.logoTexture?.dispose();
    this.logoTexture = null;
    this.refresh();
  }

  private attachLogo() {
    this.logo = projectLogo(this.content!, this.camera, this.logoTexture!);
    this.logo.visible = this.materialControls.textures;
    this.contentRoot.add(this.logo);
  }

  private removeLogoMesh() {
    if (!this.logo) return;
    this.contentRoot.remove(this.logo);
    this.logo.geometry.dispose();
    (this.logo.material as THREE.Material).dispose();
    this.logo = null;
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
    if (this.groundWanted === visible) return;
    this.groundWanted = visible;
    this.ground.visible = visible && this.content?.userData.kind !== 'garment';
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
    // Garments are product shots: start almost frontal, not from the three-quarter overhead view.
    const garment = this.content?.userData.kind === 'garment';
    const dir = (garment ? new THREE.Vector3(0.05, 0.04, 1) : new THREE.Vector3(0.9, 0.62, 1.25)).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    // a tight near/far range keeps depth precision high enough for thin board on 16-bit depth buffers
    this.camera.near = Math.max(Math.min(dist / 40, r * 0.1), 0.0005);
    this.camera.far = dist * 60;
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
    if (this.content) this.materials.apply(this.content, this.materialControls);
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
    if (this.exporting) throw new Error('Počkajte na dokončenie Studio Renderu.');
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

  /** Independent 4K path-traced render, never an upscale of the live canvas. */
  async studioRender(options: { signal?: AbortSignal; onProgress?: (value: number) => void } = {}): Promise<Blob> {
    if (this.exporting) throw new Error('Studio Render už prebieha.');
    if (!this.pathTracingEnabled || !this.pathTracer || this.ptFailed || this.shadows !== 'soft') {
      throw new Error('Studio Render vyžaduje dostupný path tracing a mäkké tiene.');
    }
    if (!this.content || this.transition) throw new Error('Počkajte na načítanie objektu a dokončenie prechodu prostredia.');
    this.exporting = true;
    let renderer: THREE.WebGLRenderer | undefined;
    let tracer: WebGLPathTracer | undefined;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      const gl = renderer.getContext();
      if (Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) < 3840) {
        throw new Error('GPU nepodporuje render v rozlíšení 4K.');
      }
      renderer.setPixelRatio(1);
      renderer.setSize(3840, 2160, false);
      renderer.toneMapping = this.renderer.toneMapping;
      renderer.toneMappingExposure = this.renderer.toneMappingExposure;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const camera = this.camera.clone();
      // Preserve the whole live composition, adding space rather than cropping.
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, camera.aspect / (16 / 9))));
      camera.aspect = 16 / 9;
      camera.updateProjectionMatrix();
      let scene!: THREE.Scene;
      this.withoutRasterLights(() => { scene = this.scene.clone(true); });
      tracer = new WebGLPathTracer(renderer);
      tracer.tiles.set(4, 4);
      tracer.bounces = 6;
      tracer.transmissiveBounces = 8;
      tracer.filterGlossyFactor = 0.5;
      tracer.renderScale = 1;
      tracer.dynamicLowRes = false;
      tracer.renderDelay = 0;
      tracer.fadeDuration = 0;
      tracer.minSamples = 1;
      tracer.setScene(scene, camera);
      const samples = this.maxSamples;
      while (tracer.samples < samples) {
        if (options.signal?.aborted || this.disposed) throw new Error('Studio Render bol zrušený.');
        tracer.renderSample();
        options.onProgress?.(Math.min(1, tracer.samples / samples));
        // Yield between tiles so progress and cancellation stay responsive. MessageChannel avoids the
        // 1 s timer clamping browsers apply to setTimeout chains in unfocused tabs.
        await new Promise<void>((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(null); });
      }
      const canvas = renderer.domElement;
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('PNG sa nepodarilo vytvoriť.')), 'image/png',
      ));
    } finally {
      try { tracer?.dispose(); } finally {
        renderer?.dispose();
        renderer?.forceContextLoss();
        this.exporting = false;
        this.needsRaster = true;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearLogo();
    this.transition?.dispose();
    this.transitionTarget?.dispose();
    this.transitionPmrem?.dispose();
    this.materials.restore();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.content) disposeObject(this.content);
    this.ground.geometry.dispose();
    this.groundMat.dispose();
    this.garmentStage.dispose();
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
      this.shadows === 'soft' &&
      !this.transition &&
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
    this.garmentStage.setStyle(spec.stage);
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
    const garment = this.content?.userData.kind === 'garment';
    this.keyLight.visible = !garment;
    // Hanging garments sit in front of a seamless backdrop, never on a floor.
    this.ground.visible = this.groundWanted && !garment;
    this.garmentStage.fit(this.radius, garment);
    this.applyPresentation();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pathTracer?.reset();
    if (this.pathTracer && this.ptReady) this.pathTracer.updateCamera();
    this.needsRaster = true;
  }

  private emit(stats: ViewerStats) {
    const l = this.lastStats;
    if (l && l.pathTracingAvailable === stats.pathTracingAvailable && l.mode === stats.mode && l.samples === stats.samples && l.maxSamples === stats.maxSamples && l.converged === stats.converged) return;
    this.lastStats = stats;
    for (const cb of this.listeners) cb(stats);
  }

  private loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.exporting) return;
    if (this.transition) {
      const previousVersion = this.transition.texture.version;
      const t = this.transition.update(performance.now());
      if (!this.transitionTarget || previousVersion !== this.transition.texture.version) {
        this.transitionPmrem ??= new THREE.PMREMGenerator(this.renderer);
        this.transitionTarget = this.transitionPmrem.fromEquirectangular(this.transition.texture, this.transitionTarget);
        this.scene.environment = this.transitionTarget.texture;
      }
      const blend = t * t * (3 - 2 * t);
      const spec = ENV_SPECS[this.envId];
      (this.scene.background as THREE.Color).lerpColors(this.transitionBackground, new THREE.Color(spec.background), blend);
      const from = this.transitionStyle!;
      this.groundMat.color.lerpColors(from.ground, new THREE.Color(spec.ground.color), blend);
      this.groundMat.roughness = THREE.MathUtils.lerp(from.roughness, spec.ground.roughness, blend);
      this.groundMat.metalness = THREE.MathUtils.lerp(from.metalness, spec.ground.metalness ?? 0, blend);
      this.groundMat.clearcoat = THREE.MathUtils.lerp(from.clearcoat, spec.ground.clearcoat ?? 0, blend);
      this.keyLight.color.lerpColors(from.key, new THREE.Color(spec.key.color), blend);
      this.keyLight.intensity = THREE.MathUtils.lerp(from.keyIntensity, spec.key.intensity, blend);
      const target = dirFromAzEl(spec.key.az, Math.max(spec.key.el, 12)).multiplyScalar(this.radius * 6);
      this.keyLight.position.lerpVectors(from.keyPosition, target, blend);
      this.scene.environmentIntensity = THREE.MathUtils.lerp(from.envIntensity, spec.envIntensity, blend);
      this.needsRaster = true;
      if (t === 1) {
        this.scene.environment = buildEnvTexture(this.envId);
        this.transition.dispose();
        this.transition = null;
        this.transitionTarget?.dispose();
        this.transitionTarget = null;
        this.transitionStyle = null;
        this.invalidate();
        this.touch();
      }
    }
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
        this.emit({ pathTracingAvailable: !this.ptFailed, mode: 'pathtracing', samples, maxSamples: this.maxSamples, converged: pt.samples >= this.maxSamples });
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
    this.emit({ pathTracingAvailable: !!this.pathTracer && !this.ptFailed, mode: 'raster', samples: 0, maxSamples: this.maxSamples, converged: false });
  }
}
