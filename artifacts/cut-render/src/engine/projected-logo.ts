import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Local-only artwork. No upload, object URL, or account required. */
export async function loadLogoTexture(file: File): Promise<THREE.CanvasTexture> {
  if (!LOGO_ACCEPT.split(',').includes(file.type)) throw new Error('Vyberte PNG, JPEG alebo WebP.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Obrázok môže mať najviac 25 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 64 * 1024 * 1024) throw new Error('Obrázok je príliš veľký (najviac 64 Mpx).');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Nepodarilo sa pripraviť obrázok.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  } finally { bitmap.close(); }
}

export function projectLogo(
  root: THREE.Object3D, camera: THREE.Camera, texture: THREE.Texture, point = new THREE.Vector2(),
): THREE.Mesh {
  root.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(point, camera);
  const hit = ray.intersectObject(root, true).find((h) => h.object instanceof THREE.Mesh && h.object.visible && !h.object.userData.printOverlay && h.face);
  if (!hit?.face) throw new Error('Pustite obrázok priamo na povrch 3D objektu.');
  const mesh = hit.object as THREE.Mesh;
  const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  const orientation = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
  );
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const width = Math.max(size.x, size.y, size.z) * 0.35;
  const image = texture.image as HTMLCanvasElement;
  const geometry = new DecalGeometry(mesh, hit.point, orientation, new THREE.Vector3(width, width * image.height / image.width, width * 0.25));
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false, roughness: 0.85,
    polygonOffset: true, polygonOffsetFactor: -4,
  });
  const decal = new THREE.Mesh(geometry, material);
  decal.name = 'local-logo';
  decal.renderOrder = 10;
  return decal;
}
