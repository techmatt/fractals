// The deep gallery pack's pictures, stamped with their links: `explorer/stamp.js`'s
// `embedJpeg`, the same COM, XMP and EXIF bytes a download from the explorer carries and
// next door's `curation/embed_link.py` writes into the full set.
//
//   node builder/deep_pack_stamp.mjs jobs.json
//
// jobs.json: [{ path, query }]. Each JPEG is rewritten in place, and read back to prove
// the link it now carries is `query`. `builder/deep_pack.py` is the only caller.

import { readFileSync, writeFileSync } from "node:fs";
import { embedJpeg, linkIn } from "../explorer/stamp.js";

const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const job of jobs) {
  const stamped = embedJpeg(new Uint8Array(readFileSync(job.path)), job.query);
  if (linkIn(stamped) !== job.query) throw new Error(`${job.path}: the stamp does not read back`);
  writeFileSync(job.path, stamped);
}
console.log(JSON.stringify({ stamped: jobs.length }));
