import * as THREE from 'three';

export interface MaterialControls {
  textures: boolean;
  normalMaps: boolean;
  roughness: number | null;
  metalness: number | null;
}

export const DEFAULT_MATERIAL_CONTROLS: MaterialControls = {
  textures: true, normalMaps: true, roughness: null, metalness: null,
};

/** Keeps original maps alive while disabled. Only owns references, not textures. */
export class RenderMaterials {
  private originals = new Map<THREE.MeshStandardMaterial, {
    map: THREE.Texture | null; normalMap: THREE.Texture | null;
    roughnessMap: THREE.Texture | null; metalnessMap: THREE.Texture | null;
    bumpMap: THREE.Texture | null; roughness: number; metalness: number;
  }>();

  apply(root: THREE.Object3D, options: MaterialControls) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.printOverlay) {
        object.visible = options.textures && !!object.userData.artworkVisible;
        return;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        let original = this.originals.get(material);
        if (!original) {
          original = {
            map: material.map, normalMap: material.normalMap, bumpMap: material.bumpMap,
            roughnessMap: material.roughnessMap, metalnessMap: material.metalnessMap,
            roughness: material.roughness, metalness: material.metalness,
          };
          this.originals.set(material, original);
        }
        material.map = options.textures ? original.map : null;
        material.normalMap = options.textures && options.normalMaps ? original.normalMap : null;
        material.bumpMap = options.textures && options.normalMaps ? original.bumpMap : null;
        material.roughnessMap = options.textures ? original.roughnessMap : null;
        material.metalnessMap = options.textures ? original.metalnessMap : null;
        material.roughness = options.roughness ?? original.roughness;
        material.metalness = options.metalness ?? original.metalness;
        material.needsUpdate = true;
      }
    });
  }

  restore() {
    for (const [material, original] of this.originals) {
      Object.assign(material, original);
      material.needsUpdate = true;
    }
    this.originals.clear();
  }
}
