// The atlas record, read.
//
// `builder/atlas.py` is the authority on what the record may say and holds it to that
// shape before anything is committed; this file is the browser's half — it fetches the
// index, fetches each partition it names, and hands back objects the page draws from.
//
// **It reads keys and never composes them.** A slot's frame is the record's own `x`,
// `y`, `w` and constants, spelled the way `permalink.js` spells them, and they go to the
// contract untouched. Nothing here works out where a location is from where it sits in a
// list — a rig that did would draw at a moving target the day the maker reran next door,
// and the pictures would not change while the links underneath them did.

/** One JSONL file as the rows it holds. */
async function rowsOf(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status} ${response.statusText}`);
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * The whole record: the method row, and one entry per partition.
 *
 * `base` is the directory the record lives in, so every fetch is relative to the page
 * that carries it — this site is served from a project-Pages subpath, and a rooted URL
 * is the bug that works locally.
 */
export async function load(base) {
  const index = await rowsOf(new URL("atlas.jsonl", base));
  const method = index.find((row) => row.kind === "method");
  if (method === undefined) throw new Error("atlas.jsonl: no method row");

  const partitions = [];
  for (const row of index.filter((entry) => entry.kind === "partition")) {
    const dots = (await rowsOf(new URL(row.file, base))).filter((entry) => entry.kind === "dot");
    partitions.push({ ...row, dots });
  }
  if (partitions.length === 0) throw new Error("atlas.jsonl: no partitions");
  return { method, partitions };
}
