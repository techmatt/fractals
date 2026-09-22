// The Julia preview under the pointer *(explorer_julia_hover_preview_ckpt137)*.
//
// On a parameter plane, the point under the pointer is a `c`, and this draws that `c`'s
// Julia set in a small card while the pointer rests on it. Julia here (J) takes `c` from
// the view's centre, so choosing one means panning it to the middle; this makes `c`
// aimable by eye, which is what the gesture is for — zoom the plane in on a cusp, move
// the mouse, and watch the Julia set change.
//
// **It is the picture entering gives, not a likeness of it.** The view it draws is the
// one `juliaAt` builds: the same family, the same home frame, the same mode, palette,
// recipe and tone. The three things it does differently are all size — one sample a pixel
// where the screen ends at two, 320x180, and the preview's own small pool — and one is
// not: a mode the prior says cannot be drawn inside the budget falls back to `smooth`,
// and the card says so rather than showing a picture that quietly is not the one waiting.
//
// **It never touches the viewer's renderer.** That one runs a job at a time and a new job
// cancels the last, so a preview drawn on it would be cancelled by every pan and would
// cancel the picture being looked at. This is the pattern the walk and the Saved tab
// already use, one size smaller: the pool starts at the first hover that would draw, and
// nothing is started at all while the main pass is still running.
//
// **The card is the gesture's only state.** There is no link key, no panel and no second
// setting — one flag, off or on, switched by the box beside Autolevel and by the card's
// own corner. What the card shows is what a click enters at, which is why the click is
// refused when the card is not up.

import { estimate } from "./download.js";
import { DERIVED } from "./permalink.js";
import { PROBE_WIDTH, Renderer, specOf } from "./render.js";

/** The card's picture. 16:9 because `.stage` is, so the preview is the frame entering
 *  gives rather than a crop of it. */
export const WIDTH = 320;
export const HEIGHT = 180;

/** How long the pointer rests before a preview is drawn. Short enough that a reader
 *  sweeping a cusp sees the set change as they go, long enough that a sweep across the
 *  whole canvas draws a handful of pictures and not a hundred. */
const SETTLE_MS = 90;

/**
 * What a preview may cost before its mode falls back to `smooth`, in seconds.
 *
 * Read against `download.js`'s per-mode prior at this size and this pool. That table is
 * one machine on one day and says so, so it is the opening guess and not the whole rule:
 * a frame that actually overran demotes its mode for the rest of the visit. At the
 * two-worker default the prior demotes `stripe` and `smooth_stripe` and nothing else.
 */
const BUDGET_S = 0.25;

/** The mode a demoted one falls back to: the one the article teaches first, the cheapest
 *  on the table, and the one every parameter plane looks like to a reader who has not
 *  changed it. */
const FALLBACK = "smooth";

/**
 * The flag, and where it is kept.
 *
 * **Off unless this tab has switched it on** *(explorer_ui_text_ckpt139)*. It was on by
 * default and remembered in `localStorage`; it is an option now, and one a reader turns on
 * when they want to aim a `c` by eye rather than one that follows their pointer around
 * whether or not they asked. So the default is off, and the memory is the tab's own
 * session rather than the browser's: a visit that wanted it keeps it across a reload and a
 * link, and a visit that did not is never handed it. No link carries it — it is a way of
 * working, not part of a picture.
 */
const KEY = "explorer.julia-preview";

/** How far a value has to be from zero before the readout stops calling it zero. */
const LEAST_DECIMALS = 3;
const MOST_DECIMALS = 15;

/**
 * Wire the preview.
 *
 * `host` is what this borrows from the page: the compiled module, the card's elements,
 * a way to build the view entering would give, and the facts it cannot see — whether the
 * main pass is quiet, whether the page is deriving a tone curve, and whether the picture
 * on the canvas is the studio's own.
 */
export function mount(host) {
  const { module, card, picture, readout, fallen, off, toggle } = host;
  const { viewFor, deriving, quiet, live, say } = host;
  // A second card may be mounted beside the first — the Phoenix tab's, over its plane
  // *(phoenix_tab_ckpt140)* — and each keeps its own flag under its own name.
  const { storageKey = KEY, name = "Julia preview" } = host;
  const paint = picture.getContext("2d", { alpha: false });
  picture.width = WIDTH;
  picture.height = HEIGHT;

  let renderer = null;
  let starting = null;
  let timer = 0;
  /** The latest point the pointer has been over, waiting for the settle. */
  let wanted = null;
  /** What the card is showing, as `{ cx, cy }`, or `null` when it is showing nothing.
   *  This is what a click enters at — the picture the reader is looking at, rather than
   *  wherever the pointer has drifted to since it was drawn. */
  let shown = null;
  /** The draw in flight, so a leave can stop it. */
  let holder = {};
  let drawing = false;
  /** Modes a frame overran the budget on, this visit. */
  const demoted = new Set();

  let on = stored();
  toggle.checked = on;

  // ------------------------------------------------------------------ the stored flag

  function stored() {
    try {
      return window.sessionStorage.getItem(storageKey) === "on";
    } catch {
      // A browser that stores nothing still has the box; it just forgets it on a reload.
      return false;
    }
  }

  function store(value) {
    try {
      window.sessionStorage.setItem(storageKey, value ? "on" : "off");
    } catch {
      // As above.
    }
  }

  function set(value, said) {
    if (on === value) return;
    on = value;
    toggle.checked = value;
    store(value);
    if (!value) {
      hide();
      if (said) say(`${name} off.`);
    }
  }

  // ------------------------------------------------------------------- the renderer

  /** The preview's own pool, started at the first hover that would draw.
   *
   *  Smaller than the walk's and the Saved tab's — a third of the cores rather than a
   *  half, and never more than three — because those two run while a reader is watching
   *  them and this one runs while a reader is watching something else. */
  function start() {
    if (renderer !== null) return Promise.resolve(renderer);
    starting ??= Renderer.over(
      module,
      Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 8) / 4))),
    ).then((made) => {
      renderer = made;
      return made;
    });
    return starting;
  }

  // -------------------------------------------------------------------- the fallback

  /** The mode this preview draws `view.mode` in: itself, or `smooth` where the prior or a
   *  measured frame says it cannot be drawn inside the budget. */
  function modeFor(mode) {
    if (mode === FALLBACK) return FALLBACK;
    if (demoted.has(mode)) return FALLBACK;
    const workers = renderer?.workerCount ?? 2;
    const seconds = estimate(mode, WIDTH * HEIGHT, workers);
    return seconds !== null && seconds > BUDGET_S ? FALLBACK : mode;
  }

  /**
   * A frame that overran **badly** demotes its mode, for the rest of the visit.
   *
   * Badly, and not merely over, because the place costs as much as the mode does here:
   * a `c` inside the main cardioid draws a Julia set that is nearly all interior, so
   * every sample of it runs to the cap, and `smooth` measures 190-250 ms there against
   * about 20 ms a thumb's width outside. Demoting on that would take a mode away over a
   * region and keep it away everywhere. At twice the budget it is the machine saying the
   * prior was wrong about it rather than the pointer saying where it is.
   */
  function measured(mode, seconds) {
    if (mode !== FALLBACK && seconds > BUDGET_S * 2) demoted.add(mode);
  }

  // ------------------------------------------------------------------------ the card

  /** Where `c` is said, to as many decimals as this zoom distinguishes and no more: a
   *  readout that changes in its sixteenth digit while the pointer moves is a readout
   *  nobody can read. `span` is the plane width of one canvas pixel. */
  function saidAt(cx, cy, span) {
    const places = Math.min(
      MOST_DECIMALS,
      Math.max(LEAST_DECIMALS, Math.ceil(-Math.log10(span)) + 1),
    );
    const sign = cy < 0 ? "-" : "+";
    return `c = ${cx.toFixed(places)} ${sign} ${Math.abs(cy).toFixed(places)}i`;
  }

  /** The card goes in the bottom corner of the stage farthest from the pointer, so it
   *  never sits under the hand that is aiming it. Inside the stage it cannot reach a
   *  panel at all. */
  function place(across) {
    card.classList.toggle("is-right", across < 0.5);
  }

  function hide() {
    clearTimeout(timer);
    timer = 0;
    wanted = null;
    shown = null;
    holder.stop?.();
    holder = {};
    // The pool as well as the shade: a field being iterated for a place the reader has
    // left is the one thing here that could go on costing something after the card does.
    renderer?.cancel();
    card.hidden = true;
  }

  // ------------------------------------------------------------------------ the draw

  /**
   * One preview, drawn the way the viewer's finishing stage draws: a field, then the
   * colour — on the pool where the mode has one to spend, on this thread where a direct
   * trap arrives painted or a texture weight is measured off the lanes that are being
   * coloured. The tone curve derives exactly where the page would derive it.
   */
  async function render(at) {
    const r = await start();
    const asked = viewFor(at.cx, at.cy);
    const mode = modeFor(asked.mode);
    // A fallback is a different mode, so its parameters go with the mode being left —
    // the same rule the Mode select keeps.
    const view = mode === asked.mode ? asked : { ...asked, mode, params: {} };
    const shape = r.plan(specOf(view, 16, 9, { colormap: false }));
    if (!shape.ok) return null;

    const started = performance.now();
    let drawn = view;
    const derived = DERIVED[view.mode];
    // A direct trap's opacity decides every pixel it paints, so it is derived before any
    // of them, exactly as the viewer's pass does it.
    if (derived === "opacity" && drawn.params?.opacity === undefined) {
      const down = Math.max(1, Math.round((PROBE_WIDTH * HEIGHT) / WIDTH));
      const counts = await r.probe(drawn, PROBE_WIDTH, down);
      if (counts === null) return null;
      const probed = r.deriveOpacity(drawn, counts);
      if (probed.opacity !== null) {
        drawn = { ...drawn, params: { ...drawn.params, opacity: probed.opacity } };
      }
    }

    const field = await r.field(drawn, WIDTH, HEIGHT);
    if (field === null) return null;

    // A texture weight is measured off these very lanes in the one call that colours
    // them, which is what the viewer's one-sample stage does and is why this picture is
    // that stage rather than an approximation of it.
    const derivingWeight = derived === "weight" && drawn.params?.weight === undefined;
    let image;
    if (shape.direct || derivingWeight) {
      image = r.shade(field, drawn, { deriveWeight: derivingWeight }).image;
    } else {
      // The tone curve derives exactly where the page would derive it: a view the reader
      // made, the box ticked, and a mode the operator acts on at all.
      const shaded = await r.shadePooled(field, drawn, holder, {
        derive: deriving() && shape.levels,
      });
      if (shaded === null) return null;
      image = shaded.image;
    }
    measured(asked.mode, (performance.now() - started) / 1000);
    return { image, fell: mode !== asked.mode };
  }

  /** The settle fired: draw the latest point, unless the main pass took the machine back
   *  in the meantime, in which case wait for it rather than competing with it. */
  async function settled() {
    timer = 0;
    if (!on || wanted === null || drawing) return;
    if (!live()) {
      hide();
      return;
    }
    if (!quiet()) {
      timer = setTimeout(settled, SETTLE_MS);
      return;
    }
    const at = wanted;
    drawing = true;
    holder = {};
    try {
      const made = await render(at);
      // Nothing came back: the draw was cancelled by a leave, or this is a recipe the
      // module will not plan. Either way the card goes, because a card left up is a
      // picture of the place before this one wearing the new place's name.
      if (made === null) {
        hide();
        return;
      }
      // The pointer left, or the page moved under the draw: what came back is a picture
      // of somewhere the reader is no longer asking about.
      if (wanted === null || !on || !live()) return;
      paint.putImageData(made.image, 0, 0);
      readout.textContent = saidAt(at.cx, at.cy, at.span);
      fallen.hidden = !made.fell;
      shown = { cx: at.cx, cy: at.cy };
      card.hidden = false;
    } catch (error) {
      // A recipe the engine refuses is the viewer's to say, not a hover's: the card goes
      // away and the page carries on.
      console.warn("the Julia preview could not be drawn", error);
      hide();
    } finally {
      drawing = false;
      // A move that landed while this was drawing is owed a picture — the newest one,
      // the way `live` owes a slider its latest value.
      if (on && wanted !== null && timer === 0) timer = setTimeout(settled, SETTLE_MS);
    }
  }

  off.addEventListener("click", () => set(false, true));
  toggle.addEventListener("change", () => set(toggle.checked, false));

  return {
    /** The pointer is over `{ cx, cy }` of the plane, `across` of the way across the
     *  canvas, where one canvas pixel spans `span` of it. */
    at({ cx, cy, across, span }) {
      if (!on) return;
      wanted = { cx, cy, span };
      place(across);
      if (timer === 0) timer = setTimeout(settled, SETTLE_MS);
    },
    /** The pointer left, or the page moved: nothing is being previewed. */
    hide,
    /** The document is going away: the preview's own small pool goes with it. */
    stop() {
      hide();
      renderer?.stop();
      renderer = null;
      starting = null;
    },
    /** What the card is showing, or `null`. A click enters here and nowhere else. */
    showing: () => shown,
    /** Whether the preview is switched on at all, which is what the Details box says. */
    enabled: () => on,
  };
}
