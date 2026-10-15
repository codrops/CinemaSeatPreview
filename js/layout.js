import { Vector3 } from 'three/webgpu';

// The auditorium, in metres. x to the right, y up, z from the screen towards the back.

// A scope screen (2.39:1), slightly curved towards the audience.
export const SCREEN = {
  width: 12,
  height: 12 / 2.39,
  bottom: 2.4,
  radius: 28,
};
export const SCREEN_CENTER = new Vector3(0, SCREEN.bottom + SCREEN.height / 2, 0);

// A point on the screen from its uv (0..1 from the bottom left), with the normal towards the audience.
export function screenPoint(u, v) {
  const angle = (u - 0.5) * SCREEN.width / SCREEN.radius;
  return {
    position: new Vector3(
      SCREEN.radius * Math.sin(angle),
      SCREEN.bottom + v * SCREEN.height,
      SCREEN.radius - SCREEN.radius * Math.cos(angle)
    ),
    normal: new Vector3(-Math.sin(angle), 0, Math.cos(angle)),
  };
}

// Stadium seating: 12 rows (A at the front), each a step higher than the one in front.
// The first row is about as far from the screen as the screen is wide, so the screen
// fills about 60° of the view there (the original demo's front row saw 77°).
export const ROW_LETTERS = 'ABCDEFGHIJKL';
export const ROWS = ROW_LETTERS.length;
export const ROW_FRONT = 10.4;
export const ROW_DEPTH = 1.15;
export const ROW_RISE = 0.42;
export const ROW_BASE = 0.15;

// Rows are arcs around a point behind the screen, so every seat turns a little towards it.
export const ARC_CENTER_Z = -20;

// Seats per block, left to right, with an aisle between blocks.
export const BLOCKS = [4, 14, 4];
export const SEAT_PITCH = 0.62;
export const AISLE_WIDTH = 1.2;

// Distances from a row's front edge: the walking lane, the seat's hinge line.
export const LANE = 0.32;
export const HINGE = 0.75;

export const EYE_SEATED = 1.13;
export const EYE_STANDING = 1.62;

export const ROOM = {
  halfWidth: 9,
  ceiling: 10.4,
  back: 26.6,
};

// A low stage under the screen.
export const STAGE = { halfWidth: 7.4, depth: 2.6, height: 0.55 };

// The back cross-aisle is "row 12" for walking purposes.
export const PLATFORM = ROWS;

export const rowFloor = (row) => ROW_BASE + row * ROW_RISE;
export const rowFront = (row) => ROW_FRONT + row * ROW_DEPTH;
export const arcRadius = (row, offset = 0) => rowFront(row) + offset - ARC_CENTER_Z;

// A point on a row's arc, from its arc length s (0 = the centre line).
export function arcPoint(radius, s, y = 0) {
  const angle = s / radius;
  return new Vector3(radius * Math.sin(angle), y, ARC_CENTER_Z + radius * Math.cos(angle));
}

// Arc positions of the seats (left to right) and of the aisles.
export const SEAT_S = [];
export const AISLE_S = [];
{
  const total = BLOCKS.reduce((sum, n) => sum + n, 0) * SEAT_PITCH + (BLOCKS.length - 1) * AISLE_WIDTH;
  let cursor = -total / 2;
  BLOCKS.forEach((count, block) => {
    for (let k = 0; k < count; k++) SEAT_S.push(cursor + SEAT_PITCH * (k + 0.5));
    cursor += count * SEAT_PITCH;
    if (block < BLOCKS.length - 1) {
      AISLE_S.push(cursor + AISLE_WIDTH / 2);
      cursor += AISLE_WIDTH;
    }
  });
}
export const SEATS_PER_ROW = SEAT_S.length;
export const SEATS_EDGE_S = SEAT_S[SEATS_PER_ROW - 1] + SEAT_PITCH / 2;

export const SEATS = [];
for (let row = 0; row < ROWS; row++) {
  SEAT_S.forEach((s, k) => {
    const radius = arcRadius(row, HINGE);
    SEATS.push({
      index: SEATS.length,
      row,
      number: k + 1,
      label: `${ROW_LETTERS[row]}${k + 1}`,
      s,
      angle: s / radius,
      position: arcPoint(radius, s, rowFloor(row)),
    });
  });
}

export const seatAt = (row, number) => SEATS[row * SEATS_PER_ROW + number - 1];

// Where your eyes are when you sit in a seat, or stand in a row's lane.
export const seatedEye = (seat) => arcPoint(arcRadius(seat.row, HINGE + 0.04), seat.s, rowFloor(seat.row) + EYE_SEATED);
export const laneEye = (row, s) =>
  arcPoint(arcRadius(row, row === PLATFORM ? 0.7 : LANE), s, rowFloor(row) + EYE_STANDING);

// The opening view: from just under the projection booth, looking out over the rows.
export const OVERVIEW_EYE = new Vector3(0, rowFloor(PLATFORM) + 3, ROOM.back - 0.6);
export const OVERVIEW_TARGET = new Vector3(0, 2.4, 9);

// The best view: about two thirds back, in the middle (rows F to H, seats 8 to 15).
export const isBest = (seat) => seat.row >= 5 && seat.row <= 7 && seat.number >= 8 && seat.number <= 15;
export const PRICE = 13;
export const PRICE_BEST = 15;
export const priceOf = (seat) => (isBest(seat) ? PRICE_BEST : PRICE);

// Seats someone else has already booked: small groups, a few more of them in the best rows.
// Seeded, so it's the same every time.
export const TAKEN = new Set();
{
  let state = 20221215;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let row = 0; row < ROWS; row++) {
    let number = 1 + Math.floor(random() * 3);
    while (number <= SEATS_PER_ROW) {
      const seat = seatAt(row, number);
      const busy = isBest(seat) ? 0.42 : 0.24;
      if (random() < busy) {
        const group = 1 + Math.floor(random() * 3);
        for (let k = 0; k < group && number + k <= SEATS_PER_ROW; k++) TAKEN.add(seatAt(row, number + k).index);
        number += group + 1 + Math.floor(random() * 3);
      } else {
        number += 1 + Math.floor(random() * 2);
      }
    }
  }
}
export const isTaken = (seat) => TAKEN.has(seat.index);
