import { hash2 } from './rng.js';

const smooth = (t) => t * t * (3 - 2 * t);

/** Seeded 2D value noise with fractal sums, used to vary zoning and terrain. */
export class ValueNoise {
  constructor(seed = 0) {
    this.seed = seed | 0;
  }

  noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = hash2(xi, yi, this.seed);
    const b = hash2(xi + 1, yi, this.seed);
    const c = hash2(xi, yi + 1, this.seed);
    const d = hash2(xi + 1, yi + 1, this.seed);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  /** Fractal Brownian motion in [0, 1). */
  fbm(x, y, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x, y);
      norm += amp;
      x *= 2.03;
      y *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }
}
