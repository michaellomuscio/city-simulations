// Fixed-time traffic signals: north-south green, yellow, all-red, then the same
// for east-west. Pedestrians cross alongside the parallel green (turning cars
// yield to them), so greens are long enough to walk across the other road.

import { SIDEWALK_W } from './constants.js';

const YELLOW = 3;
const ALL_RED = 1.5;
const PED_SPEED = 1.25; // design walking speed, m/s

export class SignalController {
  constructor(inter, rng) {
    this.inter = inter;
    const ns = inter.legs.N || inter.legs.S;
    const ew = inter.legs.E || inter.legs.W;
    // During the north-south green people cross the east-west road, and vice versa.
    this.crossNS = 2 * (inter.hz + SIDEWALK_W / 2);
    this.crossEW = 2 * (inter.hx + SIDEWALK_W / 2);
    const greenNS = Math.max(ns.cls === 'major' ? 20 : 12, Math.ceil(this.crossNS / PED_SPEED + 2));
    const greenEW = Math.max(ew.cls === 'major' ? 20 : 12, Math.ceil(this.crossEW / PED_SPEED + 2));
    this.phases = [
      { id: 'NS_G', dur: greenNS },
      { id: 'NS_Y', dur: YELLOW },
      { id: 'ALL_R', dur: ALL_RED },
      { id: 'EW_G', dur: greenEW },
      { id: 'EW_Y', dur: YELLOW },
      { id: 'ALL_R', dur: ALL_RED },
    ];
    this.cycle = this.phases.reduce((s, p) => s + p.dur, 0);
    // Random starting point so neighboring signals are out of step.
    let t = rng.range(0, this.cycle);
    this.index = 0;
    while (t >= this.phases[this.index].dur) {
      t -= this.phases[this.index].dur;
      this.index++;
    }
    this.elapsed = t;
  }

  update(dt) {
    this.elapsed += dt;
    while (this.elapsed >= this.phases[this.index].dur) {
      this.elapsed -= this.phases[this.index].dur;
      this.index = (this.index + 1) % this.phases.length;
    }
  }

  get phase() {
    return this.phases[this.index];
  }

  /** Seconds until the current phase ends. */
  get remaining() {
    return this.phases[this.index].dur - this.elapsed;
  }

  /** Vehicle signal for traffic arriving from `side`: 'G', 'Y' or 'R'. */
  state(side) {
    const id = this.phases[this.index].id;
    const axis = side === 'N' || side === 'S' ? 'NS' : 'EW';
    if (id === `${axis}_G`) return 'G';
    if (id === `${axis}_Y`) return 'Y';
    return 'R';
  }

  /** True during the all-red that directly follows this approach's yellow (left-turners may clear). */
  clearing(side) {
    const p = this.phases[this.index];
    if (p.id !== 'ALL_R') return false;
    const prev = this.phases[(this.index + this.phases.length - 1) % this.phases.length].id;
    return prev === (side === 'N' || side === 'S' ? 'NS_Y' : 'EW_Y');
  }

  /**
   * Seconds of walk time left on the crosswalk across the `side` leg. People crossing the
   * north or south leg walk east-west, alongside east-west traffic.
   */
  walkRemaining(side) {
    const p = this.phases[this.index];
    const axis = side === 'N' || side === 'S' ? 'EW' : 'NS';
    return p.id === `${axis}_G` ? p.dur - this.elapsed : 0;
  }

  /** Pedestrian signal head for the `side` crosswalk: 'walk', 'flash' or 'stop'. */
  pedLight(side) {
    const left = this.walkRemaining(side);
    const need = (side === 'N' || side === 'S' ? this.crossEW : this.crossNS) / PED_SPEED;
    if (left <= 0) return 'stop';
    return left >= need ? 'walk' : 'flash';
  }

  describe() {
    const id = this.phases[this.index].id;
    const names = {
      NS_G: 'North–south green', NS_Y: 'North–south yellow', EW_G: 'East–west green', EW_Y: 'East–west yellow', ALL_R: 'All red',
    };
    return { label: names[id], remaining: this.remaining, cycle: this.cycle, id };
  }
}
