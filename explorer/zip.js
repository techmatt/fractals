// A zip archive of files that are already compressed *(saved_tab_ckpt131)*.
//
// **Stored, never deflated.** Everything Download all puts in an archive is a PNG or a
// JPG, and both are compressed already: deflate would spend seconds per picture to save
// a fraction of a percent. So each entry is written as it is — method 0 — and the whole
// format is three fixed headers and a CRC. That is small enough to write here rather than
// vendor, and it keeps the page free of anything fetched from somewhere else.
//
// **The pictures are never copied into one buffer.** An entry is its header, then the
// `Blob` the canvas encoded, and the archive is a `Blob` of those parts: the browser keeps
// each where it already is, which for a large one is on disk rather than in memory. The
// CRC is the one thing that reads the bytes, once, as they are added.
//
// No zip64: an archive stops at 65,535 entries and 4 GiB, and `add` says so rather than
// writing one a reader could not open. Names are UTF-8 and flagged as such.

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;
const VERSION = 20;
const LIMIT = 0xffffffff;
const MOST_ENTRIES = 0xffff;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 zip uses, of a run of bytes. */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** A date as MS-DOS keeps one: two 16-bit words, to the even second, from 1980. */
function dos(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** An archive being written. `add` its files in order, then `blob()` it. */
export class Zip {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.entries = 0;
    this.encoder = new TextEncoder();
  }

  get count() {
    return this.entries;
  }

  /** Whether one more file of `size` bytes, named `name`, still fits. */
  fits(name, size) {
    const header = 30 + this.encoder.encode(name).length;
    return this.count < MOST_ENTRIES && this.offset + header + size <= LIMIT;
  }

  /** Add one file. `data` is a `Blob` or bytes; the `Blob` is read once, for its CRC. */
  async add(name, data, date = new Date()) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!this.fits(name, bytes.length)) {
      throw new Error("the archive is full: a zip without zip64 stops at 65,535 files and 4 GB");
    }
    const crc = crc32(bytes);
    const encodedName = this.encoder.encode(name);
    const { time, day } = dos(date);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, encodedName.length, true);
    local.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL, true);
    central.setUint16(4, VERSION, true);
    central.setUint16(6, VERSION, true);
    central.setUint16(8, UTF8, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, bytes.length, true);
    central.setUint32(24, bytes.length, true);
    central.setUint16(28, encodedName.length, true);
    // Extra, comment, disk, internal and external attributes are all zero.
    central.setUint32(42, this.offset, true);

    this.parts.push(local.buffer, encodedName, blob);
    this.central.push(central.buffer, encodedName);
    this.offset += 30 + encodedName.length + bytes.length;
    this.entries += 1;
  }

  /** The finished archive. */
  blob() {
    const size = this.central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, END, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, size, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: "application/zip" });
  }
}
