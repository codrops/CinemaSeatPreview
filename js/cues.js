// The 4D track for our cut of Charge, like the effects track a 4D cinema runs with a film.
// Times are seconds into assets/charge.mp4.
//
// Spans set a level while they last (fading in and out): fog, smoke, rain, embers,
// rumble (the seat shakes) and sway (the seat rocks, as in wind).
// Events fire once when the film passes them: a strobe flash, a jolt, a burst of sparks.
// Strobes never come faster than about three a second.

const SPANS = [
  // The misty factory, then the wet night approach to its fence.
  { from: 5.3, to: 12.7, fadeIn: 1.2, fadeOut: 2, fog: 0.85, sway: 0.6 },
  { from: 8.6, to: 12.7, fadeIn: 0.6, fadeOut: 0.8, rain: 1 },
  // The electric blast fills the hall with teal smoke.
  { from: 29.6, to: 34.4, fadeIn: 0.4, fadeOut: 1.6, smoke: 1 },
  { from: 29.4, to: 31.2, fadeIn: 0.1, fadeOut: 0.8, rumble: 1 },
  // The grinder against the droid.
  { from: 38.0, to: 39.8, fadeIn: 0.1, fadeOut: 0.3, rumble: 0.45 },
  // The burning hall, the walk away into the fog, the fireplace at home.
  { from: 40.75, to: 47.75, fadeIn: 0.8, fadeOut: 1.5, embers: 0.85 },
  { from: 43.75, to: 49.0, fadeIn: 1.2, fadeOut: 2, fog: 0.9 },
  { from: 47.75, to: 51.0, fadeIn: 0.5, fadeOut: 1.5, embers: 0.35 },
];

const WHITE = [0.8, 0.9, 1.0];
const BLUE = [0.35, 0.8, 1.0];
const PINK = [1.0, 0.25, 0.75];
const ORANGE = [1.0, 0.5, 0.15];

const EVENTS = [
  // The droid fires.
  { at: 22.5, flash: [WHITE, 0.5], jolt: 0.35 },
  { at: 22.85, flash: [WHITE, 0.4], jolt: 0.25 },
  { at: 23.5, burst: { speed: 6 }, jolt: 0.3 },
  // Sparks off the canister, then the pink explosion.
  { at: 24.3, burst: { speed: 3.5, distance: 3.5 } },
  { at: 25.3, flash: [PINK, 0.9], jolt: 1, burst: { speed: 8 } },
  { at: 26.3, flash: [BLUE, 0.4], jolt: 0.2 },
  // Sparks and fire off the wall.
  { at: 27.3, burst: { speed: 7 }, jolt: 0.4 },
  { at: 27.55, burst: { speed: 9, spread: 2 }, flash: [ORANGE, 0.6], jolt: 0.6 },
  { at: 28.5, flash: [ORANGE, 0.7], jolt: 0.4, burst: { speed: 5 } },
  // The electric blast: blue strobes.
  { at: 29.5, flash: [BLUE, 1], jolt: 0.8 },
  { at: 29.85, flash: [BLUE, 0.7] },
  { at: 30.2, flash: [BLUE, 0.9], jolt: 0.3 },
  { at: 30.55, flash: [BLUE, 0.6] },
  { at: 30.9, flash: [BLUE, 0.5] },
  // The droid's laser.
  { at: 35.75, flash: [BLUE, 0.6], jolt: 0.5 },
  // The grinder throws sparks straight at you.
  ...[38.0, 38.3, 38.6, 38.9, 39.2, 39.5].map((at) => ({ at, burst: { speed: 8, distance: 3.2, spread: 0.8 } })),
  // The burning hall.
  { at: 40.8, flash: [ORANGE, 0.5] },
];

const envelope = (span, t) => {
  if (t < span.from || t > span.to + span.fadeOut) return 0;
  const up = Math.min(1, (t - span.from) / span.fadeIn);
  const down = t > span.to ? 1 - (t - span.to) / span.fadeOut : 1;
  return Math.max(0, Math.min(up, down));
};

const CHANNELS = ['fog', 'smoke', 'rain', 'embers', 'rumble', 'sway'];

export class CueTrack {
  constructor(effects, rig) {
    this.effects = effects;
    this.rig = rig;
    this.last = 0;
  }

  update(t, playing, camera) {
    const levels = Object.fromEntries(CHANNELS.map((name) => [name, 0]));
    if (playing) {
      for (const span of SPANS) {
        const k = envelope(span, t);
        for (const name of CHANNELS) if (span[name]) levels[name] = Math.max(levels[name], span[name] * k);
      }
      // Events between the last frame and this one (not after a jump in the film).
      if (t > this.last && t - this.last < 0.5) {
        for (const event of EVENTS) {
          if (event.at <= this.last || event.at > t) continue;
          if (event.flash) this.effects.flash(...event.flash);
          if (event.jolt && this.effects.enabled) this.rig.jolt(event.jolt);
          if (event.burst) this.effects.burst(camera, event.burst);
        }
      }
    }
    this.last = t;
    this.effects.set(levels);
  }
}
