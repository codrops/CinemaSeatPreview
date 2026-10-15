import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { SEATS, ROWS, ROW_LETTERS, SEATS_PER_ROW, seatAt, isTaken, priceOf } from './layout.js';
import { houseDim } from './light.js';
import { buildRoom } from './room.js';
import { Seats } from './seats.js';
import { Film } from './film.js';
import { Rig } from './rig.js';
import { Effects } from './effects.js';
import { CueTrack } from './cues.js';
import { CinemaAudio } from './audio.js';
import { Gyro, canTilt } from './gyro.js';
import { SeatPreview } from './preview.js';
import { SeatMap } from './map.js';
import { Audience } from './audience.js';

const $ = (selector) => document.querySelector(selector);
const dom = {
  theater: $('.theater'),
  label: $('.seat-label'),
  labelText: $('.seat-label__pill'),
  play: $('.dock__play'),
  stop: $('.dock__stop'),
  status: $('.dock__status'),
  add: $('.dock__add'),
  stand: $('.dock__stand'),
  fx: $('.dock__fx'),
  sound: $('.dock__sound'),
  tilt: $('.dock__tilt'),
  seatsButton: $('.dock__seats'),
  keys: $('.keys'),
  toast: $('.toast'),
  fade: $('.fade'),
  video: $('.film'),
  panel: $('.panel'),
  panelClose: $('.panel__close'),
  map: $('.map'),
  previewWindow: $('.preview__window'),
  previewCaption: $('.preview__caption'),
  tickets: $('.tickets__list'),
  ticketsEmpty: $('.tickets__empty'),
  total: $('.tickets__total'),
  book: $('.tickets__book'),
  loaderLevel: $('.loader__level'),
  loaderPercent: $('.loader__percent'),
};

// The preloader: the battery from the film's first shot, charging as the demo loads.
// Each step is a real stage of loading; the page starts it at 2%, like the film.
const charge = { value: 2 };
function progress(value, duration = 0.45) {
  return new Promise((resolve) => {
    gsap.to(charge, {
      value,
      duration,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        dom.loaderPercent.textContent = `${Math.round(charge.value)}%`;
        dom.loaderLevel.style.transform = `scaleX(${charge.value / 100})`;
      },
      onComplete: resolve,
    });
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
// Where the seat map is a sheet over the view (css/base.css).
const sheetLayout = window.matchMedia('(max-width: 900px), (max-height: 720px)');
const MAX_TICKETS = 8;

const seatName = (seat) => `Row ${ROW_LETTERS[seat.row]} · Seat ${seat.number}`;
const euros = (value) => `€${value.toFixed(2)}`;

async function start() {
  // three.js and the demo's code have loaded.
  progress(30);
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.NeutralToneMapping;
  await renderer.init();
  dom.theater.append(renderer.domElement);
  progress(45);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);

  const film = new Film(dom.video);
  await film.loadPoster('assets/charge-poster.jpg');
  progress(60);
  const { room, showFilm } = buildRoom({ poster: film.poster, video: film.texture });
  const seats = new Seats();
  const audience = new Audience();
  const effects = new Effects();
  scene.add(room, seats.group, audience.group, effects.group);
  // The house lights start down, and come up once everything is ready.
  houseDim.value = 1;
  progress(72);

  const rig = new Rig(camera, { fade: dom.fade });
  const cues = new CueTrack(effects, rig);
  const audio = new CinemaAudio(dom.video);
  const gyro = new Gyro(rig);
  const preview = new SeatPreview(renderer, scene, dom.previewWindow);

  // Bloom for the glowing parts, then the seat preview drawn into its window.
  const pipeline = new THREE.RenderPipeline(renderer);
  const color = pass(scene, camera).getTextureNode('output');
  pipeline.outputNode = preview.composite(color.add(bloom(color, 0.4, 0.5, 0.9)));

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    // About 72° across in landscape; in portrait, keep a usable height of view.
    const vertical = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(36)) / camera.aspect);
    camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vertical), 38, 78);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  resize();
  window.addEventListener('resize', resize);

  // Compile the shaders before the first frame, so it doesn't stall.
  await renderer.compileAsync(scene, camera);
  await document.fonts.ready;
  progress(92);

  // ---- Your tickets ----

  const tickets = new Set();
  let booked = false;

  function updateSeatUI() {
    const seat = rig.seat;
    dom.status.textContent = seat ? seatName(seat) : 'Pick a seat to see its view';
    dom.stand.hidden = !seat;
    dom.add.hidden = !seat;
    if (seat) {
      const inTickets = tickets.has(seat.index);
      dom.add.innerHTML = inTickets
        ? '✓ <span class="dock__add-long">In your tickets</span><span class="dock__add-short">Added</span>'
        : `Add<span class="dock__add-price"> · ${euros(priceOf(seat))}</span>`;
      dom.add.setAttribute('aria-pressed', inTickets);
    }
    map.setCurrent(seat);
    updateKeys();
  }

  function updateTickets() {
    seats.setTickets(tickets);
    map.setTickets(tickets);
    dom.tickets.replaceChildren(
      ...[...tickets].map((index) => {
        const seat = SEATS[index];
        const item = document.createElement('li');
        item.className = `ticket${booked ? ' is-booked' : ''}`;
        item.innerHTML = `
          <button class="ticket__go" type="button" aria-label="Go to ${seatName(seat)}">
            <span class="ticket__row">${ROW_LETTERS[seat.row]}</span><span class="ticket__seat">${seat.number}</span>
          </button>
          <button class="ticket__remove" type="button" aria-label="Remove ${seatName(seat)}">×</button>`;
        item.querySelector('.ticket__go').addEventListener('click', () => go(seat));
        item.querySelector('.ticket__remove').addEventListener('click', () => toggleTicket(seat));
        return item;
      })
    );
    dom.ticketsEmpty.hidden = tickets.size > 0;
    const total = [...tickets].reduce((sum, index) => sum + priceOf(SEATS[index]), 0);
    dom.total.textContent = tickets.size ? `${tickets.size} seat${tickets.size > 1 ? 's' : ''} · ${euros(total)}` : '';
    dom.book.disabled = tickets.size === 0 || booked;
    dom.book.textContent = booked ? 'Booked ✓' : 'Book';
    updateSeatUI();
  }

  function toggleTicket(seat) {
    if (tickets.has(seat.index)) tickets.delete(seat.index);
    else if (tickets.size >= MAX_TICKETS) return toast(`Up to ${MAX_TICKETS} seats per booking`);
    else tickets.add(seat.index);
    booked = false;
    updateTickets();
  }

  let toastTimer;
  function toast(text) {
    dom.toast.textContent = text;
    dom.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2600);
  }

  // ---- Moving: fly to a seat, or back up ----

  const leave = (seat, instant) => seats.setFolded(seat.index, true, instant ? { duration: 0 } : { delay: 0.15 });
  const arrive = (seat, instant) => seats.setFolded(seat.index, false, instant ? { duration: 0 } : { duration: 0.4 });

  function go(seat, quick = false) {
    if (rig.busy || (seat && isTaken(seat)) || seat === rig.seat) return;
    setHovered(null);
    rig.flyTo(seat, { onLeave: leave, onArrive: arrive, quick });
    // The dock catches up when the flight ends.
    const wait = () => (rig.busy ? requestAnimationFrame(wait) : updateSeatUI());
    requestAnimationFrame(wait);
    if (sheetLayout.matches) dom.panel.classList.remove('is-open');
  }

  // The next free seat in a direction, skipping taken ones.
  function nextSeat(seat, dRow, dNumber) {
    if (dNumber) {
      for (let n = seat.number + dNumber; n >= 1 && n <= SEATS_PER_ROW; n += dNumber) {
        const next = seatAt(seat.row, n);
        if (!isTaken(next)) return next;
      }
      return null;
    }
    for (let row = seat.row + dRow; row >= 0 && row < ROWS; row += dRow) {
      const free = SEATS.filter((s) => s.row === row && !isTaken(s));
      if (free.length) return free.reduce((best, s) => (Math.abs(s.s - seat.s) < Math.abs(best.s - seat.s) ? s : best));
    }
    return null;
  }

  // ---- Pointing at seats in the room ----

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hoverAt = { x: 0, y: 0 };
  let hovered = null;

  function setHovered(index) {
    if (index !== null && rig.seat && SEATS[index] === rig.seat) index = null;
    if (index === hovered) return;
    hovered = index;
    const seat = index === null ? null : SEATS[index];
    const free = !!seat && !isTaken(seat);
    seats.setHovered(free ? index : null);
    map.setHovered(index);
    dom.theater.classList.toggle('is-over-seat', free);
    dom.label.classList.toggle('is-visible', !!seat);
    if (seat) {
      dom.labelText.textContent = free ? seatName(seat) : `${seatName(seat)} · Taken`;
      dom.label.classList.toggle('is-taken', !free);
    }
  }

  function pickAt(x, y) {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return seats.pick(raycaster);
  }

  // ---- The map ----

  const map = new SeatMap(dom.map, {
    onPreview: (seat) => {
      if (seat) {
        preview.show(seat);
        dom.previewCaption.textContent = `${seatName(seat)}${isTaken(seat) ? ' · Taken' : ` · ${euros(priceOf(seat))}`}`;
      } else {
        preview.hide();
      }
      dom.panel.classList.toggle('is-previewing', !!seat);
      seats.setHovered(seat && !isTaken(seat) && seat !== rig.seat ? seat.index : null);
    },
    onPick: (seat) => go(seat),
  });

  // ---- Pointer: drag to look, click or tap a seat ----

  const press = { id: null, x: 0, y: 0, lastX: 0, lastY: 0, time: 0, dragging: false };
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    press.id = event.pointerId;
    press.x = press.lastX = event.clientX;
    press.y = press.lastY = event.clientY;
    press.time = performance.now();
    press.dragging = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') {
      rig.setPointer((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
      hoverAt.x = event.clientX;
      hoverAt.y = event.clientY;
    }
    if (press.id !== event.pointerId) return;
    if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) {
      press.dragging = true;
      rig.startDrag();
      dom.theater.classList.add('is-dragging');
      setHovered(null);
    }
    if (press.dragging) {
      const now = performance.now();
      rig.dragBy(event.clientX - press.lastX, event.clientY - press.lastY, (now - press.time) / 1000);
      press.time = now;
    }
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  });
  const release = (event) => {
    if (press.id !== event.pointerId) return;
    if (press.dragging) {
      rig.endDrag();
      dom.theater.classList.remove('is-dragging');
    } else if (event.type === 'pointerup') {
      // The seat lit up under the mouse, or (touch) the one under the finger.
      const index = hovered ?? pickAt(event.clientX, event.clientY);
      if (index !== null) go(SEATS[index]);
    }
    press.id = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    rig.pointer.active = false;
    setHovered(null);
  });

  // ---- Keyboard ----

  window.addEventListener('keydown', (event) => {
    if (event.target.closest('.map, input, textarea')) return;
    const onControl = event.target.closest('button, a');
    const seat = rig.seat;
    if (event.key === 'Escape') {
      if (dom.panel.classList.contains('is-open')) return dom.panel.classList.remove('is-open');
      if (seat) go(null);
      return;
    }
    if (event.key === ' ' && !onControl) {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key.toLowerCase() === 'a' && seat && !onControl) return toggleTicket(seat);
    if (event.key.toLowerCase() === 's' && !dom.stop.hidden && !onControl) return stopFilm();
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    if (!seat) {
      const start = seatAt(6, 11);
      go(isTaken(start) ? (nextSeat(start, 0, 1) ?? nextSeat(start, 0, -1)) : start);
      return;
    }
    const next = nextSeat(seat, move[0], move[1]);
    if (next) go(next, true);
  });

  // The controls, spelled out under the dock and updated as you go.
  function updateKeys() {
    const key = (k) => `<kbd>${k}</kbd>`;
    let items;
    if (!finePointer.matches) {
      items = ['Tap a seat to fly there', gyro.enabled ? 'Drag or tilt to look around' : 'Drag to look around'];
    } else if (rig.seat) {
      items = [
        `${key('←')}${key('→')} Next seat`,
        `${key('↑')}${key('↓')} Row`,
        `${key('A')} Add to tickets`,
        `${key('Esc')} Back up`,
        `${key('Drag')} Look around`,
        `${key('Space')} ${film.playing ? 'Pause' : 'Play'}`,
        ...(dom.stop.hidden ? [] : [`${key('S')} Stop`]),
      ];
    } else {
      items = [
        `${key('Click')} A seat to fly there`,
        `${key('←')}${key('→')}${key('↑')}${key('↓')} Jump into a seat`,
        `${key('Drag')} Look around`,
        `${key('Space')} ${film.playing ? 'Pause' : 'Play'}`,
        ...(dom.stop.hidden ? [] : [`${key('S')} Stop`]),
      ];
    }
    dom.keys.innerHTML = items.map((item) => `<span class="keys__item">${item}</span>`).join('');
  }

  // ---- The dock ----

  dom.add.addEventListener('click', () => rig.seat && toggleTicket(rig.seat));
  dom.stand.addEventListener('click', () => go(null));

  dom.book.addEventListener('click', () => {
    if (!tickets.size) return;
    booked = true;
    const list = [...tickets].map((i) => SEATS[i].label).join(', ');
    toast(`Booked ${list} for Charge. Enjoy the film.`);
    updateTickets();
  });

  const setFx = (on) => {
    effects.enabled = on;
    dom.fx.setAttribute('aria-pressed', on);
  };
  setFx(!reducedMotion);
  dom.fx.addEventListener('click', () => {
    setFx(!effects.enabled);
    toast(effects.enabled ? '4D effects on' : '4D effects off');
  });

  dom.sound.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    dom.sound.setAttribute('aria-pressed', audio.muted);
    dom.sound.setAttribute('aria-label', audio.muted ? 'Turn the sound on' : 'Turn the sound off');
  });

  if (canTilt()) {
    dom.tilt.hidden = false;
    dom.tilt.addEventListener('click', async () => {
      if (gyro.enabled) gyro.disable();
      else if (!(await gyro.enable())) return toast('Tilt needs access to motion');
      dom.tilt.setAttribute('aria-pressed', gyro.enabled);
      updateKeys();
    });
  }

  dom.seatsButton.addEventListener('click', () => dom.panel.classList.toggle('is-open'));
  dom.panelClose.addEventListener('click', () => dom.panel.classList.remove('is-open'));

  // ---- The film and the house lights ----

  let lights = null;
  const dimLights = (down) => {
    lights?.kill();
    lights = gsap.to(houseDim, { value: down ? 1 : 0, duration: down ? 3.2 : 2.4, ease: 'power1.inOut' });
  };

  const setPlaying = (playing) => {
    dom.play.classList.toggle('is-playing', playing);
    dom.play.setAttribute('aria-label', playing ? 'Pause the film' : 'Play the film');
    updateKeys();
  };

  async function togglePlay() {
    if (film.playing) {
      film.pause();
      setPlaying(false);
      return;
    }
    // Playing again right after a stop: rewind now rather than at the end of the fade.
    if (stopped) {
      stopped.kill();
      stopped = null;
      film.rewind();
    }
    try {
      await audio.start();
      await film.play();
    } catch (error) {
      console.warn(error);
      return;
    }
    setPlaying(true);
    dom.stop.hidden = false;
    updateKeys();
    gsap.to(showFilm, { value: 1, duration: 0.6 });
    dimLights(true);
  }
  dom.play.addEventListener('click', togglePlay);

  // Stop: back to the poster, and the house lights come up. The film rewinds once the
  // poster is back (its first frame is black, and would flash on the screen otherwise).
  let stopped = null;
  function stopFilm() {
    film.pause();
    film.showPoster();
    setPlaying(false);
    dom.stop.hidden = true;
    stopped = gsap.to(showFilm, { value: 0, duration: 0.8, onComplete: () => film.rewind() });
    dimLights(false);
    updateKeys();
  }
  dom.stop.addEventListener('click', stopFilm);
  dom.video.addEventListener('ended', stopFilm);

  updateTickets();

  // ---- Render loop ----

  const timer = new THREE.Timer();
  const labelPoint = new THREE.Vector3();
  let first = true;
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const time = timer.getElapsed();

    film.update(dt);
    seats.update(dt);
    audience.update(dt);
    gyro.update(dt);
    cues.update(dom.video.currentTime, film.playing, camera);
    effects.update(dt, time, rig);
    rig.update(dt);
    audio.update(camera);

    // The view moves a little with the head turn, so check what's under the mouse every frame.
    if (rig.pointer.active && press.id === null && !rig.busy) setHovered(pickAt(hoverAt.x, hoverAt.y));
    if (hovered !== null) {
      const seat = SEATS[hovered];
      labelPoint.copy(seat.position).setY(seat.position.y + 1.25).project(camera);
      dom.label.style.transform = `translate(${(labelPoint.x * 0.5 + 0.5) * window.innerWidth}px, ${(-labelPoint.y * 0.5 + 0.5) * window.innerHeight}px)`;
    }

    preview.layout();
    preview.render();
    pipeline.render();

    if (first) {
      first = false;
      progress(100, 0.35).then(() => {
        document.body.classList.remove('loading');
        lights = gsap.to(houseDim, { value: 0, duration: 2.6, delay: 0.3, ease: 'power1.inOut' });
      });
    }
  });
}

start().catch((error) => {
  console.error(error);
  document.body.classList.remove('loading');
  document.body.classList.add('no-3d');
});
