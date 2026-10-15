import * as THREE from 'three/webgpu';
import { filmColors, filmAverage, CELLS_X, CELLS_Y } from './light.js';

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

// The film on the screen, and the colours it throws into the room.
export class Film {
  constructor(video) {
    this.video = video;
    this.texture = new THREE.VideoTexture(video);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // The frame is shrunk in two steps (to 64x27, then to the 8x3 light patches),
    // so each patch is a real average of its part of the picture.
    this.small = Object.assign(document.createElement('canvas'), { width: 64, height: 27 });
    this.cells = Object.assign(document.createElement('canvas'), { width: CELLS_X, height: CELLS_Y });
    this.smallContext = this.small.getContext('2d');
    this.cellsContext = this.cells.getContext('2d', { willReadFrequently: true });
    this.targets = filmColors.map(() => new THREE.Vector3());

    this.playing = false;
    if ('requestVideoFrameCallback' in video) {
      const onFrame = () => {
        if (this.playing) this.sample(video);
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
  }

  async loadPoster(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    this.posterImage = image;
    this.poster = new THREE.Texture(image);
    this.poster.colorSpace = THREE.SRGBColorSpace;
    this.poster.needsUpdate = true;
    this.sample(image, true);
  }

  sample(source, instant = false) {
    this.smallContext.drawImage(source, 0, 0, this.small.width, this.small.height);
    this.cellsContext.drawImage(this.small, 0, 0, CELLS_X, CELLS_Y);
    const data = this.cellsContext.getImageData(0, 0, CELLS_X, CELLS_Y).data;
    for (let y = 0; y < CELLS_Y; y++) {
      for (let x = 0; x < CELLS_X; x++) {
        const k = (y * CELLS_X + x) * 4;
        // Canvas rows go top down, the light patches bottom up.
        const target = this.targets[(CELLS_Y - 1 - y) * CELLS_X + x];
        target.set(toLinear(data[k] / 255), toLinear(data[k + 1] / 255), toLinear(data[k + 2] / 255));
      }
    }
    if (instant) filmColors.forEach((c, i) => c.copy(this.targets[i]));
  }

  // Flashes reach the room at once, and fade out a little slower, like a real screen's light.
  update(dt) {
    const average = filmAverage.value.set(0, 0, 0);
    filmColors.forEach((color, i) => {
      const target = this.targets[i];
      const rate = luminance(target) > luminance(color) ? 40 : 14;
      color.lerp(target, 1 - Math.exp(-dt * rate));
      average.add(color);
    });
    average.multiplyScalar(1 / filmColors.length);
  }

  async play() {
    this.video.muted = false;
    await this.video.play();
    this.playing = true;
  }

  pause() {
    this.video.pause();
    this.playing = false;
  }

  // The poster's light again, after the film stops.
  showPoster() {
    this.sample(this.posterImage);
  }

  rewind() {
    this.video.currentTime = 0;
  }
}
