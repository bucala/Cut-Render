import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/** Physical softboxes and a leaf cookie made from real occluders, not a flat shadow decal. */
export class GarmentStage {
  readonly root = new THREE.Group();
  readonly key: THREE.RectAreaLight;
  readonly fill: THREE.RectAreaLight;
  readonly wall: THREE.Mesh;
  readonly leaves = new THREE.Group();
  readonly goboLight = new THREE.SpotLight(0xfff5e8, 0);
  private gobo = false;

  constructor() {
    RectAreaLightUniformsLib.init();
    this.root.name = 'garment-studio';
    this.key = new THREE.RectAreaLight(0xfff7ed, 2.4, 2, 2.8);
    this.fill = new THREE.RectAreaLight(0xe9f1ff, 0.7, 2.4, 3);
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 10),
      new THREE.MeshPhysicalMaterial({ color: '#d5d1c8', roughness: 0.98, side: THREE.DoubleSide }));
    this.wall.receiveShadow = true;
    this.root.add(this.wall, this.key, this.fill, this.leaves, this.goboLight, this.goboLight.target);
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
    // Small source: leaf shadows stay legible on the wall in both renderers.
    this.goboLight.angle = 0.42;
    this.goboLight.penumbra = 0.7;
    this.goboLight.decay = 0;
    (this.goboLight as THREE.SpotLight & { radius?: number }).radius = 0.03;
    this.goboLight.castShadow = true;
    this.goboLight.shadow.mapSize.set(2048, 2048);
    this.goboLight.shadow.radius = 3;
    this.goboLight.shadow.bias = -0.0001;
    this.root.visible = false;
  }

  fit(radius: number, garment: boolean) {
    this.root.visible = garment;
    this.root.scale.setScalar(radius);
    this.key.position.set(-3, 5, 3);
    this.key.width = 2;
    this.key.height = 2.8;
    this.key.lookAt(0, radius, 0);
    this.fill.position.set(3.5, 2, 2);
    this.fill.width = 2.4;
    this.fill.height = 3;
    this.fill.lookAt(0, radius, 0);
    this.wall.position.set(0, 2, -1.2);
    const source = new THREE.Vector3(-2.5, 3, 2.5);
    const onWall = new THREE.Vector3(-0.55, 1.15, -1.19);
    this.goboLight.position.copy(source);
    this.goboLight.target.position.copy(onWall);
    // Close to the light and above the framed garment, so leaves throw shadows without entering the shot.
    this.leaves.position.lerpVectors(source, onWall, 0.3);
    this.root.updateMatrixWorld(true);
    this.leaves.lookAt(this.root.localToWorld(source.clone()));
    this.goboLight.shadow.camera.near = radius * 0.1;
    this.goboLight.shadow.camera.far = radius * 15;
    this.goboLight.shadow.camera.updateProjectionMatrix();
    this.update();
  }

  setGobo(enabled: boolean) { this.gobo = enabled; this.update(); }

  private update() {
    this.leaves.visible = this.gobo;
    this.goboLight.visible = this.gobo;
    this.goboLight.intensity = this.gobo ? 0.9 : 0;
  }

  dispose() {
    const materials = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    });
    materials.forEach((m) => m.dispose());
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.goboLight.shadow.map?.dispose();
  }
}
