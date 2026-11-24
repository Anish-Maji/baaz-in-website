# Baaz website

Hero header followed by a scroll-driven 3D cloud fly-through down onto the city map, built with three.js.

## Run it

Needs [Node.js](https://nodejs.org/). No install step.

```bash
node serve.mjs
```

Then open http://localhost:5173. The page must be served — opening `index.html` directly won't work.

Live reload is built in: saving a `.css` file updates the page instantly, saving anything else reloads it.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page structure: nav, hero, cloud canvas |
| `style.css` | All styling, including the Figma design tokens |
| `main.js` | Scroll system, hero slide-out, cloud layer, map |
| `serve.mjs` | Local server with live reload |
| `assets/` | Hero images, logo, fonts, cloud atlas, map |
| `vendor/` | three.js and the KTX2 / Basis decoder |

## Tweaking

The main numbers live at the top of `main.js` under **SETTINGS**: captions, scroll lengths, cloud layers, map zoom, shadow strength. Add `?p=0.5` to the URL to jump halfway through the clouds.

## Fonts

Basement Grotesque and VT323 are in `assets/fonts/`. Stratum2 is not included; add `Stratum2-Bold.woff2` to `assets/fonts/` so visitors who don't have it installed see the right font.
