"""Escaping, in one place.

Captions are prose written by a person and they will eventually contain an ampersand.
Two functions rather than one so the call site says which context it is escaping for.
"""


def text(value: str) -> str:
    """Escape for character data — between tags."""
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def attribute(value: str) -> str:
    """Escape for a double-quoted attribute value."""
    return text(value).replace('"', "&quot;")
