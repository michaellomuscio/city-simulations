// Ties the simulation together: one city, its traffic, its pedestrians, the
// clock and the weather. Rendering-free, so it also runs under Node for tests.

import { RNG, hashString } from '../core/rng.js';
import { generateCity, CITY_SIZES } from './cityGen.js';
import { buildNetwork } from './network.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Clock, trafficLevel, footLevel } from './clock.js';
import { Weather } from './weather.js';

export const PHYSICS_DT = 1 / 20;
const MAX_STEPS = 12;

const CAPACITY = {
  small: { cars: 360, peds: 450 },
  medium: { cars: 680, peds: 850 },
  large: { cars: 1000, peds: 1200 },
};

export function seedFrom(text) {
  const t = String(text).trim();
  return /^\d+$/.test(t) ? Number(t) >>> 0 : hashString(t.toLowerCase());
}

export class World {
  constructor({ seed = 1, size = 'medium', traffic = 1, foot = 1, hour = 16.5, weather = 'clear' } = {}) {
    this.seed = seed;
    this.size = CITY_SIZES[size] ? size : 'medium';
    this.trafficDensity = traffic;
    this.footDensity = foot;
    this.city = generateCity({ seed, size: this.size });
    const rng = new RNG(seed ^ 0x5bd1e995);
    this.net = buildNetwork(this.city, rng.fork('signals'));
    const cap = CAPACITY[this.size];
    this.traffic = new Traffic(this.net, rng.fork('traffic'), { maxCars: Math.round(cap.cars * 1.5), busLivery: this.city.busLivery });
    this.peds = new Pedestrians(this.net, rng.fork('peds'), { maxPeds: Math.round(cap.peds * 1.5) });
    this.clock = new Clock(hour);
    this.weather = new Weather(rng.fork('weather'), weather);
    /** Simulated clock seconds per real second at 1x speed (a day lasts 12 minutes). */
    this.clockRate = 120;
    this.accumulator = 0;
    this.simTime = 0;
    this.updateTargets();
    this.traffic.populate(Math.round(this.traffic.target * 0.92));
    this.peds.populate(Math.round(this.peds.target * 0.95));
    // Let queues form at signals before the first frame.
    for (let i = 0; i < 200; i++) this.physicsStep(PHYSICS_DT);
  }

  /** Vehicles the city expects on its streets at a given hour (the demand curve). */
  expectedCars(hour) {
    return CAPACITY[this.size].cars * this.trafficDensity * trafficLevel(hour, this.clock.weekend);
  }

  updateTargets() {
    const cap = CAPACITY[this.size];
    const h = this.clock.hour;
    this.traffic.setTarget(cap.cars * this.trafficDensity * trafficLevel(h, this.clock.weekend));
    const rainFactor = 1 - this.weather.rain * 0.55;
    this.peds.setTarget(cap.peds * this.footDensity * footLevel(h) * rainFactor);
  }

  physicsStep(dt) {
    for (const s of this.net.signals) s.update(dt);
    this.traffic.step(dt);
    this.peds.step(dt);
    this.simTime += dt;
  }

  /** Advance by `realDt` seconds of wall time at `speed`x. Returns the number of physics steps taken. */
  update(realDt, speed) {
    const dt = Math.min(realDt, 0.1) * speed;
    if (dt > 0) {
      const clockDt = dt * this.clockRate;
      this.clock.advance(clockDt);
      this.weather.update(clockDt, Math.min(realDt, 0.1));
      this.updateTargets();
    } else {
      this.weather.update(0, Math.min(realDt, 0.1));
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < MAX_STEPS) {
      this.physicsStep(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    return steps;
  }
}
