import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, uniform, texture, mix, smoothstep, fract, floor, exp, abs, dot, normalize, pow, length, vec2, atan,
  clamp, positionWorld, normalWorld, cameraPosition, uv, time, mx_noise_float, triNoise3D, step,
} from 'three/tsl';
import {
  SCREEN, SCREEN_CENTER, ROWS, ROW_FRONT, ROW_DEPTH, ROW_RISE, ARC_CENTER_Z, AISLE_S, AISLE_WIDTH, SEATS_EDGE_S,
  SEAT_S, SEAT_PITCH, ROOM, PLATFORM, STAGE, rowFloor, arcRadius, arcPoint, screenPoint,
} from './layout.js';
import { lit, houseLevel, houseDim, filmAverage, AMBER } from './light.js';

// Collects quads into one geometry. Winding follows the normal, so faces always point the right way.
class Mesher {
  constructor() {
    this.position = [];
    this.normal = [];
    this.uv = [];
    this.index = [];
  }

  quad(a, b, c, d, normals) {
    const n = Array.isArray(normals) ? normals : [normals, normals, normals, normals];
    const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const order = face.dot(n[0]) >= 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const vertices = [a, b, c, d];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const start = this.position.length / 3;
    order.forEach((k) => {
      this.position.push(vertices[k].x, vertices[k].y, vertices[k].z);
      this.normal.push(n[k].x, n[k].y, n[k].z);
      this.uv.push(...uvs[k]);
    });
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setIndex(this.index);
    return geometry;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const inward = (angle) => new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle));
const tangent = (angle) => new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
const onArc = (radius, angle, y) =>
  new THREE.Vector3(radius * Math.sin(angle), y, ARC_CENTER_Z + radius * Math.cos(angle));

// A horizontal ring sector (a step's tread) and the vertical face in front of it (its riser).
function stepSector(mesher, rIn, rOut, yTop, yBottom, sFrom, sTo, segments = 36) {
  const a0 = sFrom / rIn;
  const a1 = sTo / rIn;
  for (let k = 0; k < segments; k++) {
    const t0 = a0 + ((a1 - a0) * k) / segments;
    const t1 = a0 + ((a1 - a0) * (k + 1)) / segments;
    mesher.quad(onArc(rIn, t0, yTop), onArc(rOut, t0, yTop), onArc(rOut, t1, yTop), onArc(rIn, t1, yTop), UP);
    if (yTop > yBottom) {
      mesher.quad(
        onArc(rIn, t0, yBottom), onArc(rIn, t1, yBottom), onArc(rIn, t1, yTop), onArc(rIn, t0, yTop),
        [inward(t0), inward(t1), inward(t1), inward(t0)]
      );
    }
  }
}

function buildFloor() {
  const mesher = new Mesher();
  const wide = 11;
  // Front floor, in front of row A.
  mesher.quad(
    new THREE.Vector3(-wide, 0, -1), new THREE.Vector3(wide, 0, -1),
    new THREE.Vector3(wide, 0, ROW_FRONT + 2), new THREE.Vector3(-wide, 0, ROW_FRONT + 2), UP
  );
  // A low stage under the screen.
  const sx = STAGE.halfWidth;
  const sz = STAGE.depth;
  const sy = STAGE.height;
  mesher.quad(new THREE.Vector3(-sx, sy, 0), new THREE.Vector3(sx, sy, 0), new THREE.Vector3(sx, sy, sz), new THREE.Vector3(-sx, sy, sz), UP);
  mesher.quad(new THREE.Vector3(-sx, 0, sz), new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, sy, sz), new THREE.Vector3(-sx, sy, sz), new THREE.Vector3(0, 0, 1));
  for (const x of [-sx, sx]) {
    mesher.quad(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, sz), new THREE.Vector3(x, sy, sz), new THREE.Vector3(x, sy, 0), new THREE.Vector3(Math.sign(x), 0, 0));
  }
  // One tread and riser per row, then the back cross-aisle.
  for (let row = 0; row <= PLATFORM; row++) {
    const rIn = arcRadius(row);
    const rOut = row === PLATFORM ? arcRadius(row) + 8 : arcRadius(row + 1);
    stepSector(mesher, rIn, rOut, rowFloor(row), row === 0 ? 0 : rowFloor(row - 1), -wide, wide, 48);
  }
  // In the aisles, a half step in the back half of every tread.
  for (const s of AISLE_S) {
    for (let row = 1; row <= PLATFORM; row++) {
      const rOut = arcRadius(row);
      const rIn = rOut - ROW_DEPTH / 2;
      const yBottom = rowFloor(row - 1);
      const yTop = yBottom + ROW_RISE / 2;
      const sFrom = s - AISLE_WIDTH / 2;
      const sTo = s + AISLE_WIDTH / 2;
      stepSector(mesher, rIn, rOut, yTop, yBottom, sFrom, sTo, 6);
      for (const [side, sign] of [[sFrom, -1], [sTo, 1]]) {
        const aIn = side / rIn;
        const aOut = side / rOut;
        mesher.quad(
          onArc(rIn, aIn, yBottom), onArc(rOut, aOut, yBottom), onArc(rOut, aOut, yTop), onArc(rIn, aIn, yTop),
          tangent((aIn + aOut) / 2).multiplyScalar(sign)
        );
      }
    }
  }
  return mesher.geometry();
}

// Step lights: small amber LEDs at both ends of every aisle step.
function buildStepLights() {
  const positions = [];
  for (const s of AISLE_S) {
    for (let row = 1; row <= PLATFORM; row++) {
      const half = arcRadius(row) - ROW_DEPTH / 2;
      const steps = [
        [half, rowFloor(row - 1) + ROW_RISE / 2],
        [arcRadius(row), rowFloor(row)],
      ];
      for (const [radius, y] of steps) {
        for (const side of [-1, 1]) {
          const sLight = s + side * (AISLE_WIDTH / 2 - 0.09);
          positions.push({ point: arcPoint(radius - 0.012, sLight, y - 0.035), angle: sLight / radius });
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.022, 0.02), null, positions.length);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  positions.forEach(({ point, angle }, i) => {
    rotation.setFromAxisAngle(UP, angle);
    mesh.setMatrixAt(i, matrix.compose(point, rotation, new THREE.Vector3(1, 1, 1)));
  });
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = AMBER.mul(mix(float(2.2), float(3.5), houseDim));
  mesh.material = material;
  return mesh;
}

// A soft light strip along the stage's front edge.
function buildStageLight() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(STAGE.halfWidth * 2, 0.02, 0.02));
  mesh.position.set(0, STAGE.height - 0.03, STAGE.depth + 0.011);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec3(1, 0.7, 0.45).mul(0.32);
  mesh.material = material;
  return mesh;
}

// Rough floor height along the room's centre line, for things that follow the rake.
const floorAt = (z) => clamp(z.sub(ROW_FRONT).div(ROW_DEPTH), 0, ROWS).mul(ROW_RISE).add(rowFloor(0)).mul(step(ROW_FRONT, z));

// Carpet, darker under the seats where the screen light can't reach.
const carpetMaterial = () => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const p = positionWorld;
    const grain = mx_noise_float(p.mul(22)).mul(0.18).add(1);
    const radius = length(vec2(p.x, p.z.sub(ARC_CENTER_Z)));
    const rowCoord = radius.sub(ROW_FRONT - ARC_CENTER_Z).div(ROW_DEPTH);
    const inRow = fract(rowCoord);
    const s = abs(radius.mul(atan(p.x, p.z.sub(ARC_CENTER_Z))));
    const inAisle = smoothstep(AISLE_S[1] - AISLE_WIDTH / 2 - 0.05, AISLE_S[1] - AISLE_WIDTH / 2 + 0.05, s)
      .mul(smoothstep(AISLE_S[1] + AISLE_WIDTH / 2 + 0.05, AISLE_S[1] + AISLE_WIDTH / 2 - 0.05, s));
    const inSeats = step(0, rowCoord).mul(step(rowCoord, ROWS)).mul(smoothstep(SEATS_EDGE_S + 0.1, SEATS_EDGE_S - 0.1, s)).mul(inAisle.oneMinus());
    const underSeats = smoothstep(0.3, 0.48, inRow).mul(smoothstep(0.99, 0.86, inRow)).mul(inSeats);
    const albedo = vec3(0.05, 0.034, 0.04).mul(grain).mul(underSeats.mul(-0.7).add(1));
    return lit(albedo, p, normalWorld);
  })();
  return material;
};

// Acoustic slats, and warm sconces washing the side walls with light every 4.5 m.
const wallMaterial = (along) => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const p = positionWorld;
    const t = fract(p[along].mul(5));
    const slat = smoothstep(0, 0.12, t).mul(smoothstep(1, 0.88, t));
    const albedo = vec3(0.075, 0.062, 0.058).mul(mix(float(0.3), float(1), slat));
    const color = lit(albedo, p, normalWorld).toVar();
    if (along === 'z') {
      const zc = floor(p.z.sub(2).div(4.5)).add(0.5).mul(4.5).add(2);
      const ys = floorAt(zc).add(2.5);
      const dz = p.z.sub(zc);
      const above = p.y.sub(ys);
      const wash = exp(dz.mul(dz).mul(-3.2)).mul(smoothstep(-0.15, 0.25, above)).mul(exp(above.mul(-0.45)));
      const fixture = exp(dz.mul(dz).mul(-900)).mul(exp(above.mul(above).mul(-700))).mul(5);
      const level = houseLevel(zc);
      color.addAssign(vec3(1, 0.66, 0.38).mul(wash.mul(0.18).mul(mix(float(0.55), float(1), slat)).add(fixture)).mul(level));
    }
    return color;
  })();
  return material;
};

const plainMaterial = (albedo) => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = lit(vec3(...albedo), positionWorld, normalWorld);
  return material;
};

function plane(width, height, position, rotationY, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.copy(position);
  mesh.rotation.y = rotationY;
  return mesh;
}

function curvedScreenGeometry(width, height, radius, segments = 64) {
  const geometry = new THREE.PlaneGeometry(width, height, segments, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const angle = position.getX(i) / radius;
    position.setXYZ(i, radius * Math.sin(angle), position.getY(i), radius - radius * Math.cos(angle));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function exitTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0c8a3e';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#eafff1';
  ctx.font = '600 58px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 128, 52);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export function buildRoom({ poster, video }) {
  const room = new THREE.Group();
  const H = ROOM.ceiling;
  const W = ROOM.halfWidth;

  room.add(new THREE.Mesh(buildFloor(), carpetMaterial()));
  room.add(buildStepLights());
  room.add(buildStageLight());

  const side = wallMaterial('z');
  const length = ROOM.back + 1;
  room.add(plane(length, H, new THREE.Vector3(-W, H / 2, length / 2 - 1), Math.PI / 2, side));
  room.add(plane(length, H, new THREE.Vector3(W, H / 2, length / 2 - 1), -Math.PI / 2, side));
  room.add(plane(W * 2, H, new THREE.Vector3(0, H / 2, ROOM.back), Math.PI, wallMaterial('x')));

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, length), plainMaterial([0.03, 0.026, 0.026]));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, length / 2 - 1);
  room.add(ceiling);

  // Front wall and the black masking around the screen.
  room.add(plane(W * 2, H, new THREE.Vector3(0, H / 2, -0.05), 0, plainMaterial([0.008, 0.008, 0.009])));
  const masking = new THREE.Mesh(
    curvedScreenGeometry(SCREEN.width + 0.9, SCREEN.height + 0.9, SCREEN.radius),
    plainMaterial([0.004, 0.004, 0.005])
  );
  masking.position.set(0, SCREEN_CENTER.y, -0.03);
  room.add(masking);

  // The screen: the poster until the film plays.
  const showFilm = uniform(0);
  const screenMaterial = new THREE.MeshBasicNodeMaterial();
  screenMaterial.colorNode = mix(texture(poster).rgb, texture(video).rgb, showFilm);
  const screen = new THREE.Mesh(curvedScreenGeometry(SCREEN.width, SCREEN.height, SCREEN.radius), screenMaterial);
  screen.position.y = SCREEN_CENTER.y;
  room.add(screen);

  // Ceiling downlights, part of the house lights.
  const downlights = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 24), null, 20);
  const matrix = new THREE.Matrix4();
  let n = 0;
  for (const x of [-6, -2, 2, 6]) {
    for (const z of [4, 9, 14, 19, 24]) downlights.setMatrixAt(n++, matrix.makeTranslation(x, H - 0.01, z));
  }
  const downlightMaterial = new THREE.MeshBasicNodeMaterial();
  downlightMaterial.colorNode = vec3(1, 0.82, 0.62).mul(houseLevel(positionWorld.z).mul(4));
  downlights.material = downlightMaterial;
  room.add(downlights);

  // Doors at the back, with exit signs above them and by the front.
  const doorMaterial = plainMaterial([0.02, 0.018, 0.018]);
  const exitMaterial = new THREE.MeshBasicNodeMaterial();
  exitMaterial.colorNode = texture(exitTexture()).rgb.mul(2.2);
  const platformY = rowFloor(PLATFORM);
  for (const x of [-7.3, 7.3]) {
    room.add(plane(1.5, 2.3, new THREE.Vector3(x, platformY + 1.15, ROOM.back - 0.02), Math.PI, doorMaterial));
    room.add(plane(0.5, 0.19, new THREE.Vector3(x, platformY + 2.6, ROOM.back - 0.03), Math.PI, exitMaterial));
  }
  for (const x of [-W + 0.03, W - 0.03]) {
    room.add(plane(1.4, 2.3, new THREE.Vector3(x, 1.15, 3.2), x < 0 ? Math.PI / 2 : -Math.PI / 2, doorMaterial));
    room.add(plane(0.5, 0.19, new THREE.Vector3(x, 2.6, 3.2), x < 0 ? Math.PI / 2 : -Math.PI / 2, exitMaterial));
  }

  // The projection booth window, and the beam from it to the screen.
  const lens = new THREE.Vector3(0, 8.6, ROOM.back - 0.05);
  const boothMaterial = new THREE.MeshBasicNodeMaterial();
  boothMaterial.colorNode = mix(vec3(0.5, 0.45, 0.4), vec3(0.6, 0.7, 0.85).add(filmAverage.mul(2)), houseDim).mul(1.6);
  room.add(plane(1.8, 0.75, new THREE.Vector3(0, lens.y, ROOM.back - 0.03), Math.PI, boothMaterial));

  const beamLength = lens.distanceTo(SCREEN_CENTER);
  const beamGeometry = new THREE.CylinderGeometry(1, 0.06, beamLength, 48, 1, true);
  const beamMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  beamMaterial.colorNode = Fn(() => {
    const p = positionWorld;
    const view = normalize(cameraPosition.sub(p));
    const facing = pow(abs(dot(normalWorld, view)), 2.5);
    const along = uv().y;
    const ends = smoothstep(0.0, 0.12, along).mul(smoothstep(1.0, 0.82, along));
    const dust = triNoise3D(p.mul(0.35), 0.08, time).mul(1.4).add(0.3);
    return filmAverage.add(0.02).mul(facing).mul(ends).mul(dust).mul(houseDim).mul(0.09);
  })();
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  const axis = new THREE.Vector3().subVectors(SCREEN_CENTER, lens).normalize();
  const xAxis = new THREE.Vector3().crossVectors(axis, UP).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, axis).normalize();
  beam.matrixAutoUpdate = false;
  beam.matrix
    .makeBasis(xAxis, axis, zAxis)
    .scale(new THREE.Vector3(SCREEN.width / 2, 1, SCREEN.height / 2))
    .setPosition(lens.clone().add(SCREEN_CENTER).multiplyScalar(0.5));
  beam.renderOrder = 10;
  room.add(beam);

  return { room, showFilm };
}
