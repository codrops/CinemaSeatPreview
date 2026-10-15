# AGENTS.md

Notes for coding agents working on this repo. Read [README.md](README.md) first for what the demo is.

## Setup

- No package.json and nothing to install. Plain HTML, CSS and ES modules. three.js r186 (`three.webgpu.js`, `three.core.js`, `three.tsl.js`, two addons) and GSAP 3.15 are vendored in `js/lib/` and mapped with the import map in `index.html`. GSAP is a global.
- Serve the root with a static server that answers range requests (`npx serve .`): the film's metadata sits at the end of the MP4.
- There are no automated tests. Check a change in a browser: fly to a few seats (room and map), back up with Esc, use the arrow keys, play the film and jump to the 4D moments (about 9s, 25s, 30s, 38s and 41s), switch 4D off, and try reduced motion and a phone width. Look at the console.

## Map

| Path                 | What it is |
| -------------------- | ---------- |
| `js/layout.js`       | The room in metres: screen, rows, seats (position, number, arc angle), taken seats (seeded), best seats, prices, eye heights. Everything else reads from here. |
| `js/light.js`        | The lighting every material uses (`lit`, `lightAt`): the film's 8x3 light patches, the house lights (`houseDim`) and the 4D strobes (`strobe`). |
| `js/room.js`         | Floor, stadium steps, aisle steps and their LEDs, stage, walls with sconces, ceiling lights, screen, doors, exit signs, projection booth and beam. |
| `js/seats.js`        | Instanced seats (backs, cushions, armrests), folding cushions, hover/taken/ticket states, picking boxes. |
| `js/film.js`         | The video, its texture, the poster, and sampling each frame into the light patches. |
| `js/rig.js`          | The camera: flights between the overview and seats, head turn, drag to look, tilt, 4D rumble and sway. |
| `js/map.js`          | The SVG seat map. |
| `js/preview.js`      | "View from this seat": renders the room from a seat into a texture, drawn into the map's preview window in the final pass. |
| `js/effects.js`      | 4D particles (fog, smoke, drizzle, embers, spark bursts) and strobe flashes, all on the GPU. |
| `js/cues.js`         | The 4D track: spans and events in seconds of `assets/charge.mp4`. |
| `js/audio.js`        | The film's sound from two speakers at the screen, placed in 3D, plus a small room echo. |
| `js/gyro.js`         | Tilt to look around on phones. |
| `js/audience.js`     | People in the taken seats (decoration). Heads stay at most 1.2 m above their floor, so they never cross a sightline to the screen; don't raise that. |
| `js/app.js`          | Start-up and the battery preloader's steps, render loop, pointer and keyboard, dock, tickets, the controls line. |
| `css/base.css`       | All styles: frame, seat panel, dock, controls line, small-screen sheet. |
| `assets/`            | `charge.mp4` (our 55s cut of Charge, 1280x536) and `charge-poster.jpg`. |

## How it works

- Units are metres. x to the right, y up, z from the screen (z = 0) to the back. Rows are arcs around `ARC_CENTER_Z`; a seat's place on its row is its arc length `s`.
- Materials are `MeshBasicNodeMaterial`s whose colour is `albedo × lightAt(position, normal)`. There are no three.js lights. A new surface in the room should use `lit()` so the film and the strobes reach it.
- The camera is `rig.position` plus `rig.direction`, with offsets added in `rig.update`: pointer head turn (seated only), drag, tilt, rumble, sway. Moves are `rig.flyTo(seat)`: one cubic curve lifted over the seat backs, the gaze held on the screen. With reduced motion, moves crossfade instead.
- The 4D track only sets levels (`effects.set`) and fires events (flash, jolt, burst). Particle positions are functions of a per-particle seed and time in TSL; viewer-centred effects wrap into a box around the camera (`aroundCamera`). Effects that are off aren't drawn.
- The final pass is `preview.composite(scene + bloom)`. The preview window in the HTML is just an empty frame; keep it free of `backdrop-filter`, or the preview gets blurred.

## Style

- Two-space indentation, single quotes, semicolons, trailing commas.
- Comments say what something is or why, in plain words. No italics in anything visible.
- No dependencies and no build tooling unless asked.

## Ask before changing

- The film, its cut and the credits.
- The `<title>`, meta, frame links and tags (`#three.js #webgpu #tsl`).
- The room's proportions (screen size and height, first-row distance), and the 4D cue times.
