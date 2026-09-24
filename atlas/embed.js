// The atlas frame, live in an article page.
//
// The explorer's Atlas tab and the Fractal atlases page mount one implementation:
// `frame.js`, with `frame.css` for its stylesheet. This module is the article's half of that
// and holds nothing of the frame's own. It finds the well a live figure block left for it
// (`builder/figures.py`'s `_live` writes the block), and mounts a frame over it once the
// well comes near the viewport, so the page's own pictures and text are never waiting on
// the record, the plates or the engine the frame instantiates for `plan`.
//
// **The two callers differ in four options and nothing else.** The fourth is `miniatures`:
// a reader of the article meets the chips before the planes have names to them, so here
// each chip carries a small picture of its plate, and the studio's chips stay words. The studio hands a click
// back to its own viewer (`onPick`) and puts a save mark on each slot; an article page has
// no viewer, so a slot is a link into the explorer and a mark goes where its gallery slot
// goes, in the same tab as every other figure link. The studio's panel is a box its page
// has sized; an article column sizes nothing but width, so the frame is fitted to the width
// (`fit: "width"`) and the well's height follows it. And a phone's column is narrower than
// the studio's floor, so the floor is the column's (`least`). Colouring, the chips, the
// slots, the hover and the linger are the frame's, which is why they are the tab's too.
//
// The well keeps what the builder wrote until the frame is actually in it: a line saying
// what would be here and the way to the Atlas tab. A page opened from disk never runs this
// module at all, since a browser refuses a module over `file://`, and that line is what is
// left, which is also what a reader with scripting off gets.

/** How far ahead of the viewport a well starts loading, so it is drawn by the time it is
 *  scrolled to without the page paying for a frame nobody has reached. */
const AHEAD = "600px 0px";

/** The narrowest plate an article column may give the frame. The studio's floor is 320,
 *  and the narrowest phone column this site is read in is about 240 inside the figure's
 *  well, which is where a frame of three slots over a plate still reads. */
const LEAST = 220;

/** The frame's stylesheet, loaded once and awaited, because the frame measures its strip
 *  of planes when it is fitted and an unstyled strip measures wrong. */
let styled = null;
function stylesheet() {
  styled ??= new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./frame.css", import.meta.url).href;
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => reject(new Error("frame.css did not load")));
    document.head.appendChild(link);
  });
  return styled;
}

async function start(host) {
  const note = host.querySelector(".figure-live-note");
  host.classList.add("is-loading");
  try {
    const [{ mount }] = await Promise.all([import("./frame.js"), stylesheet()]);
    note?.remove();
    await mount(host, { fit: "width", least: LEAST, linger: true, miniatures: true });
  } catch (error) {
    // Whatever did not load, the well goes back to what the builder wrote.
    console.warn("the atlas could not be mounted", error);
    for (const child of [...host.children]) if (child !== note) child.remove();
    if (note && !note.isConnected) host.appendChild(note);
  } finally {
    host.classList.remove("is-loading");
  }
}

const hosts = [...document.querySelectorAll('[data-live="atlas"]')];
if ("IntersectionObserver" in window) {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watch.unobserve(entry.target);
        start(entry.target);
      }
    },
    { rootMargin: AHEAD },
  );
  for (const host of hosts) watch.observe(host);
} else {
  for (const host of hosts) start(host);
}
