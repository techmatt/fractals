"""Whether a file's embedded link is the contract's link, whichever repository wrote it.

Every full-size picture this project writes carries the explorer link that draws it again
*(embedded_links_ckpt145)*: a download from the explorer, stamped by `explorer/stamp.js`,
and a release render next door, stamped by `fractal-wallpapers`' `curation/embed_link.py`
with a link its `curation/explorer_link.py` spells. That last one is a second author of the
permalink contract, which `builder/emit.mjs` says in so many words should not exist — it
does because the release writer cannot ask node — and this is what keeps it honest.

Three halves:

* **base**, everywhere: `stamp.js`'s `EXPLORER_URL` is `pages.SITE_URL` with `explorer/`
  after it. The hosting choice is not made, and the day it is, the two move together.
* **links**, where the wallpapers checkout is configured: every seat of the general
  collection, its recipe, its recorded tone curve and its cap, spelled by `emit.mjs` and by
  `explorer_link.query_of`, and the two strings held equal byte for byte — and next door's
  own `EXPLORER_URL` held to this one's. A seat read through a curve its mode's catalog
  does not give it is the one case the two are *meant* to differ: `emit.mjs` never sees a
  curve and spells a link, `seats` calls it a gap, and `explorer_link` refuses — so there
  the refusal is what is held.
* **bytes**, the same condition: one PNG and one JPEG, drawn next door with Pillow,
  embedded by both writers with one link, and the two files held equal byte for byte — and
  each decoded, before and after, to the same pixels.

A thousand seats are read the way `builder/seats.py` reads them — the candidate ledger
streamed for the recipes and the run records for the stamps — and that is most of this
check's half-minute.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess

from . import links, picks, renders, seats
from .pages import SITE_URL
from .paths import SITE_ROOT

STAMP_JS = SITE_ROOT / "explorer" / "stamp.js"

#: The collection whose seats the links half spells both ways.
COLLECTION = "general"

#: What `EXPLORER_URL` is spelled as in `stamp.js`.
DECLARED = re.compile(r'^export const EXPLORER_URL = "([^"]+)";$', re.M)

#: The program next door: every seat's query as `explorer_link` spells it, its base, and a
#: PNG and a JPEG before and after `embed_link` — with each decoded both ways.
PROGRAM = """
import base64, io, json, sys

from PIL import Image

from fractal_wallpapers import engine
from fractal_wallpapers.curation import embed_link, explorer_link

ask = json.load(sys.stdin)
widths = sorted({row["recipe"]["viewport"]["width"] for row in ask["rows"].values()})
caps = dict(zip(widths, engine.maxiter_for(widths)))
spelled = {}
for key, row in ask["rows"].items():
    recipe = row["recipe"]
    query, why = explorer_link.query_of(
        family=recipe["family"],
        viewport=recipe["viewport"],
        maxiter=recipe.get("maxiter"),
        mode=recipe["mode"],
        mode_params=recipe.get("mode_params"),
        curve=recipe.get("curve"),
        colormap=recipe["colormap"],
        palette=recipe.get("palette"),
        level=row["level"],
        policy_cap=caps[recipe["viewport"]["width"]],
    )
    spelled[key] = {"query": query, "why": why}

picture = Image.new("RGB", (48, 27))
picture.putdata(
    [((x * 37) % 256, (y * 53) % 256, (x * y * 11) % 256) for y in range(27) for x in range(48)]
)
files = {}
for kind, options in (("png", {"format": "PNG"}), ("jpeg", {"format": "JPEG", "quality": 90})):
    held = io.BytesIO()
    picture.save(held, **options)
    raw = held.getvalue()
    embedded = embed_link.embed(raw, ask["query"])
    same = Image.open(io.BytesIO(raw)).convert("RGB").tobytes() == Image.open(
        io.BytesIO(embedded)
    ).convert("RGB").tobytes()
    files[kind] = {
        "raw": base64.b64encode(raw).decode(),
        "embedded": base64.b64encode(embedded).decode(),
        "same_pixels": same,
        "stripped_is_raw": embed_link.strip(embedded) == raw,
        "link_in": embed_link.link_in(embedded),
    }
print(json.dumps({"base": explorer_link.EXPLORER_URL, "spelled": spelled, "files": files}))
"""

#: The link both writers embed in the bytes half. A real one, as a seat spells it.
SAMPLE_QUERY = (
    "v=4&f=julia&cx=-1.2540170796954613&cy=-0.07161459637319667&m=tia"
    "&x=-0.336363658629224&y=-0.06271709146615745&w=0.5659066537374874"
    "&p=Oxblood%2C%20Cyan%2C%20Cream&phase=0.597858"
)

#: node, embedding each of the program's raw files through `stamp.js`.
EMBED_JS = """
import { embed } from "./explorer/stamp.js";
const ask = JSON.parse(await new Response(process.stdin).text());
const out = {};
for (const [kind, raw] of Object.entries(ask.files)) {
  const bytes = new Uint8Array(Buffer.from(raw, "base64"));
  out[kind] = Buffer.from(embed(bytes, ask.query)).toString("base64");
}
process.stdout.write(JSON.stringify(out));
"""


def declared_base() -> str | None:
    """The base `stamp.js` declares, or `None` where it declares none."""
    found = DECLARED.search(STAMP_JS.read_text(encoding="utf-8"))
    return None if found is None else found.group(1)


def expected_base() -> str:
    return f"{SITE_URL}explorer/"


def problems(*, with_checkout: bool) -> list[str]:
    """Every way the embedded link and its two writers disagree."""
    found: list[str] = []
    base = declared_base()
    if base is None:
        found.append("explorer/stamp.js declares no EXPLORER_URL")
    elif base != expected_base():
        found.append(
            f"explorer/stamp.js's EXPLORER_URL is {base} and pages.SITE_URL puts the explorer "
            f"at {expected_base()} — the base is one address, and both spellings move together"
        )
    if with_checkout:
        found += _next_door(base)
    return found


def _next_door(base: str | None) -> list[str]:
    stamp = dict(seats.COLLECTIONS)[COLLECTION]
    rows = seats.seat_rows(stamp)
    resolved = picks.resolve(f"{stamp}{picks.PICK_SEPARATOR}{row['key']}" for row in rows)
    stamps = seats.stamps_of(resolved)
    levels = {}
    for pick in resolved:
        toned = seats.tone(pick, stamps)
        levels[pick.key] = toned.curve if toned.way == seats.CURVED else None

    views = {}
    for pick in resolved:
        view = links.ledger_view(pick.recipe, level=levels[pick.key])
        view["cap"] = pick.recipe.get("maxiter")
        views[pick.key] = view
    emitted = links.emit(views)

    ask = {
        "rows": {pick.key: {"recipe": pick.recipe, "level": levels[pick.key]} for pick in resolved},
        "query": SAMPLE_QUERY,
    }
    answer = seats._program(PROGRAM, "spelling the seats' links next door", ask=ask)

    # A seat read through a curve its mode's catalog does not give it has no exact link: the
    # contract never sees the curve and spells one anyway, `seats` records it as a gap, and
    # a release writer refuses. That refusal is the agreement, not a difference.
    curves = links.catalog_curves()

    def unsayable(recipe: dict) -> bool:
        held = curves.get(str(recipe["mode"]))
        return held is not None and str(recipe.get("curve") or "linear") != held

    found = []
    if answer["base"] != base:
        found.append(
            f"fractal-wallpapers' explorer_link.EXPLORER_URL is {answer['base']} and "
            f"explorer/stamp.js's is {base}"
        )
    for pick in resolved:
        ours = emitted[pick.key]
        theirs = answer["spelled"][pick.key]
        if unsayable(pick.recipe):
            if theirs["query"] is not None:
                found.append(
                    f"seat {pick.key} reads {pick.recipe['mode']} through a "
                    f"{pick.recipe.get('curve')} curve, which no link can say, and explorer_link "
                    f"spells {theirs['query']}"
                )
            continue
        if ours.get("ok") and theirs["query"] != ours["link"]:
            found.append(
                f"seat {pick.key}: the contract spells {ours['link']} and explorer_link "
                f"spells {theirs['query'] or 'nothing'}"
                + (f" ({theirs['why']})" if theirs["query"] is None else "")
            )
        elif not ours.get("ok") and theirs["query"] is not None:
            found.append(
                f"seat {pick.key}: the contract refuses it ({ours['why']}) and explorer_link "
                f"spells {theirs['query']}"
            )

    files = answer["files"]
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", EMBED_JS],
        input=json.dumps(
            {"query": SAMPLE_QUERY, "files": {kind: held["raw"] for kind, held in files.items()}}
        ),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(SITE_ROOT),
        check=False,
    )
    if completed.returncode != 0:
        return [*found, f"stamp.js could not embed the sample files: {completed.stderr.strip()}"]
    here = json.loads(completed.stdout)
    for kind, held in files.items():
        if here[kind] != held["embedded"]:
            found.append(
                f"a {kind} embedded by stamp.js and by embed_link differs: "
                f"{len(base64.b64decode(here[kind]))} bytes against "
                f"{len(base64.b64decode(held['embedded']))}"
            )
        if not held["same_pixels"]:
            found.append(f"embed_link moved a {kind}'s decoded pixels")
        if not held["stripped_is_raw"]:
            found.append(f"a {kind} with embed_link's fields taken back out is not the original")
        if held["link_in"] != SAMPLE_QUERY:
            found.append(f"a {kind} embed_link wrote reads back as {held['link_in']}")
    return found


def available() -> bool:
    """Whether the halves that need the checkout next door can run here."""
    try:
        renders.wallpapers_root()
    except renders.EngineError:
        return False
    return True
