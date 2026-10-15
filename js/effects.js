import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uniform, uniformArray, uv, texture, mod, fract, sin, mix, smoothstep,
  normalize, length, cross, clamp, pow, abs, max, cameraPosition, cameraWorldMatrix, positionGeometry,
  instancedBufferAttribute, PI,
} from 'three/tsl';
import { SCREEN, STAGE, ROW_FRONT, ROW_DEPTH, ROW_RISE, ROWS, rowFloor } from './layout.js';
import { filmAverage, strobe, houseLevel } from './light.js';

// The 4D effects. Everything moves on the GPU as a function of time and a random seed per
// particle; JavaScript only sets how much of each effect there is (from the cue track in
// cues.js) and fires the spark bursts.

const uTime = uniform(0);
const SPARK_SLOTS = 6;
const SPARKS_PER_BURST = 90;

// A tiling cloud texture for fog and smoke, made once.
function cloudTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period, seed) => {
    const values = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    return (x, y) => values[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  };
  const octaves = [4, 8, 16, 32].map((period, k) => ({ period, amp: 0.5 ** k, at: lattice(period, 1234 + k * 77) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let total = 0;
      for (const { period, amp, at } of octaves) {
        const fx = (x / size) * period;
        const fy = (y / size) * period;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = smooth(fx - ix);
        const ty = smooth(fy - iy);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        total += amp;
      }
      const c = Math.round((v / total) * 255);
      data.set([c, c, c, 255], (y * size + x) * 4);
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

// Floor height under a point, roughly following the stage and the stepped rows.
const floorUnder = Fn(([z]) => {
  const rows = clamp(z.sub(ROW_FRONT).div(ROW_DEPTH), 0, ROWS).mul(ROW_RISE).add(rowFloor(0));
  return mix(mix(float(0), float(STAGE.height), smoothstep(STAGE.depth + 0.3, STAGE.depth - 0.3, z)), rows, smoothstep(ROW_FRONT - 0.3, ROW_FRONT + 0.3, z));
});

// Keeps a point inside a box that travels with the camera, so particles fill the space around you
// wherever you are, while still moving through the room on their own.
const aroundCamera = Fn(([p, box]) => cameraPosition.add(mod(p.sub(cameraPosition).add(box.mul(0.5)), box).sub(box.mul(0.5))));

const cameraRight = cameraWorldMatrix.element(0).xyz;
const cameraUp = cameraWorldMatrix.element(1).xyz;

function seeds(count, extra) {
  const array = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    array[i * 4] = Math.random();
    array[i * 4 + 1] = Math.random();
    array[i * 4 + 2] = Math.random();
    array[i * 4 + 3] = extra ? extra(i) : Math.random();
  }
  return instancedBufferAttribute(new THREE.InstancedBufferAttribute(array, 4));
}

function particles(count, material) {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
  mesh.frustumCulled = false;
  return mesh;
}

// Fog and smoke: soft, slow cloud sprites, lit by the film.
function haze({ count, amount, cloud, center, size, squash, opacity, light }) {
  const seed = seeds(count);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const c = center(seed);
  const s = size(seed);
  material.positionNode = c.add(cameraRight.mul(positionGeometry.x.mul(s))).add(cameraUp.mul(positionGeometry.y.mul(s).mul(squash)));
  material.colorNode = light(c);
  material.opacityNode = Fn(() => {
    const drift = vec2(uTime.mul(0.015), uTime.mul(-0.01)).mul(seed.w.sub(0.5).mul(2));
    const cloudy = pow(texture(cloud, uv().mul(0.7).add(seed.xy).add(drift)).r, 1.6);
    const edge = smoothstep(0.5, 0.12, length(uv().sub(0.5)));
    const near = smoothstep(0.6, 2.2, length(c.sub(cameraPosition)));
    return cloudy.mul(edge).mul(near).mul(opacity(seed)).mul(amount);
  })();
  return particles(count, material);
}

// Light on haze: the film's colour, strongest near the screen, plus the house lights and strobes.
const hazeLight = (gain) => (p) =>
  filmAverage.mul(float(gain).div(p.z.div(11).pow(2).add(1))).add(houseLevel(p.z).mul(vec3(0.06, 0.045, 0.035))).add(strobe.mul(0.4)).add(0.008);

export class Effects {
  constructor() {
    this.group = new THREE.Group();
    this.enabled = true;
    const cloud = cloudTexture();

    this.levels = { fog: 0, smoke: 0, rain: 0, embers: 0, rumble: 0, sway: 0 };
    this.targets = { ...this.levels };
    this.amount = {
      fog: uniform(0),
      smoke: uniform(0),
      rain: uniform(0),
      embers: uniform(0),
    };

    // Fog rolling off the stage edge into the room, and lying low around you.
    const fogLife = 9;
    this.group.add(this.fog = haze({
      count: 110,
      amount: this.amount.fog,
      cloud,
      squash: 0.5,
      center: (seed) => {
        const phase = fract(uTime.div(fogLife).add(seed.x));
        const fromStage = vec3(seed.y.mul(15).sub(7.5), 0, phase.mul(13).add(STAGE.depth));
        const around = aroundCamera(vec3(seed.y.mul(16), 0, seed.z.mul(16).add(uTime.mul(0.5))), vec3(16, 100, 16));
        const p = mix(fromStage, around, smoothstep(0.45, 0.55, seed.w));
        return vec3(p.x, floorUnder(p.z).add(seed.z.mul(0.5)).add(0.35).add(phase.mul(0.4)), p.z);
      },
      size: (seed) => mix(float(2.6), float(5), seed.z).mul(fract(uTime.div(fogLife).add(seed.x)).mul(0.6).add(0.7)),
      opacity: (seed) => sin(fract(uTime.div(fogLife).add(seed.x)).mul(PI)).mul(0.32),
      light: (p) => hazeLight(3.2)(p).add(0.012),
    }));

    // Smoke billowing out of the screen towards the seats, and drifting past you.
    const smokeLife = 4.5;
    this.group.add(this.smoke = haze({
      count: 90,
      amount: this.amount.smoke,
      cloud,
      squash: 0.8,
      center: (seed) => {
        const phase = fract(uTime.div(smokeLife).add(seed.x));
        const out = vec3(
          seed.y.sub(0.5).mul(10).mul(phase.mul(0.6).add(1)),
          seed.z.mul(SCREEN.height).add(SCREEN.bottom).add(phase.mul(1.2)),
          phase.mul(smokeLife * 4.6).mul(seed.w.mul(0.3).add(0.7)).add(0.6)
        );
        const around = aroundCamera(vec3(seed.y.mul(14), seed.z.mul(3), seed.x.mul(14).add(uTime.mul(1.4))), vec3(14, 3, 14));
        return mix(out, around, smoothstep(0.58, 0.62, seed.w));
      },
      size: (seed) => mix(float(2.2), float(5.5), seed.z).mul(fract(uTime.div(smokeLife).add(seed.x)).add(0.6)),
      opacity: (seed) => pow(sin(fract(uTime.div(smokeLife).add(seed.x)).mul(PI)), 0.7).mul(0.2),
      light: hazeLight(5.5),
    }));

    // Drizzle: fine drops falling and blowing around you, catching the screen's light.
    {
      const count = 1400;
      const seed = seeds(count);
      const box = vec3(9, 6, 12);
      const velocity = vec3(1.2, -7, 0.6);
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const speed = seed.w.mul(0.4).add(0.8);
      const center = aroundCamera(seed.xyz.mul(box).add(velocity.mul(speed).mul(uTime)), box);
      const axis = normalize(velocity);
      const side = normalize(cross(axis, normalize(center.sub(cameraPosition))));
      material.positionNode = center.add(axis.mul(positionGeometry.y.mul(0.16))).add(side.mul(positionGeometry.x.mul(0.0035)));
      const distance = length(center.sub(cameraPosition));
      material.colorNode = vec3(0.7, 0.8, 0.9).mul(filmAverage.mul(3).add(0.09).add(strobe.mul(0.3)))
        .mul(smoothstep(1.0, 2.2, distance)).mul(smoothstep(6, 4, distance)).mul(this.amount.rain);
      this.group.add(this.rain = particles(count, material));
    }

    // Embers: small glowing sparks rising slowly around you.
    {
      const count = 320;
      const seed = seeds(count);
      const box = vec3(10, 7, 12);
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const rise = vec3(0.15, 0.85, 0.3).mul(seed.w.mul(0.8).add(0.6));
      const wander = vec3(sin(uTime.mul(1.3).add(seed.x.mul(20))).mul(0.35), 0, sin(uTime.mul(0.9).add(seed.y.mul(17))).mul(0.25));
      const center = aroundCamera(seed.xyz.mul(box).add(rise.mul(uTime)), box).add(wander);
      const size = seed.y.mul(0.03).add(0.018);
      material.positionNode = center.add(cameraRight.mul(positionGeometry.x.mul(size))).add(cameraUp.mul(positionGeometry.y.mul(size)));
      const distance = length(center.sub(cameraPosition));
      const glow = pow(smoothstep(0.5, 0.0, length(uv().sub(0.5))), 2);
      const flicker = sin(uTime.mul(9).add(seed.z.mul(40))).mul(0.35).add(0.65);
      material.colorNode = vec3(1, 0.42, 0.1).mul(3).mul(glow).mul(flicker)
        .mul(smoothstep(0.3, 1.0, distance)).mul(smoothstep(7, 4.5, distance)).mul(this.amount.embers);
      this.group.add(this.embers = particles(count, material));
    }

    // Spark bursts, flying out of the dark towards you. Six burst slots, reused in turn.
    {
      const count = SPARK_SLOTS * SPARKS_PER_BURST;
      const seed = seeds(count, (i) => i % SPARK_SLOTS);
      this.burstOrigins = Array.from({ length: SPARK_SLOTS }, () => new THREE.Vector4(0, -100, 0, -100));
      this.burstDirections = Array.from({ length: SPARK_SLOTS }, () => new THREE.Vector4(0, 0, 1, 0));
      const origins = uniformArray(this.burstOrigins, 'vec4');
      const directions = uniformArray(this.burstDirections, 'vec4');
      this.nextSlot = 0;

      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const slot = int(seed.w);
      const origin = origins.element(slot);
      const direction = directions.element(slot);
      const age = uTime.sub(origin.w);
      const life = seed.x.mul(0.9).add(0.8);
      const alive = smoothstep(0, 0.02, age).mul(smoothstep(life, life.sub(0.15), age));
      const spread = vec3(seed.y, seed.z, fract(seed.x.mul(7.31))).mul(2).sub(1).mul(0.5);
      const v0 = normalize(direction.xyz.add(spread)).mul(direction.w).mul(seed.y.mul(0.8).add(0.5));
      const gravity = vec3(0, -4, 0);
      const center = origin.xyz.add(v0.mul(age)).add(gravity.mul(age.mul(age).mul(0.5)));
      const velocity = v0.add(gravity.mul(age));
      const axis = normalize(velocity);
      const side = normalize(cross(axis, normalize(center.sub(cameraPosition))));
      const stretch = clamp(length(velocity).mul(0.022), 0.015, 0.14).mul(alive);
      material.positionNode = center.add(axis.mul(positionGeometry.y.mul(stretch))).add(side.mul(positionGeometry.x.mul(0.0055).mul(alive)));
      const heat = clamp(float(1).sub(age.div(life)), 0, 1);
      const across = smoothstep(0.5, 0.1, abs(uv().x.sub(0.5)));
      material.colorNode = mix(vec3(1, 0.22, 0.03), vec3(1, 0.85, 0.5), heat.mul(heat)).mul(heat.mul(4)).mul(across).mul(alive)
        .mul(smoothstep(0.6, 1.6, length(center.sub(cameraPosition))));
      this.group.add(this.sparks = particles(count, material));
      this.lastBurst = -10;
    }

    this.strobeColor = new THREE.Vector3();
  }

  // A burst of sparks from a point in front of you, flying past you.
  burst(camera, { speed = 7, spread = 1.4, distance = 4.5 } = {}) {
    if (!this.enabled) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const origin = camera.position.clone()
      .addScaledVector(forward, distance)
      .add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.3) * spread, 0));
    const toward = new THREE.Vector3().subVectors(camera.position, origin).normalize();
    toward.y += 0.35;
    const slot = this.nextSlot;
    this.nextSlot = (slot + 1) % SPARK_SLOTS;
    this.burstOrigins[slot].set(origin.x, origin.y, origin.z, uTime.value);
    this.burstDirections[slot].set(toward.x, toward.y, toward.z, speed);
    this.lastBurst = uTime.value;
  }

  // A strobe flash from the walls.
  flash([r, g, b], intensity = 1) {
    if (!this.enabled) return;
    const flash = { k: intensity };
    gsap.fromTo(flash, { k: intensity }, {
      k: 0,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate: () => this.strobeColor.set(r, g, b).multiplyScalar(flash.k),
    });
  }

  set(levels) {
    Object.assign(this.targets, levels);
  }

  update(dt, time, rig) {
    uTime.value = time;
    const k = 1 - Math.exp(-dt * 2.5);
    for (const name of Object.keys(this.levels)) {
      const target = this.enabled ? this.targets[name] : 0;
      this.levels[name] += (target - this.levels[name]) * k;
    }
    this.amount.fog.value = this.levels.fog;
    this.amount.smoke.value = this.levels.smoke;
    this.amount.rain.value = this.levels.rain;
    this.amount.embers.value = this.levels.embers;
    // Only draw what's there.
    this.fog.visible = this.levels.fog > 0.002;
    this.smoke.visible = this.levels.smoke > 0.002;
    this.rain.visible = this.levels.rain > 0.002;
    this.embers.visible = this.levels.embers > 0.002;
    this.sparks.visible = time - this.lastBurst < 2;
    rig.shake.rumble = this.levels.rumble;
    rig.shake.sway = this.levels.sway;
    if (this.enabled) strobe.value.copy(this.strobeColor);
    else strobe.value.set(0, 0, 0);
  }
}
