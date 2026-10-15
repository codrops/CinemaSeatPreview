import * as THREE from 'three/webgpu';
import { Fn, uniform, vec2, vec4, texture, screenUV, screenSize, mix, smoothstep, length, max, abs } from 'three/tsl';
import { seatedEye } from './layout.js';
import { LOOK_AT } from './rig.js';

// "The view from this seat": while you point at a seat on the map, the room is also rendered
// from that seat into a small image, drawn into the map's preview window (an empty, framed
// element in the HTML) as part of the final picture.
export class SeatPreview {
  constructor(renderer, scene, element) {
    this.renderer = renderer;
    this.scene = scene;
    this.element = element;
    this.camera = new THREE.PerspectiveCamera(34, 2.39, 0.05, 120);
    this.target = new THREE.RenderTarget(16, 16, { type: THREE.HalfFloatType });
    this.rect = uniform(new THREE.Vector4(0, 0, 0, 0));
    this.opacity = uniform(0);
    this.seat = null;
    this.tween = null;
  }

  show(seat) {
    this.seat = seat;
    this.camera.position.copy(seatedEye(seat));
    this.camera.lookAt(LOOK_AT);
    this.tween?.kill();
    this.tween = gsap.to(this.opacity, { value: 1, duration: 0.25 });
  }

  hide() {
    this.tween?.kill();
    this.tween = gsap.to(this.opacity, { value: 0, duration: 0.2, onComplete: () => (this.seat = null) });
  }

  // Match the window's place and size on the page.
  layout() {
    const box = this.element.getBoundingClientRect();
    const visible = box.width > 0 && box.height > 0;
    this.rect.value.set(box.left / window.innerWidth, box.top / window.innerHeight, box.width / window.innerWidth, box.height / window.innerHeight);
    if (visible) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      this.target.setSize(Math.round(box.width * dpr), Math.round(box.height * dpr));
      this.camera.aspect = box.width / box.height;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    if (!this.seat || this.opacity.value < 0.001) return;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  // The final picture, with the preview drawn into its rounded window.
  composite(color) {
    return Fn(() => {
      const rect = this.rect;
      // A hidden window has no size: keep the maths finite so nothing else is affected.
      const extent = max(rect.zw, vec2(0.00001));
      const local = screenUV.sub(rect.xy).div(extent);
      const size = extent.mul(screenSize);
      const radius = 9;
      const p = local.sub(0.5).mul(size);
      const d = length(max(abs(p).sub(size.mul(0.5).sub(radius)), 0)).sub(radius);
      const mask = smoothstep(1, -1, d);
      const view = texture(this.target.texture, local);
      const inside = mix(vec4(0.012, 0.011, 0.011, 1), vec4(view.rgb, 1), this.opacity);
      return mix(color, inside, mask);
    })();
  }
}
