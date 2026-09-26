# examples

The four thumbnails the root `README.md` shows at the top, each linked to the explorer
view it was drawn from. Nothing on the site reads them; only that page does.

Each is its link drawn by the engine next door,
`fractal-engine render-link --link <URL> --size 1920x1080 --ss 2`, exactly as the link
says, with no re-framing or re-coloring, then scaled to 480x270 (Lanczos; JPEG quality
82, progressive, 4:2:0). That is the recipe fractal-wallpapers' own `examples/` uses. All
four took the `render-link` route; none needed the explorer's Download.

| file | family | render mode | palette |
| --- | --- | --- | --- |
| `julia_smooth_mean_angle.jpg` | julia | `smooth_mean_angle`, weight 0.55 | `skyroads-blue-25` (Cobalt Obsidian), phase 0.788175 |
| `mandelbrot_smooth.jpg` | mandelbrot | `smooth`, band autolevel | Petal Dusk, phase 0.046639 |
| `julia_stripe.jpg` | julia | `stripe` | Emerald Ingot |
| `julia_multibrot4_threads.jpg` | julia (multibrot4) | `threads` | `abstract-wallpaper-backgrounds-hd` (Amber Sea), phase 0.827208 |

## The links

In the table's order, and in the root README's:

```
https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia&cx=-1.2583366697573282&cy=-0.03810995140056672&m=smooth_mean_angle&weight=0.55&x=-0.0939167613435858&y=-0.2012267774092059&w=0.17345963982562132&p=skyroads-blue-25&phase=0.788175
https://techmatt.github.io/fractals/explorer/index.html?v=4&x=-0.056703850480536507&y=0.6689946803923973&w=0.0000000021132721900905024&p=Petal%20Dusk&phase=0.046639&level=band_autolevel/v1:0.2958367414372542,0.8390717419257583,1.1785094930375575,0.2958367414372542,0.8629886965307019
https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia&cx=-1.2517612129804818&cy=0.038979112285470574&m=stripe&x=0.190964531525442&y=-0.027508345978564743&w=0.13834453039497419&p=Emerald%20Ingot
https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia4&cx=0.4892207660373146&cy=-0.6507282511501382&m=threads&x=-0.1599467583852486&y=-0.6348190856721863&w=0.01057422759599882&p=abstract-wallpaper-backgrounds-hd&phase=0.827208
```

Replacing one is two steps and neither is optional: redraw and rescale the picture here,
and repoint both the `<a>` and the `<img>` in the root README.
