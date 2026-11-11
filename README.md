# Wippit!

A colourful, offline-first puzzle for the browser in the spirit of the 1997
seesaw-and-marbles classics. Numbered balls are dropped onto pans that hang on
seesaws. The heavier pan sinks; when a seesaw swings over, the top ball of the
rising pan is catapulted across the board, and balls that leave the board come
back on the other side as something else.

Play it: https://martinthoma.github.io/wippit/

## How to play

* A **crane** hangs above the board, below a **depot** of two rows of balls.
  Move the crane with `←` `→` (or the mouse), press `Space` (or click) to
  **pick** the ball from the depot's bottom row, move again and press `Space`
  to **drop** it into a column.
* Three or more balls of one colour **side by side** pop, together with every
  ball of that colour touching them. Five of a colour **stacked** fuse into one
  ball with the combined weight.
* Every column is a **pan on a seesaw** and shows its total weight. The heavier
  pan sinks and holds 8 balls, a raised pan only 6. When a seesaw **swings
  over**, the top ball of the rising pan is catapulted **as many columns as the
  weight difference**, towards the heavy side. Before you drop, the affected
  pan blinks and the flight path is shown, so you can aim your throws.
* A ball that **flies off the board re-enters on the other side**: balls become
  hearts, hearts become bombs, bombs become hearts, other specials become bombs.
  Hearts pop only with hearts, jokers or bombs.
* Specials appear in the depot: joker, bomb, drill, zap, colour zap, tint,
  tint 3×3, leveller, stonemaker, and a silver star every 50 balls (three in a
  row clear the board; two stacked make a gold star). The in-game help lists
  them all.
* Pop again while the **bonus lamp** is lit for double points. Every 25 balls
  the level rises and more colours and specials appear. The game ends when a
  stack touches the ceiling.
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
