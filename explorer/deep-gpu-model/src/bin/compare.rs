//! `compare`: the model against `perturb`'s `f64` kernel, one JSON line per frame.
//!
//! `compare --help` prints the usage below, which is the whole of the command's contract.

use std::path::PathBuf;

use deep_gpu_model::Encoding;
use deep_gpu_model::bla::Search;
use deep_gpu_model::compare::{BlaMode, FrameSpec, LADDER, Options, compare_frame, emit};
use deep_gpu_model::frame::GatedPolicy;
use perturb::Anchor;

const USAGE: &str = "\
compare: the GPU model against perturb's f64 kernel, one JSON line per frame (and cap).

frames, one of:
  --corpus FILE            JSONL rows {id, re, im, w, n, degree, julia_re, julia_im,
                           anchor, period, link}; coordinates as decimal strings
    [--ids a,b,..]         only these ids
    [--skip N] [--take N]  a slice of the rows, after --ids
  --re X --im Y --w W      one frame on the command line
    [--n CAP] [--deg D] [--jre A --jim B] [--anchor origin] [--period P] [--id NAME]

what runs:
  --res WxH                samples (default 160x90), one per pixel
  --cap N                  replace every frame's cap (1e6 style accepted)
  --caps N,N,..            a cap ladder: each frame once per cap, one line each, and a
                           dump's names carry the cap (<id>_n<cap>.*)
  --cap-max N              lower each frame's own cap to at most N
  --encoding E[,E..]       the model schemes to run (default both):
                             f32pair    the f32 kernel on the F32Pair orbit
                             hilo       the f32 kernel on the HiLo orbit
                             both       f32pair and hilo
                             ds         the double-single kernel on the HiLo orbit
                             survivors  F32Pair until a sample stops or reaches a
                                        threshold, then HiLo double-single from the start
                                        for what is still running, once per --survive-at
                             all        f32pair, hilo, ds and survivors
                           all on one f64 pass, each keyed by its name (survivors@N)
  --survive-at N[,N..]     the survivors' thresholds, each its own scheme keyed
                           survivors@N (default 1000)
  --interior on|off        perturb's interior switch, on both kernels (default on). The
                           models' is a gate and a proof (src/proof.rs), as perturb's is
  --interior-policy P      what a model does with a sample the gate fired on and the
                           proof never closed (default cap):
                             cap      run on; at the cap it is capped (interior), as
                                      perturb paints it
                             flag     run on; at the cap it is handed back gated
                             handoff  handed back gated as soon as the proof gives up
                           a gated sample is settled as the CPU would settle it: it takes
                           perturb's value before agreement is measured
  --bla off|on|both        the model's skip table; both runs each encoding twice, the
                           second keyed <encoding>+bla (the f64 kernel never has one)
  --eps E                  skip tolerance (default 2^-24)
  --min-level K --max-level K   stored table levels (default 4 and 24)
  --search S[,S]           the lookup's level order: bottom-up (default) or hint (from
                           the pixel's last skip level). Both runs the skip once per
                           order, the first keyed <encoding>+bla, the second
                           <encoding>+bla:<order>; both find the same runs
                           (field_hash) and read different entries
  --gate off|on|both       the lookup's gate: no read where even the level's largest
                           radius (in the table header) refuses the pixel. both runs
                           every order twice, the second keyed ...+gate; the same
                           runs, fewer reads (default off)
  --ds off|on              adds ds to the schemes (the skip on top keys it ds+bla, under
                           --bla on or both, with --ds-eps its tolerance)
  --ds-eps E               the double-single kernel's skip tolerance (default 2^-48)
  --survivors T[,T..]      adds survivors at these thresholds (as --survive-at);
                           survivors@T (and survivors@T+bla) add threshold, redone
                           (samples re-run), survivor_share (redone over samples), and
                           mean f32_steps and ds_steps per pixel (with max_ds_steps)
  --budget N               model steps per pass (default unbounded)
  --threads N              worker threads (default: all)

floors (f64 against f64):
  --floor off|on|rounded|moved|both
                           rounded (= on): perturb on the reference rounded to f32, keyed
                           floor. moved: perturb on a second reference, keyed
                           floor_moved: the view centre moved by --move samples, or on a
                           Julia plane the other anchor. both: the two.
  --move DX,DY             the moved reference's offset in samples (default 1.5,1.0)

output:
  --out FILE               append lines here (default stdout)
  --dump DIR               per-sample fields, little-endian, NaN interior:
                           <base>.f64.bin, .f64rounded.bin, .f64moved.bin,
                           .<encoding>[_bla].bin (f64 n+frac) and .f32.bin,
                           .ds[_bla].bin and .survivors@N[_bla].bin (f64 n+frac),
                           <base>.iter.bin (perturb's counts, u32), and
                           <base>.meta.json (id, link, resolution, cap, interior policy,
                           and fields, the names of every .bin above it wrote)

Each agreement object (floor, floor_moved, each model) has p50/p90/p99/max of
|delta smooth| over samples both escape at, shares over 0.01/0.1/1/10, `ladder` (shares
over each of LADDER, below), `by_iter` (per decade of perturb's count: both_escaped,
over_0.1, over_1, max, class_changes), and the class-change counts. Each model also
reports its classes (escaped, capped, proven interior, gated: handed back and settled
by perturb, unproven: the gate fired and no proof closed), delta steps per pixel
(mean_steps, p50, p99, max), skips, entries read (mean, p99, max), lookups that read
(probes), a field_hash of its samples, and wall time (wall_s).
";

fn main() {
    if let Err(e) = run() {
        eprintln!("compare: {e}\n(compare --help for usage)");
        std::process::exit(1);
    }
}

/// A count written either as an integer or in `1e6` style.
fn count(k: &str, v: &str) -> Result<u32, String> {
    let x: f64 = v
        .parse()
        .map_err(|_| format!("--{k}: {v} is not a number"))?;
    if !(x >= 1.0 && x <= u32::MAX as f64 && x.fract() == 0.0) {
        return Err(format!("--{k}: {v} is not a whole number in range"));
    }
    Ok(x as u32)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        let ladder: Vec<String> = LADDER.iter().map(|t| t.to_string()).collect();
        println!("{USAGE}LADDER = [{}]", ladder.join(", "));
        return Ok(());
    }
    let mut flags = std::collections::HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let key = args[i]
            .strip_prefix("--")
            .ok_or_else(|| format!("unexpected argument {}", args[i]))?;
        let value = args
            .get(i + 1)
            .ok_or_else(|| format!("--{key} needs a value"))?;
        flags.insert(key.to_string(), value.clone());
        i += 2;
    }
    let get = |k: &str| flags.get(k).cloned();
    let parse_u32 =
        |k: &str| -> Result<Option<u32>, String> { get(k).map(|v| count(k, &v)).transpose() };

    let mut opts = Options::default();
    if let Some(res) = get("res") {
        let (a, b) = res.split_once('x').ok_or("--res is WxH")?;
        opts.resolution = [
            a.parse().map_err(|_| "--res width")?,
            b.parse().map_err(|_| "--res height")?,
        ];
    }
    opts.cap = parse_u32("cap")?;
    opts.cap_max = parse_u32("cap-max")?;
    let caps: Vec<Option<u32>> = match get("caps") {
        None => vec![opts.cap],
        Some(list) => {
            opts.cap_in_name = true;
            list.split(',')
                .map(|c| count("caps", c.trim()).map(Some))
                .collect::<Result<_, _>>()?
        }
    };
    if let Some(t) = parse_u32("threads")? {
        opts.threads = t as usize;
    }
    if let Some(b) = parse_u32("budget")? {
        opts.budget = b.max(1);
    }
    // The survivors' thresholds, wherever the scheme is asked for.
    let thresholds = |list: &str, k: &str| -> Result<Vec<u32>, String> {
        list.split(',')
            .map(|t| {
                let t = t.trim();
                if t == "0" { Ok(0) } else { count(k, t) }
            })
            .collect()
    };
    let survive_at = match get("survive-at") {
        Some(list) => thresholds(&list, "survive-at")?,
        None => vec![1000],
    };
    let mut survivors = false;
    if let Some(e) = get("encoding") {
        opts.encodings = Vec::new();
        for name in e.split(',').map(str::trim) {
            let mut add = |enc: Encoding| {
                if !opts.encodings.contains(&enc) {
                    opts.encodings.push(enc);
                }
            };
            match name {
                "both" => {
                    add(Encoding::F32Pair);
                    add(Encoding::HiLo);
                }
                "all" => {
                    add(Encoding::F32Pair);
                    add(Encoding::HiLo);
                    opts.ds = true;
                    survivors = true;
                }
                "ds" => opts.ds = true,
                "survivors" => survivors = true,
                other => add(Encoding::parse(other).ok_or(
                    "--encoding is f32pair, hilo, both, ds, survivors or all, or a list of them",
                )?),
            }
        }
    }
    // Without the scheme, --survive-at is read and unused, so one command line can serve
    // several --encoding values.
    if survivors {
        opts.survivors = survive_at;
    }
    if let Some(p) = get("interior-policy") {
        opts.interior_policy =
            GatedPolicy::parse(&p).ok_or("--interior-policy is cap, flag or handoff")?;
    }
    if let Some(v) = get("interior") {
        opts.interior = match v.as_str() {
            "on" => true,
            "off" => false,
            _ => return Err("--interior is on or off".into()),
        };
    }
    opts.dump = get("dump").map(PathBuf::from);
    (opts.floor, opts.floor_moved) = match get("floor").as_deref() {
        None | Some("off") => (false, false),
        Some("on" | "rounded") => (true, false),
        Some("moved") => (false, true),
        Some("both") => (true, true),
        _ => return Err("--floor is off, on, rounded, moved or both".into()),
    };
    if let Some(m) = get("move") {
        let (a, b) = m.split_once(',').ok_or("--move is DX,DY")?;
        opts.move_px = [
            a.trim().parse().map_err(|_| "--move DX")?,
            b.trim().parse().map_err(|_| "--move DY")?,
        ];
    }
    opts.bla = match get("bla").as_deref() {
        None | Some("off") => BlaMode::Off,
        Some("on") => BlaMode::On,
        Some("both") => BlaMode::Both,
        _ => return Err("--bla is on, off or both".into()),
    };
    if let Some(e) = get("eps") {
        let eps: f64 = e.parse().map_err(|_| "--eps is a number")?;
        if !(eps > 0.0 && eps < 0.25) {
            return Err("--eps is in (0, 0.25)".into());
        }
        opts.bla_options.epsilon = eps;
    }
    if let Some(k) = parse_u32("min-level")? {
        opts.bla_options.min_level = k;
    }
    if let Some(k) = parse_u32("max-level")? {
        opts.bla_options.max_level = k;
    }
    if let Some(v) = get("search") {
        let mut orders = Vec::new();
        for name in v.split(',') {
            orders
                .push(Search::parse(name.trim()).ok_or("--search is bottom-up or hint, or both")?);
        }
        opts.bla_options.search = orders[0];
        opts.extra_searches = orders[1..].to_vec();
    }
    (opts.bla_options.gate, opts.flip_gate) = match get("gate").as_deref() {
        None | Some("off") => (false, false),
        Some("on") => (true, false),
        Some("both") => (false, true),
        _ => return Err("--gate is off, on or both".into()),
    };
    match get("ds").as_deref() {
        None | Some("off") => {}
        Some("on") => opts.ds = true,
        _ => return Err("--ds is on or off".into()),
    }
    if let Some(e) = get("ds-eps") {
        let eps: f64 = e.parse().map_err(|_| "--ds-eps is a number")?;
        if !(eps > 0.0 && eps < 0.25) {
            return Err("--ds-eps is in (0, 0.25)".into());
        }
        opts.ds_eps = eps;
    }
    if let Some(list) = get("survivors") {
        for t in thresholds(&list, "survivors")? {
            if !opts.survivors.contains(&t) {
                opts.survivors.push(t);
            }
        }
    }
    let out = get("out").map(PathBuf::from);

    let frames: Vec<FrameSpec> = if let Some(path) = get("corpus") {
        let text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
        let mut rows = Vec::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            rows.push(FrameSpec::from_row(line)?);
        }
        if let Some(ids) = get("ids") {
            let wanted: Vec<&str> = ids.split(',').collect();
            rows.retain(|r| wanted.contains(&r.id.as_str()));
        }
        let skip = get("skip")
            .map(|v| v.parse::<usize>().map_err(|_| "--skip is a count"))
            .transpose()?
            .unwrap_or(0);
        let take = get("take")
            .map(|v| v.parse::<usize>().map_err(|_| "--take is a count"))
            .transpose()?
            .unwrap_or(usize::MAX);
        rows.into_iter().skip(skip).take(take).collect()
    } else {
        let re = get("re").ok_or("--re or --corpus is required")?;
        let im = get("im").ok_or("--im is required")?;
        let w: f64 = get("w")
            .ok_or("--w is required")?
            .parse()
            .map_err(|_| "--w is a number")?;
        let julia = match (get("jre"), get("jim")) {
            (Some(a), Some(b)) => Some((a, b)),
            (None, None) => None,
            _ => return Err("--jre and --jim come together".into()),
        };
        vec![FrameSpec {
            id: get("id").unwrap_or_else(|| "cli".into()),
            re,
            im,
            w,
            n: parse_u32("n")?,
            degree: parse_u32("deg")?.unwrap_or(2),
            julia,
            anchor: if get("anchor").as_deref() == Some("origin") {
                Anchor::Origin
            } else {
                Anchor::Parameter
            },
            period: parse_u32("period")?,
            link: None,
        }]
    };

    for frame in &frames {
        for &cap in &caps {
            let run = Options {
                cap,
                ..opts.clone()
            };
            match compare_frame(frame, &run) {
                Ok(line) => emit(&line, out.as_deref()).map_err(|e| e.to_string())?,
                Err(e) => eprintln!("compare: skipped {e}"),
            }
        }
    }
    Ok(())
}
