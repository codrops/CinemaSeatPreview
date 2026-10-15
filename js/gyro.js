// Tilt to look around, on phones and tablets: turning and tilting the device turns your head.
// Angles are relative to how the device was held when tilt was switched on.
const wrap = (deg) => ((deg + 540) % 360) - 180;
const rad = (deg) => (deg * Math.PI) / 180;

export const canTilt = () =>
  typeof DeviceOrientationEvent !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export class Gyro {
  constructor(rig) {
    this.rig = rig;
    this.enabled = false;
    this.base = null;
    this.target = { yaw: 0, pitch: 0 };
    this.onOrientation = this.onOrientation.bind(this);
  }

  async enable() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const answer = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (answer !== 'granted') return false;
    }
    this.base = null;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.enabled = true;
    return true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.enabled = false;
    this.target.yaw = this.target.pitch = 0;
  }

  onOrientation({ alpha, beta, gamma }) {
    if (alpha === null) return;
    const angle = screen.orientation?.angle ?? 0;
    // Up/down tilt is beta when held upright, gamma when held sideways.
    const tilt = angle === 90 ? -gamma : angle === 270 || angle === -90 ? gamma : beta;
    if (!this.base) this.base = { alpha, tilt };
    this.target.yaw = rad(wrap(alpha - this.base.alpha));
    this.target.pitch = rad(Math.max(-60, Math.min(60, tilt - this.base.tilt)));
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 8);
    this.rig.tilt.yaw += (this.target.yaw - this.rig.tilt.yaw) * k;
    this.rig.tilt.pitch += (this.target.pitch - this.rig.tilt.pitch) * k;
  }
}
