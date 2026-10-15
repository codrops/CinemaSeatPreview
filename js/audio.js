import * as THREE from 'three/webgpu';
import { SCREEN, SCREEN_CENTER } from './layout.js';

// The film's sound comes from the screen: its left and right channels play from speakers
// behind the left and right of the screen, placed in 3D, so you hear it from where you sit.
// A short, soft echo makes it sound like a room.
export class CinemaAudio {
  constructor(video) {
    this.video = video;
    this.context = null;
    this.muted = false;
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
  }

  // Needs a click or tap first (browsers only start audio after one).
  async start() {
    if (this.context) return this.context.resume();
    const context = (this.context = new AudioContext());
    const source = context.createMediaElementSource(this.video);
    const splitter = context.createChannelSplitter(2);
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    source.connect(splitter);

    for (const [channel, x] of [[0, -SCREEN.width * 0.3], [1, SCREEN.width * 0.3]]) {
      const panner = new PannerNode(context, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 9,
        rolloffFactor: 0.5,
        positionX: x,
        positionY: SCREEN_CENTER.y,
        positionZ: 0.3,
      });
      splitter.connect(panner, channel);
      panner.connect(this.master);
    }

    const echo = context.createConvolver();
    echo.buffer = this.roomResponse(context);
    const wet = context.createGain();
    wet.gain.value = 0.16;
    this.master.connect(context.destination);
    this.master.connect(echo).connect(wet).connect(context.destination);
    await context.resume();
  }

  // A short burst of decaying noise, the "sound" of a carpeted cinema.
  roomResponse(context) {
    const length = Math.floor(context.sampleRate * 1.1);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
    }
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.05);
    else this.video.muted = muted;
  }

  // The listener is the camera.
  update(camera) {
    if (!this.context) return;
    const listener = this.context.listener;
    const p = camera.position;
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (listener.positionX) {
      const t = this.context.currentTime;
      listener.positionX.setValueAtTime(p.x, t);
      listener.positionY.setValueAtTime(p.y, t);
      listener.positionZ.setValueAtTime(p.z, t);
      listener.forwardX.setValueAtTime(this.forward.x, t);
      listener.forwardY.setValueAtTime(this.forward.y, t);
      listener.forwardZ.setValueAtTime(this.forward.z, t);
      listener.upX.setValueAtTime(this.up.x, t);
      listener.upY.setValueAtTime(this.up.y, t);
      listener.upZ.setValueAtTime(this.up.z, t);
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
  }
}
