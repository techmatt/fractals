"""The deep gallery pack: deep views picked by hand, rendered at full size and zipped.

    python -m builder.deep_pack members            write the member record from the picks
    python -m builder.deep_pack probe              time every member small, estimate the run
    python -m builder.deep_pack render [--ss N]    the full-size JPEGs, resuming
    python -m builder.deep_pack previews           the packs page's five tiles and their pick

*(deep_pack_ckpt157.)* Deep pictures never enter the wallpaper pipeline next door, so this
pack is made entirely on this side. **The members** are Matt's fifteen hand-picked deep
links (`PICKS`, frozen here as he gave them) and the fifteen panels of `deep-random-dives`
(read off `article/figure-recipes.jsonl`, where the figure keeps its links), in that order,
with a view dropped where an earlier member is the same view up to link spelling: every
link is read to the Deep tab's canonical form (`deep-link.js`'s `canonicalize`), and two
members are one view when their canonical links are equal. The record is
`builder/data/deep-pack.jsonl`, one row a member, so a recipe is never lost.

**A picture is its link drawn at the full set's regime**: 2560 by 1440, 4:4:4 JPEG at
quality 95 (next door's `curation/full_set.py`'s `QUALITY` and `CHROMA`), supersampled 3
by 3 a pixel. The field is the native perturbation path (`deep_gallery._native`, the
`perturb` crate as an rlib) at the link's own pinned cap; the colour is
`deep_gallery_shade.mjs`, the tab's own shading through the committed `engine.wasm`; and
the link goes into the file through `deep_pack_stamp.mjs`, which is `explorer/stamp.js`,
so a pack picture dropped on the explorer reopens its view the way a full-set one does.
Everything drawn lands under ignored `artifacts/deep-pack/`.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qsl

from . import deep_gallery, images
from .dive_candidates import below_normal
from .paths import GALLERY_IMAGES_DIR, SITE_ROOT, relative_href

HERE = Path(__file__).resolve().parent
RECORD = HERE / "data" / "deep-pack.jsonl"
STAMP = HERE / "deep_pack_stamp.mjs"
RECIPES = SITE_ROOT / "article" / "figure-recipes.jsonl"
NAMES = SITE_ROOT / "explorer" / "palette-names.json"
WORK = SITE_ROOT / "artifacts" / "deep-pack"

#: The pack's name, as the page and the zip spell it, and the zip's file name, which
#: follows next door's `curation/packs.py` (`fractal-wallpapers-<pack>.zip`).
NAME = "deep-gallery"
ZIP = f"fractal-wallpapers-{NAME}.zip"

#: The packs page's five previews: tracked tiles at the Deep gallery's own size.
TILES = GALLERY_IMAGES_DIR / NAME
PREVIEWS = 5
SEED = 157
#: The twelve hue families, 30 degrees each and centred on their names, as the colour
#: packs are named.
FAMILIES = (
    "red",
    "orange",
    "yellow",
    "lime",
    "green",
    "teal",
    "cyan",
    "azure",
    "blue",
    "purple",
    "magenta",
    "rose",
)
#: A picture is multi-coloured at this hue spread, and the previews want this many.
MULTI = 0.5
MULTI_WANTED = 2
#: How many families apart a single-hued preview is from every family already taken.
APART = 2

#: The figure whose panels join Matt's picks, and its panel count.
FIGURE = "deep-random-dives"

#: The full set's regime.
RESOLUTION = (2560, 1440)
SUPERSAMPLE = 3
QUALITY = 95

#: The probe's grid, and how long a run may be before it drops to 2x2 samples a pixel.
PROBE = (480, 270)
BUDGET_HOURS = 6.0

#: A degree said as a word: next door's `curation/packs.py` `DEGREE_WORD`.
DEGREE_WORD = {3: "Cubic", 4: "Quartic", 5: "Quintic", 6: "Sextic"}

#: Matt's picks, exactly as he gave them (deep_pack_ckpt157), in his order.
PICKS = (
    "?dv=3&x=-0.74937053247003823168823992075369&y=0.041472667068168900034718746387049&w=3.4869054402668363e-15&n=63534&p=glowdon&scale=absolute&lambda=0&period=0.794&panel=deep",
    "?dv=3&x=-0.74937053247003823168823992075369&y=0.041472667068168900034718746387049&w=1.3947621761067345e-14&n=61134&p=Porcelain%20Field&phase=0.41&scale=absolute&lambda=0&period=0.295&panel=deep",
    "?dv=3&x=-0.7493705324700378557700614606921816&y=0.0414726670681690448763936935919414&w=2.2944996147726803e-17&n=66636&p=Coalglow&phase=0.617&scale=absolute&lambda=0.04&period=0.596&panel=deep",
    "?dv=3&cx=-0.77552241446268734437207&cy=-0.12995613474704090823188&x=-0.775522414462686291736175223972636&y=-0.12995613474704156048830064524403&w=1.0476272026932324e-13&n=1012170&p=carried-away-25&phase=0.3323&scale=absolute&lambda=0&period=0.295&panel=deep",
    "?dv=3&f=julia3&cx=0.15900762390528316041934&cy=1.08826091712682204649985&x=0.1590076239053360302256466115021&y=1.088260917126819240286910894453632&w=4.587102537913604e-14&n=1239788&p=scattering-25&phase=0.3034&scale=absolute&period=3550&panel=deep",
    "?dv=3&f=julia5&cx=0.66616831546320803226979394142613758&cy=0.782735297907992585741603133271278035&x=0.000086251923016585676&y=-0.0000281573646113747857&w=0.007250744942350984&n=1765050&p=dolphin-dance-25&phase=0.9468&scale=absolute&lambda=0&period=0.355&panel=deep",
    "?dv=3&f=multibrot6&x=0.49658334569439628088727026928269&y=0.6263473553589279955374786658973&w=3.630112798928236e-14&n=1365408&p=Reds&phase=0.617&mirror=1&scale=absolute&lambda=0&period=0.417&panel=deep",
    "?dv=3&f=multibrot4&x=0.5083915086801963955211&y=0.6503769802361925397409&w=3.8475073426030776e-14&n=1620000&p=BuGn&phase=0.976&mirror=1&scale=absolute&lambda=0&period=0.2008&panel=deep",
    "?dv=3&x=-1.10685140381517066062&y=0.23106546802664082708&w=6.678403934578866e-8&n=34505&p=wallhaven_wallhaven-6d3zz6&phase=0.337&scale=absolute&period=211&panel=deep",
    "?dv=3&x=-0.748738954044648030223533819&y=-0.125038735681201010900414782&w=1.1296319426470532e-19&n=1568108&p=triangulate-25&phase=0.102&scale=absolute&lambda=0&period=0.2005&panel=deep",
    "?dv=3&x=-0.74590862254855533521191&y=-0.14811768531250161124827&w=2.6167690366217524e-15&n=1889893&p=Mint%20Field%2C%20Teal%20Well&phase=0.182&scale=absolute&lambda=0&period=0.124&panel=deep",
    "?dv=3&f=multibrot3&x=0.0641145761441101961&y=0.7769957306215741154&w=1.2474539426486646e-11&n=1761466&p=fractal_flowers_abstract_104352_2560x1600&phase=0.738&scale=absolute&lambda=0&period=0.487",
    "?dv=3&f=multibrot3&x=-0.1637047697428726804755&y=1.0952901706357020484359&w=7.736925337898443e-14&n=915800&p=glowdon&phase=0.024&scale=absolute&lambda=0&period=0.503",
    "?dv=3&f=multibrot4&x=0.319026241595811702271&y=0.749325185668184107409&w=1.6910500082259544e-13&n=1368217&p=wallhaven_wallhaven-45pqz1&phase=0.4479&scale=absolute&lambda=0&period=0.1998",
    "?dv=3&x=-0.74835176640344627&y=0.10730040483934741&w=6.323600707000755e-10&n=723180&p=visionary-spires-25&phase=0.0019&scale=absolute&lambda=0.3&period=4.991",
)


class DeepPackError(RuntimeError):
    """The pack's members or pictures cannot be made as this module describes them."""


# ------------------------------------------------------------------------------ members


def figure_links() -> list[str]:
    """`deep-random-dives`' panels' links, in panel order, off the recipe store."""
    found: dict[int, str] = {}
    for line in RECIPES.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        figure, _, panel = str(row.get("key", "")).partition("#")
        if row.get("kind") == "deep" and figure == FIGURE:
            found[int(panel)] = row["recipe"]["link"]
    if sorted(found) != list(range(1, len(found) + 1)) or not found:
        raise DeepPackError(f"{FIGURE}'s recipes are not panels 1..n: {sorted(found)}")
    return [found[n] for n in sorted(found)]


def plane_name(link: str) -> str:
    """The fractal as next door's pack file names say it: Mandelbrot, Cubic Julia, ..."""
    frame = deep_gallery.frame_of(link)
    julia = frame.get("jre") is not None
    degree = frame["deg"]
    if degree == 2:
        return "Julia" if julia else "Mandelbrot"
    if degree not in DEGREE_WORD:
        raise DeepPackError(f"no name for degree {degree}")
    return f"{DEGREE_WORD[degree]} {'Julia' if julia else 'Multibrot'}"


def palette_of(link: str) -> str:
    return dict(parse_qsl(link, keep_blank_values=True))["p"]


def derive_members() -> tuple[list[dict], list[dict]]:
    """The members in pack order, and the views dropped as an earlier member's."""
    asked = [(f"matt#{n}", link.lstrip("?")) for n, link in enumerate(PICKS, 1)]
    asked += [(f"{FIGURE}#{n}", link) for n, link in enumerate(figure_links(), 1)]
    canonical = deep_gallery._shade([{"id": at, "query": link} for at, link in asked])
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    members: list[dict] = []
    dropped: list[dict] = []
    held: dict[str, str] = {}
    for at, link in asked:
        link = canonical[at]
        if link in held:
            dropped.append({"from": at, "same_as": held[link]})
            continue
        held[link] = at
        palette = palette_of(link)
        members.append(
            {
                "id": deep_gallery.fnv(link),
                "from": at,
                "link": link,
                "palette": names.get(palette, {}).get("name", palette),
                "plane": plane_name(link),
            }
        )
    width = len(str(len(members)))
    for rank, member in enumerate(members, 1):
        member["rank"] = rank
        member["file"] = f"{rank:0{width}d} {member['palette']} {member['plane']}.jpg"
    return members, dropped


def write_members() -> list[str]:
    members, dropped = derive_members()
    # The header keeps what later stages wrote into it: the previews, and the zip.
    held = header() if RECORD.is_file() else {}
    rows = [{**held, "schema": 1, "kind": "deep-pack", "name": NAME, "dropped": dropped}]
    rows += [
        {"schema": 1, "kind": "member", **{k: m[k] for k in ("rank", "id", "from", "file", "link")}}
        for m in members
    ]
    body = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"
    RECORD.write_text(body, encoding="utf-8", newline="\n")
    said = [f"{len(members)} members, {len(dropped)} dropped"]
    said += [f"  {d['from']} is {d['same_as']}" for d in dropped]
    return said


def members() -> list[dict]:
    """The member rows of the committed record, in rank order."""
    rows = [json.loads(line) for line in RECORD.read_text(encoding="utf-8").splitlines() if line]
    return [row for row in rows if row["kind"] == "member"]


# ------------------------------------------------------------------------------ drawing


def _field(member: dict, size: tuple[int, int], ss: int, out: Path) -> dict:
    frame = deep_gallery.frame_of(member["link"])
    return deep_gallery._native(
        "field",
        res=f"{size[0]}x{size[1]}",
        ss=ss,
        cap=frame["cap"],
        out=out,
        **deep_gallery._frame_args(frame),
    )


def _shade(member: dict, field: Path, size: tuple[int, int], ss: int, out: Path) -> None:
    job = {
        "id": member["id"],
        "query": member["link"],
        "field": str(field),
        "width": size[0],
        "height": size[1],
        "ss": ss,
        "out": str(out),
    }
    if deep_gallery._shade([job])[member["id"]] != member["link"]:
        raise DeepPackError(f"{member['from']}: its link is not canonical")


def probe() -> list[str]:
    """Each member at `PROBE` 1x1, and the full run's cost scaled from it."""
    (WORK / "probe").mkdir(parents=True, exist_ok=True)
    ratio = (RESOLUTION[0] * RESOLUTION[1]) / (PROBE[0] * PROBE[1])
    total = 0.0
    said = []
    for member in members():
        drawn = _field(member, PROBE, 1, WORK / "probe" / f"{member['id']}.f64")
        total += drawn["seconds"]
        said.append(
            f"{member['rank']:2d} {member['from']:<22} {drawn['seconds']:7.2f} s  "
            f"interior {drawn['interior']:.3f}  cap {drawn['maxiter']:,}"
        )
    for ss in (3, 2):
        said.append(f"estimate at ss{ss}: {total * ratio * ss * ss / 3600:.2f} h")
    return said


def render(ss: int) -> list[str]:
    """Every member's full-size JPEG not yet on disk, stamped with its link."""
    from PIL import Image

    out = WORK / f"full-ss{ss}"
    (WORK / "fields").mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    log = out / "log.jsonl"
    said = []
    for member in members():
        target = out / f"{member['id']}.jpg"
        if target.is_file():
            continue
        started = time.monotonic()
        field = WORK / "fields" / f"{member['id']}.f64"
        raw = WORK / "fields" / f"{member['id']}.rgba"
        drawn = _field(member, RESOLUTION, ss, field)
        _shade(member, field, RESOLUTION, ss, raw)
        image = Image.frombytes("RGBA", RESOLUTION, raw.read_bytes()).convert("RGB")
        writing = target.with_name(target.name + ".writing")
        image.save(writing, format="JPEG", quality=QUALITY, subsampling=0)
        _stamp([{"path": str(writing), "query": member["link"]}])
        writing.replace(target)
        field.unlink()
        raw.unlink()
        entry = {
            "rank": member["rank"],
            "id": member["id"],
            "field_seconds": drawn["seconds"],
            "seconds": round(time.monotonic() - started, 1),
            "interior": drawn["interior"],
            "bytes": target.stat().st_size,
        }
        with log.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(entry) + "\n")
        line = f"{member['rank']:2d} {member['file']}: {entry['seconds']} s, {entry['bytes']:,} B"
        print(line, flush=True)
        said.append(line)
    return said


# ----------------------------------------------------------------------------- previews


def hue_of(path: Path) -> dict:
    """A picture's colour as a reader would sort it: its dominant hue family and its spread.

    Hue is weighted by saturation times value, so black and gray count for nothing. `spread`
    is one minus the weighted hues' mean resultant length: near 0 for one hue, towards 1 for
    many. A picture is multi-coloured at `MULTI` or over.
    """
    import numpy as np
    from PIL import Image

    hsv = np.asarray(Image.open(path).convert("RGB").convert("HSV"), dtype=np.float64) / 255.0
    angle = hsv[..., 0] * 2 * np.pi
    weight = hsv[..., 1] * hsv[..., 2]
    total = weight.sum()
    resultant = np.hypot((weight * np.cos(angle)).sum(), (weight * np.sin(angle)).sum()) / total
    families = np.floor(((hsv[..., 0] * 360 + 15) % 360) / 30).astype(int)
    shares = np.bincount(families.ravel(), weights=weight.ravel(), minlength=12) / total
    return {
        "family": FAMILIES[int(shares.argmax())],
        "spread": round(float(1 - resultant), 3),
        "shares": {FAMILIES[i]: round(float(s), 3) for i, s in enumerate(shares) if s >= 0.05},
    }


def choose(pool: list[dict], seed: int) -> list[str]:
    """Five previews: a seeded shuffle, the first `MULTI_WANTED` multi-coloured pictures in
    it, then single-hued ones whose dominant family no pick has and is `APART` families or
    more from every single-hued pick's, so that rose and magenta are not both a hue's pick."""
    order = list(pool)
    random.Random(seed).shuffle(order)
    multi = [one for one in order if one["spread"] >= MULTI][:MULTI_WANTED]
    taken = list(multi)
    families = {one["family"] for one in taken}
    single: set[str] = set()
    for one in order:
        if len(taken) == PREVIEWS:
            break
        if one in taken or one["spread"] >= MULTI or one["family"] in families:
            continue
        if any(_apart(one["family"], family) < APART for family in single):
            continue
        taken.append(one)
        families.add(one["family"])
        single.add(one["family"])
    if len(taken) < PREVIEWS:
        raise DeepPackError(f"only {len(taken)} previews spread across hues out of {len(pool)}")
    ids = {one["id"] for one in taken}
    return [one["id"] for one in order if one["id"] in ids]


def _apart(one: str, other: str) -> int:
    """How many families apart two hue families are, the short way round the wheel."""
    step = abs(FAMILIES.index(one) - FAMILIES.index(other))
    return min(step, len(FAMILIES) - step)


def previews(seed: int = SEED) -> list[str]:
    """Tiles of every member, their hues, and the five picks.

    The pool is every member. The packs page's other previews are seats shown nowhere else on
    the site, and that rule cannot reach this pack: 27 of its 28 members are already a Deep
    zoom figure's panel or a Deep gallery tile (deep_pack_ckpt157), which is what they are.
    """
    rows = [json.loads(line) for line in RECORD.read_text(encoding="utf-8").splitlines() if line]
    header, listed = rows[0], [row for row in rows if row["kind"] == "member"]
    work = WORK / "tiles"
    (WORK / "fields").mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    size = (deep_gallery.THUMB["width"], deep_gallery.THUMB["height"])
    ss = deep_gallery.THUMB["supersample"]
    pool = []
    for member in listed:
        png = work / f"{member['id']}.png"
        if not png.is_file():
            field = WORK / "fields" / f"tile_{member['id']}.f64"
            raw = WORK / "fields" / f"tile_{member['id']}.rgba"
            _field(member, size, ss, field)
            _shade(member, field, size, ss, raw)
            images.write_rgba(raw.read_bytes(), size, png)
            field.unlink()
            raw.unlink()
        pool.append({"id": member["id"], "from": member["from"], **hue_of(png)})
    picks = choose(pool, seed)
    TILES.mkdir(parents=True, exist_ok=True)
    for stale in TILES.glob("*.webp"):
        if stale.stem not in picks:
            stale.unlink()
    for key in picks:
        from PIL import Image

        with Image.open(work / f"{key}.png") as tile:
            raw = tile.convert("RGBA").tobytes()
        images.write_rgba(raw, size, TILES / f"{key}.webp", webp_quality=images.TILE_WEBP_QUALITY)
    header.update(
        seed=seed,
        rule=(
            f"every member, a seeded shuffle, the first "
            f"{MULTI_WANTED} with spread >= {MULTI}, then single-hued ones of a family no "
            f"pick has, {APART} or more families from every single-hued pick's"
        ),
        pool=pool,
        previews=picks,
    )
    header.setdefault("zip", {"file": ZIP, "bytes": None})
    _write([header, *listed])
    said = [f"pool {len(pool)}"]
    for one in pool:
        mark = "*" if one["id"] in picks else " "
        said.append(f" {mark} {one['from']:<10} {one['family']:<8} spread {one['spread']}")
    return said


def _write(rows: list[dict]) -> None:
    body = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"
    RECORD.write_text(body, encoding="utf-8", newline="\n")


# ------------------------------------------------------------------------ the pack record


def header() -> dict:
    return json.loads(RECORD.read_text(encoding="utf-8").splitlines()[0])


def row() -> dict:
    """The pack's row of `wallpaper-packs/packs.jsonl`, off this side's own record."""
    held = header()
    return {
        "schema": 1,
        "kind": "pack",
        "name": NAME,
        "source": "deep",
        "files": [
            {"file": held["zip"]["file"], "pictures": len(members()), "bytes": held["zip"]["bytes"]}
        ],
        "thumbs": list(held["previews"]),
    }


def problems() -> list[str]:
    """The record against itself and the tiles on disk; runs on a bare clone."""
    where = RECORD.relative_to(SITE_ROOT).as_posix()
    found = []
    listed = members()
    by_id = {one["id"]: one for one in listed}
    if len(by_id) != len(listed) or len({one["link"] for one in listed}) != len(listed):
        found.append(f"{where}: a member appears twice")
    for rank, one in enumerate(listed, 1):
        if one["rank"] != rank or deep_gallery.fnv(one["link"]) != one["id"]:
            found.append(f"{where}: member {one['from']} has the wrong rank or id")
    held = header()
    for key in held.get("previews", []):
        if key not in by_id:
            found.append(f"{where}: preview {key} is no member")
        elif not (TILES / f"{key}.webp").is_file():
            found.append(f"{where}: preview {key} has no tile on disk")
    on_disk = {path.stem for path in TILES.glob("*.webp")} if TILES.is_dir() else set()
    for stray in sorted(on_disk - set(held.get("previews", []))):
        found.append(f"{TILES.relative_to(SITE_ROOT).as_posix()}/{stray}.webp: no preview names it")
    return found


def tile_href(page: Path, key: str) -> str:
    return relative_href(page, TILES / f"{key}.webp")


def link_of(key: str) -> str:
    return next(one["link"] for one in members() if one["id"] == key)


def _stamp(jobs: list[dict]) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        path = Path(scratch) / "jobs.json"
        path.write_text(json.dumps(jobs), encoding="utf-8", newline="\n")
        done = subprocess.run(
            ["node", str(STAMP), str(path)], capture_output=True, text=True, cwd=str(SITE_ROOT)
        )
    if done.returncode != 0:
        raise DeepPackError(f"stamping failed:\n{done.stderr[-2000:]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m builder.deep_pack")
    parser.add_argument("stage", choices=("members", "probe", "render", "previews"))
    parser.add_argument("--ss", type=int, default=SUPERSAMPLE)
    options = parser.parse_args(argv)
    below_normal()
    if options.stage == "members":
        said = write_members()
    elif options.stage == "previews":
        said = previews()
    elif options.stage == "probe":
        said = probe()
    else:
        said = render(options.ss)
    print("\n".join(said))
    return 0


if __name__ == "__main__":
    sys.exit(main())
