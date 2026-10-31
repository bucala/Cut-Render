import { requestUploadUrl } from '@workspace/api-client-react';
import { primeArtworkImage } from '@/engine';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
const MAX_BYTES = 25 * 1024 * 1024;

export const ARTWORK_ACCEPT = ALLOWED.join(',');

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Súbor sa nedá otvoriť ako obrázok.'));
    img.src = url;
  });
}

function errorText(e: unknown): string {
  const data = (e as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) return 'Na nahrávanie obrázkov sa prihláste.';
  return e instanceof Error ? e.message : 'Nahrávanie zlyhalo.';
}

/**
 * Upload an artwork image to App Storage (requires sign-in).
 * Returns the stored object path and the image aspect (height / width).
 */
export async function uploadArtworkImage(file: File): Promise<{ src: string; aspect: number; name: string }> {
  if (!ALLOWED.includes(file.type)) throw new Error('Podporované sú obrázky PNG, JPG, WebP, SVG alebo GIF.');
  if (file.size > MAX_BYTES) throw new Error('Obrázok je väčší ako 25 MB.');
  const local = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(local);
  } catch (e) {
    URL.revokeObjectURL(local);
    throw e;
  }
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  let res;
  try {
    res = await requestUploadUrl({ name: file.name, size: file.size, contentType: file.type });
  } catch (e) {
    URL.revokeObjectURL(local);
    throw new Error(errorText(e));
  }
  const put = await fetch(res.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) {
    URL.revokeObjectURL(local);
    throw new Error(`Nahrávanie zlyhalo (${put.status}).`);
  }
  // show the local copy right away; the stored copy is used after reload
  primeArtworkImage(res.objectPath, img);
  return { src: res.objectPath, aspect: h / w, name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Obrázok' };
}
