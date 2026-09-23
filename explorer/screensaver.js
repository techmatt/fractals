// The screensaver: the gallery's pictures, one after another, each drawn live at the size
// of the screen it is shown on *(gallery_screensaver_ckpt141)*.
//
// **What it shows is whatever the Gallery tab is showing.** The collection and the chips
// are the only selection controls it has, and it takes their answer once, on the way in:
// random without replacement until the shelf is exhausted, then shuffled again. A seat is
// drawn exactly as opening its tile draws it — its own link, parsed — so the screensaver is
// the gallery at a different size and never a second opinion about any picture in it.
//
// **A picture is shown when it is whole, and not before.** The next one renders while the
// current one is up, and the cross-fade waits for both the interval and the render,
// whichever is later. So the interval is a floor and not a promise, and fitting the render
// to it is what keeps the two close: each seat is priced with the Download row's own
// `COST` estimate at the screen's size, then stepped down — two samples a pixel each way,
// then one — until it fits. **Never under one sample a pixel, and never under the screen's
// size** *(Matt, 2026-09-22)*: a seat one sample cannot fit is skipped and the log says
// why, and so is a render that runs past twice what it was priced at.
//
// **The estimate learns.** `COST` is one machine at the mandelbrot home view, and a
// gallery seat is usually deeper than that and iterates more per sample, so every picture
// drawn here adds its measured-over-priced ratio to a short list, and the running median
// of that list scales every price after it. Without it, the overrun rule skipped exactly
// the deep seats it was priced wrongest on.
//
// The pure parts — the interval table, the fitting ladder, the correction and the bag —
// are exported and tested on their own; `install` is the part that needs a page.

/** How long the cross-fade from one picture to the next takes. */
export const SCREENSAVER_FADE_MS = 500;

/** The intervals offered, in the order the picker shows them, spelled as the link does.
 *
 *  *Fastest* is four seconds, as a floor and as a budget alike *(Matt, 2026-09-22)*: it
 *  advances as soon as the next picture is ready and four seconds have passed, and the
 *  next picture is fitted into four. It used to be no floor at all and a 2 s budget, which
 *  put most seats at half the screen's size. */
export const EVERY = [
  { value: "fastest", label: "Fastest", seconds: 4 },
  { value: "10s", label: "10 s", seconds: 10 },
  { value: "30s", label: "30 s", seconds: 30 },
  { value: "1m", label: "1 min", seconds: 60 },
  { value: "5m", label: "5 min", seconds: 300 },
  { value: "10m", label: "10 min", seconds: 600 },
  { value: "30m", label: "30 min", seconds: 1800 },
];

export const DEFAULT_EVERY = "30s";

/** A render past this multiple of its price is cancelled and its seat skipped. */
export const OVERRUN = 2;

/** The least time an overrun is allowed, so a cheap seat on a slow moment is not cut. */
const OVERRUN_FLOOR_S = 1;

/** How long the controls stay up after the pointer last moved. */
const CONTROLS_FOR_MS = 2000;

/** The steps a seat is fitted down, most expensive first. `scale` is of each side.
 *  It ends at the screen's size and one sample a pixel: a picture that cannot be drawn at
 *  that in the interval is skipped rather than shown coarser than the screen. */
export const LADDER = [
  { scale: 1, supersample: 2 },
  { scale: 1, supersample: 1 },
];

/** Where the interval is remembered, and where the log is switched on. */
const EVERY_KEY = "explorer.screensaver-every";
const LOG_KEY = "explorer.screensaver-log";

/** An interval by the name a link or the picker spells it with, or `null`. */
export function everyOf(value) {
  return EVERY.find((one) => one.value === value) ?? null;
}

/** The seconds a render is fitted into at this interval. */
export function budgetOf(every) {
  return (everyOf(every) ?? everyOf(DEFAULT_EVERY)).seconds;
}

/**
 * The browser's own key for full screen, as a reader on this machine presses it: ⌃⌘F on a
 * Mac, F11 everywhere else. It is only ever a hint beside the button — the button asks
 * the page's own full screen, which the key does not need.
 */
export function fullscreenKey(platform = null) {
  const nav = globalThis.navigator;
  platform ??= nav?.userAgentData?.platform ?? nav?.platform ?? "";
  return /mac|iphone|ipad/i.test(platform) ? "⌃⌘F" : "F11";
}

/**
 * The largest picture of this aspect that fits the screen, in whole pixels.
 *
 * Letterboxed rather than cropped: a seat's aspect is part of its recipe, and filling a
 * screen of another shape would be showing more or less of the plane than the seat is.
 */
export function sizeFor(aspect, width, height) {
  const across = Math.max(1, aspect.across);
  const down = Math.max(1, aspect.down);
  const fitted =
    width * down <= height * across
      ? { width, height: (width * down) / across }
      : { width: (height * across) / down, height };
  return {
    width: Math.max(16, Math.round(fitted.width)),
    height: Math.max(16, Math.round(fitted.height)),
  };
}

/**
 * The first step of the ladder whose price fits the budget.
 *
 * `price(samples)` is seconds, already corrected. Returns the step with its size and
 * price, or `{ skip: true, seconds }` with what the last step would have cost.
 */
export function fit({ width, height, budget, price }) {
  let seconds = Infinity;
  for (const step of LADDER) {
    const w = Math.max(16, Math.round(width * step.scale));
    const h = Math.max(16, Math.round(height * step.scale));
    seconds = price(w * h * step.supersample * step.supersample);
    if (seconds <= budget) return { ...step, width: w, height: h, seconds };
  }
  return { skip: true, seconds };
}

/**
 * How far off the prior has been this session: the median of measured-over-priced, over
 * the last few pictures, clamped so that one pathological seat cannot price every seat
 * after it out of the ladder.
 */
export class Correction {
  constructor({ keep = 15, least = 0.5, most = 4 } = {}) {
    this.keep = keep;
    this.least = least;
    this.most = most;
    this.ratios = [];
  }

  add(measured, priced) {
    if (!(measured > 0) || !(priced > 0)) return;
    this.ratios.push(measured / priced);
    if (this.ratios.length > this.keep) this.ratios.shift();
  }

  factor() {
    if (this.ratios.length === 0) return 1;
    const sorted = [...this.ratios].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median =
      sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.min(this.most, Math.max(this.least, median));
  }
}

/**
 * Random without replacement, and shuffled again once every seat has been drawn — never
 * opening a new round on the seat that closed the last one, where there is another.
 */
export class Bag {
  constructor(seats, random = Math.random) {
    this.seats = seats;
    this.random = random;
    this.left = [];
    this.last = null;
  }

  get size() {
    return this.seats.length;
  }

  next() {
    if (this.seats.length === 0) return null;
    if (this.left.length === 0) {
      this.left = [...this.seats];
      for (let i = this.left.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [this.left[i], this.left[j]] = [this.left[j], this.left[i]];
      }
      // `left` is drawn from its end, so the seat that would open the round is the last.
      const opening = this.left.length - 1;
      if (this.left.length > 1 && this.left[opening] === this.last) {
        [this.left[0], this.left[opening]] = [this.left[opening], this.left[0]];
      }
    }
    this.last = this.left.pop();
    return this.last;
  }
}

function stored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window: the interval lasts the visit.
  }
}

/**
 * Wire the screensaver to its layer.
 *
 * `host` is what it borrows from the page: the layer's elements, a renderer of its own
 * (`pool()`, stopped on the way out, so a resize or a pass on the page underneath cannot
 * cancel a picture by generation), `parse` for a seat's link, `estimate` and `pictureOf`
 * from the Download row, `address(seat, every)` to put a picture's link in the address
 * bar, and `leave(seat)` for the page to take its viewer back with the last seat shown.
 */
export function install(host) {
  const { layer, canvases, controls, everyPicker, pauseButton, exitButton, note } = host;
  const { fullscreenButton } = host;
  const { pool, parse, estimate, pictureOf, address, leave } = host;

  for (const canvas of canvases) canvas.style.transition = `opacity ${SCREENSAVER_FADE_MS}ms linear`;
  for (const one of EVERY) {
    const option = document.createElement("option");
    option.value = one.value;
    option.textContent = one.label;
    everyPicker.append(option);
  }
  // The page's own full screen where the browser has it, which a click may ask for; where
  // it does not (a phone's Safari), the browser's key is still said, as a hint.
  const key = fullscreenKey();
  const canFill = typeof layer.requestFullscreen === "function" && document.fullscreenEnabled !== false;
  fullscreenButton.title = canFill
    ? `Or press F here, or ${key} for the browser's own full screen.`
    : `Press ${key} for full screen.`;
  if (!canFill) fullscreenButton.disabled = true;

  let run = 0;
  let active = false;
  let paused = false;
  let every = everyOf(stored(EVERY_KEY))?.value ?? DEFAULT_EVERY;
  let renderer = null;
  let holder = null;
  let bag = null;
  let shown = null;
  let top = 0;
  let logging = false;
  let controlsTimer = 0;
  const correction = new Correction();
  /** Seconds the current picture has been up, counted only while not paused. */
  let upFor = 0;
  let tickedAt = 0;

  function log(event, details = {}) {
    // The Deep tab's shape, `[deep <time>] <event>`, as one string per line, so a console
    // that previews objects cannot fold a field away.
    if (!logging) return;
    console.log(`[screensaver ${new Date().toISOString()}] ${event} ${JSON.stringify(details)}`);
  }

  function setEvery(value) {
    every = everyOf(value)?.value ?? DEFAULT_EVERY;
    everyPicker.value = every;
    store(EVERY_KEY, every);
    if (shown !== null) address(shown, every);
  }

  function setPaused(on) {
    paused = on;
    pauseButton.textContent = on ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(on));
  }

  function fillsScreen() {
    return document.fullscreenElement === layer;
  }

  function sayFullscreen() {
    fullscreenButton.textContent = fillsScreen() ? "Leave full screen" : `Full screen (${key})`;
    fullscreenButton.setAttribute("aria-pressed", String(fillsScreen()));
  }

  function toggleFullscreen() {
    if (!canFill) return;
    const asked = fillsScreen() ? document.exitFullscreen() : layer.requestFullscreen();
    // A refusal — no gesture, a policy — leaves the layer as it was, and the key still works.
    asked?.catch?.((error) => log("fullscreen refused", { why: String(error?.message ?? error) }));
  }

  /** The screen wake lock, held while the layer is up so the display does not sleep under a
   *  screensaver. The browser drops it whenever the tab is hidden, so `visibilitychange`
   *  asks again on the way back. Where the API is missing, or a request is refused, the
   *  screensaver runs exactly as it did without one: there is nothing to say about it. */
  let wakeLock = null;

  async function holdAwake() {
    if (!active || wakeLock !== null || document.visibilityState !== "visible") return;
    if (!navigator.wakeLock?.request) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      // The layer may have closed while the request was out.
      if (!active) {
        lock.release().catch(() => {});
        return;
      }
      wakeLock = lock;
      lock.addEventListener("release", () => {
        if (wakeLock === lock) wakeLock = null;
      });
      log("wake lock held");
    } catch (error) {
      log("wake lock refused", { why: String(error?.message ?? error) });
    }
  }

  function letSleep() {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release().catch(() => {});
  }

  function showControls() {
    layer.classList.add("is-awake");
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
      // Not while the pointer is on them: a control that vanishes under the hand reaching
      // for it is not one anybody can use.
      if (!controls.matches(":hover, :focus-within")) layer.classList.remove("is-awake");
    }, CONTROLS_FOR_MS);
  }

  /** Letterbox a canvas at its own aspect in the layer, in CSS pixels. */
  function place(canvas) {
    if (canvas.width === 0) return;
    const box = sizeFor(
      { across: canvas.width, down: canvas.height },
      layer.clientWidth,
      layer.clientHeight,
    );
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
  }

  function present(picture) {
    const back = canvases[1 - top];
    const front = canvases[top];
    back.width = picture.image.width;
    back.height = picture.image.height;
    back.getContext("2d", { alpha: false }).putImageData(picture.image, 0, 0);
    place(back);
    back.style.zIndex = "2";
    front.style.zIndex = "1";
    back.classList.add("is-up");
    const mine = run;
    setTimeout(() => {
      if (mine === run && canvases[top] === back) front.classList.remove("is-up");
    }, SCREENSAVER_FADE_MS);
    top = 1 - top;
    shown = picture.seat;
    upFor = 0;
    tickedAt = performance.now();
    address(picture.seat, every);
  }

  /** Wait, a quarter of a second at a time, until `ready()` says so or the run ends. */
  function until(ready, mine) {
    return new Promise((resolve) => {
      const tick = () => {
        if (mine !== run) return resolve(false);
        const now = performance.now();
        if (!paused) upFor += (now - tickedAt) / 1000;
        tickedAt = now;
        if (ready()) return resolve(true);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  /** The screen's size in device pixels, which is what a picture is rendered for. */
  function screenPixels() {
    const ratio = window.devicePixelRatio || 1;
    return {
      width: Math.round(layer.clientWidth * ratio),
      height: Math.round(layer.clientHeight * ratio),
    };
  }

  /**
   * Render one seat, fitted to the interval, or say why it was skipped.
   * Returns `{ seat, image }`, `{ skip }`, or `null` where the run ended under it.
   */
  async function render(seat, mine) {
    let view;
    try {
      view = parse(seat.link);
    } catch (error) {
      return { skip: `its link does not parse: ${error.message}` };
    }
    const screen = screenPixels();
    const size = sizeFor(view.aspect, screen.width, screen.height);
    const workers = renderer.workerCount;
    // A mode the table does not price is priced as the dearest one it does, which is a
    // step down too far rather than an overrun.
    const prior = (samples) => estimate(view.mode, samples, workers) ?? estimate("smooth_stripe", samples, workers);
    const factor = correction.factor();
    const budget = budgetOf(every);
    const step = fit({ ...size, budget, price: (samples) => prior(samples) * factor });
    if (step.skip) {
      return { skip: `~${step.seconds.toFixed(1)} s at one sample a pixel, over the ${budget} s budget` };
    }
    const priced = prior(step.width * step.height * step.supersample * step.supersample);
    holder = {};
    const mineHolder = holder;
    let overran = false;
    // Never inside twice the budget, though: a render still within its interval has made
    // nothing late, and at a minute the first measured run cut a seat priced at 6.5 s at 13.
    // Past the interval is allowed too *(Matt, 2026-09-22)*: a seat that fitted at one
    // sample a pixel and runs over is still worth waiting for, and under *Fastest* the
    // interval alone cut seats priced at 1.4 s at exactly 4.
    const limit = Math.max(OVERRUN_FLOOR_S, OVERRUN * Math.max(step.seconds, budget));
    const timer = setTimeout(() => {
      // A run ended since: the renderer here may already be the next entry's.
      if (mine !== run) return;
      overran = true;
      renderer?.cancel();
      mineHolder.stop?.();
    }, limit * 1000);
    const started = performance.now();
    let drawn = null;
    try {
      drawn = await pictureOf(renderer, view, step.width, step.height, {
        supersample: step.supersample,
        holder: mineHolder,
      });
    } catch (error) {
      if (mine !== run) return null;
      clearTimeout(timer);
      return { skip: `it failed to render: ${error.message ?? error}` };
    }
    clearTimeout(timer);
    if (mine !== run) return null;
    const seconds = (performance.now() - started) / 1000;
    if (overran || drawn === null) {
      // An overrun still teaches the correction, at no less than the time it was given.
      correction.add(seconds, priced);
      return { skip: `cancelled after ${seconds.toFixed(1)} s, priced at ${step.seconds.toFixed(1)} s` };
    }
    correction.add(seconds, priced);
    log("drawn", {
      key: seat.key,
      mode: view.mode,
      size: `${step.width}x${step.height}`,
      scale: step.scale,
      samples: `${step.supersample * step.supersample}x`,
      prior: +priced.toFixed(2),
      priced: +step.seconds.toFixed(2),
      took: +seconds.toFixed(2),
      factor: +factor.toFixed(2),
      budget,
    });
    return { seat, image: drawn.image };
  }

  /** The next picture that renders: seats are drawn from the bag until one does. A whole
   *  bag of skips in a row waits for the interval to change rather than spinning. */
  async function prepare(mine, first = null) {
    let skipped = 0;
    let at = first;
    for (;;) {
      if (mine !== run) return null;
      const seat = at ?? bag.next();
      at = null;
      if (seat === null) {
        note.textContent = "The gallery shows nothing with these filters.";
        layer.classList.add("is-awake");
        return null;
      }
      log("pick", { key: seat.key });
      const drawn = await render(seat, mine);
      if (drawn === null) return null;
      if (!drawn.skip) {
        note.textContent = "";
        return drawn;
      }
      skipped += 1;
      log("skip", { key: seat.key, why: drawn.skip });
      if (skipped >= Math.max(1, bag.size)) {
        const waited = every;
        note.textContent = "Nothing here can be drawn this often. Choose a longer interval.";
        layer.classList.add("is-awake");
        if (!(await until(() => every !== waited, mine))) return null;
        skipped = 0;
      }
    }
  }

  async function loop(mine, first) {
    let pending = prepare(mine, first);
    for (;;) {
      const picture = await pending;
      if (picture === null || mine !== run) return;
      if (shown !== null) {
        const ok = await until(() => !paused && upFor >= (everyOf(every)?.seconds ?? 0), mine);
        if (!ok) return;
      }
      present(picture);
      pending = prepare(mine);
    }
  }

  function onKey(event) {
    if (!active) return;
    // Nothing reaches the page underneath: an arrow key would pan a viewer nobody sees.
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      exit();
    } else if (event.key === " " && event.target !== everyPicker) {
      event.preventDefault();
      setPaused(!paused);
      showControls();
    } else if ((event.key === "f" || event.key === "F") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleFullscreen();
    }
  }

  function onResize() {
    for (const canvas of canvases) place(canvas);
  }

  async function enter(seats, { every: asked = null, first = null } = {}) {
    if (active || (seats.length === 0 && first === null)) return false;
    active = true;
    const mine = ++run;
    // Set at all is on, as `explorer.deep-log` reads, from the next entry.
    logging = stored(LOG_KEY) !== null;
    if (everyOf(asked)) setEvery(asked);
    else everyPicker.value = every;
    setPaused(false);
    shown = null;
    note.textContent = "";
    bag = new Bag(seats);
    for (const canvas of canvases) {
      canvas.classList.remove("is-up");
      canvas.width = 0;
    }
    layer.hidden = false;
    layer.classList.remove("is-awake");
    sayFullscreen();
    holdAwake();
    log("enter", { seats: seats.length, every, factor: +correction.factor().toFixed(2) });
    try {
      renderer = await pool();
    } catch (error) {
      console.warn("the screensaver could not start its renderer", error);
      exit();
      return false;
    }
    if (mine !== run) {
      renderer?.stop();
      renderer = null;
      return false;
    }
    loop(mine, first);
    return true;
  }

  function exit() {
    if (!active) return;
    active = false;
    run += 1;
    renderer?.cancel();
    holder?.stop?.();
    renderer?.stop();
    renderer = null;
    holder = null;
    clearTimeout(controlsTimer);
    letSleep();
    // The full screen this layer asked for ends with it; the browser's own (F11) is the
    // reader's, and is left alone.
    if (fillsScreen()) document.exitFullscreen().catch(() => {});
    layer.hidden = true;
    log("exit", { factor: +correction.factor().toFixed(2) });
    leave(shown);
  }

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  layer.addEventListener("pointermove", showControls);
  layer.addEventListener("pointerdown", showControls);
  everyPicker.addEventListener("change", () => setEvery(everyPicker.value));
  pauseButton.addEventListener("click", () => setPaused(!paused));
  exitButton.addEventListener("click", exit);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", sayFullscreen);
  document.addEventListener("visibilitychange", holdAwake);

  return {
    enter,
    exit,
    /** Give the pool back without handing the viewer anything: the page is going away. */
    stop() {
      active = false;
      run += 1;
      letSleep();
      renderer?.stop();
      renderer = null;
    },
    get active() {
      return active;
    },
  };
}
