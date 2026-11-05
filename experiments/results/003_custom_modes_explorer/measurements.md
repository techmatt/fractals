# Custom modes in Mandelnaut: parity and speed (item 003, 2026-11-05)

Working papers for `fractal-website__003_custom_modes_explorer`. The path and every problem
are in `docs/custom-modes.md`; this holds the numbers.

## Parity: every Example, against the pipeline's bytes

640x400 2×2, the size item 026 held the module at. Tolerance: item 026's, identical on
Windows. Native pictures: the sibling's `style wasm-parity` (`artifacts/style-wasm/
wasm-parity/<id>.native.png`, each keep's own stack) and, for the four buttons no setting
reproduces, `style render <style> --location <its place> --colormap <its map> --resolution
640 400 --supersample 2` (the published settings, Matt's MESSAGE #844).

- **Request path** (`bench/custom-parity.mjs --stack keep`, Node, one thread a process): each
  keep's link written by `exampleQuery`, read by `permalink.parse`, turned into the module's
  request by `requestOf` with the keep's own stack swapped in, measured and drawn in 128-pixel
  tiles. **23 of 23 identical.**
- **The served page** (`bench/custom-browser.mjs --workers 3`, Chrome): each Example button
  pressed, saved through the Download row as PNG at 640x400 with 2×2 samples. **22 of 22
  offered buttons identical** (18 against their keep, 4 against the published-settings
  render); `lit_petals__1` is not offered (it draws button 1's picture); no console error.
  Before MESSAGE #844 the same run read 18 of 23, the five misses being exactly the five
  keeps no setting reaches.

| example | mode | a setting reaches the keep | request path vs keep | offered | page vs native | Node s, 1 thread | page s, 3 workers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bronze_packing__0` | brass-foam | no | identical | yes | identical (published) | 21.1 | 12.3 |
| `bronze_packing__1` | brass-foam | no | identical | yes | identical (published) | 16.4 | 9.4 |
| `bronze_packing__2` | brass-foam | no | identical | yes | identical (published) | 22.7 | 13.6 |
| `floating_on_dreams__0` | silk-waves | yes (Auto tone off) | identical | yes | identical (keep) | 8.3 | 5.6 |
| `floating_on_dreams__1` | silk-waves | yes (Auto tone off) | identical | yes | identical (keep) | 10.4 | 6.0 |
| `floating_on_dreams__2` | silk-waves | yes (Auto tone off) | identical | yes | identical (keep) | 64.3 | 35.3 |
| `gilded_orbs__0` | gilt-orbs | yes | identical | yes | identical (keep) | 33.1 | 19.8 |
| `gilded_orbs__1` | gilt-orbs | yes (`orb_size` 0.3) | identical | yes | identical (keep) | 21.3 | 12.6 |
| `glossy_lobes__0` | lacquer-lobes | yes | identical | yes | identical (keep) | 56.5 | 30.1 |
| `glossy_lobes__1` | lacquer-lobes | yes | identical | yes | identical (keep) | 38.3 | 22.7 |
| `glossy_lobes__2` | lacquer-lobes | yes | identical | yes | identical (keep) | 66.3 | 36.6 |
| `lit_petals__0` | soft-petals | yes | identical | yes | identical (keep) | 10.0 | 6.3 |
| `lit_petals__1` | soft-petals | no | identical | no (button 1's picture) | — | 10.2 | — |
| `lit_petals__2` | soft-petals | no | identical | yes | identical (published) | 18.9 | 8.9 |
| `ribbon_packing__0` | ribbon-foam | yes | identical | yes | identical (keep) | 33.8 | 17.3 |
| `ribbon_packing__1` | ribbon-foam | yes | identical | yes | identical (keep) | 25.5 | 14.4 |
| `shaded_blades__0` | steel-blades | yes | identical | yes | identical (keep) | 16.4 | 8.4 |
| `teal_tunnel__0` | arch-tunnel | yes (`turns` 3) | identical | yes | identical (keep) | 9.2 | 4.7 |
| `teal_tunnel__1` | arch-tunnel | yes | identical | yes | identical (keep) | 9.0 | 5.3 |
| `teal_tunnel__2` | arch-tunnel | yes (its place sets `turns` 8) | identical | yes | identical (keep) | 8.0 | 4.5 |
| `yas__0` | glass-whorl | yes | identical | yes | identical (keep) | 30.6 | 15.7 |
| `yas__1` | glass-whorl | yes | identical | yes | identical (keep) | 11.8 | 6.8 |
| `yas__2` | glass-whorl | yes | identical | yes | identical (keep) | 28.9 | 15.8 |

The seconds in the last two columns ran beside an outside load (about 45% of the box) and
are inflated; their ratio is the pool's, not a speed.

## By eye

`side-by-side/<style>.jpg`: each keep (left, the 2560x1600 JPEG resized to 640x400) beside
the page's own 640x400 download (right). Fine structure reads grainier on the right because
the left averaged a picture four times wider; the comparison of record is the bytes above.
Brass-foam's three are its published tone (a deeper `p10`), soft-petals' third is the
published formulation, darker and less glossy than the older keep.

## Speed in the served page (Matt's box, 12 threads)

`bench/custom-speed.mjs --workers 4`, each mode at its first Example, window 1600x1000
(screen 884x540 at 2×2), then a 1280x800 2×2 download through the row. **Beside an outside
load of about 45% of the box** (MESSAGE #840): every number is inflated by it.

| mode | preview | full detail (preview's balance) | exact measure | exact tiles | screen, whole | 1280x800 download |
| --- | --- | --- | --- | --- | --- | --- |
| lacquer-lobes | 0.63 s | 12.8 s | 47.7 s | 11.2 s | 71.8 s | 115.5 s |
| gilt-orbs | 0.42 s | 8.2 s | 30.2 s | 7.6 s | 46.0 s | 78.6 s |
| ribbon-foam | 0.38 s | 6.8 s | 30.6 s | 6.6 s | 44.0 s | 71.9 s |
| glass-whorl | 0.33 s | 5.9 s | 23.4 s | 6.0 s | 35.3 s | 64.8 s |
| brass-foam | 0.27 s | 4.9 s | 21.1 s | 4.7 s | 30.7 s | 52.7 s |
| steel-blades | 0.16 s | 3.2 s | 12.9 s | 3.0 s | 19.1 s | 34.3 s |
| soft-petals | 0.16 s | 2.1 s | 9.5 s | 2.0 s | 13.7 s | 25.0 s |
| arch-tunnel | 0.11 s | 1.4 s | 8.9 s | 1.8 s | 12.1 s | 24.5 s |
| silk-waves | 0.14 s | 2.0 s | 7.4 s | 1.8 s | 11.2 s | 19.4 s |

What the shape says, load or not: the picture is up in under a second and at full detail in
2 to 13 s, but the exact pass costs about one single-thread frame, because every worker
measures the whole frame (the measure lives in a session and cannot cross workers). So a
download takes about item 026's one-thread time plus its tiles over the pool, at any pool
size; a 3840x2160 2×2 download of lacquer-lobes would run on the order of fifteen minutes.
A measure that splits into bands with mergeable statistics (a wallpapers seam) is what
would take the exact pass from about `T + T/N` to about `2T/N`.
