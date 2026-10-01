"""The website's resolver, held to next door's rule for a pool picture, on temporary trees.

`python -m unittest builder.test_renders`. Nothing here reads the wallpaper project: each
test builds a hot tier and an archive in a temporary directory, and the one that goes
through `rehome` points every setting it reads at that directory by environment variable.
"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from . import renders

GROUP, LEG, FILE = "depth", "night_d", "0123456789abcdef.jpg"
STORED = f"artifacts/curation/{GROUP}/{LEG}/pictures/{FILE}"


def _write(path: Path, text: str = "x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


class PoolPictureMirror(unittest.TestCase):
    def setUp(self):
        held = tempfile.TemporaryDirectory()
        self.addCleanup(held.cleanup)
        root = Path(held.name)
        self.hot = root / "hot"
        self.archive = root / "archive"
        (self.hot / renders.POOL_NAME).mkdir(parents=True)
        (self.archive / renders.POOL_PICTURES_NAME).mkdir(parents=True)
        self.tiers = renders.Tiers(self.hot, self.archive)
        self.hot_copy = self.hot / renders.POOL_NAME / GROUP / LEG / "pictures" / FILE
        self.mirrored = self.archive / renders.POOL_PICTURES_NAME / GROUP / LEG / "pictures" / FILE

    def test_the_names_are_next_doors(self):
        self.assertEqual(renders.POOL_NAME, "curation")
        self.assertEqual(renders.POOL_PICTURES_DIR, "pictures")
        self.assertEqual(renders.POOL_PICTURES_NAME, "pool_pictures")
        self.assertTrue(issubclass(renders.ArchiveUnreachable, renders.EngineError))

    def test_hot_wins(self):
        _write(self.hot_copy, "hot")
        _write(self.mirrored, "mirror")
        self.assertEqual(self.tiers.resolve(STORED), self.hot_copy)

    def test_the_mirror_answers_when_the_hot_copy_is_gone(self):
        _write(self.mirrored)
        self.assertEqual(self.tiers.resolve(STORED), self.mirrored)
        # The same name, however a caller spells its parts.
        self.assertEqual(
            self.tiers.resolve("curation", GROUP, LEG, "pictures", FILE), self.mirrored
        )
        self.assertEqual(self.tiers.resolve(STORED.replace("/", "\\")), self.mirrored)

    def test_the_hot_spelling_when_neither_holds_it(self):
        self.assertEqual(self.tiers.resolve(STORED), self.hot_copy)
        self.assertFalse(self.tiers.resolve(STORED).exists())

    def test_other_names_are_not_mirrored(self):
        # Same file name, but not at a pool picture's depth or under `curation`.
        for parts in (
            ("curation", GROUP, LEG, "rows.jsonl"),
            ("curation", GROUP, LEG, "pictures", "x.leveled", FILE),
            ("tiles", GROUP, LEG, "pictures", FILE),
        ):
            mirrored = self.archive / renders.POOL_PICTURES_NAME / Path(*parts[1:])
            _write(mirrored)
            self.assertFalse(renders.is_pool_picture(list(parts)))
            self.assertEqual(
                self.tiers.resolve(*parts), self.tiers.unit(parts[0]) / Path(*parts[1:])
            )
        self.assertIsNone(self.tiers.mirror(["tiles", GROUP, LEG, "pictures", FILE]))

    def test_unreachable_archive_raises_only_when_the_hot_copy_is_gone(self):
        unplugged = renders.Tiers(self.hot, self.hot.parent / "not-plugged-in")
        with self.assertRaises(renders.ArchiveUnreachable):
            unplugged.resolve(STORED)
        _write(self.hot_copy)
        self.assertEqual(unplugged.resolve(STORED), self.hot_copy)

    def test_no_archive_configured_is_the_hot_spelling(self):
        self.assertEqual(renders.Tiers(self.hot, None).resolve(STORED), self.hot_copy)

    def test_rehome_reads_the_settings_and_follows_the_rule(self):
        checkout = self.hot.parent / "checkout"
        checkout.mkdir()
        _write(self.mirrored)
        settings = {
            renders.WALLPAPERS_VARIABLE: str(checkout),
            renders.HOT_ROOT_VARIABLE: str(self.hot),
            renders.ARCHIVE_ROOT_VARIABLE: str(self.archive),
        }
        with mock.patch.dict(os.environ, settings):
            self.assertEqual(renders.rehome(f"D:/elsewhere/{STORED}"), self.mirrored)
            os.environ[renders.ARCHIVE_ROOT_VARIABLE] = str(self.hot.parent / "gone")
            with self.assertRaises(renders.ArchiveUnreachable):
                renders.rehome(STORED)


if __name__ == "__main__":
    unittest.main()
