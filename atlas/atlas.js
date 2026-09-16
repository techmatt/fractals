// The atlas page.
//
// The frame itself — the plate with its marks, the three slots, and every link they carry
// — is `frame.js`, because the explorer's studio shows the same frame in a panel. What is
// left here is what is the *page's*: the notice that stands in until the record has been
// read, the error path when it cannot be, and the one piece of arithmetic that makes this
// page full bleed.
//
// **The stage takes the window's height, or the figure's, whichever is less.** Full bleed
// is the ask and on any ordinary window the height is what binds, so the stage is the
// screen. On a narrow one the width binds first and the figure comes out short, and a
// stage held to the viewport anyway would be a band of empty mat with a small picture in
// the middle of it. The host inside it keeps the whole box the stage's padding leaves, so
// the frame is fitted to the room the window has rather than to the band it ends up in —
// the two are the same on a tall window and the frame is centred in either.
//
// The page has to be served: a browser will not load a module, or the `.wasm` the frame
// asks the home views of, over `file://`.

import { mount } from "./frame.js";

/** The shortest the stage goes, whatever a window with no height says. */
const LEAST_TALL = 280;

const stage = document.getElementById("stage");
const notice = document.getElementById("notice");
const host = document.getElementById("frame-host");

/** One element, with its text. */
function made(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/**
 * What the stage has to give: the window's width, and the height the site bar leaves.
 *
 * The height is a number rather than `100vh` less a bar, because the bar's own height is
 * whatever the reader's font metrics make it and `100vh` is a promise a phone browser does
 * not keep. The padding comes out of both, because that is the box the figure goes in.
 */
function room() {
  const style = getComputedStyle(stage);
  const above = stage.getBoundingClientRect().top + window.scrollY;
  return {
    padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    padY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
    width: document.documentElement.clientWidth,
    height: Math.max(LEAST_TALL, Math.floor(window.innerHeight - above)),
  };
}

/** The stage at its full height, which is what the notice is centred in before the load. */
function stageBox() {
  stage.style.height = `${room().height}px`;
}

async function start() {
  const frame = await mount(host, { keep: true });
  notice.hidden = true;
  host.hidden = false;

  // The host is the room the window has; the stage is what the frame made of it. Sizing
  // the host from the viewport rather than from the stage is what keeps the two one-way:
  // a stage that shrank to its figure and a frame fitted to the stage would be each other's
  // input, and a rounding of a pixel would chase itself.
  const lay = () => {
    const box = room();
    host.style.width = `${box.width - box.padX}px`;
    host.style.height = `${box.height - box.padY}px`;
    const size = frame.refit();
    stage.style.height = `${Math.min(box.height, size.height + box.padY)}px`;
  };
  lay();
  window.addEventListener("resize", lay);
}

// The stage is full height before anything has loaded, so the notice — and the wait, on a
// slow connection — sits in the band the figure is about to fill rather than in a strip
// that jumps open when it arrives.
stageBox();

start().catch((error) => {
  notice.replaceChildren(
    made("p", "The atlas could not be read."),
    made("p", String(error.message ?? error)),
  );
  // `lay` is what keeps the stage the window's height once there is a frame in it; with
  // no frame there is still a notice to centre, so the stage is resized on its own.
  window.addEventListener("resize", stageBox);
});
