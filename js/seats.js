import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, abs, dot, normalize, mix, positionWorld, normalWorld, cameraPosition, mx_noise_float,
  instancedDynamicBufferAttribute, instancedBufferAttribute, attribute,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEATS, BLOCKS, SEAT_S, SEAT_PITCH, ROWS, HINGE, rowFloor, arcRadius, arcPoint, isTaken } from './layout.js';
import { lit, lightAt, AMBER } from './light.js';

// A cinema seat, built around the hinge line of its cushion (y up, facing -z).
// The cushion folds up when the seat is empty, like in a real cinema.
export const FOLDED = 1.42;
const CUSHION_HINGE = new THREE.Vector3(0, 0.47, 0.03);

function merge(geometries) {
  const merged = new THREE.BufferGeometry();
  const attributes = ['position', 'normal', 'uv'];
  const data = Object.fromEntries(attributes.map((name) => [name, []]));
  const index = [];
  let offset = 0;
  for (const g of geometries) {
    attributes.forEach((name) => data[name].push(...g.attributes[name].array));
    if (g.index) index.push(...Array.from(g.index.array, (i) => i + offset));
    else for (let i = 0; i < g.attributes.position.count; i++) index.push(i + offset);
    offset += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  merged.setIndex(index);
  merged.setAttribute('ao', new THREE.Float32BufferAttribute(new Float32Array(merged.attributes.position.count).fill(1), 1));
  return merged;
}

// Soft occlusion baked per vertex: lower parts of a seat get less light.
function withOcclusion(geometry, from, to, min) {
  const position = geometry.attributes.position;
  const ao = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, (position.getY(i) - from) / (to - from)));
    ao[i] = min + (1 - min) * t * t * (3 - 2 * t);
  }
  geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  return geometry;
}

function backGeometry() {
  const back = new RoundedBoxGeometry(0.54, 0.64, 0.13, 3, 0.05);
  back.translate(0, 0.32, 0);
  back.rotateX(0.2);
  back.translate(0, 0.44, 0.1);
  return withOcclusion(back, 0.44, 1.08, 0.35);
}

function cushionGeometry() {
  const cushion = new RoundedBoxGeometry(0.52, 0.12, 0.5, 3, 0.045);
  cushion.translate(0, -0.06, -0.25);
  return withOcclusion(cushion, -0.12, 0, 0.55);
}

function armGeometry() {
  const panel = new RoundedBoxGeometry(0.05, 0.6, 0.5, 2, 0.02);
  panel.translate(0, 0.3, -0.06);
  const rest = new RoundedBoxGeometry(0.09, 0.05, 0.56, 2, 0.022);
  rest.translate(0, 0.65, -0.09);
  const arm = merge([panel, rest]);
  return withOcclusion(arm, 0, 0.68, 0.4);
}

const seatMatrix = (point, angle) =>
  new THREE.Matrix4().compose(point, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(1, 1, 1));

export class Seats {
  constructor() {
    const count = SEATS.length;
    this.group = new THREE.Group();
    this.matrices = SEATS.map((seat) => seatMatrix(seat.position, seat.angle));
    // Empty seats are folded up; someone is sitting in the taken ones.
    this.fold = Float32Array.from(SEATS, (seat) => (isTaken(seat) ? 0 : FOLDED));

    // Hover glow per seat, shared by the backs and the cushions.
    this.hover = new Float32Array(count);
    this.hoverTarget = new Float32Array(count);
    this.hoverAttribute = new THREE.InstancedBufferAttribute(this.hover, 1);
    this.hoverAttribute.setUsage(THREE.DynamicDrawUsage);
    const hover = instancedDynamicBufferAttribute(this.hoverAttribute);

    // Taken seats are darker; seats in your tickets keep a faint amber glow.
    this.taken = new Float32Array(count);
    SEATS.forEach((seat) => (this.taken[seat.index] = isTaken(seat) ? 1 : 0));
    const taken = instancedBufferAttribute(new THREE.InstancedBufferAttribute(this.taken, 1));
    this.ticket = new Float32Array(count);
    this.ticketAttribute = new THREE.InstancedBufferAttribute(this.ticket, 1);
    this.ticketAttribute.setUsage(THREE.DynamicDrawUsage);
    const ticket = instancedDynamicBufferAttribute(this.ticketAttribute);

    const fabric = new THREE.MeshBasicNodeMaterial();
    fabric.colorNode = Fn(() => {
      const p = positionWorld;
      const n = normalWorld;
      const weave = mx_noise_float(p.mul(60)).mul(0.12).add(1);
      const base = mix(vec3(0.2, 0.022, 0.03), vec3(0.055, 0.03, 0.032), taken);
      const albedo = mix(base, vec3(0.36, 0.12, 0.05), hover.mul(0.6)).mul(weave).mul(attribute('ao', 'float'));
      const rim = float(1).sub(abs(dot(n, normalize(cameraPosition.sub(p)))));
      const glow = AMBER.mul(hover.add(ticket.mul(0.35))).mul(rim.mul(rim).mul(0.8).add(0.05));
      return albedo.mul(lightAt(p, n)).add(glow);
    })();

    this.backs = new THREE.InstancedMesh(backGeometry(), fabric, count);
    this.cushions = new THREE.InstancedMesh(cushionGeometry(), fabric, count);
    this.matrices.forEach((m, i) => this.backs.setMatrixAt(i, m));
    for (let i = 0; i < count; i++) this.updateCushion(i);

    // Armrests between the seats, at both ends of every block.
    const arms = [];
    for (let row = 0; row < ROWS; row++) {
      let first = 0;
      for (const block of BLOCKS) {
        for (let k = 0; k <= block; k++) {
          const s = SEAT_S[first] - SEAT_PITCH / 2 + k * SEAT_PITCH;
          const radius = arcRadius(row, HINGE);
          arms.push(seatMatrix(arcPoint(radius, s, rowFloor(row)), s / radius));
        }
        first += block;
      }
    }
    const plastic = new THREE.MeshBasicNodeMaterial();
    plastic.colorNode = lit(vec3(0.02, 0.017, 0.018).mul(attribute('ao', 'float')), positionWorld, normalWorld);
    this.arms = new THREE.InstancedMesh(armGeometry(), plastic, arms.length);
    arms.forEach((m, i) => this.arms.setMatrixAt(i, m));

    this.group.add(this.backs, this.cushions, this.arms);

    // Simple boxes for picking seats with the pointer. Never rendered.
    const proxy = new THREE.BoxGeometry(0.6, 1.1, 0.78);
    proxy.translate(0, 0.55, -0.18);
    this.proxies = new THREE.InstancedMesh(proxy, new THREE.MeshBasicMaterial(), count);
    this.matrices.forEach((m, i) => this.proxies.setMatrixAt(i, m));
    this.proxies.computeBoundingSphere();
    this.proxies.updateMatrixWorld();
  }

  updateCushion(i) {
    const m = this.matrices[i].clone()
      .multiply(new THREE.Matrix4().makeTranslation(CUSHION_HINGE.x, CUSHION_HINGE.y, CUSHION_HINGE.z))
      .multiply(new THREE.Matrix4().makeRotationX(this.fold[i]));
    this.cushions.setMatrixAt(i, m);
    this.cushions.instanceMatrix.needsUpdate = true;
  }

  // Unfold (sit) or fold up (leave) a seat.
  setFolded(i, folded, { duration = 0.5, delay = 0 } = {}) {
    const state = { fold: this.fold[i] };
    gsap.to(state, {
      fold: folded ? FOLDED : 0,
      duration,
      delay,
      ease: folded ? 'back.out(1.6)' : 'power2.out',
      onUpdate: () => {
        this.fold[i] = state.fold;
        this.updateCushion(i);
      },
    });
  }

  setTickets(indices) {
    this.ticket.fill(0);
    indices.forEach((i) => (this.ticket[i] = 1));
    this.ticketAttribute.needsUpdate = true;
  }

  setHovered(index) {
    this.hoverTarget.fill(0);
    if (index !== null) this.hoverTarget[index] = 1;
  }

  update(dt) {
    let changed = false;
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < this.hover.length; i++) {
      const delta = this.hoverTarget[i] - this.hover[i];
      if (Math.abs(delta) > 0.002) {
        this.hover[i] += delta * k;
        changed = true;
      } else if (delta !== 0) {
        this.hover[i] = this.hoverTarget[i];
        changed = true;
      }
    }
    if (changed) this.hoverAttribute.needsUpdate = true;
  }

  pick(raycaster) {
    const hit = raycaster.intersectObject(this.proxies, false)[0];
    return hit ? hit.instanceId : null;
  }
}
