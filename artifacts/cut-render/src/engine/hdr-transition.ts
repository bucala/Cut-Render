import * as THREE from 'three';

/** Linear-radiance crossfade. The small temporary map limits PMREM work while moving. */
export class HdrTransition {
  readonly texture: THREE.DataTexture;
  private from: Float32Array;
  private to: Float32Array;
  private data = new Uint16Array(256 * 128 * 4);
  private started = performance.now();
  private lastFrame = -Infinity;

  constructor(from: THREE.DataTexture, to: THREE.DataTexture) {
    this.from = this.sample(from);
    this.to = this.sample(to);
    this.texture = new THREE.DataTexture(this.data, 256, 128, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.update(this.started);
  }

  private sample(texture: THREE.DataTexture) {
    const { data, width, height } = texture.image;
    if (!data) throw new Error('HDR mapa neobsahuje obrazové dáta.');
    const result = new Float32Array(this.data.length);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 256; x++) {
        const src = (Math.floor((y + 0.5) * height / 128) * width + Math.floor((x + 0.5) * width / 256)) * 4;
        const dst = (y * 256 + x) * 4;
        for (let k = 0; k < 4; k++) result[dst + k] = THREE.DataUtils.fromHalfFloat(data[src + k]);
      }
    }
    return result;
  }

  update(now: number): number {
    const linear = Math.min(1, Math.max(0, (now - this.started) / 500));
    if (now - this.lastFrame >= 40 || linear === 1) {
      const t = linear * linear * (3 - 2 * linear);
      for (let i = 0; i < this.data.length; i++) {
        this.data[i] = THREE.DataUtils.toHalfFloat(this.from[i] * (1 - t) + this.to[i] * t);
      }
      this.texture.needsUpdate = true;
      this.lastFrame = now;
    }
    return linear;
  }

  dispose() { this.texture.dispose(); }
}
