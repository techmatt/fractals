// The stored-zip writer held to the format: the CRC's check value, and an archive read
// back through its own central directory to the bytes that went in.
//
//   node --test explorer/zip.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { Zip, crc32 } from "./zip.js";

test("CRC-32 gives the standard check values", () => {
  const ascii = (text) => new TextEncoder().encode(text);
  assert.equal(crc32(ascii("123456789")), 0xcbf43926);
  assert.equal(crc32(ascii("")), 0);
  assert.equal(crc32(ascii("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("an archive reads back, through its central directory, to what went in", async () => {
  const files = [
    ["mandelbrot-smooth-1920x1080.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3])],
    ["julia-orbit-trap-3840x2160.jpg", new Blob([new Uint8Array(1000).fill(7)])],
    ["phoenix-é-2.png", new Uint8Array(0)],
  ];
  const zip = new Zip();
  const when = new Date(2026, 8, 18, 13, 45, 30);
  for (const [name, data] of files) await zip.add(name, data, when);
  assert.equal(zip.count, 3);

  const bytes = new Uint8Array(await zip.blob().arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 3);
  let at = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(end + 12, true), end - at);

  const decoder = new TextDecoder();
  for (const [name, data] of files) {
    const expected = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true) & 0x0800, 0x0800);
    assert.equal(view.getUint16(at + 10, true), 0);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    assert.equal(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), name);
    assert.equal(size, expected.length);
    assert.equal(crc, crc32(expected));

    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint32(offset + 14, true), crc);
    const localName = view.getUint16(offset + 26, true);
    const start = offset + 30 + localName;
    assert.deepEqual(bytes.subarray(start, start + size), expected);
    // The date is the one given, to the even second.
    const day = view.getUint16(offset + 12, true);
    const time = view.getUint16(offset + 10, true);
    assert.deepEqual([(day >> 9) + 1980, (day >> 5) & 15, day & 31], [2026, 9, 18]);
    assert.deepEqual([time >> 11, (time >> 5) & 63, (time & 31) * 2], [13, 45, 30]);
    at += 46 + nameLength;
  }
});
