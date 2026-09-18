// The palette blob's reader, held to the layout the bake writes.
//
// `palettes.bin` is stored planar and byte-delta per map (explorer_slim_ckpt131) so that
// gzip can see it, and `stops.js` undoes that on arrival. The layout is what makes a
// wrong reader dangerous rather than loud: an interleaved blob and a planar one are the
// same length, so a reader that got the layout wrong would draw real colours from the
// wrong stops. These cases hold the reader to an encoder spelled the way
// `builder/explorer.py`'s `blob` spells it, over every map's span in the index.
//
// Run: node --test explorer/stops.test.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PALETTES, PROVENANCE } from "./palettes.js";
import { install, interleave, stopsOf } from "./stops.js";

/** `builder/explorer.py`'s `blob`, over bytes that are already interleaved. */
function planar(interleaved) {
  const out = new Uint8Array(interleaved.length);
  for (const { at, stops } of PALETTES.values()) {
    for (let channel = 0; channel < 3; channel += 1) {
      let before = 0;
      for (let index = 0; index < stops; index += 1) {
        const value = interleaved[at + index * 3 + channel];
        out[at + channel * stops + index] = (value - before) & 0xff;
        before = value;
      }
    }
  }
  return out;
}

test("every map's span comes back interleaved exactly", () => {
  const colours = new Uint8Array(PROVENANCE.blob.bytes);
  let state = 12345;
  for (let index = 0; index < colours.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    colours[index] = state >>> 24;
  }
  assert.deepEqual(interleave(planar(colours)), colours);
});

test("the index names the layout this reader reads", () => {
  assert.equal(PROVENANCE.blob.layout, "planar-delta");
});

// The blob is untracked, so a bare clone has the index and not the gradients.
const BLOB = fileURLToPath(new URL("./palettes.bin", import.meta.url));
test("the blob on disk is the one the index was baked against", { skip: !existsSync(BLOB) && "palettes.bin is not baked here" }, () => {
  const bytes = new Uint8Array(readFileSync(BLOB));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PROVENANCE.blob.sha256);
  install(bytes);
  for (const name of PALETTES.keys()) {
    const { stops } = stopsOf(name);
    assert.equal(stops.length, PALETTES.get(name).stops);
  }
});
