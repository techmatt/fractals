// What this machine's WebGPU adapter is, and whether it does double-single arithmetic the
// way the model says it should.
//
// A bench page and nothing more: it is linked from nowhere, the explorer does not load it,
// and it asserts nothing. It writes everything it finds into one <pre> as plain text, so
// a person can copy it, and onto `window.__probe` as text plus a structured object, so
// `explorer/bench/gpu-probe.mjs` can read it over CDP. `__probe.done` resolves when every
// section has finished, whether or not it succeeded.
//
// Three sections, in order: the adapter, the arithmetic self-test, and the kernel: the
// per-pixel loop (`kernel-wgsl.js`) run on the bundles `deep-gpu-model`'s `export` writes,
// held to the model's own results word for word over every pixel's state, and timed.
//
// The query string narrows a run: `frames=a,b` (bundle file stems), `schemes=f32,ds`,
// `budgets=64,256`, `wg=64,256`, `compact=0|1`, `form=<guard>`, `repeats=N`, `selftest=0`.

import { ARITY, CASE_STRIDE, FORMS, OPS, WORKGROUP, source } from "./ds-wgsl.js";
import { ESCAPED, KERNEL_FORMS, RUNNING, STATE_BYTES, STATE_NAMES, kernelSource } from "./kernel-wgsl.js";
import { PARAMS_BYTES, paramsBytes } from "../../deep-gpu-wgsl.js";

const query = new URLSearchParams(location.search);
/** A comma-separated query parameter, or `fallback` when it is absent. */
const listParam = (name, fallback) => (query.has(name) ? query.get(name).split(",").filter(Boolean) : fallback);

const out = document.getElementById("out");
const lines = [];
const result = { adapter: null, selftest: null, kernel: null, errors: [] };

/** Append a line to the report, on the page and in `__probe.text` alike. */
function log(text = "") {
  lines.push(text);
  out.textContent = lines.join("\n");
  window.__probe.text = out.textContent;
}

let finish;
window.__probe = { text: "", result, done: new Promise((resolve) => (finish = resolve)) };

// --- Formatting -------------------------------------------------------------------------

const view = new DataView(new ArrayBuffer(4));
const asFloat = (u) => (view.setUint32(0, u >>> 0, true), view.getFloat32(0, true));
const hex = (u) => "0x" + (u >>> 0).toString(16).padStart(8, "0");
/** One f32 bit pattern as hex and as the exact decimal of its value. */
const both = (u) => {
  const x = asFloat(u);
  return `${hex(u)} (${Object.is(x, -0) ? "-0" : String(x)})`;
};

// --- 1. Adapter ---------------------------------------------------------------------------

/** The limits that decide what a kernel can bind and dispatch. */
const LIMITS = [
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxStorageBuffersPerShaderStage",
  "maxComputeWorkgroupSizeX",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupsPerDimension",
  "maxUniformBufferBindingSize",
  "maxBindingsPerBindGroup",
];

async function adapterReport() {
  log("== adapter ==");
  log(`userAgent: ${navigator.userAgent}`);
  if (!("gpu" in navigator)) {
    log("navigator.gpu: absent (no WebGPU in this browser or context)");
    return null;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) {
    log("requestAdapter: null (WebGPU present but no adapter offered)");
    return null;
  }
  // `info` is the current spelling; older Chrome had `requestAdapterInfo()` instead.
  const info = adapter.info ?? (await adapter.requestAdapterInfo?.()) ?? {};
  const report = {
    vendor: info.vendor ?? "",
    architecture: info.architecture ?? "",
    device: info.device ?? "",
    description: info.description ?? "",
    isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    limits: Object.fromEntries(LIMITS.map((name) => [name, adapter.limits[name]])),
    features: [...adapter.features].sort(),
  };
  for (const key of ["vendor", "architecture", "device", "description", "isFallbackAdapter"]) {
    log(`${key}: ${report[key]}`);
  }
  log("limits (adapter maximum):");
  for (const name of LIMITS) log(`  ${name}: ${report.limits[name]}`);
  log(`features (${report.features.length}):`);
  for (const feature of report.features) log(`  ${feature}`);

  // The storage-size limits at the adapter's maximum, because a kernel that holds a long
  // reference orbit wants every byte of them; the rest at their defaults.
  const timestamps = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ["timestamp-query"] : [],
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
  // A lost device fails every later call with a message about the instance, never this.
  device.lost.then((info) => {
    const message = `device lost (${info.reason}): ${info.message}`;
    result.errors.push(message);
    log(message);
  });
  report.timestampQuery = timestamps;
  log(`device: requested; timestamp-query ${timestamps ? "on" : "unavailable, timing by performance.now()"}`);
  log(`device limits granted: maxStorageBufferBindingSize ${device.limits.maxStorageBufferBindingSize}, maxBufferSize ${device.limits.maxBufferSize}`);
  result.adapter = report;
  return { adapter, device, timestamps };
}

// --- Timing ---------------------------------------------------------------------------------

/**
 * Run `encode(pass)` in one compute pass and say how long the GPU took over it.
 *
 * With `timestamp-query` that is the pass's own begin and end stamps, which Chrome rounds
 * to 100 us unless it is started with `--disable-dawn-features=timestamp_quantization`
 * (`gpu-probe.mjs` does; the kernel section warns when its stamps come back rounded).
 * Without, it is wall time from submit to `onSubmittedWorkDone`, which includes the
 * queue's latency and says so in its label.
 */
async function timedPass(device, timestamps, encode) {
  const encoder = device.createCommandEncoder();
  let query = null;
  let resolve = null;
  let read = null;
  if (timestamps) {
    query = device.createQuerySet({ type: "timestamp", count: 2 });
    resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }
  const pass = encoder.beginComputePass(
    timestamps ? { timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {},
  );
  encode(pass);
  pass.end();
  if (timestamps) {
    encoder.resolveQuerySet(query, 0, 2, resolve, 0);
    encoder.copyBufferToBuffer(resolve, 0, read, 0, 16);
  }
  const start = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const wall = performance.now() - start;
  if (!timestamps) return { ms: wall, how: "wall" };
  await read.mapAsync(GPUMapMode.READ);
  const [begin, end] = new BigUint64Array(read.getMappedRange());
  const ms = Number(end - begin) / 1e6;
  read.unmap();
  query.destroy();
  return { ms, how: "timestamp", wall };
}

// --- 2. Arithmetic self-test --------------------------------------------------------------

/** Copy a GPU buffer back to the CPU as u32s. */
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

async function selfTest({ device, timestamps }) {
  log("");
  log("== self-test: double-single error-free transforms ==");
  const vectors = await (await fetch("./vectors.json", { cache: "no-store" })).json();
  const cases = vectors.cases;
  log(`vectors: ${cases.length} cases; generator: ${vectors.generator}`);

  // Inputs go up through a storage buffer at run time, so nothing about them is a
  // constant the compiler could fold through the arithmetic it is being tested on.
  const packed = new Uint32Array(cases.length * CASE_STRIDE);
  cases.forEach((c, i) => {
    const op = OPS.indexOf(c.op);
    if (op < 0) throw new Error(`vectors.json: unknown op ${c.op}`);
    if (c.in.length !== ARITY[c.op]) throw new Error(`vectors.json: ${c.op} wants ${ARITY[c.op]} inputs`);
    packed[i * CASE_STRIDE] = op;
    c.in.forEach((u, k) => (packed[i * CASE_STRIDE + 1 + k] = u));
  });
  const input = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, packed);
  const outBytes = cases.length * 2 * 4;
  const knobs = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const knobData = new ArrayBuffer(16);
  new Float32Array(knobData, 0, 2).set([1.0, 0.0]); // one, zero
  new Uint32Array(knobData, 8, 2).set([0, 0]); // uzero, flag
  device.queue.writeBuffer(knobs, 0, knobData);
  const scratch = device.createBuffer({ size: cases.length * 4, usage: GPUBufferUsage.STORAGE });

  // An explicit layout, so a form that never touches `scratch` still binds the same four.
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });

  const forms = [];
  for (const form of FORMS) {
    const entry = {
      form: form.name,
      note: form.note,
      control: form.control === true,
      ops: {},
      ms: null,
      timing: null,
      error: null,
    };
    forms.push(entry);
    try {
      const module = device.createShaderModule({ code: source(form), label: `ds-${form.name}` });
      const compiled = await module.getCompilationInfo();
      const errors = compiled.messages.filter((m) => m.type === "error");
      if (errors.length > 0) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; "));
      device.pushErrorScope("validation");
      const pipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: "main" },
      });
      const output = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: input } },
          { binding: 1, resource: { buffer: output } },
          { binding: 2, resource: { buffer: knobs } },
          { binding: 3, resource: { buffer: scratch } },
        ],
      });
      const time = await timedPass(device, timestamps, (pass) => {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(cases.length / WORKGROUP));
      });
      const invalid = await device.popErrorScope();
      if (invalid) throw new Error(invalid.message);
      entry.ms = time.ms;
      entry.timing = time.how;
      const got = await readBack(device, output, outBytes);
      output.destroy();

      for (const op of OPS) entry.ops[op] = { pass: 0, fail: 0, first: null };
      cases.forEach((c, i) => {
        const tally = entry.ops[c.op];
        const g = [got[2 * i], got[2 * i + 1]];
        if (g[0] === c.out[0] >>> 0 && g[1] === c.out[1] >>> 0) {
          tally.pass++;
          return;
        }
        tally.fail++;
        tally.first ??= { index: i, in: c.in, expected: c.out, got: g };
      });
    } catch (error) {
      entry.error = String(error?.message ?? error);
    }
  }

  // The matrix first, so the answer is on one screen; the first failures after it.
  const width = Math.max(...FORMS.map((f) => f.name.length));
  const cell = (tally) => (tally.fail === 0 ? `ok ${tally.pass}` : `FAIL ${tally.fail}/${tally.pass + tally.fail}`);
  log("");
  log(`${"form".padEnd(width)}  ${OPS.map((op) => op.padEnd(13)).join(" ")}  gpu ms`);
  for (const entry of forms) {
    if (entry.error !== null) {
      log(`${entry.form.padEnd(width)}  error: ${entry.error}`);
      continue;
    }
    const cells = OPS.map((op) => cell(entry.ops[op]).padEnd(13)).join(" ");
    log(`${entry.form.padEnd(width)}  ${cells}  ${entry.ms.toFixed(3)} (${entry.timing})`);
  }
  log("");
  for (const entry of forms) log(`${entry.form}: ${entry.note}`);
  for (const entry of forms) {
    if (entry.error !== null) continue;
    for (const op of OPS) {
      const first = entry.ops[op].first;
      if (first === null) continue;
      log("");
      log(`first failure: form ${entry.form}, op ${op}, case ${first.index}`);
      log(`  in:       ${first.in.map(both).join(", ")}`);
      log(`  expected: ${first.expected.map(both).join(", ")}`);
      log(`  got:      ${first.got.map(both).join(", ")}`);
    }
  }
  const clean = (e) => e.error === null && OPS.every((op) => e.ops[op].fail === 0);
  const survivors = forms.filter((e) => !e.control && clean(e));
  const toothless = forms.filter((e) => e.control && clean(e));
  const unrun = forms.filter((e) => e.control && e.error !== null);
  log("");
  log(`forms passing every op: ${survivors.length ? survivors.map((e) => e.form).join(", ") : "none"}`);
  log(
    unrun.length > 0
      ? `controls DID NOT RUN, so nothing shows the vectors can see a fused or reassociated evaluation: ${unrun.map((e) => e.form).join(", ")}`
      : toothless.length === 0
        ? "controls: every control failed, so the vectors can see a fused or reassociated evaluation"
        : `controls PASSED, so the vectors cannot see what they model: ${toothless.map((e) => e.form).join(", ")}`,
  );
  input.destroy();
  knobs.destroy();
  scratch.destroy();
  result.selftest = { generator: vectors.generator, cases: cases.length, forms };
}

// --- 3. Kernel --------------------------------------------------------------------------

/** Where the bundles are, relative to this page; the served root is the repository's. */
const BUNDLES = "../../../artifacts/gpu-probe/";

/** What writes the bundles, run from `explorer/deep-gpu-model`. */
const EXPORT_COMMAND = [
  "cargo build --release --bin export",
  "target/release/export --frames ../../scratch/gpu-model/corpus-unique.jsonl,../../scratch/gpu-model/deep/frames.jsonl \\",
  "    --ids random-dives#504,random-dives#337,go:julia3-end,random-dives#501,A-1e-60 --res 320x180 \\",
  "    --out ../../artifacts/gpu-probe",
  "target/release/export --frames ../../scratch/gpu-model/longorbit.jsonl --ids longorbit-cusp-main-d2 \\",
  "    --res 160x90 --cap 1e6 --out ../../artifacts/gpu-probe",
];

/** Budgets in delta steps per pixel per dispatch, smallest first. */
const BUDGETS = listParam("budgets", ["64", "256", "1024", "4096"]).map(Number);
/** Never issue a dispatch predicted to take longer than this, and stop scaling past the other. */
const PREDICTED_LIMIT_MS = 500;
const MEASURED_LIMIT_MS = 250;
/** What another workgroup size may cost against the first, for predicting it: 1.9x was seen. */
const WORKGROUP_FACTOR = 2;
/** Windows' TDR: a dispatch longer than this resets the display driver. */
const TDR_MS = 2000;
/**
 * The margin a budget read off a measured pass is divided by: the desktop shares this GPU,
 * a workgroup size alone moved a pass by 1.9x, and clocks are not held.
 */
const SAFETY = 4;
/** A compact pass runs before every this many kernel passes. */
const COMPACT_EVERY = 8;
/** Most passes in one submission, and the query set's room for them (two stamps each). */
const BATCH_MAX = 256;
const QUERY_SLOTS = 2 * (BATCH_MAX + BATCH_MAX / COMPACT_EVERY + 2);
/** GPU time one submission is sized to, compact passes included. */
const BATCH_TARGET_MS = 500;
/** Timed runs of every configuration, interleaved round by round so order is not the variable. */
const REPEATS = Math.max(1, Number(query.get("repeats") ?? 3));
const TYPED = { u8: Uint8Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array };

/** A bundle: its manifest, and every array it names as a typed view over the one .bin. */
async function loadBundle(entry) {
  const manifest = await (await fetch(BUNDLES + entry.manifest, { cache: "no-store" })).json();
  const response = await fetch(BUNDLES + entry.bin, { cache: "no-store" });
  if (!response.ok) throw new Error(`${entry.bin}: HTTP ${response.status}`);
  const bin = await response.arrayBuffer();
  if (bin.byteLength !== manifest.bin_bytes) throw new Error(`${entry.bin}: ${bin.byteLength} bytes, manifest says ${manifest.bin_bytes}`);
  const arrays = {};
  for (const a of manifest.arrays) arrays[a.name] = new TYPED[a.dtype](bin, a.offset, a.count);
  return { manifest, arrays, stem: entry.manifest.replace(/\.manifest\.json$/, "") };
}

/** Compile one shader module, refusing it with its first errors and their lines. */
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

/** The buffers and pipelines one bundle needs, made once and reused by every run. */
class Bench {
  constructor(device, timestamps, bundle) {
    this.device = device;
    this.timestamps = timestamps;
    this.bundle = bundle;
    const m = bundle.manifest;
    this.count = m.width_px * m.height_px;
    const usage = GPUBufferUsage;
    const upload = (data, flags) => {
      const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: flags | usage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    this.frame = upload(bundle.arrays.frame, usage.UNIFORM);
    this.frameLo = upload(bundle.arrays.frame_lo, usage.UNIFORM);
    this.orbits = { f32: upload(bundle.arrays.orbit_f32pair, usage.STORAGE), ds: upload(bundle.arrays.orbit_hilo, usage.STORAGE) };
    this.params = device.createBuffer({ size: PARAMS_BYTES, usage: usage.UNIFORM | usage.COPY_DST });
    const maxState = Math.max(STATE_BYTES.f32, STATE_BYTES.ds);
    this.states = device.createBuffer({ size: this.count * maxState, usage: usage.STORAGE | usage.COPY_SRC });
    this.counters = device.createBuffer({ size: 16, usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST });
    this.list = device.createBuffer({ size: this.count * 4, usage: usage.STORAGE });
    // The shipped layout's `out`, which only `emit` writes and the probe never dispatches.
    this.out = device.createBuffer({ size: this.count * 8, usage: usage.STORAGE });
    this.indirect = device.createBuffer({ size: 16, usage: usage.STORAGE | usage.INDIRECT });
    // Per pass: the pixels still running after it, and the delta steps it took.
    this.counts = device.createBuffer({ size: BATCH_MAX * 8, usage: usage.COPY_SRC | usage.COPY_DST });
    this.countsRead = device.createBuffer({ size: BATCH_MAX * 8, usage: usage.MAP_READ | usage.COPY_DST });
    if (timestamps) {
      this.query = device.createQuerySet({ type: "timestamp", count: QUERY_SLOTS });
      this.resolve = device.createBuffer({ size: QUERY_SLOTS * 8, usage: usage.QUERY_RESOLVE | usage.COPY_SRC });
      this.stampsRead = device.createBuffer({ size: QUERY_SLOTS * 8, usage: usage.MAP_READ | usage.COPY_DST });
    }
    const compute = GPUShaderStage.COMPUTE;
    const entry = (binding, type) => ({ binding, visibility: compute, buffer: { type } });
    this.layout0 = device.createBindGroupLayout({
      entries: [
        entry(0, "uniform"),
        entry(1, "uniform"),
        entry(2, "uniform"),
        entry(3, "read-only-storage"),
        entry(4, "storage"),
        entry(5, "storage"),
        entry(6, "storage"),
        entry(7, "storage"),
      ],
    });
    // The indirect arguments are a group of their own, bound only by `args`: a buffer may
    // not be a writable binding and the indirect buffer of one dispatch at once.
    this.layout1 = device.createBindGroupLayout({ entries: [entry(0, "storage")] });
    this.groups = {};
    for (const scheme of ["f32", "ds"]) {
      this.groups[scheme] = device.createBindGroup({
        layout: this.layout0,
        entries: [
          { binding: 0, resource: { buffer: this.frame } },
          { binding: 1, resource: { buffer: this.frameLo } },
          { binding: 2, resource: { buffer: this.params } },
          { binding: 3, resource: { buffer: this.orbits[scheme] } },
          { binding: 4, resource: { buffer: this.states, size: this.count * STATE_BYTES[scheme] } },
          { binding: 5, resource: { buffer: this.counters } },
          { binding: 6, resource: { buffer: this.list } },
          { binding: 7, resource: { buffer: this.out } },
        ],
      });
    }
    this.group1 = device.createBindGroup({ layout: this.layout1, entries: [{ binding: 0, resource: { buffer: this.indirect } }] });
    this.pipelines = new Map();
  }

  destroy() {
    for (const b of [this.frame, this.frameLo, this.orbits.f32, this.orbits.ds, this.params, this.states, this.counters]) b.destroy();
    for (const b of [this.list, this.out, this.indirect, this.counts, this.countsRead]) b.destroy();
    if (this.timestamps) {
      this.query.destroy();
      this.resolve.destroy();
      this.stampsRead.destroy();
    }
  }

  /** The five entry points for a scheme, form and workgroup size, compiled once. */
  async pipelinesFor(scheme, form, workgroup, smooth) {
    const key = `${scheme}/${form}/${workgroup}/${smooth}`;
    if (this.pipelines.has(key)) return this.pipelines.get(key);
    const m = this.bundle.manifest;
    const code = kernelSource({ scheme, degree: m.degree, julia: m.julia, form, workgroup, smooth });
    const started = performance.now();
    const module = await compile(this.device, code, `kernel-${scheme}-d${m.degree}${m.julia ? "j" : ""}-${form}-wg${workgroup}`);
    const plain = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout0] });
    const both = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout0, this.layout1] });
    const make = (entryPoint, layout) => this.device.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
    const [init, all, list, compact, args] = await Promise.all([
      make("init", plain),
      make("pass_all", plain),
      make("pass_list", plain),
      make("compact", plain),
      make("args", both),
    ]);
    const made = { init, all, list, compact, args, workgroup, compileMs: performance.now() - started, lines: code.split("\n").length };
    this.pipelines.set(key, made);
    return made;
  }

  /**
   * One run to the end: init, then passes of `budget` steps until a pass leaves no pixel
   * running. Every pass is a compute pass of its own, stamped at both ends, followed by a
   * copy of its running and step counters; a submission carries a batch of them, sized
   * from the last batch's longest pass, compact passes included, so that a batch stays
   * near `BATCH_TARGET_MS` of GPU time.
   */
  async run({ scheme, form, workgroup, budget, compact, smooth = "exact" }) {
    const device = this.device;
    const m = this.bundle.manifest;
    const p = await this.pipelinesFor(scheme, form, workgroup, smooth);
    // The flush term is the proof's alone, and neither kernel here runs it.
    const params = paramsBytes({ budget, periodic: m.periodic, length: m.orbit_len, count: this.count, flush: 0 });
    device.queue.writeBuffer(this.params, 0, params);
    const groups = Math.ceil(this.count / workgroup);
    const group = this.groups[scheme];

    const wallStart = performance.now();
    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(p.init);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(groups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    const limit = Math.ceil(m.cap / budget) + 2;
    const passes = []; // { ms, running }
    const compacts = []; // ms
    let batch = 1;
    let finished = false;
    let issued = 0;
    while (!finished && issued < limit) {
      const encoder = device.createCommandEncoder();
      const kinds = [];
      let stamp = 0;
      const stamped = () => (this.timestamps ? { timestampWrites: { querySet: this.query, beginningOfPassWriteIndex: stamp, endOfPassWriteIndex: stamp + 1 } } : {});
      for (let k = 0; k < batch; k++) {
        if (compact && (issued + k) % COMPACT_EVERY === 0) {
          encoder.clearBuffer(this.counters, 4, 4);
          const pass = encoder.beginComputePass(stamped());
          stamp += 2;
          pass.setBindGroup(0, group);
          pass.setBindGroup(1, this.group1);
          pass.setPipeline(p.compact);
          pass.dispatchWorkgroups(groups);
          pass.setPipeline(p.args);
          pass.dispatchWorkgroups(1);
          pass.end();
          kinds.push("compact");
        }
        encoder.clearBuffer(this.counters, 0, 4);
        encoder.clearBuffer(this.counters, 8, 4);
        const pass = encoder.beginComputePass(stamped());
        stamp += 2;
        pass.setBindGroup(0, group);
        if (compact) {
          pass.setPipeline(p.list);
          pass.dispatchWorkgroupsIndirect(this.indirect, 0);
        } else {
          pass.setPipeline(p.all);
          pass.dispatchWorkgroups(groups);
        }
        pass.end();
        encoder.copyBufferToBuffer(this.counters, 0, this.counts, 8 * k, 4);
        encoder.copyBufferToBuffer(this.counters, 8, this.counts, 8 * k + 4, 4);
        kinds.push("pass");
      }
      if (this.timestamps) {
        encoder.resolveQuerySet(this.query, 0, stamp, this.resolve, 0);
        encoder.copyBufferToBuffer(this.resolve, 0, this.stampsRead, 0, stamp * 8);
      }
      encoder.copyBufferToBuffer(this.counts, 0, this.countsRead, 0, batch * 8);
      const submitted = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const batchWall = performance.now() - submitted;
      await this.countsRead.mapAsync(GPUMapMode.READ, 0, batch * 8);
      const counted = new Uint32Array(this.countsRead.getMappedRange(0, batch * 8).slice(0));
      this.countsRead.unmap();
      let times = null;
      if (this.timestamps) {
        await this.stampsRead.mapAsync(GPUMapMode.READ, 0, stamp * 8);
        const raw = new BigUint64Array(this.stampsRead.getMappedRange(0, stamp * 8).slice(0));
        this.stampsRead.unmap();
        times = [];
        for (let j = 0; j < stamp; j += 2) times.push(Number(raw[j + 1] - raw[j]) / 1e6);
      }
      let k = 0;
      for (let j = 0; j < kinds.length; j++) {
        // Without stamps a pass is credited an equal share of its batch's wall time.
        const ms = times ? times[j] : batchWall / kinds.length;
        if (kinds[j] === "compact") {
          compacts.push(ms);
          continue;
        }
        passes.push({ ms, running: counted[2 * k], steps: counted[2 * k + 1] });
        issued++;
        if (counted[2 * k] === 0) {
          finished = true;
          break;
        }
        k++;
      }
      const longest = Math.max(...(times ?? [batchWall / kinds.length]), 0.01);
      batch = Math.max(1, Math.min(BATCH_MAX, 2 * batch, Math.floor(BATCH_TARGET_MS / longest)));
    }
    const wallMs = performance.now() - wallStart;

    const bytes = this.count * STATE_BYTES[scheme];
    const words = await readBack(device, this.states, bytes);
    const gpuMs = passes.reduce((a, x) => a + x.ms, 0) + compacts.reduce((a, x) => a + x, 0);
    const maxMs = Math.max(...passes.map((x) => x.ms));
    // The cost of a pixel-step where it is a cost: in passes where every pixel ran its whole
    // budget, so that no slot sat idle. The worst of them is what a budget is sized from.
    const slots = this.count * budget;
    const full = passes.filter((x) => x.steps === slots);
    const nsFull = full.length === 0 ? null : Math.max(...full.map((x) => (1e6 * x.ms) / x.steps));
    const stepsCounted = passes.reduce((a, x) => a + x.steps, 0);
    // Chrome rounds stamps to 100 us unless it was started with the quantization off.
    const quantized = this.timestamps && passes.length >= 8 && passes.every((x) => Math.abs(x.ms * 10 - Math.round(x.ms * 10)) < 1e-6);
    return {
      scheme,
      form,
      smooth,
      workgroup,
      budget,
      compact,
      finished,
      dispatches: passes.length,
      compacts: compacts.length,
      gpuMs,
      wallMs,
      meanMs: gpuMs / passes.length,
      maxMs,
      firstMs: passes[0]?.ms ?? null,
      fullPasses: full.length,
      nsFull,
      nsAll: stepsCounted === 0 ? null : (1e6 * gpuMs) / stepsCounted,
      stepsCounted,
      quantized,
      compileMs: p.compileMs,
      words,
    };
  }
}

/**
 * The run's state against the model's, every word of it (the export's `f32_state` or
 * `ds_state`), and its smooth count against the model's and `perturb`'s `f64`.
 */
function judge(bundle, scheme, words) {
  const names = STATE_NAMES[scheme];
  const stride = names.length;
  const expected = bundle.arrays[`${scheme}_state`];
  if (expected === undefined) throw new Error(`${bundle.stem}: the bundle has no ${scheme}_state; write it again with export`);
  const at = Object.fromEntries(names.map((name, k) => [name, k]));
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const exFloats = new Float32Array(expected.buffer, expected.byteOffset, expected.length);
  const width = bundle.manifest.width_px;
  const f64 = bundle.arrays.f64_smooth;
  const count = expected.length / stride;
  const r = {
    pixels: count,
    // Pixels on which each word differs.
    fields: Object.fromEntries(names.map((name) => [name, 0])),
    identical: 0,
    identical_but_frac: 0,
    running: 0,
    both_escaped: 0,
    max_delta: 0,
    max_delta_at: null,
    over_001: 0,
    over_01: 0,
    nonfinite: 0,
    gpu_vs_f64: { both: 0, over_01: 0, class_changes: 0 },
    model_vs_f64: { both: 0, over_01: 0, class_changes: 0 },
    // A few pixels whose state differs past `frac`, and a few where only `frac` does.
    mismatches: [],
    frac_only: [],
  };
  // Escaped on one side and not the other is a class change, never a smooth delta.
  const against = (tally, escaped, smooth, f) => {
    const fEscaped = !Number.isNaN(f);
    if (escaped && fEscaped) {
      tally.both++;
      tally.over_01 += !(Math.abs(smooth - f) <= 0.1);
    } else if (escaped !== fEscaped) {
      tally.class_changes++;
    }
  };
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const differ = [];
    for (let k = 0; k < stride; k++) if (words[base + k] !== expected[base + k]) differ.push(names[k]);
    for (const name of differ) r.fields[name]++;
    r.identical += differ.length === 0;
    const fracOnly = differ.length === 1 && differ[0] === "frac";
    r.identical_but_frac += differ.length === 0 || fracOnly;
    if (differ.length > 0) {
      const into = fracOnly ? r.frac_only : r.mismatches;
      if (into.length < (fracOnly ? 2 : 6)) {
        const shown = fracOnly ? ["n", "frac"] : [...new Set(["status", "n", ...differ])];
        into.push({
          i,
          col: i % width,
          row: Math.floor(i / width),
          fields: differ,
          gpu: Object.fromEntries(shown.map((name) => [name, words[base + at[name]]])),
          model: Object.fromEntries(shown.map((name) => [name, expected[base + at[name]]])),
        });
      }
    }
    const status = words[base + at.status];
    const exStatus = expected[base + at.status];
    r.running += status === RUNNING;
    const smooth = words[base + at.n] + floats[base + at.frac];
    const exSmooth = expected[base + at.n] + exFloats[base + at.frac];
    if (status === ESCAPED && exStatus === ESCAPED) {
      r.both_escaped++;
      const delta = Math.abs(smooth - exSmooth);
      if (!Number.isFinite(delta)) {
        // A NaN or an infinity counts against every threshold rather than slipping past them.
        r.nonfinite++;
        r.over_001++;
        r.over_01++;
        continue;
      }
      if (delta > r.max_delta) {
        r.max_delta = delta;
        r.max_delta_at = i;
      }
      r.over_001 += delta > 0.01;
      r.over_01 += delta > 0.1;
    }
    against(r.gpu_vs_f64, status === ESCAPED, smooth, f64[i]);
    against(r.model_vs_f64, exStatus === ESCAPED, exSmooth, f64[i]);
  }
  return r;
}

/** How many pixels' states differ between two runs: in any word, or in any but `frac`. */
function stateDiff(scheme, a, b, ignoreFrac) {
  const stride = STATE_NAMES[scheme].length;
  const skip = ignoreFrac ? STATE_NAMES[scheme].indexOf("frac") : -1;
  let differ = 0;
  for (let base = 0; base < a.length; base += stride) {
    for (let k = 0; k < stride; k++) {
      if (k !== skip && a[base + k] !== b[base + k]) {
        differ++;
        break;
      }
    }
  }
  return differ;
}

const pct = (part, whole) => (whole === 0 ? "-" : `${((100 * part) / whole).toFixed(3)}%`);
const sci = (x) => (x === null || !Number.isFinite(x) ? "-" : x === 0 ? "0" : x.toExponential(2));
const fixed = (x, digits) => (x === null || !Number.isFinite(x) ? "-" : x.toFixed(digits));
const sum = (array) => array.reduce((a, x) => a + x, 0);
const median = (array) => {
  const s = [...array].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Pads every column of `rows` (arrays of strings) to its widest cell. */
function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => String(row[c]).length)));
  return rows.map((row) => row.map((cell, c) => (c === 0 ? String(cell).padEnd(widths[c]) : String(cell).padStart(widths[c]))).join("  "));
}

/** Which guard the double-single kernel compiles with: asked for, or the self-test's. */
function chooseForm(selftest) {
  if (query.has("form")) return { form: query.get("form"), why: "asked for in the query string" };
  const clean = (e) => e.error === null && OPS.every((op) => e.ops[op].fail === 0);
  const survivors = (selftest?.forms ?? []).filter((e) => !e.control && clean(e)).map((e) => e.form);
  const usable = KERNEL_FORMS.filter((f) => survivors.includes(f));
  if (usable.length > 0) return { form: usable[0], why: `the first form the self-test passed (${survivors.join(", ")})` };
  if (selftest === null) return { form: "plain", why: "no self-test ran" };
  return { form: "plain", why: "NO form passed the self-test; the DS results are not double-single" };
}

/** The 1920x1080 budget a pass costing `ns` a pixel-step allows under `TDR_MS / SAFETY`. */
const budget1080p = (ns) => (ns === null ? null : Math.floor((TDR_MS * 1e6) / (SAFETY * ns * 1920 * 1080)));

/** One configuration's repeats, reduced: medians of the times, the worst of the costs. */
function summarize(config) {
  const runs = config.runs;
  const med = (key) => median(runs.map((r) => r[key]));
  const costs = runs.map((r) => r.nsFull).filter((x) => x !== null);
  const nsFull = costs.length === 0 ? null : Math.max(...costs);
  return {
    ...config.opts,
    repeats: runs.length,
    dispatches: runs[0].dispatches,
    finished: runs.every((r) => r.finished),
    gpuMs: med("gpuMs"),
    gpuMsMin: Math.min(...runs.map((r) => r.gpuMs)),
    gpuMsMax: Math.max(...runs.map((r) => r.gpuMs)),
    wallMs: med("wallMs"),
    stepsPerSecond: med("stepsPerSecond"),
    meanMs: med("meanMs"),
    maxMs: Math.max(...runs.map((r) => r.maxMs)),
    fullPasses: Math.min(...runs.map((r) => r.fullPasses)),
    nsFull,
    nsAll: med("nsAll"),
    budget1080p: budget1080p(nsFull),
    runs,
  };
}

async function runKernel({ device, timestamps }, log, selftest) {
  log("");
  log("== kernel ==");
  const index = await fetch(BUNDLES + "index.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null);
  if (index === null) {
    log(`no bundles at ${BUNDLES}index.json. Write them from explorer/deep-gpu-model with:`);
    for (const line of EXPORT_COMMAND) log(`  ${line}`);
    return { error: "no bundles" };
  }
  const { form, why } = chooseForm(selftest);
  const schemes = listParam("schemes", ["f32", "ds"]);
  const workgroups = listParam("wg", ["64", "256"]).map(Number);
  const wantCompact = query.get("compact") !== "0";
  const wanted = listParam("frames", null);
  const entries = index.frames.filter((f) => wanted === null || wanted.includes(f.manifest.replace(/\.manifest\.json$/, "")) || wanted.includes(f.id));
  // Shortest first, the long-orbit frame last.
  entries.sort((x, y) => x.width_px * x.height_px * x.cap - y.width_px * y.height_px * y.cap);
  log(`bundles: ${index.frames.length} in index, running ${entries.map((e) => e.id).join(", ")}`);
  log(`double-single guard: ${form} (${why})`);
  log(`configurations: budgets ${BUDGETS.join(", ")} at workgroup ${workgroups[0]}; workgroup ${workgroups.slice(1).join(", ") || "-"} and${wantCompact ? "" : " no"} compaction (every ${COMPACT_EVERY} passes) at the largest budget that ran; the exact smooth fraction at budget ${BUDGETS[0]}`);
  log(`each timed ${REPEATS} times, in rounds: the first in order, the rest reversed or rotated, after one untimed run per frame and scheme`);
  log(`timing: ${timestamps ? "timestamp queries, one compute pass per dispatch" : "performance.now() around each batch, shared equally between its passes"}`);
  log(`a budget is skipped when the last one's longest pass, scaled, predicts more than ${PREDICTED_LIMIT_MS} ms, or measured ${MEASURED_LIMIT_MS} ms or more; another workgroup size or compaction, when the top budget's longest pass times ${WORKGROUP_FACTOR} (1 for compaction) predicts more than ${PREDICTED_LIMIT_MS} ms`);
  log(`correctness: every word of every pixel's state against the model's; the exact smooth run is held to it bit for bit, the builtin runs to it but for frac`);
  log(`ns/step full: the worst GPU time per pixel-step over passes in which every pixel ran its whole budget. budget@1080p: what a 1920x1080 pass at that cost allows under ${TDR_MS} ms / ${SAFETY}. A frame under one wave of the GPU overstates the cost, which errs safe`);

  const report = { form, why, timestamps, repeats: REPEATS, safety: SAFETY, quantized: false, frames: [] };
  for (const entry of entries) {
    let bundle;
    try {
      bundle = await loadBundle(entry);
    } catch (error) {
      log("");
      log(`${entry.id}: could not load: ${error.message}`);
      report.frames.push({ id: entry.id, error: String(error.message) });
      continue;
    }
    const m = bundle.manifest;
    if (m.interior) {
      // The probe runs both kernels with the switch compiled out; `kernel-check.html` holds
      // the shipped kernel, proof and all, to an interior bundle.
      log("");
      log(`${m.id}: written with the interior switch on; kernel-check.html runs it`);
      report.frames.push({ id: m.id, error: "interior bundle" });
      continue;
    }
    const bench = new Bench(device, timestamps, bundle);
    const frameReport = { id: m.id, stem: bundle.stem, degree: m.degree, julia: m.julia, width_px: m.width_px, height_px: m.height_px, cap: m.cap, orbit_len: m.orbit_len, periodic: m.periodic, schemes: {} };
    report.frames.push(frameReport);
    log("");
    log(`--- ${m.id}: degree ${m.degree}, ${m.julia ? "Julia" : "Mandelbrot"}, width ${m.width.toExponential(3)}, ${m.width_px}x${m.height_px}, cap ${m.cap}, orbit ${m.orbit_len}${m.periodic ? " periodic" : ""}`);
    try {
      for (const scheme of schemes) {
        const modelSteps = sum(scheme === "f32" ? bundle.arrays.f32_steps : bundle.arrays.ds_steps);
        // Untimed, so that the clocks are up and the first timed pass is not paying for them.
        await bench.run({ scheme, form, workgroup: workgroups[0], budget: BUDGETS[0], compact: false, smooth: "builtin" });
        const configs = [];
        let first = null;
        const time = async (config) => {
          const run = await bench.run(config.opts);
          const verdict = judge(bundle, scheme, run.words);
          // Every builtin run against the first, word for word; the exact run but for frac.
          const builtin = config.opts.smooth === "builtin";
          first ??= run.words;
          run.differFromFirst = stateDiff(scheme, first, run.words, !builtin);
          delete run.words;
          run.stepsPerSecond = modelSteps / (run.gpuMs / 1000);
          run.verdict = { identical: verdict.identical, identical_but_frac: verdict.identical_but_frac, running: verdict.running, nonfinite: verdict.nonfinite, over_01: verdict.over_01 };
          if (run.quantized) report.quantized = true;
          config.runs.push(run);
          return { run, verdict };
        };
        const add = (opts) => {
          const config = { opts: { scheme, form, compact: false, smooth: "builtin", workgroup: workgroups[0], ...opts }, runs: [] };
          configs.push(config);
          return time(config);
        };

        let builtinVerdict = null;
        let last = null;
        const skipped = [];
        for (const budget of BUDGETS) {
          if (last !== null && (last.maxMs >= MEASURED_LIMIT_MS || (last.maxMs * budget) / last.budget > PREDICTED_LIMIT_MS)) {
            skipped.push(`budget ${budget}`);
            continue;
          }
          const { run, verdict } = await add({ budget });
          last = run;
          builtinVerdict ??= verdict;
        }
        const top = last.budget;
        for (const workgroup of workgroups.slice(1)) {
          if (last.maxMs * WORKGROUP_FACTOR > PREDICTED_LIMIT_MS) skipped.push(`wg ${workgroup}`);
          else await add({ workgroup, budget: top });
        }
        if (wantCompact) {
          if (last.maxMs > PREDICTED_LIMIT_MS) skipped.push("compact");
          else await add({ budget: top, compact: true });
        }
        const exact = (await add({ budget: BUDGETS[0], smooth: "exact" })).verdict;
        for (let round = 1; round < REPEATS; round++) {
          const shift = Math.floor(round / 2) % configs.length;
          const order = round % 2 === 1 ? [...configs].reverse() : [...configs.slice(shift), ...configs.slice(0, shift)];
          for (const config of order) await time(config);
        }
        const runs = configs.flatMap((c) => c.runs);
        frameReport.schemes[scheme] = {
          modelSteps,
          correctness: exact,
          builtinSmooth: builtinVerdict,
          runsAgree: runs.every((r) => r.differFromFirst === 0),
          worstDiffer: Math.max(...runs.map((r) => r.differFromFirst)),
          stepsAgree: runs.every((r) => r.stepsCounted === modelSteps),
          skipped,
          configs: configs.map(summarize),
        };
      }
    } catch (error) {
      log(`  threw: ${error.message ?? error}`);
      frameReport.error = String(error.message ?? error);
    }
    bench.destroy();
    printFrame(log, frameReport);
  }
  printSummary(log, report);
  return report;
}

/** A u32 word as the state holds it: a float field in hex and decimal, the rest as integers. */
function word(name, u) {
  if (/^(d|d_hi|d_lo)\.|^frac$|^dz_mantissa$/.test(name)) return both(u);
  if (name === "s" || name === "dz_exponent") return String(u | 0);
  return String(u);
}

function printFrame(log, frame) {
  const schemes = Object.entries(frame.schemes);
  if (schemes.length === 0) return;
  log("correctness against the model's own run (smooth deltas over pixels where both escaped; class: escaped on one side only):");
  const rows = [["scheme", "smooth", "all words=", "all but frac=", "running", "max |d smooth|", ">0.01", ">0.1", "non-finite", "vs f64 >0.1 gpu", "class", "model", "class", "runs agree", "steps="]];
  const row = (scheme, smooth, c, s) => [
    scheme,
    smooth,
    `${c.identical}/${c.pixels}`,
    `${c.identical_but_frac}`,
    `${c.running}`,
    sci(c.max_delta),
    pct(c.over_001, c.both_escaped),
    pct(c.over_01, c.both_escaped),
    `${c.nonfinite}`,
    pct(c.gpu_vs_f64.over_01, c.gpu_vs_f64.both),
    `${c.gpu_vs_f64.class_changes}`,
    pct(c.model_vs_f64.over_01, c.model_vs_f64.both),
    `${c.model_vs_f64.class_changes}`,
    s === null ? "-" : s.runsAgree ? "yes" : `NO, ${s.worstDiffer} px`,
    s === null ? "-" : s.stepsAgree ? "yes" : "NO",
  ];
  for (const [scheme, s] of schemes) {
    rows.push(row(scheme, "exact", s.correctness, s));
    rows.push(row(scheme, "builtin", s.builtinSmooth, null));
  }
  for (const line of table(rows)) log(`  ${line}`);
  for (const [scheme, s] of schemes) {
    for (const [smooth, c] of [["exact", s.correctness], ["builtin", s.builtinSmooth]]) {
      const differing = Object.entries(c.fields).filter(([, n]) => n > 0);
      log(`  ${scheme} ${smooth}: words differing ${differing.length === 0 ? "none" : differing.map(([name, n]) => `${name} ${n} px`).join(", ")}`);
    }
    for (const x of s.correctness.mismatches.slice(0, 4)) {
      const fields = Object.keys(x.gpu);
      log(`  ${scheme} (exact) state differs at (${x.col}, ${x.row}) in ${x.fields.join(", ")}: ${fields.map((f) => `${f} gpu ${word(f, x.gpu[f])} model ${word(f, x.model[f])}`).join("; ")}`);
    }
    for (const x of s.correctness.frac_only) {
      log(`  ${scheme} (exact) frac only at (${x.col}, ${x.row}): n ${x.gpu.n}, gpu ${word("frac", x.gpu.frac)}, model ${word("frac", x.model.frac)}`);
    }
  }
  log(`timing (medians of ${schemes[0][1].configs[0]?.repeats ?? "-"} runs; steps/s: the model's steps over the GPU time; max ms and ns/step full: the worst run):`);
  const t = [["scheme", "smooth", "wg", "budget", "compact", "passes", "gpu ms", "min-max", "steps/s", "mean ms", "max ms", "full passes", "ns/step full", "budget@1080p"]];
  for (const [scheme, s] of schemes) {
    for (const c of s.configs) {
      t.push([
        scheme,
        c.smooth,
        `${c.workgroup}`,
        `${c.budget}`,
        c.compact ? `every ${COMPACT_EVERY}` : "no",
        `${c.dispatches}${c.finished ? "" : " (cut)"}`,
        fixed(c.gpuMs, 1),
        `${fixed(c.gpuMsMin, 1)}-${fixed(c.gpuMsMax, 1)}`,
        sci(c.stepsPerSecond),
        fixed(c.meanMs, 3),
        fixed(c.maxMs, 3),
        `${c.fullPasses}`,
        c.nsFull === null ? "-" : c.nsFull.toFixed(4),
        c.budget1080p === null ? "-" : `${c.budget1080p}`,
      ]);
    }
    if (s.skipped.length > 0) log(`  ${scheme} skipped: ${s.skipped.join(", ")}`);
  }
  for (const line of table(t)) log(`  ${line}`);
}

/**
 * Across every frame: the smallest safe 1080p budget per scheme, and what spoils the timing.
 * A frame's cost is read at the largest budget that had all-running passes, from the
 * builtin runs only (the exact smooth fraction is a correctness mode), because a small
 * budget's passes carry a fixed cost per dispatch that is not a cost per step.
 */
function printSummary(log, report) {
  log("");
  log("== kernel summary ==");
  for (const scheme of ["f32", "ds"]) {
    const seen = [];
    for (const frame of report.frames) {
      const timed = (frame.schemes?.[scheme]?.configs ?? []).filter((c) => c.smooth === "builtin" && c.nsFull !== null);
      if (timed.length === 0) continue;
      const top = Math.max(...timed.map((c) => c.budget));
      const worst = timed.filter((c) => c.budget === top).sort((a, b) => b.nsFull - a.nsFull)[0];
      seen.push({ frame: frame.id, c: worst });
      log(`${scheme} ${frame.id}: ${worst.nsFull.toFixed(4)} ns/step at budget ${top} (wg ${worst.workgroup}${worst.compact ? ", compacted" : ""}), budget@1080p ${worst.budget1080p}`);
    }
    if (seen.length === 0) continue;
    seen.sort((a, b) => a.c.budget1080p - b.c.budget1080p);
    log(`${scheme}: budget@1080p at most ${seen[0].c.budget1080p}, set by ${seen[0].frame}`);
  }
  if (report.quantized) {
    log("WARNING: the timestamps came back in 100 us steps, so short passes are mistimed; start Chrome with --disable-dawn-features=timestamp_quantization (gpu-probe.mjs does)");
  }
}

// --- Run -----------------------------------------------------------------------------------

async function main() {
  let gpu = null;
  try {
    gpu = await adapterReport();
  } catch (error) {
    result.errors.push(String(error));
    log(`adapter: threw ${error}`);
  }
  if (gpu !== null) {
    if (query.get("selftest") !== "0") {
      try {
        await selfTest(gpu);
      } catch (error) {
        result.errors.push(String(error));
        log(`self-test: threw ${error}`);
      }
    }
    try {
      result.kernel = await runKernel(gpu, log, result.selftest);
    } catch (error) {
      result.errors.push(String(error));
      log(`kernel: threw ${error}`);
    }
  }
  log("");
  log("== done ==");
}

document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(out.textContent);
    document.getElementById("copied").textContent = "copied";
  } catch {
    // No clipboard permission (a file:// page, an old browser): select the text instead
    // so a Ctrl+C takes it.
    const range = document.createRange();
    range.selectNodeContents(out);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.getElementById("copied").textContent = "selected; press Ctrl+C";
  }
});

main().finally(() => finish(result));
