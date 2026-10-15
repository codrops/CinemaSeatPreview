import { SEATS, ROWS, ROW_LETTERS, SEATS_PER_ROW, SCREEN, isTaken, isBest, seatAt } from './layout.js';

const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attributes = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

// The seat map: the room seen from above, curved like the real rows, with the screen
// glowing at the top. Point at a seat to preview its view; click it to go and sit there.
export class SeatMap {
  constructor(container, { onPreview, onPick }) {
    this.onPreview = onPreview;
    this.onPick = onPick;
    this.focusIndex = seatAt(6, 11).index;

    const width = 296;
    const margin = 20;
    const xs = SEATS.map((s) => s.position.x);
    const zs = SEATS.map((s) => s.position.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const scale = (width - margin * 2) / (maxX - minX + 0.6);
    const top = 46;
    const minZ = Math.min(...zs);
    const height = top + (Math.max(...zs) - minZ) * scale + 16;
    const px = (x) => width / 2 + x * scale;
    const py = (z) => top + (z - minZ) * scale;

    const svg = (this.svg = el('svg', { viewBox: `0 0 ${width} ${height.toFixed(1)}`, class: 'map__svg', role: 'group', 'aria-label': 'Seat map' }));

    // The screen, a glowing arc above row A.
    const defs = el('defs');
    const blur = el('filter', { id: 'screen-glow', x: '-20%', y: '-200%', width: '140%', height: '500%' });
    blur.append(el('feGaussianBlur', { stdDeviation: 3 }));
    defs.append(blur);
    svg.append(defs);
    const half = (SCREEN.width / 2) * scale;
    const arc = `M ${width / 2 - half} 16 Q ${width / 2} 26 ${width / 2 + half} 16`;
    svg.append(el('path', { d: arc, class: 'map__screen-glow', filter: 'url(#screen-glow)' }));
    svg.append(el('path', { d: arc, class: 'map__screen' }));
    const label = el('text', { x: width / 2, y: 9, class: 'map__screen-label' });
    label.textContent = 'SCREEN';
    svg.append(label);

    // The best seats, behind them.
    const best = SEATS.filter(isBest);
    const bx = best.map((s) => px(s.position.x));
    const by = best.map((s) => py(s.position.z));
    const pad = 6;
    const zone = el('rect', {
      x: Math.min(...bx) - pad,
      y: Math.min(...by) - pad,
      width: Math.max(...bx) - Math.min(...bx) + pad * 2,
      height: Math.max(...by) - Math.min(...by) + pad * 2,
      rx: 7,
      class: 'map__best',
    });
    svg.append(zone);
    const bestLabel = el('text', { x: width / 2, y: Math.min(...by) - pad - 3, class: 'map__best-label' });
    bestLabel.textContent = 'Best view';
    svg.append(bestLabel);

    // Row letters at both ends.
    for (let row = 0; row < ROWS; row++) {
      for (const seat of [seatAt(row, 1), seatAt(row, SEATS_PER_ROW)]) {
        const side = seat.number === 1 ? -1 : 1;
        const text = el('text', { x: px(seat.position.x) + side * 11, y: py(seat.position.z) + 3, class: 'map__row' });
        text.textContent = ROW_LETTERS[row];
        svg.append(text);
      }
    }

    // The seats.
    this.nodes = SEATS.map((seat) => {
      const taken = isTaken(seat);
      const node = el('rect', {
        x: -3.8,
        y: -3.5,
        width: 7.6,
        height: 7,
        rx: 1.8,
        transform: `translate(${px(seat.position.x).toFixed(2)} ${py(seat.position.z).toFixed(2)}) rotate(${((-seat.angle * 180) / Math.PI).toFixed(2)})`,
        class: `map__seat${taken ? ' is-taken' : ''}${isBest(seat) ? ' is-best' : ''}`,
        'data-index': seat.index,
        role: 'button',
        tabindex: seat.index === this.focusIndex ? 0 : -1,
        'aria-label': `Row ${ROW_LETTERS[seat.row]}, seat ${seat.number}${taken ? ', taken' : ''}${isBest(seat) ? ', best view' : ''}`,
      });
      svg.append(node);
      return node;
    });

    container.append(svg);

    const seatOf = (event) => {
      const index = event.target.closest?.('.map__seat')?.dataset.index;
      return index === undefined ? null : SEATS[+index];
    };
    svg.addEventListener('pointerover', (event) => {
      const seat = seatOf(event);
      if (seat && event.pointerType === 'mouse') this.onPreview(seat);
    });
    svg.addEventListener('pointerleave', () => this.onPreview(null));
    svg.addEventListener('click', (event) => {
      const seat = seatOf(event);
      if (!seat || isTaken(seat)) return;
      // After a click (not the keyboard), the keys go back to the room: arrows change seat there.
      if (event.detail > 0) event.target.blur();
      this.onPick(seat);
    });
    svg.addEventListener('focusin', (event) => {
      const seat = seatOf(event);
      if (seat) this.onPreview(seat);
    });
    svg.addEventListener('focusout', (event) => {
      if (!svg.contains(event.relatedTarget)) this.onPreview(null);
    });

    // Arrow keys move between seats on the map, Enter or Space goes there.
    svg.addEventListener('keydown', (event) => {
      const seat = seatOf(event);
      if (!seat) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!isTaken(seat)) this.onPick(seat);
        return;
      }
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const row = seat.row + move[0];
      const number = seat.number + move[1];
      if (row < 0 || row >= ROWS || number < 1 || number > SEATS_PER_ROW) return;
      this.focus(seatAt(row, number));
    });
  }

  focus(seat) {
    this.nodes[this.focusIndex].setAttribute('tabindex', -1);
    this.focusIndex = seat.index;
    const node = this.nodes[seat.index];
    node.setAttribute('tabindex', 0);
    node.focus();
  }

  setCurrent(seat) {
    this.nodes.forEach((node) => node.classList.remove('is-current'));
    if (seat) this.nodes[seat.index].classList.add('is-current');
  }

  setTickets(indices) {
    this.nodes.forEach((node, i) => node.classList.toggle('is-ticket', indices.has(i)));
  }

  setHovered(index) {
    this.nodes.forEach((node) => node.classList.remove('is-hovered'));
    if (index !== null) this.nodes[index].classList.add('is-hovered');
  }
}
