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
// **And no version of its own.** The query carries `v=3` or `dv=3`, so a payload this page
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
// **And the same link again, whole, where ordinary tools look** *(embedded_links_ckpt145)*.
// The tag above is this page's own and no other program reads it, so a file also carries
// the absolute URL — `EXPLORER_URL` and the query — in the fields a photo viewer, a file
// manager or `exiftool` shows: an XMP packet's `dc:source` in both formats, and in a JPEG
// an EXIF `ImageDescription` too, which is the field Windows shows as a file's Title.
// `dc:source` is Dublin Core's "a related resource from which the described resource is
// derived", which is what a link that draws the picture again is. The host is a constant
// here and the drop-to-reopen reader never needs it: it reads the tag first, and the XMP
// only where there is no tag, and then only the query.
//
// **One packet per file, and never somebody else's replaced.** A PNG or JPEG carries one
// standard XMP packet and one EXIF block, so a file that already holds a packet or a block
// that is not ours keeps it and goes without that half of ours; the tag still goes in.
// Ours is recognized by what it says — a URL whose path is the explorer's — so a stamp
// written under another base is still ours to replace.
//
// Nothing here touches the DOM except `stamp`, which is the one function that takes and
// returns a `Blob`; the rest is bytes, and runs under node's own test runner.
//
// `fractal-wallpapers`' `curation/embed_link.py` writes these same bytes into the
// release renders next door, and is held to this file by `builder check`'s `stamps`.

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

/**
 * Where a link written into a file points: the explorer, on the site as it is served.
 *
 * **The one place this module spells a host**, and it is `builder/pages.py`'s `SITE_URL`
 * with `explorer/` after it — `builder check`'s `stamps` holds the two together, and the
 * wallpaper project's `curation/explorer_link.py` to both. The hosting choice is not
 * final; when it moves, this line and `SITE_URL` move together and the check says so.
 */
export const EXPLORER_URL = "https://techmatt.github.io/fractals/explorer/";

/** The PNG keyword an XMP packet travels under, by the XMP specification. */
export const XMP_KEYWORD = "XML:com.adobe.xmp";

/** What opens a JPEG's XMP segment, by the same specification. */
const XMP_SIGNATURE = "http://ns.adobe.com/xap/1.0/\0";

/** What opens a JPEG's EXIF segment. */
const EXIF_SIGNATURE = "Exif\0\0";

/** The TIFF tag EXIF's `ImageDescription` is. */
const IMAGE_DESCRIPTION = 0x010e;

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

/** The absolute link a file carries for ordinary tools: the explorer and the query. */
export function urlOf(query) {
  return `${EXPLORER_URL}?${bare(query)}`;
}

/** The query an explorer URL carries, whatever host it names, or `null` for a URL that is
 *  not the explorer's. Reading is by path, so a file stamped under another base opens. */
export function queryOfUrl(url) {
  if (typeof url !== "string") return null;
  const found = /^[a-z][a-z0-9+.-]*:\/\/[^?#\s]*\/explorer\/(?:index\.html)?\?([^#\s]+)$/i.exec(url.trim());
  return found === null ? null : found[1];
}

// ---------------------------------------------------------------------------- XMP

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/**
 * The XMP packet for this link: one `rdf:Description` holding `dc:source`, and nothing
 * else. No padding — nothing here edits a packet in place, and a stamp is replaced whole.
 */
export function xmpOf(url) {
  const text = url.replace(/[&<>"]/g, (one) => XML_ESCAPES[one]);
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:source>${text}</dc:source>` +
    "</rdf:Description></rdf:RDF></x:xmpmeta>" +
    '<?xpacket end="r"?>'
  );
}

/** The `dc:source` an XMP packet names, unescaped, or `null`. Both the element form this
 *  writes and the attribute form other writers use. */
export function sourceOf(packet) {
  if (typeof packet !== "string") return null;
  const found =
    /<dc:source>([^<]*)<\/dc:source>/.exec(packet) ?? /\bdc:source="([^"]*)"/.exec(packet);
  if (found === null) return null;
  return found[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name],
  );
}

/** Whether a packet is one of ours: its source is an explorer link. */
function ourXmp(packet) {
  return queryOfUrl(sourceOf(packet)) !== null;
}

// --------------------------------------------------------------------------- EXIF

/**
 * An EXIF block — the TIFF structure after `Exif\0\0` — with one entry in IFD0: the URL as
 * `ImageDescription`. Big-endian, the way the TIFF header says. `null` where the URL is not
 * ASCII, which is what the field's type is; a link percent-encodes everything else.
 */
export function exifOf(url) {
  if (!/^[\x20-\x7e]*$/.test(url)) return null;
  const text = ENCODER.encode(url);
  const count = text.length + 1;
  // Header 8, entry count 2, one entry 12, next-IFD offset 4, then the string.
  const out = new Uint8Array(EXIF_SIGNATURE.length + 26 + count);
  out.set(ENCODER.encode(EXIF_SIGNATURE), 0);
  const view = new DataView(out.buffer, EXIF_SIGNATURE.length);
  view.setUint16(0, 0x4d4d); // "MM"
  view.setUint16(2, 42);
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, IMAGE_DESCRIPTION);
  view.setUint16(12, 2); // ASCII
  view.setUint32(14, count);
  view.setUint32(18, 26);
  view.setUint32(22, 0);
  out.set(text, EXIF_SIGNATURE.length + 26);
  return out;
}

/** The `ImageDescription` an EXIF block's IFD0 carries, either byte order, or `null`. */
export function descriptionOf(block) {
  if (block.length < EXIF_SIGNATURE.length + 8) return null;
  if (DECODER.decode(block.subarray(0, EXIF_SIGNATURE.length)) !== EXIF_SIGNATURE) return null;
  const tiff = block.subarray(EXIF_SIGNATURE.length);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = view.getUint16(0) === 0x4949;
  if (!little && view.getUint16(0) !== 0x4d4d) return null;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return null;
  const entries = view.getUint16(ifd, little);
  for (let at = ifd + 2; at + 12 <= tiff.length && at < ifd + 2 + entries * 12; at += 12) {
    if (view.getUint16(at, little) !== IMAGE_DESCRIPTION || view.getUint16(at + 2, little) !== 2) continue;
    const count = view.getUint32(at + 4, little);
    const start = count <= 4 ? at + 8 : view.getUint32(at + 8, little);
    if (start + count > tiff.length) return null;
    const text = tiff.subarray(start, start + count);
    const end = text.indexOf(0);
    return DECODER.decode(end < 0 ? text : text.subarray(0, end));
  }
  return null;
}

/** Whether an EXIF block is one of ours: its description is an explorer link. */
function ourExif(block) {
  return queryOfUrl(descriptionOf(block)) !== null;
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
function textChunk(payload, name = KEYWORD) {
  const keyword = ENCODER.encode(name);
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

/** The XMP packet a PNG carries, or `null`. */
export function xmpInPng(bytes) {
  if (!isPng(bytes)) return null;
  for (const one of chunks(bytes)) {
    if (one.type !== "iTXt") continue;
    const said = textOf(one.type, one.data);
    if (said !== null && said.keyword === XMP_KEYWORD) return said.text;
  }
  return null;
}

/**
 * The PNG with every field of the link in it: the tag's chunk, then an XMP packet naming
 * the absolute URL, both straight after `IHDR`.
 *
 * Idempotent like `stampPng`: an XMP packet of ours is replaced, and one of somebody
 * else's is left alone and ours goes without — a PNG carries one.
 */
export function embedPng(bytes, query) {
  const tagged = stampPng(bytes, payloadOf(query));
  const parts = [];
  let foreign = false;
  let at = 0;
  let after = null;
  for (const one of chunks(tagged)) {
    // The tag's chunk is the one straight after IHDR, and the packet goes after it.
    if (after === null && one.type !== "IHDR") after = one.end;
    if (one.type !== "iTXt") continue;
    const said = textOf(one.type, one.data);
    if (said === null || said.keyword !== XMP_KEYWORD) continue;
    if (!ourXmp(said.text)) {
      foreign = true;
      continue;
    }
    parts.push(tagged.subarray(at, one.at));
    at = one.end;
  }
  parts.push(tagged.subarray(at));
  const kept = join(parts);
  if (foreign) return kept;
  // Nothing before `after` was dropped — a packet of ours never sits before the tag.
  return join([
    kept.subarray(0, after),
    textChunk(xmpOf(urlOf(query)), XMP_KEYWORD),
    kept.subarray(after),
  ]);
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

/** Every marker segment before the scan, as `{ marker, at, end, data }`, and where the
 *  scan starts. The standalone markers are carried as segments with no data. */
function jpegSegments(bytes) {
  const out = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push({ marker, at, end: at + 2, data: bytes.subarray(at + 2, at + 2) });
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) break;
    out.push({ marker, at, end: at + 2 + length, data: bytes.subarray(at + 4, at + 2 + length) });
    at += 2 + length;
  }
  return { segments: out, scan: at };
}

/** What an `APP1` segment is: `exif`, `xmp`, or `null` for anything else. */
function app1Kind(data) {
  const head = (signature) =>
    data.length >= signature.length && DECODER.decode(data.subarray(0, signature.length)) === signature;
  if (head(EXIF_SIGNATURE)) return "exif";
  if (head(XMP_SIGNATURE)) return "xmp";
  return null;
}

/** One `APP1` segment around this data, or `null` where it would not fit in one. */
function app1(data) {
  if (data.length + 2 > 0xffff) return null;
  const out = new Uint8Array(4 + data.length);
  out[0] = 0xff;
  out[1] = 0xe1;
  out[2] = (data.length + 2) >> 8;
  out[3] = (data.length + 2) & 0xff;
  out.set(data, 4);
  return out;
}

/** The XMP packet a JPEG carries, or `null`. */
export function xmpInJpeg(bytes) {
  if (!isJpeg(bytes)) return null;
  for (const one of jpegSegments(bytes).segments) {
    if (one.marker === 0xe1 && app1Kind(one.data) === "xmp") {
      return DECODER.decode(one.data.subarray(XMP_SIGNATURE.length));
    }
  }
  return null;
}

/** The EXIF block a JPEG carries, `Exif\0\0` and all, or `null`. */
export function exifInJpeg(bytes) {
  if (!isJpeg(bytes)) return null;
  for (const one of jpegSegments(bytes).segments) {
    if (one.marker === 0xe1 && app1Kind(one.data) === "exif") return one.data;
  }
  return null;
}

/**
 * The JPEG with every field of the link in it: an EXIF block and an XMP packet at the end
 * of the leading `APPn` run, and the tag's comment after them.
 *
 * Idempotent: a block, a packet or a comment of ours is replaced. One of somebody else's
 * is kept, and that half of ours is left out, because a JPEG carries one of each.
 */
export function embedJpeg(bytes, query) {
  const tagged = stampJpeg(bytes, payloadOf(query));
  const { segments, scan } = jpegSegments(tagged);
  const kept = [];
  const foreign = new Set();
  for (const one of segments) {
    const kind = one.marker === 0xe1 ? app1Kind(one.data) : null;
    if (kind === "exif" && ourExif(one.data)) continue;
    if (kind === "xmp" && ourXmp(DECODER.decode(one.data.subarray(XMP_SIGNATURE.length)))) continue;
    if (kind !== null) foreign.add(kind);
    kept.push(one);
  }
  let insert = 0;
  while (insert < kept.length && kept[insert].marker >= 0xe0 && kept[insert].marker <= 0xef) insert += 1;

  const url = urlOf(query);
  const added = [];
  const exif = foreign.has("exif") ? null : exifOf(url);
  if (exif !== null) added.push(app1(exif));
  if (!foreign.has("xmp")) added.push(app1(join([ENCODER.encode(XMP_SIGNATURE), ENCODER.encode(xmpOf(url))])));

  const parts = [tagged.subarray(0, 2)];
  kept.forEach((one, at) => {
    if (at === insert) parts.push(...added.filter((segment) => segment !== null));
    parts.push(tagged.subarray(one.at, one.end));
  });
  if (insert === kept.length) parts.push(...added.filter((segment) => segment !== null));
  parts.push(tagged.subarray(scan));
  return join(parts);
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

/**
 * The link a picture carries, whatever of the two it is, or `null`.
 *
 * The tag first, because it is this page's own; the XMP packet's `dc:source` where there is
 * no tag, so a file whose comment some other program dropped still opens. The EXIF copy is
 * for people and is not read.
 */
export function linkIn(bytes) {
  const payload = isPng(bytes) ? readPng(bytes) : isJpeg(bytes) ? readJpeg(bytes) : null;
  const tagged = payload === null ? null : linkOf(payload);
  if (tagged !== null) return tagged;
  const packet = isPng(bytes) ? xmpInPng(bytes) : isJpeg(bytes) ? xmpInJpeg(bytes) : null;
  return queryOfUrl(sourceOf(packet));
}

/** A finished file with every field of its link in it, whatever of the two it is. Throws
 *  where the bytes are neither. */
export function embed(bytes, query) {
  if (isPng(bytes)) return embedPng(bytes, query);
  if (isJpeg(bytes)) return embedJpeg(bytes, query);
  throw new Error("neither a PNG nor a JPEG");
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
  const stamped = type === "image/png" ? embedPng(bytes, query) : embedJpeg(bytes, query);
  return new Blob([stamped], { type });
}

/** The link a dropped file carries, or `null`. Reads metadata and never pixels. */
export async function linkInFile(file) {
  return linkIn(new Uint8Array(await file.arrayBuffer()));
}
