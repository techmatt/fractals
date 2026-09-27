"""The votes store, held to its promises against a store in a temporary directory.

`python -m unittest builder.test_votes`. Every test runs with `FRACTAL_WEBSITE_VOTES_STORE`
and `FRACTAL_WEBSITE_VOTES_VIEWER` pointed into a temporary directory, and the first thing
the suite proves is that this is where the writes go: the real store is looked at before
and after and must not have moved.
"""

import json
import os
import re
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from . import votes


def _real_store() -> Path | None:
    held = os.environ.pop(votes.STORE_VARIABLE, None)
    try:
        return votes.store_path()
    except votes.VotesError:
        return None
    finally:
        if held is not None:
            os.environ[votes.STORE_VARIABLE] = held


def _stat(path: Path | None):
    if path is None or not path.exists():
        return None
    found = path.stat()
    return (found.st_size, found.st_mtime_ns)


class VotesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.real = _real_store()
        cls.real_before = _stat(cls.real)
        rows = votes.seat_rows()
        cls.plain = [row for row in rows if "level=" not in row["link"]][:2]
        cls.leveled = next(row for row in rows if "level=" in row["link"])

    @classmethod
    def tearDownClass(cls):
        assert _stat(cls.real) == cls.real_before, f"the real store at {cls.real} moved"

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.store = root / "votes" / "events.jsonl"
        self.saved = {
            name: os.environ.get(name) for name in (votes.STORE_VARIABLE, votes.VIEWER_VARIABLE)
        }
        os.environ[votes.STORE_VARIABLE] = str(self.store)
        os.environ[votes.VIEWER_VARIABLE] = str(root / "viewer" / "index.html")

    def tearDown(self):
        for name, value in self.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        self.dir.cleanup()

    def test_the_store_is_the_temporary_one(self):
        self.assertEqual(votes.store_path(), self.store)
        self.assertNotEqual(votes.store_path(), self.real)
        self.assertEqual(votes.viewer_path().parent.name, "viewer")

    def test_ingest_appends_and_never_rewrites(self):
        one, two = self.plain
        votes.ingest("Jason", f"https://techmatt.github.io/fractals/explorer/?{one['link']}")
        first = self.store.read_bytes()
        lines = votes.ingest(
            "jason", f"{one['link']}\n\nhttp://localhost:8000/explorer/?{two['link']}"
        )
        after = self.store.read_bytes()
        self.assertTrue(after.startswith(first))
        rows = votes.events()
        self.assertEqual([row["friend"] for row in rows], ["jason", "jason"])
        self.assertIn("1 new to jason, 1 already theirs", lines[1])
        self.assertEqual(votes.selections(rows), {"jason": {one["key"], two["key"]}})
        self.assertTrue(votes.viewer_path().is_file())

    def test_a_cut_short_store_is_refused(self):
        self.store.parent.mkdir(parents=True)
        self.store.write_bytes(b'{"friend": "x", "links": []')
        with self.assertRaises(votes.VotesError):
            votes.ingest("jason", self.plain[0]["link"])
        self.assertEqual(self.store.read_bytes(), b'{"friend": "x", "links": []')

    def test_matching(self):
        stripped = re.sub(r"&level=[^&]*", "", self.leveled["link"])
        text = "\n".join(
            [
                "here are mine:",
                f"<https://techmatt.github.io/fractals/explorer/?{stripped}>",
                "?v=4&f=julia&x=0.1&y=0.2&w=1",
                "https://techmatt.github.io/fractals/explorer/?panel=gallery&collection=red",
                "v=4&f=nosuchfamily",
                "thanks!",
            ]
        )
        answer = votes.match(text)
        found = [entry.get("key") or entry["reason"] for entry in answer["links"]]
        self.assertEqual(
            found, [self.leveled["key"], "not a wallpaper", "collection link", "unparseable"]
        )
        self.assertEqual(answer["ignored"], 4)
        self.assertEqual(answer["unreadable_seats"], [])
        self.assertEqual(
            answer["links"][0]["link"], f"https://techmatt.github.io/fractals/explorer/?{stripped}"
        )

    def test_a_saved_export_is_read(self):
        exported = json.dumps({"v": 1, "items": [{"link": row["link"]} for row in self.plain]})
        answer = votes.match(exported)
        self.assertEqual(
            [entry["key"] for entry in answer["links"]], [r["key"] for r in self.plain]
        )

    def test_names_and_empty_pastes(self):
        with self.assertRaises(votes.VotesError):
            votes.ingest("", self.plain[0]["link"])
        with self.assertRaises(votes.VotesError):
            votes.ingest("jason", "no links here at all")
        self.assertFalse(self.store.exists())

    def test_likes_count_friends_not_events(self):
        key = self.plain[0]["key"]
        rows = [
            {"friend": "a", "links": [{"link": "x", "key": key}]},
            {"friend": "a", "links": [{"link": "x", "key": key}]},
            {"friend": "b", "links": [{"link": "x", "key": key}, {"link": "y", "reason": "r"}]},
        ]
        self.assertEqual(votes.likes(rows), {key: 2})

    def test_row_shape(self):
        now = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)
        votes.ingest("jason", f"{self.plain[0]['link']} v=4&f=nosuchfamily", now=now)
        (row,) = votes.events()
        self.assertEqual(row["at"], "2026-09-26T12:00:00Z")
        self.assertEqual(
            row["links"][0], {"link": self.plain[0]["link"], "key": self.plain[0]["key"]}
        )
        self.assertEqual(row["links"][1]["reason"], "unparseable")


if __name__ == "__main__":
    unittest.main()
