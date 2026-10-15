import * as THREE from 'three/webgpu';
import { vec3, positionWorld, normalWorld, instancedBufferAttribute } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEATS, isTaken } from './layout.js';
import { lit } from './light.js';

// People in the taken seats, for atmosphere: simple head-and-shoulders figures, lit by the film.
// Nobody is taller than 1.2 m above their floor (top of the head), which keeps every head
// below every sightline to the bottom of the screen: from any seat, they never block the film.
const HEAD_TOP = 1.2;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Clothes, and hair: mostly dark, some brown or grey.
const CLOTHES = [
  [0.035, 0.03, 0.028],
  [0.05, 0.035, 0.025],
  [0.02, 0.02, 0.024],
  [0.06, 0.055, 0.05],
  [0.03, 0.025, 0.035],
];
const HAIR = [
  [0.008, 0.006, 0.005],
  [0.012, 0.008, 0.006],
  [0.03, 0.018, 0.01],
  [0.05, 0.048, 0.046],
  [0.055, 0.04, 0.03],
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Audience {
  constructor() {
    this.group = new THREE.Group();
    this.people = SEATS.filter(isTaken).map((seat) => ({
      seat,
      height: 0.94 + Math.random() * 0.06,
      width: 0.9 + Math.random() * 0.2,
      turn: (Math.random() - 0.5) * 0.3,
      tilt: (Math.random() - 0.5) * 0.12,
    }));
    const count = this.people.length;

    // Shoulders and body, sitting back in the seat.
    const body = new RoundedBoxGeometry(0.44, 0.52, 0.26, 3, 0.11);
    body.translate(0, 0.74, 0.0);
    // The head (with a little of the neck), turned and tilted per person.
    const head = new THREE.SphereGeometry(0.1, 20, 14);
    head.scale(0.86, 1.05, 1);

    const toneMaterial = (palette) => {
      const tones = new Float32Array(count * 3);
      this.people.forEach((person, i) => tones.set(pick(palette), i * 3));
      const material = new THREE.MeshBasicNodeMaterial();
      material.colorNode = lit(vec3(instancedBufferAttribute(new THREE.InstancedBufferAttribute(tones, 3))), positionWorld, normalWorld);
      return material;
    };

    this.bodies = new THREE.InstancedMesh(body, toneMaterial(CLOTHES), count);
    this.heads = new THREE.InstancedMesh(head, toneMaterial(HAIR), count);
    this.people.forEach((person, i) => {
      this.bodies.setMatrixAt(i, this.bodyMatrix(person));
      this.heads.setMatrixAt(i, this.headMatrix(person));
    });
    this.group.add(this.bodies, this.heads);
    this.nextShift = 2;
  }

  base(person) {
    const { seat } = person;
    return new THREE.Matrix4().compose(
      seat.position,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.angle),
      new THREE.Vector3(1, 1, 1)
    );
  }

  bodyMatrix(person) {
    return this.base(person).multiply(new THREE.Matrix4().makeScale(person.width, person.height, 1));
  }

  headMatrix(person) {
    const centre = HEAD_TOP * person.height - 0.105;
    return this.base(person)
      .multiply(new THREE.Matrix4().makeTranslation(0, centre, -0.02))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(person.tilt, person.turn, 0, 'YXZ')));
  }

  // Now and then someone turns their head a little, as people do in a cinema.
  update(dt) {
    if (reducedMotion.matches || !this.people.length) return;
    this.nextShift -= dt;
    if (this.nextShift > 0) return;
    this.nextShift = 1.5 + Math.random() * 3;
    const i = Math.floor(Math.random() * this.people.length);
    const person = this.people[i];
    gsap.to(person, {
      turn: (Math.random() - 0.5) * 0.6,
      tilt: (Math.random() - 0.5) * 0.14,
      duration: 0.9 + Math.random() * 0.6,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.heads.setMatrixAt(i, this.headMatrix(person));
        this.heads.instanceMatrix.needsUpdate = true;
      },
    });
  }
}
