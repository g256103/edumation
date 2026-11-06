/** One-Euro filter: low lag on fast moves, strong jitter rejection when still. */
export class OneEuroFilter {
  constructor(minCutoff = 1.5, beta = 0.6, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  static alpha(te, cutoff) {
    const r = 2 * Math.PI * cutoff * te;
    return r / (r + 1);
  }

  filter(x, tMs) {
    if (this.tPrev == null || this.xPrev == null) {
      this.tPrev = tMs;
      this.xPrev = x;
      return x;
    }
    const te = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / te;
    const aD = OneEuroFilter.alpha(te, this.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(te, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
