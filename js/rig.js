import * as THREE from 'three/webgpu';
import {
  SCREEN_CENTER, OVERVIEW_EYE, OVERVIEW_TARGET, ROWS, ROW_FRONT, ROW_DEPTH, STAGE, seatedEye, rowFloor,
} from './layout.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Where you look by default: the screen, a little below its centre, so the rows in front show too.
export const LOOK_AT = SCREEN_CENTER.clone().setY(SCREEN_CENTER.y - 1.4);
export const toScreen = (from) => new THREE.Vector3().subVectors(LOOK_AT, from).normalize();
const toOverview = (from) => new THREE.Vector3().subVectors(OVERVIEW_TARGET, from).normalize();
const eyeOf = (seat) => (seat ? seatedEye(seat) : OVERVIEW_EYE.clone());
const gazeOf = (seat, from) => (seat ? toScreen(from) : toOverview(from));

// How high the seat backs (or the stage) reach at a point along the room.
function obstacleAt(z) {
  if (z < STAGE.depth) return STAGE.height;
  const row = Math.floor((z - ROW_FRONT) / ROW_DEPTH);
  if (row < 0) return 0;
  return rowFloor(Math.min(row, ROWS)) + 1.12;
}

// Smooth pseudo-random wobble for the seat rumble.
const wobble = (t, seed) => Math.sin(t * 17.3 + seed) * 0.6 + Math.sin(t * 31.7 + seed * 2.1) * 0.4;

// The camera is you: up under the projection booth, or in a seat. Moving between the two
// is one smooth flight with your eyes on the screen. On top of that: a head turn that follows
// the pointer, a look-around you drag (or tilt, on phones), and the 4D seat effects.
export class Rig {
  constructor(camera, { fade }) {
    this.camera = camera;
    this.fade = fade;
    this.position = OVERVIEW_EYE.clone();
    this.direction = toOverview(this.position);
    this.seat = null;
    this.busy = false;

    this.pointer = { x: 0, y: 0, active: false };
    this.parallax = { yaw: 0, pitch: 0 };
    this.drag = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, active: false, idle: 0 };
    this.tilt = { yaw: 0, pitch: 0 };
    this.shake = { rumble: 0, sway: 0, jolt: 0, time: 0 };
  }

  get reduced() {
    return reducedMotion.matches;
  }

  setPointer(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = true;
  }

  startDrag() {
    this.drag.active = true;
    this.drag.vYaw = this.drag.vPitch = 0;
  }

  // Drag the view like grabbing the room: right moves it to the right, so you look left.
  dragBy(dx, dy, dt) {
    const perPixel = this.horizontalFov() / window.innerWidth;
    const dYaw = dx * perPixel;
    const dPitch = dy * perPixel;
    this.drag.yaw = THREE.MathUtils.clamp(this.drag.yaw + dYaw, -2.1, 2.1);
    this.drag.pitch = THREE.MathUtils.clamp(this.drag.pitch + dPitch, -0.9, 0.9);
    if (dt > 0) {
      this.drag.vYaw = THREE.MathUtils.lerp(this.drag.vYaw, dYaw / dt, 0.5);
      this.drag.vPitch = THREE.MathUtils.lerp(this.drag.vPitch, dPitch / dt, 0.5);
    }
  }

  endDrag() {
    this.drag.active = false;
    this.drag.idle = 0;
    if (this.reduced) this.drag.vYaw = this.drag.vPitch = 0;
  }

  horizontalFov() {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    return 2 * Math.atan(Math.tan(v / 2) * this.camera.aspect);
  }

  // A cubic curve from here to there, lifted just enough to clear the seat backs on the way.
  flightPath(start, end) {
    let lift = 0.35;
    for (let k = 1; k < 12; k++) {
      const p = new THREE.Vector3().lerpVectors(start, end, k / 12);
      lift = Math.max(lift, (obstacleAt(p.z) + 0.45 - p.y) / 0.75);
    }
    const up = new THREE.Vector3(0, lift, 0);
    return new THREE.CubicBezierCurve3(start, start.clone().add(up).lerp(end, 0.12), end.clone().add(up), end);
  }

  // Fly to a seat (or back to the overview with null).
  flyTo(seat, { onLeave, onArrive, quick = false } = {}) {
    if (this.busy || seat === this.seat) return;
    const from = this.seat;
    this.busy = true;
    if (this.reduced) return this.crossfadeTo(seat, { onLeave, onArrive });

    const start = this.position.clone();
    const end = eyeOf(seat);
    const path = this.flightPath(start, end);
    const distance = start.distanceTo(end);
    const duration = quick
      ? THREE.MathUtils.clamp(0.45 + distance * 0.05, 0.5, 0.9)
      : THREE.MathUtils.clamp(0.95 + distance * 0.035, 1.1, 1.9);
    const startDirection = this.direction.clone();
    const flight = { t: 0 };
    let arrived = false;

    if (from) onLeave?.(from);
    gsap.to(flight, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.position.copy(path.getPoint(flight.t));
        const gaze = gazeOf(seat, this.position);
        this.direction.copy(startDirection).lerp(gaze, smoothstep(0, 0.85, flight.t)).normalize();
        if (!arrived && seat && flight.t > 0.62) {
          arrived = true;
          onArrive?.(seat);
        }
      },
      onComplete: () => {
        this.busy = false;
        this.seat = seat;
      },
    });
  }

  // Reduced motion: fade out, move, fade back in.
  crossfadeTo(seat, { onLeave, onArrive }) {
    const from = this.seat;
    gsap.timeline({ onComplete: () => (this.busy = false) })
      .to(this.fade, { opacity: 1, duration: 0.25, ease: 'power1.in' })
      .call(() => {
        if (from) onLeave?.(from, true);
        if (seat) onArrive?.(seat, true);
        this.seat = seat;
        this.position.copy(eyeOf(seat));
        this.direction.copy(gazeOf(seat, this.position));
      })
      .to(this.fade, { opacity: 0, duration: 0.35, ease: 'power1.out' });
  }

  // 4D: a sudden knock (gunshots, explosions).
  jolt(amount) {
    if (!this.reduced) this.shake.jolt = Math.min(1.5, this.shake.jolt + amount);
  }

  update(dt) {
    // Head turn towards the pointer, once seated (not in the overview, where you aim at seats,
    // not on touch screens, and not with reduced motion).
    const follow = this.seat && !this.busy && this.pointer.active && !this.drag.active && !this.reduced;
    const k = 1 - Math.exp(-dt * 3);
    this.parallax.yaw += ((follow ? -this.pointer.x * 0.05 : 0) - this.parallax.yaw) * k;
    this.parallax.pitch += ((follow ? this.pointer.y * 0.03 : 0) - this.parallax.pitch) * k;

    // After a drag: glide on, then drift back to the screen.
    if (!this.drag.active) {
      this.drag.idle += dt;
      const friction = Math.exp(-dt * 5);
      this.drag.vYaw *= friction;
      this.drag.vPitch *= friction;
      this.drag.yaw = THREE.MathUtils.clamp(this.drag.yaw + this.drag.vYaw * dt, -2.1, 2.1);
      this.drag.pitch = THREE.MathUtils.clamp(this.drag.pitch + this.drag.vPitch * dt, -0.9, 0.9);
      if (this.drag.idle > 1.2 && !this.reduced) {
        const back = Math.exp(-dt * 2.2);
        this.drag.yaw *= back;
        this.drag.pitch *= back;
      }
    }

    // 4D seat effects: a rumble, a slow sway in the wind, and jolts that die away.
    const shake = this.shake;
    shake.time += dt;
    shake.jolt *= Math.exp(-dt * 7);
    const quiet = this.reduced ? 0 : 1;
    const rumble = (shake.rumble + shake.jolt) * quiet;
    const sway = shake.sway * quiet;

    const baseYaw = Math.atan2(-this.direction.x, -this.direction.z);
    const basePitch = Math.asin(THREE.MathUtils.clamp(this.direction.y, -1, 1));
    const yaw = baseYaw + this.parallax.yaw + this.drag.yaw + this.tilt.yaw
      + wobble(shake.time, 1) * 0.006 * rumble + Math.sin(shake.time * 1.7) * 0.012 * sway;
    const pitch = THREE.MathUtils.clamp(
      basePitch + this.parallax.pitch + this.drag.pitch + this.tilt.pitch + wobble(shake.time, 4) * 0.005 * rumble,
      -1.3,
      1.3
    );
    const roll = wobble(shake.time, 7) * 0.004 * rumble + Math.sin(shake.time * 1.3 + 1) * 0.008 * sway;

    this.camera.position.copy(this.position);
    this.camera.position.y += wobble(shake.time, 9) * 0.012 * rumble - shake.jolt * 0.02 * quiet;
    this.camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  }
}
