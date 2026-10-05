// Camera modes: free orbit (with keyboard panning), a slow aerial tour, a
// chase camera that follows a car, and a driver's-eye view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp } from '../sim/constants.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Driver's eye for each vehicle, from the car's center: forward, left, and up (meters).
// Each sits just behind the windshield, inside the cab.
const EYE = {
  sedan: { fwd: 0.35, left: 0.37, up: 1.22 },
  taxi: { fwd: 0.4, left: 0.37, up: 1.22 },
  hatch: { fwd: 0.05, left: 0.35, up: 1.24 },
  suv: { fwd: 0.75, left: 0.42, up: 1.45 },
  van: { fwd: 1.4, left: 0.42, up: 1.75 },
  truck: { fwd: 2.8, left: 0.5, up: 2.25 },
  bus: { fwd: 4.8, left: 0.55, up: 2.3 },
};

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minDistance = 6;
    c.maxDistance = 3200;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 1.1;
    c.panSpeed = 1.0;
    c.keys = {};
    this.controls = c;
    this.mode = 'orbit';
    this.car = null;
    this.flight = null;
    this.tourT = 0;
    this.focus = new THREE.Vector3();
    this.bounds = { x0: -1000, x1: 1000, z0: -1000, z1: 1000 };
    this.buildings = [];
    this.keys = new Set();
    this.onModeChange = () => {};
    this._pose = { x: 0, z: 0, dx: 1, dz: 0 };
    this._last = new THREE.Vector3();
    this.alpha = 1;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 'f'].includes(k)) {
        this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('start', () => {
      this.flight = null;
      if (this.mode === 'tour') this.setMode('orbit');
    });
  }

  setBounds(b, downtown, buildings = []) {
    this.bounds = b;
    this.downtown = downtown;
    this.buildings = buildings;
  }

  /** Keep the camera out of buildings by lifting it over their roofs. */
  avoidBuildings() {
    const p = this.camera.position;
    for (const b of this.buildings) {
      const bb = b.bbox;
      if (p.x > bb.x0 - 1.5 && p.x < bb.x1 + 1.5 && p.z > bb.z0 - 1.5 && p.z < bb.z1 + 1.5 && p.y < bb.y1 + 2.5) {
        p.y = bb.y1 + 2.5;
      }
    }
  }

  setMode(mode, car = null) {
    if (this.car && this.car !== car) this.car.pinned = false;
    this.mode = mode;
    this.car = car;
    if (car) car.pinned = true;
    this.controls.enabled = mode !== 'drive';
    this.onModeChange(mode, car);
  }

  get distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Opening shot: the skyline seen across the river. */
  home(city, instant = true) {
    const dt = city.downtown;
    const tallest = Math.max(...city.buildings.map((b) => b.height));
    const target = new THREE.Vector3(dt.x - 30, Math.min(110, tallest * 0.28), dt.z + 20);
    const pos = new THREE.Vector3(dt.x + 560, 230 + tallest * 0.2, city.river.zSouth + 520);
    this.setMode('orbit');
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
    } else {
      this.flyTo(target, pos);
    }
  }

  flyTo(target, position, duration = 1.6) {
    this.flight = {
      t: 0, duration,
      fromT: this.controls.target.clone(), toT: target.clone(),
      fromP: this.camera.position.clone(), toP: position.clone(),
    };
  }

  /** Frame an object of a given size from the current viewing direction. */
  frame(center, size) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.25;
    dir.normalize();
    const dist = clamp(size * 2.4, 40, 1600);
    this.setMode('orbit');
    this.flyTo(center, center.clone().addScaledVector(dir, dist));
  }

  tour() {
    this.setMode('tour');
    const off = this.camera.position.clone().sub(this.controls.target);
    this.tourT = Math.atan2(off.z, off.x);
  }

  follow(car, traffic) {
    this.setMode('follow', car);
    traffic.drawPose(car, this.alpha, this._pose);
    const p = new THREE.Vector3(this._pose.x, 1.5, this._pose.z);
    this._last.copy(p);
    const back = new THREE.Vector3(-this._pose.dx, 0, -this._pose.dz);
    this.flyTo(p, p.clone().addScaledVector(back, 26).add(new THREE.Vector3(0, 11, 0)), 1.2);
  }

  drive(car) {
    this.setMode('drive', car);
    this.flight = null;
  }

  release() {
    this.setMode('orbit');
  }

  /**
   * @param {number} dt wall-clock seconds since the last frame
   * @param {number} alpha interpolation between the last two physics steps
   */
  update(dt, traffic, alpha = 1) {
    const c = this.controls;
    const cam = this.camera;
    this.alpha = alpha;
    if (this.car && (this.car.dead || !traffic.cars.includes(this.car))) {
      // The car left the city or faded out. From the driver's seat, rise to look down on where it was.
      const fromSeat = this.mode === 'drive';
      this.setMode('orbit');
      if (fromSeat) {
        const at = new THREE.Vector3(this._pose.x, 0, this._pose.z);
        this.flyTo(at, at.clone().add(new THREE.Vector3(-this._pose.dx * 50, 38, -this._pose.dz * 50)), 1.4);
      }
    }

    if (this.mode === 'tour' && this.downtown) {
      this.tourT += dt * 0.045;
      const t = this.tourT;
      const r = 560 + Math.sin(t * 1.7) * 200;
      const h = 170 + Math.sin(t * 1.3 + 1) * 110;
      const tx = this.downtown.x + Math.sin(t * 0.9) * 120;
      const tz = this.downtown.z + Math.cos(t * 0.7) * 120;
      c.target.lerp(new THREE.Vector3(tx, 30, tz), 1 - Math.exp(-dt * 0.8));
      const goal = new THREE.Vector3(tx + Math.cos(t) * r, h, tz + Math.sin(t) * r);
      cam.position.lerp(goal, 1 - Math.exp(-dt * 0.8));
    }

    if ((this.mode === 'follow' || this.mode === 'drive') && this.car) {
      traffic.drawPose(this.car, alpha, this._pose);
      const p = new THREE.Vector3(this._pose.x, 1.5, this._pose.z);
      if (this.mode === 'follow') {
        const delta = p.clone().sub(this._last);
        if (!this.flight) {
          cam.position.add(delta);
          c.target.add(delta);
          c.target.lerp(p, 1 - Math.exp(-dt * 3));
        } else {
          this.flight.toT.add(delta);
          this.flight.toP.add(delta);
        }
      } else {
        // Driver's seat: fixed in the cab, so the view moves exactly with the car.
        const e = EYE[this.car.type] || EYE.sedan;
        const { dx, dz } = this._pose;
        cam.position.set(p.x + dx * e.fwd + dz * e.left, e.up, p.z + dz * e.fwd - dx * e.left);
        c.target.set(cam.position.x + dx * 30, e.up - 1.1, cam.position.z + dz * 30);
        cam.lookAt(c.target);
      }
      this._last.copy(p);
    }

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const k = ease(Math.min(1, f.t));
      c.target.lerpVectors(f.fromT, f.toT, k);
      cam.position.lerpVectors(f.fromP, f.toP, k);
      if (f.t >= 1) this.flight = null;
    }

    // Keyboard: WASD / arrows pan, Q and E orbit, R and F zoom.
    if (this.keys.size && this.mode !== 'drive') {
      const dist = this.distance;
      const fwd = new THREE.Vector3().subVectors(c.target, cam.position);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const move = new THREE.Vector3();
      const sp = dist * 0.9 * dt;
      if (this.keys.has('w') || this.keys.has('arrowup')) move.addScaledVector(fwd, sp);
      if (this.keys.has('s') || this.keys.has('arrowdown')) move.addScaledVector(fwd, -sp);
      if (this.keys.has('a') || this.keys.has('arrowleft')) move.addScaledVector(right, -sp);
      if (this.keys.has('d') || this.keys.has('arrowright')) move.addScaledVector(right, sp);
      if (move.lengthSq() > 0) {
        if (this.mode !== 'orbit') this.setMode('orbit');
        c.target.add(move);
        cam.position.add(move);
      }
      const rot = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
      if (rot) {
        const off = cam.position.clone().sub(c.target);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 0.9);
        cam.position.copy(c.target).add(off);
      }
      const zoom = (this.keys.has('f') ? 1 : 0) - (this.keys.has('r') ? 1 : 0);
      if (zoom) {
        const off = cam.position.clone().sub(c.target);
        off.multiplyScalar(1 + zoom * dt * 1.2);
        if (off.length() > c.minDistance && off.length() < c.maxDistance) cam.position.copy(c.target).add(off);
      }
    }

    // Keep the view over the city.
    if (this.mode === 'orbit') {
      const b = this.bounds;
      const pad = 600;
      const tx = clamp(c.target.x, b.x0 - pad, b.x1 + pad);
      const tz = clamp(c.target.z, b.z0 - pad, b.z1 + pad);
      if (tx !== c.target.x || tz !== c.target.z) {
        cam.position.x += tx - c.target.x;
        cam.position.z += tz - c.target.z;
        c.target.x = tx;
        c.target.z = tz;
      }
      c.target.y = clamp(c.target.y, -2, 400);
    }
    if (this.mode !== 'drive') {
      c.update();
      this.avoidBuildings();
    }
    if (cam.position.y < 1.2) cam.position.y = 1.2;

    // Push the near plane out when far away, for depth precision on road paint.
    const near = this.mode === 'drive' ? 0.3 : clamp(Math.min(this.distance, cam.position.y) * 0.02, 0.25, 25);
    if (Math.abs(cam.near - near) > near * 0.1) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.focus.copy(c.target);
  }
}
