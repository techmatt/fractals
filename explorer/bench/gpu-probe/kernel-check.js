// The Deep tab's shipped GPU kernel (`explorer/deep-gpu-wgsl.js`) held to its model on this
// machine's adapter, word for word.
//
// A bench page and nothing more: linked from nowhere, loaded by nothing the explorer
// serves, and asserting nothing; `explorer/bench/deep-gpu-check.mjs` drives it headless and
// reads `window.__check`. Three sections:
//
// 1. The primitive self-test: `explorer/deep-gpu-selftest/vectors.json` through every
//    double-single primitive the kernel uses, bit for bit, in the guard form asked for.
// 2. The tracked self-test frames (`explorer/deep-gpu-selftest/`), at the budget schedules
//    their `selftest.json` names.
// 3. The check bundles `deep-gpu-model`'s `export` wrote under `artifacts/deep-gpu-check/`
//    (the interior switch on, each with its gated policy), each run twice: a schedule that
//    cycles a small budget, a budget of one step and an odd larger one, every pixel every
//    pass; then budget 4096, compacted once fewer than a tenth of the pixels still run.
//
// Every run reads back every pixel's whole state (`DsPixelState::bits` and, with the proof
// compiled in, `Proof::bits`) and compares it with the model's unbounded run: status, n and
// steps, every other word, frac counted apart, since WGSL's `log` is a few ulps from the
// model's. Then `emit` is run and its `out` buffer held to the state it reads.
//
// Query: `frames=a,b` (ids or file stems), `dir=` (bundle directory, relative to this page),
// `form=<guard>`, `wg=64`, `vectors=0`, `selftest=0`, `bundles=0`.

import {
  BLA_HEADER_BYTES,
  BLA_RUN_BYTES,
  ESCAPED,
  EXACT_BYTES,
  FORMS,
  LAYOUT,
  OUT_NONE,
  PARAMS_BYTES,
  PARAMS_LISTED,
  PROOF_NAMES,
  RUNNING,
  SELFTEST_LAYOUT,
  SELFTEST_STRIDE,
  SELFTEST_WORKGROUP,
  STATE_NAMES,
  decodeOut,
  kernelSource,
  paramsBytes,
  selfTestCases,
  selfTestSource,
  stateBytes,
} from "../../deep-gpu-wgsl.js";

const query = new URLSearchParams(location.search);
const listParam = (name, fallback) => (query.has(name) ? query.get(name).split(",").filter(Boolean) : fallback);
const FORM = query.get("form") ?? "plain";
const WORKGROUP = Number(query.get("wg") ?? 64);
const SELFTEST_DIR = "../../deep-gpu-selftest/";
const BUNDLE_DIR = query.get("dir") ?? "../../../artifacts/deep-gpu-check/";
/** Below this share of running pixels the large-budget run compacts, every 8 passes. */
const COMPACT_BELOW = 0.1;
const COMPACT_EVERY = 8;
/** GPU work one submission is sized to, from the last submission's wall time. */
const BATCH_TARGET_MS = 250;
const BATCH_MAX = 512;

const out = document.getElementById("out");
const lines = [];
const result = { adapter: null, vectors: null, frames: [], errors: [] };
let finish;
window.__check = { text: "", result, done: new Promise((resolve) => (finish = resolve)) };

function log(text = "") {
  lines.push(text);
  out.textContent = lines.join("\n");
  window.__check.text = out.textContent;
}

const TYPED = { u8: Uint8Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array };

async function loadBundle(dir, manifestName) {
  const manifest = await (await fetch(dir + manifestName, { cache: "no-store" })).json();
  const response = await fetch(dir + manifest.bin, { cache: "no-store" });
  if (!response.ok) throw new Error(`${manifest.bin}: HTTP ${response.status}`);
  const bin = await response.arrayBuffer();
  if (bin.byteLength !== manifest.bin_bytes) throw new Error(`${manifest.bin}: ${bin.byteLength} bytes, manifest says ${manifest.bin_bytes}`);
  const arrays = {};
  for (const a of manifest.arrays) arrays[a.name] = new TYPED[a.dtype](bin, a.offset, a.count);
  return { manifest, arrays };
}

async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length > 0) {
    const text = code.split("\n");
    const said = errors.slice(0, 4).map((m) => `${m.lineNum}:${m.linePos} ${m.message}\n    > ${text[m.lineNum - 1]?.trim()}`);
    throw new Error(`${label}: ${said.join("\n  ")}`);
  }
  return module;
}

async function readBack(device, buffer, bytes) {
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = new Uint32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return copy;
}

// --- Adapter -----------------------------------------------------------------------------

async function openDevice() {
  if (!("gpu" in navigator)) throw new Error("no navigator.gpu");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) throw new Error("no adapter");
  const info = adapter.info ?? {};
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    },
  });
  device.addEventListener("uncapturederror", (event) => {
    const message = event.error?.message ?? String(event.error);
    result.errors.push(message);
    log(`uncaptured GPU error: ${message}`);
  });
  device.lost.then((lost) => {
    const message = `device lost (${lost.reason}): ${lost.message}`;
    result.errors.push(message);
    log(message);
  });
  result.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description, fallback: info.isFallbackAdapter ?? null };
  log(`adapter: ${info.vendor} ${info.architecture} ${info.description ?? ""} (fallback ${info.isFallbackAdapter ?? "?"}); ${navigator.userAgent}`);
  return device;
}

// --- 1. Vectors --------------------------------------------------------------------------

async function vectors(device) {
  const file = await (await fetch(SELFTEST_DIR + "vectors.json", { cache: "no-store" })).json();
  const cases = file.cases;
  const packed = selfTestCases(cases);
  const input = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, packed);
  const results = device.createBuffer({ size: cases.length * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const knobs = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const knobData = new ArrayBuffer(16);
  new Float32Array(knobData, 0, 2).set([1, 0]);
  device.queue.writeBuffer(knobs, 0, knobData);
  const form = FORMS.find((f) => f.name === FORM);
  const module = await compile(device, selfTestSource(form), `selftest-${FORM}`);
  // An explicit layout: "auto" would drop the knobs a plain guard never reads.
  const layout = device.createBindGroupLayout({ entries: SELFTEST_LAYOUT });
  const pipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: "main" },
  });
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: results } },
      { binding: 2, resource: { buffer: knobs } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(cases.length / SELFTEST_WORKGROUP));
  pass.end();
  device.queue.submit([encoder.finish()]);
  const got = await readBack(device, results, cases.length * 8);
  const tally = {};
  const failures = [];
  cases.forEach((c, i) => {
    tally[c.op] ??= { pass: 0, fail: 0 };
    const ok = got[2 * i] === c.out[0] >>> 0 && got[2 * i + 1] === c.out[1] >>> 0;
    tally[c.op][ok ? "pass" : "fail"]++;
    if (!ok && failures.length < 4) failures.push({ i, op: c.op, expected: c.out, got: [got[2 * i], got[2 * i + 1]] });
  });
  for (const b of [input, results, knobs]) b.destroy();
  const passed = Object.values(tally).every((t) => t.fail === 0);
  log(`vectors (${cases.length}, form ${FORM}, stride ${SELFTEST_STRIDE}): ${passed ? "all bit for bit" : "FAIL"}; ${Object.entries(tally).map(([op, t]) => `${op} ${t.pass}/${t.pass + t.fail}`).join(", ")}`);
  for (const f of failures) log(`  case ${f.i} ${f.op}: expected ${f.expected.join(",")} got ${f.got.join(",")}`);
  result.vectors = { cases: cases.length, passed, tally, failures };
}

// --- 2 and 3. Frames ---------------------------------------------------------------------

/** One bundle's buffers and pipelines on the device. */
class Runner {
  constructor(device, bundle) {
    const m = bundle.manifest;
    this.device = device;
    this.bundle = bundle;
    this.count = m.width_px * m.height_px;
    this.interior = m.interior === true;
    this.words = stateBytes(this.interior) / 4;
    const usage = GPUBufferUsage;
    const upload = (data, flags) => {
      const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: flags | usage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    this.frame = upload(bundle.arrays.frame, usage.UNIFORM);
    this.frameLo = upload(bundle.arrays.frame_lo, usage.UNIFORM);
    this.orbit = upload(bundle.arrays.orbit_hilo, usage.STORAGE);
    // The skip table where the bundle was exported with one (`export --bla on`), else the
    // empty one, which finds no run.
    this.blaHeader = upload(bundle.arrays.bla_header ?? new Uint8Array(BLA_HEADER_BYTES), usage.UNIFORM);
    this.blaRuns = upload(bundle.arrays.bla_runs ?? new Uint8Array(BLA_RUN_BYTES), usage.STORAGE);
    // The orbit's exact points where it flushed (`orbit.rs`), else a dummy never read.
    this.exact = upload(bundle.arrays.orbit_exact ?? new Uint8Array(EXACT_BYTES), usage.STORAGE);
    this.params = device.createBuffer({ size: PARAMS_BYTES, usage: usage.UNIFORM | usage.COPY_DST });
    this.states = device.createBuffer({ size: this.count * stateBytes(this.interior), usage: usage.STORAGE | usage.COPY_SRC });
    this.counters = device.createBuffer({ size: 16, usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST });
    this.list = device.createBuffer({ size: this.count * 4, usage: usage.STORAGE });
    this.out = device.createBuffer({ size: this.count * 8, usage: usage.STORAGE | usage.COPY_SRC });
    this.indirect = device.createBuffer({ size: 16, usage: usage.STORAGE | usage.INDIRECT });
    this.budgets = device.createBuffer({ size: BATCH_MAX * 4, usage: usage.COPY_SRC | usage.COPY_DST });
    this.counts = device.createBuffer({ size: BATCH_MAX * 4, usage: usage.COPY_SRC | usage.COPY_DST });
    this.countsRead = device.createBuffer({ size: BATCH_MAX * 4, usage: usage.MAP_READ | usage.COPY_DST });
    this.layouts = LAYOUT.map((entries) => device.createBindGroupLayout({ entries }));
    this.group0 = device.createBindGroup({
      layout: this.layouts[0],
      entries: [this.frame, this.frameLo, this.params, this.orbit, this.states, this.counters, this.list, this.out, this.blaHeader, this.blaRuns, this.exact].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.group1 = device.createBindGroup({ layout: this.layouts[1], entries: [{ binding: 0, resource: { buffer: this.indirect } }] });
  }

  destroy() {
    for (const b of [this.frame, this.frameLo, this.orbit, this.blaHeader, this.blaRuns, this.exact, this.params, this.states, this.counters, this.list, this.out, this.indirect, this.budgets, this.counts, this.countsRead]) b.destroy();
  }

  async pipelines() {
    const m = this.bundle.manifest;
    const code = kernelSource({ degree: m.degree, julia: m.julia, interior: this.interior, form: FORM, workgroup: WORKGROUP, smooth: "builtin" });
    const started = performance.now();
    const module = await compile(this.device, code, `deep-d${m.degree}${m.julia ? "j" : ""}${this.interior ? "i" : ""}`);
    const plain = this.device.createPipelineLayout({ bindGroupLayouts: [this.layouts[0]] });
    const both = this.device.createPipelineLayout({ bindGroupLayouts: this.layouts });
    const make = (entryPoint, layout) => this.device.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
    const [init, pass, compact, args, emit] = await Promise.all([
      make("init", plain),
      make("run_pass", plain),
      make("compact", plain),
      make("args", both),
      make("emit", plain),
    ]);
    this.p = { init, pass, compact, args, emit, compileMs: performance.now() - started, lines: code.split("\n").length };
    return this.p;
  }

  /**
   * One run to the end: `init`, then passes whose budgets `budgetOf(k)` gives, until a pass
   * leaves nothing running. Budgets reach the uniform by a copy inside the command stream,
   * so one submission carries passes of different budgets. With `compact`, once fewer than
   * `COMPACT_BELOW` of the pixels still run, passes run the compacted list.
   */
  async run(budgetOf, compact) {
    const device = this.device;
    const m = this.bundle.manifest;
    const params = paramsBytes({ budget: 0, periodic: m.periodic, length: m.orbit_len, count: this.count, flush: m.flush_hilo ?? m.flush });
    device.queue.writeBuffer(this.params, 0, params);
    const groups = Math.ceil(this.count / WORKGROUP);
    const started = performance.now();
    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.p.init);
      pass.setBindGroup(0, this.group0);
      pass.dispatchWorkgroups(groups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    let issued = 0;
    let running = this.count;
    let batch = 1;
    let listed = false;
    let compacts = 0;
    const limit = 10_000_000;
    while (running > 0 && issued < limit) {
      const budgets = new Uint32Array(batch);
      for (let k = 0; k < batch; k++) budgets[k] = budgetOf(issued + k);
      device.queue.writeBuffer(this.budgets, 0, budgets);
      const encoder = device.createCommandEncoder();
      const useList = compact && (listed || running < COMPACT_BELOW * this.count);
      // The one pass entry walks the list or every pixel, as `listed` in the uniform says.
      device.queue.writeBuffer(this.params, PARAMS_LISTED, Uint32Array.of(useList ? 1 : 0));
      for (let k = 0; k < batch; k++) {
        encoder.copyBufferToBuffer(this.budgets, 4 * k, this.params, 0, 4);
        if (useList && (!listed || (issued + k) % COMPACT_EVERY === 0)) {
          encoder.clearBuffer(this.counters, 4, 4);
          const pass = encoder.beginComputePass();
          pass.setBindGroup(0, this.group0);
          pass.setBindGroup(1, this.group1);
          pass.setPipeline(this.p.compact);
          pass.dispatchWorkgroups(groups);
          pass.setPipeline(this.p.args);
          pass.dispatchWorkgroups(1);
          pass.end();
          listed = true;
          compacts++;
        }
        encoder.clearBuffer(this.counters, 0, 4);
        encoder.clearBuffer(this.counters, 8, 4);
        const pass = encoder.beginComputePass();
        pass.setBindGroup(0, this.group0);
        pass.setPipeline(this.p.pass);
        if (useList) pass.dispatchWorkgroupsIndirect(this.indirect, 0);
        else pass.dispatchWorkgroups(groups);
        pass.end();
        encoder.copyBufferToBuffer(this.counters, 0, this.counts, 4 * k, 4);
      }
      encoder.copyBufferToBuffer(this.counts, 0, this.countsRead, 0, 4 * batch);
      const submitted = performance.now();
      device.queue.submit([encoder.finish()]);
      await this.countsRead.mapAsync(GPUMapMode.READ, 0, 4 * batch);
      const counted = new Uint32Array(this.countsRead.getMappedRange(0, 4 * batch).slice(0));
      this.countsRead.unmap();
      const wall = performance.now() - submitted;
      // Passes after the one that left nothing running ran on finished pixels and took no
      // steps; they are harmless and not counted.
      let k = 0;
      for (; k < batch; k++) {
        running = counted[k];
        if (running === 0) break;
      }
      issued += Math.min(batch, k + 1);
      batch = Math.max(1, Math.min(BATCH_MAX, 2 * batch, Math.floor((batch * BATCH_TARGET_MS) / Math.max(wall, 0.5))));
    }
    const wallMs = performance.now() - started;
    const words = await readBack(device, this.states, this.count * stateBytes(this.interior));
    // `emit`, and its output.
    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.p.emit);
      pass.setBindGroup(0, this.group0);
      pass.dispatchWorkgroups(groups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    const emitted = await readBack(device, this.out, this.count * 8);
    return { words, emitted, passes: issued, compacts, wallMs, finished: running === 0 };
  }
}

/** Every pixel's state against the model's: words that differ, by name and by class. */
function judge(bundle, run, interior) {
  const names = interior ? [...STATE_NAMES, ...PROOF_NAMES] : STATE_NAMES;
  const stride = names.length;
  const state = bundle.arrays.ds_state;
  const proof = bundle.arrays.ds_proof;
  if (interior && proof === undefined) throw new Error("the bundle has no ds_proof; export it again");
  const width = bundle.manifest.width_px;
  const count = state.length / 14;
  const at = Object.fromEntries(names.map((n, k) => [n, k]));
  const r = {
    pixels: count,
    fields: Object.fromEntries(names.map((n) => [n, 0])),
    identical: 0,
    identical_but_frac: 0,
    status_n_steps: 0,
    frac_only: 0,
    classes: { running: 0, escaped: 0, capped: 0, interior: 0, gated: 0 },
    emit_wrong: 0,
    // Pixels that differ from the model and equal its flushing run, frac apart.
    as_flushed: 0,
    mismatches: [],
  };
  const ftzState = bundle.arrays.ds_state_ftz;
  const ftzProof = bundle.arrays.ds_proof_ftz;
  const classNames = ["running", "escaped", "capped", "interior", "gated"];
  const words = run.words;
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const differ = [];
    for (let k = 0; k < stride; k++) {
      const want = k < 14 ? state[i * 14 + k] : proof[i * 18 + (k - 14)];
      if (words[base + k] !== want) differ.push(names[k]);
    }
    for (const n of differ) r.fields[n]++;
    r.identical += differ.length === 0;
    let butFrac = differ.filter((n) => n !== "frac");
    // A pixel the model's flushing run (`export --ftz-check`) moves, held to that run instead:
    // the GPU flushes subnormals and the model keeps them. Its status, n and steps are then
    // that run's too: a flushed low half can move a skip, and with it the steps a pixel took
    // to the same count *(gpu_deep_depth_ckpt163)*.
    let flushedRun = false;
    if (butFrac.length > 0 && ftzState !== undefined) {
      let flushed = true;
      for (let k = 0; k < stride && flushed; k++) {
        const want = k < 14 ? ftzState[i * 14 + k] : ftzProof[i * 18 + (k - 14)];
        if (names[k] !== "frac" && words[base + k] !== want) flushed = false;
      }
      if (flushed) {
        r.as_flushed++;
        butFrac = [];
        flushedRun = true;
      }
    }
    r.identical_but_frac += butFrac.length === 0;
    r.frac_only += differ.length === 1 && differ[0] === "frac";
    const held = flushedRun ? ftzState : state;
    const sns = ["status", "n", "steps"].every((n) => words[base + at[n]] === held[i * 14 + at[n]]);
    r.status_n_steps += sns;
    const status = words[base + at.status];
    r.classes[classNames[Math.min(status, 4)]]++;
    if (butFrac.length > 0 && r.mismatches.length < 6) {
      r.mismatches.push({
        col: i % width,
        row: Math.floor(i / width),
        fields: butFrac,
        gpu: Object.fromEntries(["status", "n", "steps", ...butFrac.slice(0, 6)].map((n) => [n, words[base + at[n]]])),
        model: Object.fromEntries(["status", "n", "steps", ...butFrac.slice(0, 6)].map((n) => [n, n in at && at[n] < 14 ? state[i * 14 + at[n]] : proof[i * 18 + at[n] - 14]])),
      });
    }
    // emit: (n, frac) where escaped, (OUT_NONE, status) otherwise, off the GPU's own state.
    const o = decodeOut(run.emitted[2 * i], run.emitted[2 * i + 1]);
    const ok =
      status === ESCAPED
        ? o.status === ESCAPED && o.n === words[base + at.n] && run.emitted[2 * i + 1] === words[base + at.frac]
        : run.emitted[2 * i] === OUT_NONE && o.status === status && status !== RUNNING;
    r.emit_wrong += !ok;
  }
  return r;
}

/** A schedule that cycles a small budget, a budget of one, and an odd larger one. */
function cycling(cap) {
  let small = Math.max(61, Math.ceil(cap / 2000));
  small += small % 2 === 0 ? 1 : 0;
  const cycle = [small, 1, 2 * small + 1];
  return { name: `cycle ${cycle.join("/")}`, budgetOf: (k) => cycle[k % 3], compact: false };
}

async function checkFrame(device, dir, manifestName, schedules) {
  let bundle;
  try {
    bundle = await loadBundle(dir, manifestName);
  } catch (error) {
    log(`${manifestName}: could not load: ${error.message}`);
    result.frames.push({ manifest: manifestName, error: String(error.message) });
    return;
  }
  const m = bundle.manifest;
  const report = {
    id: m.id,
    degree: m.degree,
    julia: m.julia,
    res: `${m.width_px}x${m.height_px}`,
    cap: m.cap,
    interior: m.interior,
    policy: m.interior_policy ?? null,
    flush_hilo: m.flush_hilo,
    periodic: m.periodic,
    ftz: m.ftz ?? null,
    runs: [],
  };
  result.frames.push(report);
  log("");
  log(`--- ${m.id}: degree ${m.degree}, ${m.julia ? "Julia" : "Mandelbrot"}, width ${m.width.toExponential(3)}, ${report.res}, cap ${m.cap}, orbit ${m.orbit_len}${m.periodic ? " periodic" : ""}, interior ${m.interior ? (m.interior_policy ?? "on") : "off"}, flush ${m.flush_hilo}, model ftz ${m.ftz ? `${m.ftz.differ} px` : "-"}`);
  const runner = new Runner(device, bundle);
  try {
    const p = await runner.pipelines();
    report.compileMs = p.compileMs;
    for (const schedule of schedules(m)) {
      device.pushErrorScope("validation");
      const run = await runner.run(schedule.budgetOf, schedule.compact);
      const invalid = await device.popErrorScope();
      if (invalid) throw new Error(invalid.message);
      const v = judge(bundle, run, runner.interior);
      const summary = {
        schedule: schedule.name,
        finished: run.finished,
        passes: run.passes,
        compacts: run.compacts,
        wallMs: run.wallMs,
        pixels: v.pixels,
        status_n_steps: v.status_n_steps,
        identical_but_frac: v.identical_but_frac,
        identical: v.identical,
        frac_only: v.frac_only,
        emit_wrong: v.emit_wrong,
        as_flushed: v.as_flushed,
        classes: v.classes,
        fields: Object.fromEntries(Object.entries(v.fields).filter(([, n]) => n > 0)),
        mismatches: v.mismatches,
      };
      report.runs.push(summary);
      const verdict = v.identical_but_frac === v.pixels && v.status_n_steps === v.pixels && v.emit_wrong === 0 && run.finished ? "MATCH" : "DIFFER";
      log(
        `  ${schedule.name.padEnd(22)} ${verdict}: status/n/steps ${v.status_n_steps}/${v.pixels}, all words but frac ${v.identical_but_frac}, all ${v.identical} (frac only ${v.frac_only})${v.as_flushed ? `, ${v.as_flushed} px equal to the model's flushing run instead` : ""}, emit wrong ${v.emit_wrong}; ${run.passes} passes${run.compacts ? `, ${run.compacts} compactions` : ""}, ${run.wallMs.toFixed(0)} ms; ` +
          `escaped ${v.classes.escaped} capped ${v.classes.capped} interior ${v.classes.interior} gated ${v.classes.gated} running ${v.classes.running}`,
      );
      const fields = Object.entries(summary.fields).filter(([n]) => n !== "frac");
      if (fields.length > 0) log(`    words differing: ${fields.map(([n, k]) => `${n} ${k} px`).join(", ")}`);
      for (const x of v.mismatches.slice(0, 3)) {
        log(`    (${x.col}, ${x.row}) differs in ${x.fields.join(", ")}: gpu ${JSON.stringify(x.gpu)} model ${JSON.stringify(x.model)}`);
      }
    }
  } catch (error) {
    log(`  threw: ${error.message ?? error}`);
    report.error = String(error.message ?? error);
  }
  runner.destroy();
}

async function main() {
  const device = await openDevice();
  if (query.get("vectors") !== "0") await vectors(device);
  const wanted = listParam("frames", null);
  const pick = (entry) => wanted === null || wanted.includes(entry.id) || wanted.includes(entry.manifest.replace(/\.manifest\.json$/, ""));
  if (query.get("selftest") !== "0") {
    const selftest = await (await fetch(SELFTEST_DIR + "selftest.json", { cache: "no-store" })).json();
    log("");
    log(`== self-test frames (${SELFTEST_DIR}) ==`);
    for (const f of selftest.frames.filter(pick)) {
      const schedules = () => selftest.budgets.map(([first, rest]) => ({ name: `budget ${first} then ${rest}`, budgetOf: (k) => (k === 0 ? first : rest), compact: false }));
      await checkFrame(device, SELFTEST_DIR, f.manifest, schedules);
    }
  }
  if (query.get("bundles") !== "0") {
    const index = await fetch(BUNDLE_DIR + "index.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null);
    log("");
    if (index === null) {
      log(`== no check bundles at ${BUNDLE_DIR} ==`);
    } else {
      const entries = index.frames.filter(pick);
      entries.sort((x, y) => x.width_px * x.height_px * x.cap - y.width_px * y.height_px * y.cap);
      log(`== check bundles (${BUNDLE_DIR}): ${entries.length} ==`);
      for (const entry of entries) {
        await checkFrame(device, BUNDLE_DIR, entry.manifest, (m) => [cycling(m.cap), { name: "budget 4096, compacted", budgetOf: () => 4096, compact: true }]);
      }
    }
  }
  const runs = result.frames.flatMap((f) => f.runs ?? []);
  const bad = result.frames.filter((f) => f.error || (f.runs ?? []).some((r) => r.status_n_steps !== r.pixels || r.identical_but_frac !== r.pixels || r.emit_wrong > 0 || !r.finished));
  log("");
  log(`== summary: vectors ${result.vectors ? (result.vectors.passed ? "pass" : "FAIL") : "-"}; ${result.frames.length} frames, ${runs.length} runs; ${bad.length === 0 ? "every run matches the model in every word but frac" : `DIFFER: ${bad.map((f) => f.id ?? f.manifest).join(", ")}`} ==`);
  result.ok = bad.length === 0 && (result.vectors?.passed ?? true);
}

main()
  .catch((error) => {
    result.errors.push(String(error?.message ?? error));
    log(`threw: ${error?.message ?? error}`);
  })
  .finally(() => finish(result));
