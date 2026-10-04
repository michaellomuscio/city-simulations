// Pedestrians wander the sidewalk graph. At signalized corners they cross with
// the parallel green, only when they can finish before it ends, and not while a
// car is driving across the crosswalk. Turning cars in turn yield to them.

import { clamp, STOP_GAP, CROSSWALK_W } from './constants.js';

const FADE_TIME = 0.6;

function removeFrom(arr, x) {
  const i = arr.indexOf(x);
  if (i >= 0) arr.splice(i, 1);
}
const STRIDE = 4.4; // walk-cycle radians per meter
const SHIRTS = ['#c0392b', '#2f6fb3', '#e2b33b', '#3c8f5a', '#e8e3d8', '#2b2d33', '#8e44ad', '#d35400', '#16a085', '#7f8c8d', '#b03a6b', '#f0eadc', '#455a8a', '#9c6b3e'];

export class Pedestrians {
  constructor(net, rng, { maxPeds = 800 } = {}) {
    this.net = net;
    this.rng = rng;
    this.maxPeds = maxPeds;
    this.peds = [];
    this.target = 0;
    this.nextId = 1;
    this.leaving = 0;
    this.walkable = net.pedEdges.filter((e) => e.kind === 'sidewalk' && e.length > 8);
  }

  setTarget(n) {
    this.target = clamp(Math.round(n), 0, this.maxPeds);
  }

  populate(n) {
    while (this.peds.length < n) {
      const p = this.spawn();
      if (!p) break;
      p.fade = 1;
      p.fadeDir = 0;
    }
  }

  spawn() {
    if (this.peds.length >= this.maxPeds || !this.walkable.length) return null;
    const r = this.rng;
    const edge = this.walkable[Math.floor(r.next() * this.walkable.length)];
    const forward = r.chance(0.5);
    const p = {
      id: this.nextId++,
      edge,
      from: forward ? edge.a : edge.b,
      to: forward ? edge.b : edge.a,
      s: r.range(0, edge.length),
      speed: r.range(1.1, 1.65),
      lat: r.range(-0.55, 1.35),
      ox: 0,
      oz: 0,
      blend: 1,
      waiting: false,
      react: 0,
      phase: r.range(0, Math.PI * 2),
      amp: 1,
      fade: 0,
      fadeDir: 1,
      dead: false,
      leaving: false,
      shirt: r.pick(SHIRTS),
      style: r.int(0, 3), // trousers palette index
      skin: r.int(0, 4),
      scale: r.range(0.92, 1.08),
    };
    edge.walkers.push(p);
    this.peds.push(p);
    return p;
  }

  step(dt) {
    let leaving = 0;
    for (const p of this.peds) {
      if (p.fadeDir !== 0) {
        p.fade = clamp(p.fade + (p.fadeDir * dt) / FADE_TIME, 0, 1);
        if (p.fadeDir > 0 && p.fade >= 1) p.fadeDir = 0;
        if (p.fadeDir < 0 && p.fade <= 0) p.dead = true;
      }
      if (p.leaving) leaving++;
      if (p.waiting) {
        if (this.canEnter(p, p.edge)) {
          p.react -= dt;
          if (p.react <= 0) {
            p.waiting = false;
            p.edge.walkers.push(p);
          }
        }
        p.amp = Math.max(0, p.amp - dt * 4);
        if (p.waiting) continue;
      }
      p.amp = Math.min(1, p.amp + dt * 4);
      p.s += p.speed * dt;
      p.phase += p.speed * dt * STRIDE;
      if (p.blend < 1) p.blend = Math.min(1, p.blend + (p.speed * dt) / 1.6);
      if (p.s >= p.edge.length) this.arrive(p);
    }
    if (this.peds.some((p) => p.dead)) {
      for (const p of this.peds) if (p.dead && !p.waiting) removeFrom(p.edge.walkers, p);
      this.peds = this.peds.filter((p) => !p.dead);
    }
    this.leaving = leaving;
    this.balance(dt);
  }

  canEnter(p, edge) {
    if (edge.kind !== 'crosswalk') return true;
    const I = edge.inter;
    if (I.signal && I.signal.walkRemaining(edge.side) < edge.length / p.speed + 0.3) return false;
    return !this.carCrossing(I, edge.side);
  }

  /** Is a car on, or about to drive over, the crosswalk across the `side` leg? */
  carCrossing(I, side) {
    for (const t of I.turns) {
      if (t.exitSide === side) {
        for (const c of t.cars) if (c.s > t.xwalkS - 4 && c.s - c.len < t.xwalkS + CROSSWALK_W + 1) return true;
        for (const c of t.trailing) if (t.length + c.s - c.len < t.length + 0.5) return true;
      }
      if (t.approachSide === side) {
        // Still clearing the crosswalk it drove over when entering.
        for (const c of t.cars) if (c.s - c.len < STOP_GAP + CROSSWALK_W + 0.5) return true;
      }
    }
    // Without a signal, also wait for cars about to turn across.
    if (!I.signal) {
      for (const lane of I.inLanes[side]) if (lane.cars[0] && lane.cars[0].committed) return true;
    }
    return false;
  }

  arrive(p) {
    const node = p.to;
    const prev = p.edge;
    // Prefer carrying on in roughly the same direction.
    const dirx = (p.to.x - p.from.x) / (prev.length || 1);
    const dirz = (p.to.z - p.from.z) / (prev.length || 1);
    let options = node.edges.filter((e) => e !== prev);
    if (!options.length) options = node.edges;
    const weights = options.map((e) => {
      const o = e.other(node);
      const ex = (o.x - node.x) / (e.length || 1);
      const ez = (o.z - node.z) / (e.length || 1);
      const align = ex * dirx + ez * dirz;
      return (e.kind === 'sidewalk' ? 1 : 0.75) * (1.2 + align);
    });
    removeFrom(prev.walkers, p);
    const next = this.rng.weighted(options, weights);
    // Remember the old sideways offset so the walker eases across the corner.
    p.ox = prev.ox * p.lat;
    p.oz = prev.oz * p.lat;
    p.blend = 0;
    p.edge = next;
    p.from = node;
    p.to = next.other(node);
    p.s = 0;
    if (this.canEnter(p, next)) {
      next.walkers.push(p);
    } else {
      p.waiting = true;
      p.s = -this.rng.range(0.2, 1.4);
      p.react = this.rng.range(0.2, 1.6);
    }
  }

  balance(dt) {
    const active = this.peds.length - this.leaving;
    const deficit = this.target - active;
    if (deficit > 0) {
      const n = Math.min(deficit, Math.max(1, Math.round(deficit * dt * 0.5)));
      for (let i = 0; i < n; i++) this.spawn();
    } else if (deficit < -6) {
      const n = Math.min(-deficit, Math.max(1, Math.round(-deficit * dt * 0.2)));
      for (let i = 0; i < n; i++) {
        const p = this.peds[Math.floor(this.rng.next() * this.peds.length)];
        if (p && !p.leaving && !p.waiting) {
          p.leaving = true;
          p.fadeDir = -1;
        }
      }
    }
  }

  /** Position and facing of a walker. */
  pose(p, out) {
    const e = p.edge;
    const len = e.length || 1;
    const dx = (p.to.x - p.from.x) / len;
    const dz = (p.to.z - p.from.z) / len;
    let x = p.from.x + dx * p.s;
    let z = p.from.z + dz * p.s;
    const t = p.blend * p.blend * (3 - 2 * p.blend);
    x += (e.ox * p.lat) * t + p.ox * (1 - t);
    z += (e.oz * p.lat) * t + p.oz * (1 - t);
    out.x = x;
    out.z = z;
    out.dx = dx;
    out.dz = dz;
    return out;
  }

  stats() {
    let crossing = 0;
    let waiting = 0;
    for (const p of this.peds) {
      if (p.waiting) waiting++;
      else if (p.edge.kind === 'crosswalk') crossing++;
    }
    return { count: this.peds.length - this.leaving, crossing, waiting };
  }
}
