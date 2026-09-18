// PIL's `Image.resize(size, Image.BICUBIC)` on an 8-bit RGB image, ported line for line
// from Pillow's src/libImaging/Resample.c (precompute_coeffs, normalize_coeffs_8bpc,
// ImagingResampleHorizontal_8bpc / Vertical_8bpc). Horizontal pass first, then vertical,
// each rounding to uint8 in 22-bit fixed point — the intermediate rounding is part of
// what the judges were trained on, so it is reproduced rather than approximated.
//
// Brought over unchanged from the judges lab (`fractal-judges-lab/web/resize.mjs`), where
// it matched PIL on 0 differing bytes of 31M, in Node from PIL's decode and in Chrome from
// Chrome's. The Walk tab (`walk.js`) is its one caller here: every picture a judge reads
// goes through `resizeBicubic` to 384×224 and `toTensorData` to NCHW in [0, 1].

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;

function bicubic(x) {
  const a = -0.5;
  if (x < 0) x = -x;
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

function coeffs(inSize, outSize) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 2 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    const base = xx * ksize;
    for (let x = 0; x < xmax; x++) {
      const w = bicubic((x + xmin - center + 0.5) * ss);
      kk[base + x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0) kk[base + x] /= ww;
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  // normalize_coeffs_8bpc: C's (int) cast truncates toward zero.
  const fixed = new Int32Array(kk.length);
  for (let i = 0; i < kk.length; i++) {
    fixed[i] = kk[i] < 0 ? Math.trunc(-0.5 + kk[i] * ONE) : Math.trunc(0.5 + kk[i] * ONE);
  }
  return { ksize, bounds, k: fixed };
}

function clip8(v) {
  if (v >= ONE * 256) return 255;
  if (v <= 0) return 0;
  return Math.floor(v / ONE);
}

// src: Uint8Array/Uint8ClampedArray of RGB or RGBA (channels = 3 | 4), inW x inH.
// Returns Uint8Array RGB, outW x outH.
export function resizeBicubic(src, inW, inH, channels, outW, outH) {
  const h = coeffs(inW, outW);
  const v = coeffs(inH, outH);
  // Pillow crops the vertical pass's source rows first; with a full-image box every
  // row is used, so the horizontal pass runs over all inH rows.
  const mid = new Uint8Array(outW * inH * 3);
  const half = ONE / 2;
  for (let y = 0; y < inH; y++) {
    const row = y * inW * channels;
    for (let xx = 0; xx < outW; xx++) {
      const xmin = h.bounds[xx * 2];
      const xmax = h.bounds[xx * 2 + 1];
      const kb = xx * h.ksize;
      let r = half;
      let g = half;
      let b = half;
      for (let x = 0; x < xmax; x++) {
        const w = h.k[kb + x];
        const p = row + (x + xmin) * channels;
        r += src[p] * w;
        g += src[p + 1] * w;
        b += src[p + 2] * w;
      }
      const o = (y * outW + xx) * 3;
      mid[o] = clip8(r);
      mid[o + 1] = clip8(g);
      mid[o + 2] = clip8(b);
    }
  }
  const out = new Uint8Array(outW * outH * 3);
  for (let yy = 0; yy < outH; yy++) {
    const ymin = v.bounds[yy * 2];
    const ymax = v.bounds[yy * 2 + 1];
    const kb = yy * v.ksize;
    for (let xx = 0; xx < outW; xx++) {
      let r = half;
      let g = half;
      let b = half;
      for (let y = 0; y < ymax; y++) {
        const w = v.k[kb + y];
        const p = ((y + ymin) * outW + xx) * 3;
        r += mid[p] * w;
        g += mid[p + 1] * w;
        b += mid[p + 2] * w;
      }
      const o = (yy * outW + xx) * 3;
      out[o] = clip8(r);
      out[o + 1] = clip8(g);
      out[o + 2] = clip8(b);
    }
  }
  return out;
}

// HWC uint8 RGB (n pictures, contiguous) -> NCHW float32 in [0, 1].
export function toTensorData(pixels, n, width, height, offset = 0) {
  const plane = width * height;
  const out = new Float32Array(n * 3 * plane);
  for (let i = 0; i < n; i++) {
    const src = (offset + i) * plane * 3;
    const dst = i * 3 * plane;
    for (let p = 0; p < plane; p++) {
      out[dst + p] = pixels[src + p * 3] / 255;
      out[dst + plane + p] = pixels[src + p * 3 + 1] / 255;
      out[dst + 2 * plane + p] = pixels[src + p * 3 + 2] / 255;
    }
  }
  return out;
}
