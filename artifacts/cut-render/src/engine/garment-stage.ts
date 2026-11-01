import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export type GoboPattern = 'off' | 'leaves' | 'window';
export type GarmentPresentation = 'realistic' | 'marketing';

/** Per-environment look of the garment studio, in units of the stage radius. */
export interface StageStyle {
  wall: string;
  key: { color: string; intensity: number; position: [number, number, number] };
  fill: { color: string; intensity: number; position: [number, number, number] };
  /** Back light that separates the garment from the wall. */
  rim?: { color: string; intensity: number };
  /** Hard light through window panes, drawn as diagonal bands across garment and wall. */
  shafts?: { color: string; intensity: number };
}

export const DEFAULT_STAGE_STYLE: StageStyle = {
  wall: '#d5d1c8',
  key: { color: '#fff7ed', intensity: 2.4, position: [-3, 5, 3] },
  fill: { color: '#e9f1ff', intensity: 0.7, position: [3.5, 2, 2] },
};

/** Light, desaturated backdrop in the garment's own hue, as in catalogue shots. */
export function marketingBackdrop(garment: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  garment.getHSL(hsl);
  const s = Math.min(hsl.s * 0.5, 0.32);
  const l = THREE.MathUtils.clamp(0.5 + hsl.l * 0.32, 0.5, 0.82);
  return new THREE.Color().setHSL(hsl.h, s, l);
}

/**
 * Physical softboxes, a shadow-casting key and light cookies made from real occluders
 * (leaves, window panes), never flat shadow decals.
 */
export class GarmentStage {
  readonly root = new THREE.Group();
  readonly key: THREE.RectAreaLight;
  readonly fill: THREE.RectAreaLight;
  readonly rim: THREE.RectAreaLight;
  readonly wall: THREE.Mesh;
  readonly leaves = new THREE.Group();
  readonly panes: THREE.Mesh;
  readonly goboLight = new THREE.SpotLight(0xfff5e8, 0);
  readonly shaftLight = new THREE.SpotLight(0xfff3e0, 0);
  /** Softboxes cast no raster shadows; this spot at the key carries the soft cast shadows. */
  readonly shadowKey = new THREE.SpotLight(0xffffff, 0);
  private gobo: GoboPattern = 'off';
  private style: StageStyle = DEFAULT_STAGE_STYLE;
  private presentation: GarmentPresentation = 'realistic';
  private garmentColor: THREE.Color | null = null;
  private radius = 1;

  constructor() {
    RectAreaLightUniformsLib.init();
    this.root.name = 'garment-studio';
    this.key = new THREE.RectAreaLight(0xfff7ed, 2.4, 2, 2.8);
    this.fill = new THREE.RectAreaLight(0xe9f1ff, 0.7, 2.4, 3);
    this.rim = new THREE.RectAreaLight(0xffffff, 0, 1.2, 3);
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 10),
      new THREE.MeshPhysicalMaterial({ color: '#d5d1c8', roughness: 0.98, side: THREE.DoubleSide }));
    this.wall.receiveShadow = true;
    const material = new THREE.MeshPhysicalMaterial({ color: '#354531', roughness: 1, side: THREE.DoubleSide });
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0);
    leaf.bezierCurveTo(0.03, 0.02, 0.036, 0.07, 0, 0.11);
    leaf.bezierCurveTo(-0.036, 0.07, -0.03, 0.02, 0, 0);
    const leafGeometry = new THREE.ShapeGeometry(leaf, 10);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let branch = 0; branch < 4; branch++) {
      const base = new THREE.Vector2(-0.3 + branch * 0.17, -0.3 + rnd() * 0.12);
      const bend = (rnd() - 0.5) * 0.5;
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? -1 : 1;
        const mesh = new THREE.Mesh(leafGeometry, material);
        mesh.position.set(base.x + bend * i * 0.06 + side * 0.03, base.y + i * 0.075, 0);
        mesh.rotation.z = side * (0.7 + rnd() * 0.5) + bend;
        mesh.scale.setScalar(0.75 + rnd() * 0.5);
        mesh.castShadow = true;
        this.leaves.add(mesh);
      }
    }
    // A window frame: an opaque sheet with three tall panes, tilted so the light falls in diagonal bands.
    const sheet = new THREE.Shape();
    // Wider than the light cone at this distance, so pane ends never show; it sits outside the shot.
    sheet.moveTo(-1.8, -1.8); sheet.lineTo(1.8, -1.8); sheet.lineTo(1.8, 1.8); sheet.lineTo(-1.8, 1.8); sheet.lineTo(-1.8, -1.8);
    for (const x of [-0.3, 0, 0.3]) {
      const pane = new THREE.Path();
      pane.moveTo(x - 0.085, -1.7); pane.lineTo(x - 0.085, 1.7); pane.lineTo(x + 0.085, 1.7); pane.lineTo(x + 0.085, -1.7); pane.lineTo(x - 0.085, -1.7);
      sheet.holes.push(pane);
    }
    this.panes = new THREE.Mesh(new THREE.ShapeGeometry(sheet), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
    this.panes.castShadow = true;
    this.panes.name = 'window-panes';
    this.root.add(this.wall, this.key, this.fill, this.rim, this.leaves, this.panes,
      this.goboLight, this.goboLight.target, this.shaftLight, this.shaftLight.target, this.shadowKey, this.shadowKey.target);
    for (const light of [this.goboLight, this.shaftLight]) {
      light.angle = 0.42;
      light.penumbra = 0.7;
      light.decay = 0;
      (light as THREE.SpotLight & { radius?: number }).radius = 0.03;
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.radius = 3;
      light.shadow.bias = -0.0001;
    }
    this.shaftLight.angle = 0.5;
    this.shaftLight.penumbra = 0.55;
    // Large, soft leaf shadows as in catalogue shots: a coarser map and a wider source blur the edges.
    this.goboLight.shadow.mapSize.set(768, 768);
    (this.goboLight as THREE.SpotLight & { radius?: number }).radius = 0.1;
    this.leaves.scale.setScalar(1.45);
    this.shadowKey.angle = 0.55;
    this.shadowKey.penumbra = 1;
    this.shadowKey.decay = 0;
    (this.shadowKey as THREE.SpotLight & { radius?: number }).radius = 0.35;
    this.shadowKey.castShadow = true;
    this.shadowKey.shadow.mapSize.set(2048, 2048);
    this.shadowKey.shadow.radius = 8;
    this.shadowKey.shadow.bias = -0.0002;
    this.shadowKey.shadow.normalBias = 0.01;
    this.root.visible = false;
  }

  fit(radius: number, garment: boolean) {
    this.radius = radius;
    this.root.visible = garment;
    this.root.scale.setScalar(radius);
    this.wall.position.set(0, 2, -1.2);
    const source = new THREE.Vector3(-2.5, 3, 2.5);
    const onWall = new THREE.Vector3(-0.55, 1.15, -1.19);
    this.goboLight.position.copy(source);
    this.goboLight.target.position.copy(onWall);
    // Close to the light and above the framed garment, so leaves throw shadows without entering the shot.
    this.leaves.position.lerpVectors(source, onWall, 0.3);
    // Window light comes from high on the left and crosses both the garment and the wall.
    const sun = new THREE.Vector3(-3.2, 3.6, 2.2);
    const across = new THREE.Vector3(0.1, 0.9, -0.9);
    this.shaftLight.position.copy(sun);
    this.shaftLight.target.position.copy(across);
    this.panes.position.lerpVectors(sun, across, 0.28);
    this.root.updateMatrixWorld(true);
    this.leaves.lookAt(this.root.localToWorld(source.clone()));
    this.panes.lookAt(this.root.localToWorld(sun.clone()));
    this.panes.rotateZ(-0.62);
    for (const light of [this.goboLight, this.shaftLight, this.shadowKey]) {
      light.shadow.camera.near = radius * 0.1;
      light.shadow.camera.far = radius * 15;
      light.shadow.camera.updateProjectionMatrix();
    }
    this.update();
  }

  setGobo(pattern: GoboPattern | boolean) {
    this.gobo = pattern === true ? 'leaves' : pattern === false ? 'off' : pattern;
    this.update();
  }

  setStyle(style: StageStyle) { this.style = style; this.update(); }

  setPresentation(mode: GarmentPresentation, garmentColor: THREE.Color | null) {
    this.presentation = mode;
    this.garmentColor = garmentColor;
    this.update();
  }

  private update() {
    const s = this.style;
    const marketing = this.presentation === 'marketing';
    const wall = this.wall.material as THREE.MeshPhysicalMaterial;
    wall.color.set(marketing && this.garmentColor ? marketingBackdrop(this.garmentColor) : new THREE.Color(s.wall));
    // Catalogue light: a stronger, more directional key and less fill for deeper modelling.
    const keyGain = marketing ? 1.15 : 1;
    const fillGain = marketing ? 0.55 : 1;
    this.key.color.set(s.key.color);
    this.key.intensity = s.key.intensity * 0.7 * keyGain;
    this.key.position.set(...s.key.position);
    this.key.width = 2;
    this.key.height = 2.8;
    this.key.lookAt(0, 1, 0);
    this.shadowKey.color.set(s.key.color);
    this.shadowKey.intensity = s.key.intensity * 0.22 * keyGain;
    this.shadowKey.position.set(...s.key.position);
    this.shadowKey.target.position.set(0, 0.9, -0.4);
    this.fill.color.set(s.fill.color);
    this.fill.intensity = s.fill.intensity * fillGain;
    this.fill.position.set(...s.fill.position);
    this.fill.width = 2.4;
    this.fill.height = 3;
    this.fill.lookAt(0, 1, 0);
    this.rim.color.set(s.rim?.color ?? '#ffffff');
    this.rim.intensity = (s.rim?.intensity ?? 0) * (marketing ? 1.3 : 1);
    this.rim.position.set(1.6, 2.2, -0.9);
    this.rim.lookAt(0, 1, 0);
    this.leaves.visible = this.gobo === 'leaves';
    this.goboLight.visible = this.gobo === 'leaves';
    this.goboLight.intensity = this.gobo === 'leaves' ? 0.9 : 0;
    const shafts = this.gobo === 'window' ? (s.shafts ?? { color: '#fff3e0', intensity: 1.1 }) : s.shafts;
    this.panes.visible = !!shafts;
    this.shaftLight.visible = !!shafts;
    this.shaftLight.intensity = shafts ? shafts.intensity * (marketing ? 1.25 : 1) : 0;
    if (shafts) this.shaftLight.color.set(shafts.color);
    this.root.updateMatrixWorld(true);
  }

  /** Current backdrop colour, for the canvas background behind the wall. */
  wallColor(): THREE.Color { return (this.wall.material as THREE.MeshPhysicalMaterial).color; }

  dispose() {
    const materials = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    });
    materials.forEach((m) => m.dispose());
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const light of [this.goboLight, this.shaftLight, this.shadowKey]) light.shadow.map?.dispose();
  }
}
