# Cinema Seat Preview

Pick a seat in a 3D cinema, fly to it and watch the film from there. The film lights the room as it plays, and a 4D track adds fog, drizzle, smoke, sparks, embers, strobes and seat motion at the right moments. Built with three.js, its WebGPU renderer and TSL (it falls back to WebGL 2 where WebGPU isn't available).

A new take on the 2016 [Cinema Seat Preview Experiment](https://github.com/codrops/SeatPreview), which was made with CSS 3D transforms.

[Demo](https://tympanus.net/Demos/CinemaSeatPreview/)

## What's in it

- A cinema at real proportions: a curved widescreen 12 m wide, 12 stadium rows, the first one about as far from the screen as the screen is wide.
- The film lights the room: each frame is split into 8x3 patches that light every surface like small area lights.
- Fly to any seat by clicking it in the room or on the seat map. Hovering a seat on the map shows the live view from it.
- Ticket stubs, a total and a booking button. Some seats are already taken; the best ones are marked.
- Sound from the screen, placed in 3D, so you hear it from where you sit.
- A 4D track cued to the film, with a switch to turn it off.
- An audience in the taken seats, lit by the film. Nobody's head reaches a sightline to the screen, from any seat.
- A preloader taken from the film's first shot: a battery charging from 2% as the demo loads.
- Tilt your phone to look around.

## Controls

- Click a seat (in the room or on the map) to fly there. Drag to look around.
- Arrow keys: jump into a seat, then move seat by seat (left and right) or row by row (up and down).
- A: add the seat you're in to your tickets. Esc: back up to the overview. Space: play or pause. S: stop the film (the house lights come back up).
- On the map, Tab in, then use the arrow keys and Enter.

## Installation

Run this demo on a [local server](https://developer.mozilla.org/en-US/docs/Learn/Common_questions/Tools_and_setup/set_up_a_local_testing_server) that supports range requests for the video, for example `npx serve .`. There's no build step: three.js and GSAP are in `js/lib/`.

## Credits

- The film is a cut of Charge (2022), © Blender Foundation | [studio.blender.org/charge](https://studio.blender.org/charge), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Shortened to about 55 seconds and re-encoded for this demo.
- [three.js](https://threejs.org/) and [GSAP](https://gsap.com/).

## Misc

Follow Codrops: [Bluesky](https://bsky.app/profile/codrops.bsky.social), [Facebook](https://www.facebook.com/codrops), [GitHub](https://github.com/codrops), [Instagram](https://www.instagram.com/codropsss/), [X](https://www.x.com/codrops)

## License

The code is [MIT](LICENSE). The film in `assets/` isn't covered by the MIT license: it's licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) (see Credits).
