"""The one home for the colours and faces a drawn figure is made of.

Every figure this project draws — the two diagrams in `diagrams.py`, every contact
sheet a rig composes — sits in the same dark image well the rendered figures sit in.
That means it takes its colours from the stylesheet rather than inventing a second set,
and until this module existed it did so by four separate copies of the same five hex
triples drifting apart in four files.

The well tokens are `assets/css/site.css`'s own, transcribed. `check` holds them to it,
so a restyle that moves `--well` and forgets the figures is a failing check rather than
a seam somebody notices in a picture months later.
"""

from __future__ import annotations

# ------------------------------------------------------------------ the well's tokens
#
# Transcribed from the stylesheet's `:root`, and checked against it. A drawn figure is
# furniture for the well it sits in.

WELL = (0x16, 0x17, 0x1C)
WELL_RULE = (0x2B, 0x2E, 0x36)
WELL_INK = (0xEA, 0xE8, 0xE5)
WELL_INK_DIM = (0xC2, 0xBC, 0xB4)
WELL_PENDING = (0x3B, 0x3F, 0x4A)

#: The one token with no counterpart in the stylesheet: the fill of a panel drawn *on*
#: the well rather than a picture pasted onto it. Nothing in the CSS draws such a panel,
#: so there is nothing there to be held to.
WELL_PANEL = (0x1D, 0x1F, 0x26)

#: Quieter than a caption, louder than a rule: a third rank of label ink, for the lines
#: that name where a panel came from rather than what it shows.
SECTION_INK = (0x8F, 0x8A, 0x84)

#: The CSS custom property each well token is transcribed from, for the check.
CSS_TOKENS = {
    "--well": WELL,
    "--well-rule": WELL_RULE,
    "--well-ink": WELL_INK,
    "--well-ink-dim": WELL_INK_DIM,
    "--well-pending": WELL_PENDING,
}

# ------------------------------------------------------------------------ the faces
#
# Rasterized through whatever the machine has, in preference order, which is why a
# drawn figure is committed rather than regenerated in CI: two machines agree about the
# picture and not about its bytes.

REGULAR = ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf")
SEMIBOLD = ("seguisb.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf")


def font(size: int, faces: tuple[str, ...] = REGULAR):
    """The first face on this machine at this size, or Pillow's own as a last resort."""
    from PIL import ImageFont

    for name in faces:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def text_width(draw, text: str, face) -> float:
    """How wide a string will be, for centring and right-aligning it."""
    left, _, right, _ = draw.textbbox((0, 0), text, font=face)
    return right - left


def hex_token(colour: tuple[int, int, int]) -> str:
    """A token as the stylesheet spells it, for an error message that can be compared."""
    return "#" + "".join(f"{channel:02x}" for channel in colour)
