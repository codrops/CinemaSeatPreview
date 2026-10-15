import { Vector3 } from 'three/webgpu';
import {
  Fn, Loop, uniform, uniformArray, vec3, float, dot, max, inverseSqrt, smoothstep, mix, PI,
} from 'three/tsl';
import { SCREEN, screenPoint } from './layout.js';

// The film lights the room. The current frame is split into 8x3 patches (film.js samples
// their colours), and each patch lights every surface like a small area light on the screen.
export const CELLS_X = 8;
export const CELLS_Y = 3;
export const CELLS = CELLS_X * CELLS_Y;

const cellPositions = [];
const cellNormals = [];
for (let j = 0; j < CELLS_Y; j++) {
  for (let i = 0; i < CELLS_X; i++) {
    const { position, normal } = screenPoint((i + 0.5) / CELLS_X, (j + 0.5) / CELLS_Y);
    cellPositions.push(position);
    cellNormals.push(normal);
  }
}
const CELL_AREA = (SCREEN.width / CELLS_X) * (SCREEN.height / CELLS_Y);

// Linear colours of the patches, bottom row first. Updated in place by film.js.
export const filmColors = Array.from({ length: CELLS }, () => new Vector3());
export const filmAverage = uniform(new Vector3());

const uFilm = uniformArray(filmColors, 'vec3');
const uCellPosition = uniformArray(cellPositions, 'vec3');
const uCellNormal = uniformArray(cellNormals, 'vec3');

// How strongly the screen lights the room.
export const screenGain = uniform(30);

// The house lights. 0 = up, 1 = down. They go down from the front row to the back.
export const houseDim = uniform(0);
const HOUSE_COLOR = vec3(1.0, 0.74, 0.5);
export const houseGain = uniform(0.55);

export const screenLight = Fn(([p, n]) => {
  const sum = vec3(0).toVar();
  Loop(CELLS, ({ i }) => {
    const toCell = uCellPosition.element(i).sub(p);
    const d2 = dot(toCell, toCell);
    const dir = toCell.mul(inverseSqrt(d2));
    const receive = max(dot(n, dir), 0);
    const emit = max(dot(uCellNormal.element(i), dir.negate()), 0);
    sum.addAssign(uFilm.element(i).mul(receive.mul(emit).div(d2.mul(PI).add(CELL_AREA))));
  });
  return sum.mul(CELL_AREA).mul(screenGain);
});

// 1 where the house lights are up, a faint glow where they're down.
export const houseLevel = Fn(([z]) => {
  const edge = mix(float(-6), float(32), houseDim);
  return mix(float(0.08), float(1), smoothstep(edge.sub(4), edge.add(4), z));
});

const houseLight = Fn(([p, n]) => {
  return HOUSE_COLOR.mul(houseLevel(p.z)).mul(n.y.mul(0.32).add(0.68).pow(2)).mul(houseGain);
});

// 4D strobes: a flash of coloured light from the walls, set by the cue track (effects.js).
export const strobe = uniform(new Vector3());

// All the light reaching a surface: the screen's, the house lights' and the strobes'.
export const lightAt = Fn(([p, n]) => screenLight(p, n).add(houseLight(p, n)).add(strobe.mul(n.y.mul(0.3).add(0.7))));

// Everything in the room uses this: the surface colour under that light.
export const lit = Fn(([albedo, p, n]) => albedo.mul(lightAt(p, n)));

export const AMBER = vec3(1.0, 0.6, 0.22);
