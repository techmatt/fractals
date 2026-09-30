"""The packs' ranking and preview picker, on made-up keys.

`python -m unittest builder.test_ranking`. Nothing here reads the store, the site, or
the project next door.
"""

import unittest

from . import packs, ranking


class Ranking(unittest.TestCase):
    def test_votes_first_ties_in_the_order_given(self):
        keys = ["a", "b", "c", "d", "e"]
        self.assertEqual(ranking.ranked(keys, {"d": 2, "b": 1, "e": 1}), ["d", "b", "e", "a", "c"])
        self.assertEqual(ranking.ranked(keys, {}), keys)

    def test_the_rules(self):
        members = [f"k{n}" for n in range(12)]
        hue = {key: "blue" for key in members} | {"k7": "red", "k8": "red", "k9": "green"}
        scores = dict.fromkeys(members, 1)
        chosen = ranking.pick("best-30", members, hue, {"k0"}, {"k1"}, scores, capped=True)
        self.assertEqual(chosen.picks, ["k2", "k3", "k7", "k8", "k9"])
        self.assertEqual(chosen.skipped["k0"], ranking.ON_SITE)
        self.assertEqual(chosen.skipped["k1"], ranking.EARLIER)
        self.assertEqual(chosen.skipped["k4"], ranking.HUE)
        self.assertEqual(chosen.counts(), {ranking.ON_SITE: 1, ranking.EARLIER: 1, ranking.HUE: 3})
        self.assertNotIn("k10", chosen.skipped, "the walk stops at the fifth pick")
        self.assertEqual(chosen.empty, 0)

    def test_no_fall_through_to_unvoted_seats(self):
        members = [f"k{n}" for n in range(8)]
        hue = dict.fromkeys(members, "blue")
        scores = {"k0": 2, "k1": 1, "k2": 1}
        chosen = ranking.pick("blue", members, hue, {"k1"}, set(), scores, capped=False)
        self.assertEqual(chosen.picks, ["k0", "k2"])
        self.assertEqual(chosen.empty, ranking.PREVIEWS - 2)
        self.assertNotIn("k3", chosen.skipped, "an unvoted seat is not walked")

    def test_a_colour_pack_is_not_capped(self):
        members = [f"k{n}" for n in range(6)]
        chosen = ranking.pick(
            "blue",
            members,
            dict.fromkeys(members, "blue"),
            set(),
            set(),
            dict.fromkeys(members, 1),
            capped=False,
        )
        self.assertEqual(chosen.picks, members[: ranking.PREVIEWS])

    def test_no_preview_is_reused_down_the_page(self):
        members = [f"k{n:03}" for n in range(300)]
        hues = ("red", "blue", "green", "teal")
        hue = {key: hues[n % len(hues)] for n, key in enumerate(members)}
        order = {name: members for name in packs.marked()}
        chosen = ranking.pick_all(order, hue, set(), dict.fromkeys(members, 1))
        picked = [key for one in chosen.values() for key in one.picks]
        self.assertEqual(len(picked), len(set(picked)))
        self.assertEqual(len(picked), ranking.PREVIEWS * len(packs.marked()))

    def test_hand_picks_replace_the_walk_and_are_never_reused(self):
        members = [f"k{n:03}" for n in range(300)]
        hue = dict.fromkeys(members, "blue")
        order = {name: members for name in packs.marked()}
        # Any voted seat, a member or not, and fewer than five is fewer than five.
        manual = {"best-30": ["k000", "k299"], packs.GENERAL: ["k005"]}
        chosen = ranking.pick_all(order, hue, {"k299"}, dict.fromkeys(members, 1), manual)
        self.assertEqual(chosen["best-30"].picks, ["k000", "k299"])
        self.assertTrue(chosen["best-30"].by_hand)
        self.assertEqual(chosen["best-30"].empty, ranking.PREVIEWS - 2)
        self.assertFalse(chosen["best-100"].by_hand)
        walked = [
            key for name in packs.marked() if name not in manual for key in chosen[name].picks
        ]
        self.assertFalse({"k000", "k005", "k299"} & set(walked))


if __name__ == "__main__":
    unittest.main()
