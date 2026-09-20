// The Saved tab: the visitor's own pictures, drawn again from their links
// *(saved_tab_ckpt131)*.
//
// **Nothing stored but links.** Each tile is drawn by the engine from the saved permalink
// at tile size, on a renderer of the panel's own, and the picture is kept in memory as a
// blob URL for as long as the page is open, so a tile is drawn once a visit. What
// `saved.js` writes to the browser is the list of links and nothing else.
//
// **Its own renderer, as the walk has.** The viewer's renderer runs one job at a time and
// a new one cancels the last, so a panel drawing thumbnails on it would be cancelled by
// every pan and would cancel the picture being looked at. The panel starts a small pool
// the first time a tile needs drawing, draws only tiles that are near its window, one at
// a time, and draws nothing while the tab is hidden.
//
// **Download all is a download, repeated.** It draws on the viewer's renderer at the
// download row's size and samples, holding the row and the view exactly as one download
// does, one picture at a time into a stored zip (`zip.js`). It says what it will cost
// before it starts where that is more than a minute, and its button is the way to cancel.
//
// **A picture dropped here is kept, not opened** *(explorer_download_carries_link_ckpt137)*.
// A file saved from this page carries its own link, so dropping one on this tab is another
// way of saving it; dropping it on the canvas is how it is opened instead.
//
// **The panel does nothing to a running walk.** Showing it neither pauses nor resumes
// one; opening a saved picture detaches the viewer from it the way opening any picture
// does, and the walk carries on.

import { FORMATS, encode, estimate, fileNameOf, hand, pictureOf, withinLimits } from "./download.js";
import { Renderer } from "./render.js";
import { MAX } from "./saved.js";
import { Zip } from "./zip.js";

/** A tile's picture: the gallery's tile size, so the three grids read as one. */
const TILE = { width: 316, height: 178 };

/** Samples each way a thumbnail is drawn at: the screen's finished pass. */
const TILE_SUPERSAMPLE = 2;

/** Asked before Download all starts once it would take longer than this, or hold more. */
const ASK_SECONDS = 60;
const ASK_COUNT = 25;

/** Bytes per pixel an encoded fractal lands near, for the size said before a long run:
 *  a rough reading of downloads from this page, never a promise. */
const BYTES_PER_PIXEL = { png: 1.6, jpg: 0.4 };

/** Every thumbnail drawn this visit, by canonical link. Kept across refills. */
const drawnTiles = new Map();

/** Whether a drag is carrying files, which is the only kind this tab takes. */
function dragsFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

export function mount(host) {
  const { saved, parse, shownName, planeName } = host;
  const els = host.elements;

  let visible = false;
  let dirty = true;
  let renderer = null;
  let starting = null;
  let observer = null;
  const queue = [];
  let drawing = false;
  let openKey = null;
  let running = null;

  // ------------------------------------------------------------------ the tiles

  /** A tile's label.
   *
   *  A deep entry says so and says how wide it is, because "smooth · Mandelbrot" is true
   *  of it and tells a reader nothing: what makes it worth keeping is the depth. */
  function describeView(view) {
    if (view.deep) return `deep · ${view.said}`;
    return `${view.mode} · ${planeName(view.family)}`;
  }

  function fill() {
    dirty = false;
    queue.length = 0;
    const cells = saved.items.map(({ link }) => cell(link));
    els.tiles.replaceChildren(...cells);
    // A thumbnail no longer saved is a blob nobody will show again.
    const kept = new Set(saved.items.map((item) => item.link));
    for (const [key, url] of drawnTiles) {
      if (!kept.has(key)) {
        URL.revokeObjectURL(url);
        drawnTiles.delete(key);
      }
    }
    watch();
    head();
  }

  function cell(key) {
    const box = document.createElement("div");
    box.className = "tile-cell";
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile saved-tile";
    tile.dataset.key = key;
    if (key === openKey) tile.classList.add("is-open");
    const image = document.createElement("img");
    image.width = TILE.width;
    image.height = TILE.height;
    image.decoding = "async";
    const label = document.createElement("span");
    label.className = "tile-label";
    let view = null;
    try {
      view = parse(key);
      const said = describeView(view);
      label.textContent = said;
      tile.title = view.deep
        ? `The Mandelbrot set at ${view.said}, in ${shownName(view.palette)} — below what ` +
          "the ordinary renderer resolves. Opens in the Deep tab."
        : `${view.mode} in ${shownName(view.palette)} on ${planeName(view.family)}`;
      image.alt = view.deep ? "" : tile.title;
      // **A deep picture is not drawn here.** There is no thumbnail of one without the
      // perturbation kernel and a wait of seconds to minutes a tile, so the tab labels it
      // and the click opens it where it can be drawn.
      if (view.deep) tile.classList.add("is-deep");
    } catch (error) {
      label.textContent = "cannot be read";
      tile.title = String(error.message ?? error);
      image.alt = "";
    }
    const known = drawnTiles.get(key);
    if (known !== undefined) {
      image.src = known;
      tile.classList.add("is-ready");
    }
    tile.append(image, label);
    tile.addEventListener("click", () => {
      openKey = key;
      for (const other of els.tiles.querySelectorAll(".tile")) {
        other.classList.toggle("is-open", other.dataset.key === key);
      }
      host.open(key);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tile-remove";
    remove.textContent = "×";
    remove.title = "Remove from Saved";
    remove.setAttribute("aria-label", "Remove from Saved");
    remove.addEventListener("click", () => saved.remove(key));
    box.append(tile, remove);
    return box;
  }

  /** Ask for a tile's picture when it comes near the panel's window, as the gallery does. */
  function watch() {
    observer?.disconnect();
    const scrolls = getComputedStyle(els.tiles).overflowY !== "visible";
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const key = entry.target.dataset.key;
          if (!drawnTiles.has(key)) queue.push(entry.target);
        }
        pump();
      },
      { root: scrolls ? els.tiles : null, rootMargin: "300px 0px" },
    );
    for (const tile of els.tiles.querySelectorAll(".tile:not(.is-ready)")) observer.observe(tile);
  }

  async function pool() {
    if (renderer !== null) return renderer;
    starting ??= (async () => {
      const cores = navigator.hardwareConcurrency || 8;
      renderer = await Renderer.over(host.module, Math.max(1, Math.min(4, Math.floor(cores / 3))));
      return renderer;
    })();
    return starting;
  }

  /** Draw the queued tiles one at a time, newest first as they were queued, while shown. */
  async function pump() {
    if (drawing) return;
    drawing = true;
    try {
      while (visible && queue.length > 0) {
        const tile = queue.shift();
        const key = tile.dataset.key;
        if (!tile.isConnected || drawnTiles.has(key)) continue;
        let view;
        try {
          view = parse(key);
        } catch {
          continue;
        }
        // A deep entry has no tile to draw: see `cell`.
        if (view.deep) continue;
        const pictures = await pool();
        let url = null;
        try {
          const drawn = await pictureOf(pictures, view, TILE.width, TILE.height, {
            supersample: TILE_SUPERSAMPLE,
            apart: false,
          });
          if (drawn === null) continue;
          const blob = await encode(drawn.image, { type: "image/webp", quality: 0.85, label: "WebP" });
          url = URL.createObjectURL(blob);
        } catch (error) {
          tile.title = `This picture could not be drawn here: ${error.message ?? error}`;
          tile.classList.add("is-refused");
          continue;
        }
        drawnTiles.set(key, url);
        // The tile may have been rebuilt while it drew; every copy of it gets the picture.
        for (const one of els.tiles.querySelectorAll(".tile")) {
          if (one.dataset.key !== key) continue;
          one.querySelector("img").src = url;
          one.classList.add("is-ready");
        }
      }
    } finally {
      drawing = false;
    }
  }

  // ------------------------------------------------------------------ the head

  function head() {
    const count = saved.size;
    els.count.textContent =
      count === 0 ? "" : count === 1 ? "1 saved" : `${count.toLocaleString("en-US")} saved`;
    els.empty.hidden = count > 0;
    for (const button of [els.download, els.exportFile, els.copy, els.clear]) {
      button.disabled = count === 0 || (running !== null && button !== els.download);
    }
    els.format.disabled = count === 0 || running !== null;
    const notes = [];
    if (saved.failed) notes.push(saved.failed);
    if (saved.full) notes.push(`Saved is full at ${MAX.toLocaleString("en-US")} pictures. Remove some to save more.`);
    els.warning.textContent = notes.join(" ");
  }

  function say(text) {
    els.progress.textContent = text;
  }

  // ------------------------------------------------------------------ export and import

  /** Today, in the visitor's own calendar, for a file name. */
  function today() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  }

  els.exportFile.addEventListener("click", () => {
    hand(
      new Blob([saved.exported()], { type: "application/json" }),
      `fractal-explorer-saved-${today()}.json`,
    );
    say(`Exported ${saved.size === 1 ? "1 link" : `${saved.size} links`}.`);
  });

  els.copy.addEventListener("click", async () => {
    const page = `${window.location.origin}${window.location.pathname}`;
    const text = saved.items.map(({ link }) => `${page}?${link}`).join("\n");
    try {
      await navigator.clipboard.writeText(`${text}\n`);
      say(`Copied ${saved.size === 1 ? "1 link" : `${saved.size} links`}, one to a line.`);
    } catch {
      say("The browser would not copy. Export the list as a file instead.");
    }
  });

  els.importToggle.addEventListener("click", () => {
    els.importBox.hidden = !els.importBox.hidden;
    els.importToggle.setAttribute("aria-expanded", String(!els.importBox.hidden));
    if (!els.importBox.hidden) els.paste.focus();
  });

  function take(text) {
    const entries = host.parseImport(text);
    if (entries.length === 0) {
      say("There was nothing to import there.");
      return;
    }
    const tally = saved.merge(entries);
    const parts = [`Added ${tally.added}`];
    if (tally.already > 0) parts.push(`${tally.already} already saved`);
    if (tally.refused > 0) parts.push(`${tally.refused} not ${tally.refused === 1 ? "a link" : "links"} this page can open`);
    if (tally.full > 0) parts.push(`${tally.full} left out because Saved is full`);
    say(`${parts.join("; ")}.`);
    if (tally.added > 0 || tally.already > 0) {
      els.paste.value = "";
      els.importBox.hidden = true;
      els.importToggle.setAttribute("aria-expanded", "false");
    }
  }

  els.importGo.addEventListener("click", () => take(els.paste.value));
  els.file.addEventListener("change", async () => {
    const [file] = els.file.files;
    if (file === undefined) return;
    try {
      take(await file.text());
    } catch {
      say("That file could not be read.");
    }
    els.file.value = "";
  });

  // A picture dropped on this tab is **saved** rather than opened
  // *(explorer_download_carries_link_ckpt137)*: its link is read out of the file exactly as
  // the canvas reads a picture dropped there, and then goes through the import the paste
  // box and the file button already use, so the tally at the end is the same sentence.
  // Anything else dropped here is read as text, which is what those two take.
  els.panel.addEventListener("dragover", (event) => {
    if (!dragsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  els.panel.addEventListener("drop", async (event) => {
    if (!dragsFiles(event)) return;
    event.preventDefault();
    const [file] = event.dataTransfer.files;
    if (file === undefined) return;
    try {
      const { isJpeg, isPng, linkInFile } = await import("./stamp.js");
      // Eight bytes decide which of the two this is, rather than a type the drag reported.
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (!isPng(head) && !isJpeg(head)) {
        take(await file.text());
        return;
      }
      const query = await linkInFile(file);
      if (query === null) say("That picture carries no explorer link, so there is nothing to save.");
      else take(query);
    } catch {
      say("That file could not be read.");
    }
  });

  els.clear.addEventListener("click", () => {
    const count = saved.size;
    if (count === 0) return;
    const pictures = count === 1 ? "the saved picture" : `all ${count} saved pictures`;
    if (!window.confirm(`Remove ${pictures} from this browser? Export first to keep a copy.`)) return;
    saved.clear();
    say("Saved is empty.");
  });

  // ------------------------------------------------------------------ download all

  function formatNow() {
    return FORMATS[els.format.value] ?? FORMATS.jpg;
  }

  /** Seconds and bytes the whole run should cost, from the prior table: a rough figure. */
  function cost(views, width, height, supersample, format) {
    let seconds = 0;
    for (const view of views) {
      seconds += estimate(view.mode, width * height * supersample * supersample, host.renderer.workerCount) ?? 0;
    }
    const bytes = views.length * width * height * BYTES_PER_PIXEL[format.extension];
    return { seconds, bytes };
  }

  function saidTime(seconds) {
    if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
    return `${(seconds / 3600).toFixed(1)} hours`;
  }

  function saidBytes(bytes) {
    if (bytes < 1e9) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }

  function uniqueName(name, taken) {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    for (let n = 2; ; n++) {
      const next = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
      if (!taken.has(next)) {
        taken.add(next);
        return next;
      }
    }
  }

  function syncDownload() {
    els.download.textContent = running === null ? "Download all" : "Cancel";
    els.download.title = running === null
      ? "Every saved picture, drawn at the download row's size and samples, in one zip."
      : "Stop drawing. Nothing is saved.";
    els.download.classList.toggle("is-running", running !== null);
    head();
  }

  async function downloadAll() {
    if (running !== null) {
      running.cancelled = true;
      host.renderer.cancel();
      running.holder.stop?.();
      return;
    }
    const format = formatNow();
    const { width, height, supersample } = host.download.asked();
    const refusal = withinLimits(width, height, supersample);
    if (refusal !== null) {
      say(`The download row asks for more than one picture may be: ${refusal}`);
      return;
    }
    const entries = [];
    for (const { link } of saved.items) {
      try {
        const view = parse(link);
        // A deep picture is left out for the reason its tile is: this path draws through
        // the ordinary renderer, which cannot resolve one. Download from the Deep tab is
        // not offered at all yet, so leaving it out is honest rather than a gap.
        if (view.deep) continue;
        entries.push({ link, view });
      } catch {
        // Unreadable links are left out and counted at the end.
      }
    }
    if (entries.length === 0) return;
    const samples = supersample * supersample;
    const { seconds, bytes } = cost(entries.map((entry) => entry.view), width, height, supersample, format);
    if (seconds > ASK_SECONDS || entries.length > ASK_COUNT) {
      const ok = window.confirm(
        `Download all draws ${entries.length} pictures at ${width}×${height}, ${samples} ` +
          `${samples === 1 ? "sample" : "samples"} a pixel, as ${format.label}: about ` +
          `${saidTime(seconds)} on this machine, and a zip of roughly ${saidBytes(bytes)}. ` +
          "The view is held still until it finishes, and pressing Cancel stops it. Go ahead?",
      );
      if (!ok) return;
    }
    if (!host.download.hold(true)) {
      say("A download is drawing. Download all can start once it has finished.");
      return;
    }
    running = { cancelled: false, holder: {} };
    const mine = running;
    syncDownload();
    const zip = new Zip();
    const taken = new Set();
    const skipped = [];
    const started = performance.now();
    try {
      for (const [index, { link: query, view }] of entries.entries()) {
        if (mine.cancelled) break;
        const name = uniqueName(fileNameOf(view, width, height, format.extension), taken);
        say(`Drawing ${index + 1} of ${entries.length}: ${name}`);
        mine.holder = {};
        let drawn;
        try {
          drawn = await pictureOf(host.renderer, view, width, height, {
            supersample,
            holder: mine.holder,
            onProgress: (done) => {
              if (!mine.cancelled) {
                say(`Drawing ${index + 1} of ${entries.length} (${Math.round(done * 100)}%): ${name}`);
              }
            },
          });
        } catch (error) {
          skipped.push(`${name}: ${error.message ?? error}`);
          continue;
        }
        if (drawn === null || mine.cancelled) break;
        // Every picture in the archive carries its own link, the one it was drawn from.
        const blob = await encode(drawn.image, format, query);
        if (!zip.fits(name, blob.size)) {
          skipped.push(`${name} and after: the zip is full`);
          break;
        }
        await zip.add(name, blob);
      }
      if (mine.cancelled) {
        say("Download all cancelled. Nothing was saved.");
      } else if (zip.count === 0) {
        say(`Nothing could be drawn. ${skipped.join(" ")}`);
      } else {
        const file = `fractal-explorer-saved-${today()}.zip`;
        hand(zip.blob(), file);
        const spent = (performance.now() - started) / 1000;
        const left = entries.length - zip.count;
        say(
          `Saved ${file}: ${zip.count} ${zip.count === 1 ? "picture" : "pictures"} in ` +
            `${saidTime(spent)}.${left > 0 ? ` ${left} left out: ${skipped.join("; ")}.` : ""}`,
        );
      }
    } catch (error) {
      say(`Download all stopped: ${error.message ?? error}`);
    } finally {
      running = null;
      host.download.hold(false);
      // The viewer's own pass may have been cut short by the first picture; it finishes now.
      host.settle();
      syncDownload();
    }
  }

  els.download.addEventListener("click", downloadAll);

  // ------------------------------------------------------------------ the handle

  saved.subscribe(() => {
    if (visible) fill();
    else dirty = true;
  });

  return {
    show() {
      visible = true;
      if (dirty) fill();
      else {
        head();
        watch();
      }
    },
    hide() {
      visible = false;
      queue.length = 0;
    },
    /** The viewer moved to a picture that is not the saved one marked open. */
    unmark() {
      openKey = null;
      for (const tile of els.tiles.querySelectorAll(".tile.is-open")) tile.classList.remove("is-open");
    },
  };
}
