# Wippit!

A colourful, offline-first ball-stacking puzzle for the browser. Balls with
weights drop into columns that rest on seesaws; when one side gets too heavy
the seesaw tips and catapults a ball into the next column. Pop three or more
of a colour to score.

Play it: https://martinthoma.github.io/wippit/

## How to play

* Balls drop one at a time. Steer with `←` `→` (or move the mouse), drop with
  `Space` (or click). `↓` is a soft drop.
* Join **three or more balls of one colour** – side by side, stacked or
  diagonally – and they pop. Chains after a pop multiply the score.
* Every ball shows its **weight** (1–9). Each pair of columns rests on a
  **seesaw**. When one side becomes heavier by 3 or more, it tips and the
  light side **catapults** its top ball into the neighbouring column.
* **Rainbow balls** match any colour. **Bombs** blast everything around them
  when they land.
* Pop balls to level up (faster drops, more colours). The game is over when a
  column is full.
* `P` pauses, `M` toggles sound.

The game works on desktop first; on phones there are on-screen buttons.

## Installing

Wippit! is a Progressive Web App. In Chrome/Edge use the *Install app* button
in the top bar (or the browser's install menu); on iOS use *Share → Add to
Home Screen*. After the first visit it runs without an internet connection.
When an installed copy is online and a new version has been published, it is
downloaded in the background and applied automatically (after the current
game if one is running).

## Development

Everything is static HTML/CSS/JS – no bundler, no server-side code. Only
`python3` is needed to generate resources and to serve the folder locally.

    make build   # generate icons/, version.js and sw.js
    make run     # build, then serve http://localhost:8000/
    make check   # fail if generated files are out of date

Layout:

| Path                   | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `index.html`, `style.css` | page and styling                                |
| `js/game.js`           | rules and state machine (no DOM)                   |
| `js/render.js`         | canvas rendering                                   |
| `js/audio.js`          | WebAudio sound effects (synthesised, no files)     |
| `js/pwa.js`            | service-worker registration, auto-update, install  |
| `js/main.js`           | wiring, input, HUD                                 |
| `tools/build.py`       | generates `icons/*.png`, `version.js`, `sw.js`     |
| `sw.js`, `version.js`, `icons/*.png` | **generated** – run `make build`     |

The version is a hash of all source files. `sw.js` embeds it as the cache
name and precache list, so publishing a changed file publishes a new version;
browsers with the old version pick it up on their next check (page load,
return to the tab, going online, or every 30 minutes).

**After changing any source file, run `make build` and commit the generated
files too** – GitHub Pages serves the `main` branch as-is. The CI workflow
(`make check`) fails if they are stale.

## Licence

MIT, see `LICENSE`.
