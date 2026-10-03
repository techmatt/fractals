// Demo mode *(showcase_video_build_ckpt159)*: what a scripted showcase capture drives.
//
// `?demo=1` loads this module and nothing else changes: without the flag it is never
// fetched, and with it the page is the same page, driven by real input. What it adds is
// the furniture a recording needs and a reader never does — a drawn cursor that pulses
// where it clicks, a clock the capture can step one frame at a time, the Deep tab's
// progress taken off the screen, a fixed Dive landing, a way to know a deep picture has
// finished, and a caption bar for the last frame.
//
// **It clicks nothing itself.** The capture sends real mouse events through the browser at
// the place this cursor stands (`where`), so a click here is exactly a reader's click; the
// cursor is only the picture of one. `explorer/bench/showcase.mjs` is the script that drives
// it, and `explorer/README.md`'s *Demo mode* says what each hook is for.

/** How long a click's ring takes to spread and fade. */
const PULSE_MS = 420;

/** How often `deepReady` asks whether the deep picture has finished, in wall time. */
const READY_POLL_MS = 50;

const STYLE = `
.demo-cursor, .demo-pulse {
  position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483647;
}
.demo-cursor { width: 28px; height: 28px; margin: -2px 0 0 -3px; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.6)); }
.demo-pulse {
  width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  border: 3px solid #ffd76a; box-sizing: border-box; opacity: 0;
}
.demo-caption {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646; pointer-events: none;
  padding: 1.6rem 2rem; text-align: center; font: 600 2.6rem/1.2 var(--sans, system-ui, sans-serif);
  letter-spacing: 0.01em; color: #fff; background: rgb(8 10 16 / 0.82);
  border-top: 1px solid rgb(255 255 255 / 0.12);
}
.demo-on #deep-bar, .demo-on #deep-spinner, .demo-on #deep-progress, .demo-on #dive-bar,
.demo-on #dive-cancel, .demo-on #dive-status, .demo-on #deep-stats, .demo-on #deep-note {
  visibility: hidden;
}
`;

const CURSOR_SVG =
  '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">' +
  '<path d="M3 2 L3 22 L8.5 17 L12.5 26 L16 24.5 L12 15.8 L19.5 15.8 Z" ' +
  'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/** Slow in and out, so a move reads as a hand rather than a teleport. */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Install demo mode over the page. `host` is what only the page can do:
 * `open(query)` (its one door for a link, shallow or deep) and `deep()` (the Deep tab's
 * handle, or `null` before it is mounted).
 */
export function install(host) {
  document.documentElement.classList.add("demo-on");
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  // ------------------------------------------------------------------ the clock
  //
  // Every animation here is a function of `now`. On the wall clock it runs on its own; once
  // `step(true)` pins it, nothing moves until `advance(ms)`, which is how a capture takes a
  // cursor move or a scroll one exact frame at a time whatever a screenshot costs.
  let pinned = null;
  const now = () => pinned ?? performance.now();
  const tweens = new Set();
  const apply = () => {
    const at = now();
    for (const tween of tweens) {
      const share = tween.ms <= 0 ? 1 : Math.min(1, Math.max(0, (at - tween.start) / tween.ms));
      tween.at(tween.eased ? ease(share) : share);
      if (share >= 1) {
        tweens.delete(tween);
        tween.done();
      }
    }
  };
  const frame = () => {
    if (pinned === null) apply();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const tween = (ms, at, eased = true) =>
    new Promise((done) => {
      const made = { start: now(), ms, at, eased, done };
      tweens.add(made);
      at(0);
      if (ms <= 0) apply();
    });

  // ------------------------------------------------------------------ the cursor
  const cursor = document.createElement("div");
  cursor.className = "demo-cursor";
  cursor.innerHTML = CURSOR_SVG;
  const ring = document.createElement("div");
  ring.className = "demo-pulse";
  document.body.append(ring, cursor);
  const point = { x: innerWidth * 0.62, y: innerHeight * 0.55 };
  const place = () => {
    cursor.style.transform = `translate(${point.x}px, ${point.y}px)`;
  };
  place();

  /** Where a target is: a selector or an element at a share of its box, or a point. */
  const pointOf = (target, { dx = 0.5, dy = 0.5 } = {}) => {
    if (typeof target === "object" && target !== null && "x" in target && !(target instanceof Element)) {
      return { x: target.x, y: target.y };
    }
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (node === null) throw new Error(`demo: nothing matches ${target}`);
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width * dx, y: box.top + box.height * dy };
  };

  // ------------------------------------------------------------------ the caption
  let caption = null;

  // ------------------------------------------------------------------ Dive, at a fixed draw
  //
  // A real Go lands at random. With a landing set, the next press of Go opens that link
  // instead, through the page's own door for a link, and the landing is spent. The press is
  // still the reader's click on the real button; only what it lands on is fixed.
  let landing = null;
  document.getElementById("dive-go")?.addEventListener(
    "click",
    (event) => {
      if (landing === null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const query = landing;
      landing = null;
      host.open(query);
    },
    { capture: true },
  );

  const demo = {
    ready: true,
    /** The clock every animation here reads. */
    now,
    /** Pin the clock (`true`) or hand it back to the wall (`false`). Animations in flight
     *  carry on from where they stood either way. */
    step(on) {
      const before = now();
      pinned = on ? before : null;
      const shift = now() - before;
      for (const made of tweens) made.start += shift;
    },
    /** Move the pinned clock on by `ms` and put every animation where it now stands. */
    advance(ms) {
      if (pinned === null) throw new Error("demo: advance needs a pinned clock");
      pinned += ms;
      apply();
      return tweens.size;
    },
    /** Where the cursor's tip is, in CSS pixels: where the capture sends its events. */
    where: () => ({ x: Math.round(point.x), y: Math.round(point.y) }),
    /** Ease the cursor to a target over `ms`. */
    moveTo(target, ms = 600, at = {}) {
      const to = pointOf(target, at);
      const from = { ...point };
      return tween(ms, (t) => {
        point.x = from.x + (to.x - from.x) * t;
        point.y = from.y + (to.y - from.y) * t;
        place();
      });
    },
    /** Where a target is, without moving there. */
    pointOf,
    /** A click's ring at the cursor. The click itself is the capture's real event. */
    pulse() {
      ring.style.left = `${point.x}px`;
      ring.style.top = `${point.y}px`;
      return tween(
        PULSE_MS,
        (t) => {
          ring.style.transform = `scale(${0.3 + 0.9 * t})`;
          ring.style.opacity = String(t >= 1 ? 0 : 0.95 * (1 - t));
        },
        false,
      );
    },
    /** Ease a scroller's `scrollTop` to `top` over `ms`. */
    scroll(target, top, ms = 1500) {
      const node = typeof target === "string" ? document.querySelector(target) : target;
      const from = node.scrollTop;
      return tween(ms, (t) => {
        node.scrollTop = from + (top - from) * t;
      });
    },
    /** Show the caption bar with `text`, or take it down with `null`. */
    caption(text) {
      caption?.remove();
      caption = null;
      if (text === null) return;
      caption = document.createElement("div");
      caption.className = "demo-caption";
      caption.textContent = text;
      document.body.append(caption);
    },
    /** The cursor shown or hidden, for a frame that should carry none. */
    cursor(on) {
      cursor.hidden = !on;
    },
    /** Fix where the next press of Go lands: a deep link's query, or `null` to dive for real. */
    landing(query) {
      landing = query;
    },
    /** Open a link through the page's own door, as a Saved tile does: a cut. */
    open: (query) => host.open(query),
    /** Resolves once the Deep tab owns the viewer and its picture of the frame it stands on
     *  has drawn to the end, or with `false` after `within` ms. */
    deepReady({ within = 600000 } = {}) {
      const until = performance.now() + within;
      const state = document.getElementById("render-state");
      return new Promise((resolve) => {
        const ask = () => {
          const deep = host.deep();
          if (deep?.owns() && deep.showsFinished() && state.dataset.state === "final") {
            resolve(true);
          } else if (performance.now() > until) {
            resolve(false);
          } else {
            setTimeout(ask, READY_POLL_MS);
          }
        };
        ask();
      });
    },
  };
  globalThis.__demo = demo;
  return demo;
}
