// Click picking: vehicles (oriented boxes), buildings (bounding boxes) and
// intersections (where the click lands on the street).

import * as THREE from 'three';
import { CROSSWALK_W } from '../sim/constants.js';

const HEIGHT = { sedan: 1.5, hatch: 1.5, suv: 1.8, taxi: 1.7, van: 2.3, truck: 3.3, bus: 3.2 };

export class Picker {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pose = { x: 0, z: 0, dx: 1, dz: 0 };
  }

  /** @param {object|null} skip a car to ignore (the one the camera sits in) */
  pick(clientX, clientY, world, skip = null) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    let best = null;
    const consider = (t, hit) => {
      if (t > 0 && (!best || t < best.t)) best = { t, ...hit };
    };

    // Vehicles: slab test in each car's local frame, slightly inflated so small cars are easy to hit.
    for (const c of world.traffic.cars) {
      if (c === skip) continue;
      world.traffic.drawPose(c, world.alpha, this.pose);
      const { x, z, dx, dz } = this.pose;
      const ox = o.x - x;
      const oz = o.z - z;
      const lo = [ox * dx + oz * dz, o.y, -ox * dz + oz * dx];
      const ld = [d.x * dx + d.z * dz, d.y, -d.x * dz + d.z * dx];
      const t = slab(lo, ld, [-c.len / 2 - 0.4, 0, -c.wid / 2 - 0.4], [c.len / 2 + 0.4, HEIGHT[c.type] + 0.3, c.wid / 2 + 0.4]);
      if (t !== null) consider(t * 0.98, { kind: 'car', car: c });
    }

    for (const b of world.city.buildings) {
      const bb = b.bbox;
      const t = slab([o.x, o.y, o.z], [d.x, d.y, d.z], [bb.x0, 0, bb.z0], [bb.x1, bb.y1, bb.z1]);
      if (t !== null) consider(t, { kind: 'building', building: b });
    }

    // Street level: find an intersection under the pointer.
    if (d.y < -1e-4) {
      const t = -o.y / d.y;
      const gx = o.x + d.x * t;
      const gz = o.z + d.z * t;
      if (!best || t < best.t) {
        for (const I of world.net.inters) {
          if (!I.signal) continue;
          if (Math.abs(gx - I.x) < I.hx + CROSSWALK_W + 1 && Math.abs(gz - I.z) < I.hz + CROSSWALK_W + 1) {
            consider(t, { kind: 'intersection', inter: I });
            break;
          }
        }
      }
    }
    return best;
  }
}

/** Ray vs axis-aligned box; returns the entry distance or null. */
function slab(o, d, min, max) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    let a = (min[i] - o[i]) / d[i];
    let b = (max[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return t0 > 0 ? t0 : t1;
}
