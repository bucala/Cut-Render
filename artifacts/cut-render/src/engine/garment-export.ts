import type { Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Self-contained binary glTF, retaining visible garment parts and their PBR maps. */
export async function garmentToGlb(object: Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(object, (output) => {
      if (output instanceof ArrayBuffer) resolve(output);
      else reject(new Error('GLB exporter nevrátil binárny model.'));
    }, reject, { binary: true, onlyVisible: true });
  });
  return new Blob([result], { type: 'model/gltf-binary' });
}
