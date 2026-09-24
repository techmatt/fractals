// The stamp held to the one promise it makes: the link is in the file and the picture is
// not. A PNG is built here, stamped, and then both are inflated and their rasters compared
// byte for byte; a JPEG is checked the same way a decoder would read it, segment by
// segment, because node has no JPEG decoder and there is not going to be a dependency.
//
// The browser's own encoders are checked out of band — see *The download* in
// `explorer/README.md` for the two pixel counts that pass measured.
//
//   node --test explorer/stamp.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

import {
  COMMENT_LIMIT,
  EXPLORER_URL,
  KEYWORD,
  TAG,
  XMP_KEYWORD,
  descriptionOf,
  embed,
  embedJpeg,
  embedPng,
  exifInJpeg,
  exifOf,
  isJpeg,
  isPng,
  linkIn,
  linkOf,
  payloadOf,
  queryOfUrl,
  readJpeg,
  readPng,
  sourceOf,
  stamp,
  stampJpeg,
  stampPng,
  urlOf,
  xmpInJpeg,
  xmpInPng,
  xmpOf,
} from "./stamp.js";

const QUERY = "v=3&f=mandelbrot&m=smooth&x=-0.75&y=0&w=3.5&p=dimensionality-25";
const DEEP = "dv=2&x=-1.7490830&y=0.0000000&w=1e-30&m=smooth&p=ocean-25";

// ------------------------------------------------------------------ a PNG, by hand

const MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC a chunk carries, computed here rather than imported, so the test is not held to
 *  the module it is testing. */
function crc(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

function chunk(type, data) {
  const name = new TextEncoder().encode(type);
  const body = new Uint8Array(name.length + data.length);
  body.set(name, 0);
  body.set(data, name.length);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc(body));
  return out;
}

function join(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A small RGB PNG with a picture in it, filter 0 on every row. */
function makePng(width = 9, height = 7) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, truecolour, deflate, adaptive filter, no interlace
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = (x * 29 + y * 7) & 0xff;
      raw[row + 2 + x * 3] = (x * 3 + y * 61) & 0xff;
      raw[row + 3 + x * 3] = (x * y * 13) & 0xff;
    }
  }
  return {
    bytes: join([MAGIC, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]),
    raw,
  };
}

/** Every chunk of a PNG, with its CRC checked as a decoder would check it. */
function chunksOf(bytes) {
  const out = [];
  let at = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    assert.ok(at + 12 + length <= bytes.length, `${type} runs past the end of the file`);
    assert.equal(view.getUint32(at + 8 + length), crc(bytes.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    out.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at = at + 12 + length;
  }
  assert.equal(at, bytes.length, "the chunks account for every byte");
  return out;
}

/** The raster a PNG's image data inflates to. */
function rasterOf(bytes) {
  const data = chunksOf(bytes).filter((one) => one.type === "IDAT");
  return new Uint8Array(inflateSync(join(data.map((one) => one.data))));
}

// ----------------------------------------------------------------- the payload

test("a payload is the tag and the query, and reads back as the query", () => {
  assert.equal(payloadOf(QUERY), `${TAG} ${QUERY}`);
  assert.equal(linkOf(payloadOf(QUERY)), QUERY);
  assert.equal(linkOf(payloadOf(DEEP)), DEEP);
  // A leading `?` is not part of a query, however the caller spelled it.
  assert.equal(linkOf(payloadOf(`?${QUERY}`)), QUERY);
});

test("a payload that is not ours is not read as one", () => {
  assert.equal(linkOf(`Adobe Photoshop ${QUERY}`), null);
  assert.equal(linkOf(TAG), null);
  assert.equal(linkOf(`${TAG} `), null);
  assert.equal(linkOf(""), null);
  assert.equal(linkOf(null), null);
  assert.equal(linkOf(undefined), null);
});

// --------------------------------------------------------------------- the PNG

test("a stamped PNG is a PNG, and its picture is the same picture", () => {
  const { bytes, raw } = makePng();
  const stamped = stampPng(bytes, payloadOf(QUERY));

  // Structure: every CRC checks, IHDR still opens it, and the stamp is the chunk after it.
  const before = chunksOf(bytes).map((one) => one.type);
  const after = chunksOf(stamped).map((one) => one.type);
  assert.deepEqual(before, ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual(after, ["IHDR", "iTXt", "IDAT", "IEND"]);

  // Pixels: both inflate to the same raster, which is the one that went in.
  assert.deepEqual(rasterOf(stamped), raw);
  assert.deepEqual(rasterOf(stamped), rasterOf(bytes));

  // And the bytes of the image data itself never moved: taking the stamp back out gives
  // the original file, exactly.
  const at = 8 + 12 + 13;
  const length = new DataView(stamped.buffer).getUint32(at);
  assert.deepEqual(join([stamped.subarray(0, at), stamped.subarray(at + 12 + length)]), bytes);

  assert.equal(readPng(stamped), payloadOf(QUERY));
  assert.equal(linkIn(stamped), QUERY);
});

test("stamping a PNG twice leaves one stamp", () => {
  const { bytes } = makePng();
  const once = stampPng(bytes, payloadOf(QUERY));
  const twice = stampPng(once, payloadOf(DEEP));
  assert.deepEqual(
    chunksOf(twice).map((one) => one.type),
    ["IHDR", "iTXt", "IDAT", "IEND"],
  );
  assert.equal(linkIn(twice), DEEP);
  assert.equal(twice.length, once.length + (DEEP.length - QUERY.length));
});

test("a tEXt chunk written by somebody else reads the same way", () => {
  const { bytes } = makePng();
  const keyword = new TextEncoder().encode(KEYWORD);
  const text = new TextEncoder().encode(payloadOf(QUERY));
  const data = new Uint8Array(keyword.length + 1 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 1);
  const head = 8 + 12 + 13;
  const hand = join([bytes.subarray(0, head), chunk("tEXt", data), bytes.subarray(head)]);
  assert.equal(linkIn(hand), QUERY);
  // And it is replaced rather than joined, the same as one of ours.
  assert.deepEqual(
    chunksOf(stampPng(hand, payloadOf(DEEP))).map((one) => one.type),
    ["IHDR", "iTXt", "IDAT", "IEND"],
  );
});

test("a PNG with no stamp, and bytes that are not a PNG", () => {
  const { bytes } = makePng();
  assert.equal(readPng(bytes), null);
  assert.equal(linkIn(bytes), null);
  assert.equal(isPng(bytes), true);
  const notOne = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(isPng(notOne), false);
  assert.equal(linkIn(notOne), null);
  assert.throws(() => stampPng(notOne, payloadOf(QUERY)), /not a PNG/);
});

// -------------------------------------------------------------------- the JPEG

/** A JPEG's shape: `SOI`, an `APP0` JFIF, a table, `SOS`, entropy bytes, `EOI`. Not a
 *  decodable picture — what is being tested is that every one of these bytes survives in
 *  order, which is what leaves a real picture alone. */
function makeJpeg() {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dqt = [0xff, 0xdb, 0x00, 0x06, 0x00, 1, 2, 3];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0x00];
  // Entropy-coded data, with a marker-looking byte stuffed as a real one would be.
  const scan = [0x12, 0xff, 0x00, 0x34, 0x56, 0xfe, 0x78];
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sos, ...scan, 0xff, 0xd9]);
}

/** Every marker segment before the scan, and the whole of the scan after it. */
function markersOf(bytes) {
  const out = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    out.push({ marker, at, data: bytes.subarray(at + 4, at + 2 + length) });
    at += 2 + length;
  }
  return { markers: out, rest: bytes.subarray(at) };
}

test("a stamped JPEG keeps every other byte, in order", () => {
  const bytes = makeJpeg();
  const stamped = stampJpeg(bytes, payloadOf(QUERY));

  const plain = markersOf(bytes);
  const after = markersOf(stamped);
  assert.deepEqual(
    plain.markers.map((one) => one.marker),
    [0xe0, 0xdb],
  );
  // The comment lands after the leading APPn run and before everything else.
  assert.deepEqual(
    after.markers.map((one) => one.marker),
    [0xe0, 0xfe, 0xdb],
  );
  assert.deepEqual(after.markers[0].data, plain.markers[0].data);
  assert.deepEqual(after.markers[2].data, plain.markers[1].data);
  // The scan — everything a decoder turns into pixels — is untouched, bytes and length.
  assert.deepEqual(after.rest, plain.rest);
  assert.equal(stamped.length, bytes.length + 4 + payloadOf(QUERY).length);

  assert.equal(readJpeg(stamped), payloadOf(QUERY));
  assert.equal(linkIn(stamped), QUERY);
});

test("stamping a JPEG twice leaves one comment", () => {
  const once = stampJpeg(makeJpeg(), payloadOf(QUERY));
  const twice = stampJpeg(once, payloadOf(DEEP));
  assert.deepEqual(
    markersOf(twice).markers.map((one) => one.marker),
    [0xe0, 0xfe, 0xdb],
  );
  assert.equal(linkIn(twice), DEEP);
});

test("a comment somebody else wrote is left where it is", () => {
  const bytes = makeJpeg();
  const note = new TextEncoder().encode("Created with a camera");
  const comment = new Uint8Array([0xff, 0xfe, 0x00, note.length + 2, ...note]);
  const withNote = join([bytes.subarray(0, 20), comment, bytes.subarray(20)]);
  const stamped = stampJpeg(withNote, payloadOf(QUERY));
  const kinds = markersOf(stamped).markers;
  assert.equal(kinds.filter((one) => one.marker === 0xfe).length, 2);
  assert.equal(linkIn(stamped), QUERY);
});

test("a JPEG with no comment of ours, and bytes that are not a JPEG", () => {
  const bytes = makeJpeg();
  assert.equal(isJpeg(bytes), true);
  assert.equal(readJpeg(bytes), null);
  assert.equal(linkIn(bytes), null);
  assert.throws(() => stampJpeg(new Uint8Array([1, 2, 3]), payloadOf(QUERY)), /not a JPEG/);
});

test("a link too long for one comment is refused rather than truncated", () => {
  const long = `p=${"x".repeat(COMMENT_LIMIT)}`;
  assert.throws(() => stampJpeg(makeJpeg(), payloadOf(long)), /holds 65533 bytes/);
  // The PNG side has no such limit.
  assert.equal(linkIn(stampPng(makePng().bytes, payloadOf(long))), long);
});

// ------------------------------------------------- the fields ordinary tools read

test("the absolute link is the explorer and the query, and reads back by path", () => {
  assert.ok(EXPLORER_URL.startsWith("https://") && EXPLORER_URL.endsWith("/explorer/"));
  assert.equal(urlOf(QUERY), `${EXPLORER_URL}?${QUERY}`);
  assert.equal(urlOf(`?${DEEP}`), `${EXPLORER_URL}?${DEEP}`);
  assert.equal(queryOfUrl(urlOf(QUERY)), QUERY);
  // Another host, and the explorer's own index, are still the explorer.
  assert.equal(queryOfUrl(`http://localhost:8000/explorer/?${QUERY}`), QUERY);
  assert.equal(queryOfUrl(`https://example.org/site/explorer/index.html?${DEEP}`), DEEP);
  assert.equal(queryOfUrl(`https://example.org/article/?${QUERY}`), null);
  assert.equal(queryOfUrl(`${EXPLORER_URL}`), null);
  assert.equal(queryOfUrl(null), null);
});

test("an XMP packet escapes the link and gives it back", () => {
  const url = urlOf(QUERY);
  const packet = xmpOf(url);
  assert.ok(!packet.includes("&f="), "an ampersand in XML is escaped");
  assert.ok(packet.includes("&amp;f="));
  assert.equal(sourceOf(packet), url);
  assert.equal(sourceOf(`<rdf:Description dc:source="${url.replaceAll("&", "&amp;")}"/>`), url);
  assert.equal(sourceOf("<x:xmpmeta/>"), null);
});

test("an EXIF block carries the link as ImageDescription, and a non-ASCII one is refused", () => {
  const url = urlOf(QUERY);
  assert.equal(descriptionOf(exifOf(url)), url);
  assert.equal(exifOf(`${url}é`), null);
});

test("an embedded PNG carries the tag and the packet, and the picture does not move", () => {
  const { bytes, raw } = makePng();
  const embedded = embedPng(bytes, QUERY);
  const kinds = chunksOf(embedded).map((one) => one.type);
  assert.deepEqual(kinds, ["IHDR", "iTXt", "iTXt", "IDAT", "IEND"]);
  assert.deepEqual(rasterOf(embedded), raw);
  // Both text chunks back out, and what is left is the original file byte for byte.
  const kept = [];
  let at = 8;
  const view = new DataView(embedded.buffer);
  while (at < embedded.length) {
    const end = at + 12 + view.getUint32(at);
    if (String.fromCharCode(...embedded.subarray(at + 4, at + 8)) !== "iTXt") kept.push(embedded.subarray(at, end));
    at = end;
  }
  assert.deepEqual(join([MAGIC, ...kept]), bytes);

  assert.equal(readPng(embedded), payloadOf(QUERY));
  assert.equal(sourceOf(xmpInPng(embedded)), urlOf(QUERY));
  assert.equal(linkIn(embedded), QUERY);
});

test("embedding a PNG twice leaves one of each, and the second link wins", () => {
  const once = embedPng(makePng().bytes, QUERY);
  const twice = embedPng(once, DEEP);
  assert.deepEqual(chunksOf(twice).map((one) => one.type), ["IHDR", "iTXt", "iTXt", "IDAT", "IEND"]);
  assert.equal(linkIn(twice), DEEP);
  assert.equal(sourceOf(xmpInPng(twice)), urlOf(DEEP));
  assert.deepEqual(embedPng(twice, DEEP), twice);
});

test("a PNG's packet alone opens it, and somebody else's packet is left alone", () => {
  const { bytes } = makePng();
  const head = 8 + 12 + 13;
  const packetOnly = join([
    bytes.subarray(0, head),
    chunk("iTXt", join([new TextEncoder().encode(`${XMP_KEYWORD}\0\0\0\0\0`), new TextEncoder().encode(xmpOf(urlOf(QUERY)))])),
    bytes.subarray(head),
  ]);
  assert.equal(readPng(packetOnly), null);
  assert.equal(linkIn(packetOnly), QUERY);

  const theirs = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:source>a camera</dc:source></x:xmpmeta>';
  const withTheirs = join([
    bytes.subarray(0, head),
    chunk("iTXt", join([new TextEncoder().encode(`${XMP_KEYWORD}\0\0\0\0\0`), new TextEncoder().encode(theirs)])),
    bytes.subarray(head),
  ]);
  const embedded = embedPng(withTheirs, QUERY);
  assert.equal(xmpInPng(embedded), theirs);
  assert.deepEqual(chunksOf(embedded).map((one) => one.type), ["IHDR", "iTXt", "iTXt", "IDAT", "IEND"]);
  assert.equal(linkIn(embedded), QUERY);
});

test("an embedded JPEG carries EXIF, XMP and the tag, and keeps every other byte in order", () => {
  const bytes = makeJpeg();
  const embedded = embedJpeg(bytes, QUERY);
  const plain = markersOf(bytes);
  const after = markersOf(embedded);
  assert.deepEqual(after.markers.map((one) => one.marker), [0xe0, 0xe1, 0xe1, 0xfe, 0xdb]);
  assert.deepEqual(after.markers[0].data, plain.markers[0].data);
  assert.deepEqual(after.markers[4].data, plain.markers[1].data);
  assert.deepEqual(after.rest, plain.rest);

  assert.equal(descriptionOf(exifInJpeg(embedded)), urlOf(QUERY));
  assert.equal(sourceOf(xmpInJpeg(embedded)), urlOf(QUERY));
  assert.equal(readJpeg(embedded), payloadOf(QUERY));
  assert.equal(linkIn(embedded), QUERY);
  assert.deepEqual(embed(bytes, QUERY), embedded);
});

test("embedding a JPEG twice leaves one of each, and the second link wins", () => {
  const once = embedJpeg(makeJpeg(), QUERY);
  const twice = embedJpeg(once, DEEP);
  assert.deepEqual(markersOf(twice).markers.map((one) => one.marker), [0xe0, 0xe1, 0xe1, 0xfe, 0xdb]);
  assert.equal(linkIn(twice), DEEP);
  assert.equal(descriptionOf(exifInJpeg(twice)), urlOf(DEEP));
  assert.deepEqual(embedJpeg(twice, DEEP), twice);
});

test("a JPEG's own EXIF is kept, and its packet alone opens it", () => {
  const bytes = makeJpeg();
  const camera = exifOf("A camera wrote this");
  const segment = new Uint8Array([0xff, 0xe1, (camera.length + 2) >> 8, (camera.length + 2) & 0xff, ...camera]);
  const withCamera = join([bytes.subarray(0, 20), segment, bytes.subarray(20)]);
  const embedded = embedJpeg(withCamera, QUERY);
  assert.equal(descriptionOf(exifInJpeg(embedded)), "A camera wrote this");
  assert.equal(sourceOf(xmpInJpeg(embedded)), urlOf(QUERY));
  assert.deepEqual(markersOf(embedded).markers.map((one) => one.marker), [0xe0, 0xe1, 0xe1, 0xfe, 0xdb]);

  // Take the comment back out: the packet is still enough to reopen the view.
  const full = embedJpeg(bytes, QUERY);
  const { markers, rest } = markersOf(full);
  const noComment = join([
    full.subarray(0, 2),
    ...markers
      .filter((one) => one.marker !== 0xfe)
      .map((one) => full.subarray(one.at, one.at + 4 + one.data.length)),
    rest,
  ]);
  assert.equal(readJpeg(noComment), null);
  assert.equal(linkIn(noComment), QUERY);
});

// ------------------------------------------------------------------- the blobs

test("stamp takes a blob and gives one back, and leaves a type it cannot stamp alone", async () => {
  const { bytes } = makePng();
  const png = await stamp(new Blob([bytes], { type: "image/png" }), "image/png", QUERY);
  assert.equal(png.type, "image/png");
  assert.equal(linkIn(new Uint8Array(await png.arrayBuffer())), QUERY);
  assert.equal(sourceOf(xmpInPng(new Uint8Array(await png.arrayBuffer()))), urlOf(QUERY));

  const jpeg = await stamp(new Blob([makeJpeg()], { type: "image/jpeg" }), "image/jpeg", QUERY);
  assert.equal(linkIn(new Uint8Array(await jpeg.arrayBuffer())), QUERY);
  assert.equal(descriptionOf(exifInJpeg(new Uint8Array(await jpeg.arrayBuffer()))), urlOf(QUERY));

  // The thumbnail's WebP goes through the same call site and comes back as it went in.
  const webp = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  assert.equal(await stamp(webp, "image/webp", QUERY), webp);
});
