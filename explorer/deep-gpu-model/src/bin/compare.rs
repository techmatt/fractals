//! `compare`: the model against `perturb`'s `f64` kernel, one JSON line per frame.
//!
//! ```text
//! compare --corpus FILE [--ids a,b,..] [--skip N] [--take N]
//! compare --re X --im Y --w W [--n CAP] [--deg D] [--jre A --jim B] [--anchor origin]
//!         [--period P] [--id NAME]
//! common: [--res WxH] [--cap N] [--cap-max N] [--encoding f32pair|hilo|both]
//!         [--interior on|off] [--threads N] [--budget N] [--dump DIR] [--out FILE]
//!         [--floor on|off]
//! ```
//!
//! `--floor on` also runs the `f64` kernel on the reference rounded to `f32`, and
//! reports how far that lands from the `f64` field: the part of the model's
//! disagreement that storing the reference in `f32` causes on its own.

use std::path::PathBuf;

use deep_gpu_model::Encoding;
use deep_gpu_model::compare::{FrameSpec, Options, compare_frame, emit};
use perturb::Anchor;

fn main() {
    if let Err(e) = run() {
        eprintln!("compare: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
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
    let parse_u32 = |k: &str| -> Result<Option<u32>, String> {
        get(k)
            .map(|v| v.parse::<u32>().map_err(|e| format!("--{k}: {e}")))
            .transpose()
    };

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
    if let Some(t) = parse_u32("threads")? {
        opts.threads = t as usize;
    }
    if let Some(b) = parse_u32("budget")? {
        opts.budget = b.max(1);
    }
    if let Some(e) = get("encoding") {
        opts.encodings = match e.as_str() {
            "both" => vec![Encoding::F32Pair, Encoding::HiLo],
            other => vec![Encoding::parse(other).ok_or("--encoding is f32pair, hilo or both")?],
        };
    }
    if let Some(v) = get("interior") {
        opts.interior = match v.as_str() {
            "on" => true,
            "off" => false,
            _ => return Err("--interior is on or off".into()),
        };
    }
    opts.dump = get("dump").map(PathBuf::from);
    opts.floor = match get("floor").as_deref() {
        None | Some("off") => false,
        Some("on") => true,
        _ => return Err("--floor is on or off".into()),
    };
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
        let skip = parse_u32("skip")?.unwrap_or(0) as usize;
        let take = parse_u32("take")?.map(|t| t as usize).unwrap_or(usize::MAX);
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
        }]
    };

    for frame in &frames {
        match compare_frame(frame, &opts) {
            Ok(line) => emit(&line, out.as_deref()).map_err(|e| e.to_string())?,
            Err(e) => eprintln!("compare: skipped {e}"),
        }
    }
    Ok(())
}
