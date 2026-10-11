// Whether a reader would see two pictures differ: stage 2's visible-pixel rule
// *(gpu_ds_probe_stage2_ckpt162)*, on two RGBA rasters of one size.
//
// A pixel is visible when its largest RGB channel moves by more than 8/255 and by more than
// its own contrast with its four neighbours in the reference picture. The contrast term is
// there because inside aliased speckle a change swaps one speckle value for another. A frame
// **matches** at 1% visible or less and is **acceptable as a preview** at 5% or less
// (`deep-gpu-model/README.md`, "The visible metric", which also says the share is not
// resolution-free). The rule's only other implementation is untracked scratch on fields;
// this is the same rule on canvases, so the reference is the CPU kernel's picture and not
// `f64`'s field.

export const MATCH = 0.01;
export const ACCEPTABLE = 0.05;

/**
 * `{ moved, visible }` as shares of the pixels: any channel moved at all, and moved visibly.
 * `ref` is the picture the contrast is read from. Both are `{ w, h, data }` with `data` RGBA.
 */
export function visible(ref, other) {
  const { w, h } = ref;
  if (other.w !== w || other.h !== h) throw new Error(`size ${other.w}x${other.h} against ${w}x${h}`);
  const a = ref.data;
  const b = other.data;
  let moved = 0;
  let seen = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      let d = 0;
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
      if (d === 0) continue;
      moved++;
      if (d <= 8) continue;
      let contrast = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = 4 * (yy * w + xx);
        for (let k = 0; k < 3; k++) contrast = Math.max(contrast, Math.abs(a[i + k] - a[j + k]));
      }
      if (d > contrast) seen++;
    }
  }
  return { moved: moved / (w * h), visible: seen / (w * h) };
}

/** `match`, `acceptable` or `different`, by the two lines above. */
export const verdictOf = (share) =>
  share <= MATCH ? "match" : share <= ACCEPTABLE ? "acceptable" : "different";
