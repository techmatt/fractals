// A downloaded picture carries its own link *(explorer_download_carries_link_ckpt137)*.
//
// **The link goes in the file's metadata, and the pixels are not touched.** A PNG gets a
// text chunk between `IHDR` and the image data; a JPEG gets a `COM` segment after the
// `APPn` run at the front. Neither is read by a decoder: the compressed image data is the
// same bytes in the same order, which is what `stamp.test.mjs` asserts by stripping the
// stamp back off and comparing, and by inflating both PNGs and comparing the pixels.
//
// **The payload is the query and nothing else.** No host: nothing here is live, the site
// is served from a project-Pages subpath that could move, and a file saved today should
// open on whatever origin the reader has. The contract's own string is the whole of the
// address — and *which* contract is already in it, because a deep link leads with `dv`
// exactly as it does in a URL.
//
// **And no version of its own.** The query carries `v=3` or `dv=2`, so a payload this page
// cannot read is refused by the contract with the contract's own sentence, which is a
// better sentence than anything a second version number could produce. What is in front of
// the query is a tag rather than a version: it is how a reader recognizes its own files,
// and how the JPEG side — a `COM` segment is free text with no keyword — tells our comment
// from somebody else's.
//
// **Written as `iTXt`, read as either.** `iTXt` is UTF-8 by the PNG spec, so one writer
// needs no guard about what a query may contain; `tEXt` is Latin-1 and would need one. The
// reader takes both, uncompressed, so a file stamped by some other writer still opens.
//
// Nothing here touches the DOM except `stamp`, which is the one function that takes and
// returns a `Blob`; the rest is bytes, and runs under node's own test runner.

// PNG's chunk CRC is the same CRC-32 the zip's central directory uses — same polynomial,
// same reflection, same pre- and post-conditioning — and `zip.test.mjs` already pins it to
// the standard check values. A second copy of the table would be a second thing to get
// right.
import { crc32 } from "./zip.js";

/** What a file of ours says in front of its link. */
export const TAG = "fractal-explorer";

/** The PNG text chunk's keyword. The same word, because a keyword is what the PNG side has
 *  instead of a tag, and a file dumped by `exiftool` should read the same either way. */
export const KEYWORD = "fractal-explorer";

/** The most a JPEG comment may hold: the segment's length word is two bytes and counts
 *  itself. A link is a few hundred characters, so this is a guard and not a case. */
export const COMMENT_LIMIT = 0xffff - 2;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEXT_TYPES = new Set(["tEXt", "iTXt"]);

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The payload a picture of this view carries: the tag, then the query. */
export function payloadOf(query) {
  return `${TAG} ${bare(query)}`;
}

/** The query a payload carries, or `null` for a payload that is not one of ours.
 *
 *  Only the tag is checked here. Whether the query is a link this page can open is the
 *  contract's question and is asked at the door, so that a refusal is the contract's own
 *  sentence rather than a second opinion. */
export function linkOf(payload) {
  if (typeof payload !== "string") return null;
  const text = payload.trim();
  if (!text.startsWith(`${TAG} `)) return null;
  const query = bare(text.slice(TAG.length + 1));
  return query === "" ? null : query;
}

/** A query with no leading `?` and no surrounding space. */
function bare(query) {
  const text = String(query ?? "").trim();
  return text.startsWith("?") ? text.slice(1) : text;
}

// --------------------------------------------------------------------------- PNG

/** Whether these bytes open with the PNG signature. */
export function isPng(bytes) {
  return bytes.length >= 8 && PNG_MAGIC.every((byte, at) => bytes[at] === byte);
}

/** Each chunk of a PNG, in order, as `{ type, at, end, data }`. Stops at the first chunk
 *  whose length runs past the end of the file rather than throwing: a truncated download is
 *  something to decline to stamp, not something to raise about. */
function* chunks(bytes) {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = readU32(bytes, at);
    // A PNG chunk length is a 31-bit number by the spec. Anything else is not a PNG.
    if (length > 0x7fffffff || at + 12 + length > bytes.length) return;
    const end = at + 12 + length;
    yield {
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      at,
      end,
      data: bytes.subarray(at + 8, at + 8 + length),
    };
    at = end;
  }
}

function readU32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/** One chunk, with its length and CRC around it. */
function chunk(type, data) {
  const name = ENCODER.encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(name, 4);
  out.set(data, 8);
  const body = new Uint8Array(4 + data.length);
  body.set(name, 0);
  body.set(data, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** The data of an `iTXt` chunk: keyword, uncompressed, no language and no translation. */
function textChunk(payload) {
  const keyword = ENCODER.encode(KEYWORD);
  const text = ENCODER.encode(payload);
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  // keyword \0, compression flag 0, compression method 0, language \0, translated \0
  data.set([0, 0, 0, 0, 0], keyword.length);
  data.set(text, keyword.length + 5);
  return chunk("iTXt", data);
}

/** The keyword and text of a `tEXt` or uncompressed `iTXt` chunk, or `null`. */
function textOf(type, data) {
  const first = data.indexOf(0);
  if (first < 0) return null;
  const keyword = DECODER.decode(data.subarray(0, first));
  if (type === "tEXt") return { keyword, text: DECODER.decode(data.subarray(first + 1)) };
  // iTXt: the flag, the method, then two more null-terminated strings before the text.
  if (data[first + 1] !== 0) return null; // compressed; not something this writes
  const language = data.indexOf(0, first + 3);
  if (language < 0) return null;
  const translated = data.indexOf(0, language + 1);
  if (translated < 0) return null;
  return { keyword, text: DECODER.decode(data.subarray(translated + 1)) };
}

/**
 * The PNG with this payload in a text chunk after `IHDR`.
 *
 * Idempotent: a chunk already standing under our keyword is replaced rather than joined, so
 * stamping a file twice leaves one stamp. Throws where the bytes are not a PNG, which the
 * caller takes as a reason to hand over the file unstamped.
 */
export function stampPng(bytes, payload) {
  if (!isPng(bytes)) throw new Error("not a PNG");
  const parts = [];
  let header = null;
  const drop = [];
  for (const one of chunks(bytes)) {
    if (header === null) {
      if (one.type !== "IHDR") throw new Error("a PNG opens with IHDR");
      header = one;
      continue;
    }
    if (TEXT_TYPES.has(one.type) && textOf(one.type, one.data)?.keyword === KEYWORD) {
      drop.push(one);
    }
  }
  if (header === null) throw new Error("a PNG opens with IHDR");
  parts.push(bytes.subarray(0, header.end), textChunk(payload));
  let at = header.end;
  for (const one of drop) {
    parts.push(bytes.subarray(at, one.at));
    at = one.end;
  }
  parts.push(bytes.subarray(at));
  return join(parts);
}

/** The payload a PNG carries under our keyword, or `null`. */
export function readPng(bytes) {
  if (!isPng(bytes)) return null;
  for (const one of chunks(bytes)) {
    if (!TEXT_TYPES.has(one.type)) continue;
    const said = textOf(one.type, one.data);
    if (said !== null && said.keyword === KEYWORD) return said.text;
  }
  return null;
}

// -------------------------------------------------------------------------- JPEG

/** Whether these bytes open with `SOI`. */
export function isJpeg(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Where a comment goes, and any comment of ours already standing.
 *
 * The walk stops at `SOS` — everything after it is entropy-coded and has no segment
 * structure — and the insertion point is the end of the **leading run** of `APPn` segments,
 * which is where `JFIF` and any `Exif` block sit. Putting the comment after them rather
 * than straight after `SOI` is what readers expect, and keeps the first `APPn` the one a
 * format sniffer looks at.
 */
function segments(bytes) {
  let at = 2;
  let insert = 2;
  let leading = true;
  let mine = null;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    // The standalone markers carry no length: `TEM` and the eight restarts.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      leading = false;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) break;
    const end = at + 2 + length;
    if (marker >= 0xe0 && marker <= 0xef && leading) insert = end;
    else {
      leading = false;
      if (marker === 0xfe && linkOf(DECODER.decode(bytes.subarray(at + 4, end))) !== null) {
        mine = { at, end };
      }
    }
    at = end;
  }
  return { insert, mine };
}

/**
 * The JPEG with this payload in a `COM` segment.
 *
 * Idempotent in the same way the PNG is: a comment of ours already there is replaced.
 * Throws where the bytes are not a JPEG, or where the payload would not fit in one comment.
 */
export function stampJpeg(bytes, payload) {
  if (!isJpeg(bytes)) throw new Error("not a JPEG");
  const text = ENCODER.encode(payload);
  if (text.length > COMMENT_LIMIT) {
    throw new Error(`a JPEG comment holds ${COMMENT_LIMIT} bytes and this link is longer`);
  }
  const comment = new Uint8Array(4 + text.length);
  comment[0] = 0xff;
  comment[1] = 0xfe;
  comment[2] = (text.length + 2) >> 8;
  comment[3] = (text.length + 2) & 0xff;
  comment.set(text, 4);

  const { insert, mine } = segments(bytes);
  const parts = [bytes.subarray(0, insert), comment];
  if (mine === null) parts.push(bytes.subarray(insert));
  else parts.push(bytes.subarray(insert, mine.at), bytes.subarray(mine.end));
  return join(parts);
}

/** The payload a JPEG carries in a comment of ours, or `null`. */
export function readJpeg(bytes) {
  if (!isJpeg(bytes)) return null;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) break;
    const end = at + 2 + length;
    if (marker === 0xfe) {
      const text = DECODER.decode(bytes.subarray(at + 4, end));
      if (linkOf(text) !== null) return text;
    }
    at = end;
  }
  return null;
}

// -------------------------------------------------------------------------- both

function join(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The link a picture carries, whatever of the two it is, or `null`. */
export function linkIn(bytes) {
  const payload = isPng(bytes) ? readPng(bytes) : isJpeg(bytes) ? readJpeg(bytes) : null;
  return payload === null ? null : linkOf(payload);
}

/**
 * A finished file with its own link written into it.
 *
 * A type this cannot stamp — the WebP a thumbnail is — comes back exactly as it went in,
 * so a call site may hand over whatever it encoded without asking first.
 */
export async function stamp(blob, type, query) {
  if (type !== "image/png" && type !== "image/jpeg") return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const payload = payloadOf(query);
  const stamped = type === "image/png" ? stampPng(bytes, payload) : stampJpeg(bytes, payload);
  return new Blob([stamped], { type });
}

/** The link a dropped file carries, or `null`. Reads metadata and never pixels. */
export async function linkInFile(file) {
  return linkIn(new Uint8Array(await file.arrayBuffer()));
}
