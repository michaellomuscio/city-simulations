// Weather as a slow Markov chain over a few regimes. Rendering reads the smoothed
// parameters (cloud cover, rain, fog, wet roads, lightning).

import { clamp } from './constants.js';

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

const TARGETS = {
  clear: { cloud: 0.16, rain: 0, fog: 0, wind: 0.3 },
  cloudy: { cloud: 0.72, rain: 0, fog: 0.12, wind: 0.5 },
  rain: { cloud: 0.9, rain: 0.6, fog: 0.3, wind: 0.6 },
  storm: { cloud: 1, rain: 1, fog: 0.42, wind: 1 },
  fog: { cloud: 0.4, rain: 0, fog: 1, wind: 0.1 },
};

const NEXT = {
  clear: [['clear', 0.4], ['cloudy', 0.45], ['fog', 0.15]],
  cloudy: [['clear', 0.4], ['rain', 0.35], ['cloudy', 0.25]],
  rain: [['cloudy', 0.5], ['rain', 0.25], ['storm', 0.25]],
  storm: [['rain', 0.7], ['cloudy', 0.3]],
  fog: [['clear', 0.55], ['cloudy', 0.45]],
};

export class Weather {
  constructor(rng, kind = 'clear') {
    this.rng = rng;
    this.auto = true;
    this.kind = kind;
    const t = TARGETS[kind];
    this.cloud = t.cloud;
    this.rain = t.rain;
    this.fog = t.fog;
    this.wind = t.wind;
    this.wet = t.rain > 0 ? 1 : 0;
    this.timer = rng.range(3, 7) * 3600;
    this.flash = 0;
    this.nextBolt = rng.range(4, 10);
  }

  /** 'auto' lets the weather change on its own; any kind pins it. */
  setMode(mode) {
    if (mode === 'auto') {
      this.auto = true;
      this.timer = this.rng.range(2, 5) * 3600;
    } else {
      this.auto = false;
      this.kind = mode;
    }
  }

  get mode() {
    return this.auto ? 'auto' : this.kind;
  }

  update(simDt, realDt) {
    if (this.auto) {
      this.timer -= simDt;
      if (this.timer <= 0) {
        const opts = NEXT[this.kind];
        this.kind = this.rng.weighted(opts.map((o) => o[0]), opts.map((o) => o[1]));
        this.timer = this.rng.range(2, 6) * 3600;
      }
    }
    const t = TARGETS[this.kind];
    const k = 1 - Math.exp(-realDt / 3);
    this.cloud += (t.cloud - this.cloud) * k;
    this.rain += (t.rain - this.rain) * k;
    this.fog += (t.fog - this.fog) * k;
    this.wind += (t.wind - this.wind) * k;
    // Streets get wet quickly in rain and dry over a couple of simulated hours.
    if (this.rain > 0.05) this.wet = Math.min(1, this.wet + realDt * this.rain * 0.5);
    else this.wet = Math.max(0, this.wet - simDt / 7200);

    this.flash = Math.max(0, this.flash - realDt * 5);
    if (this.kind === 'storm' && this.rain > 0.6) {
      this.nextBolt -= realDt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = this.rng.range(3, 11);
      }
    }
  }

  /** Air temperature in °C for the HUD. */
  temperature(hour) {
    const daily = Math.sin(((hour - 9) / 24) * Math.PI * 2) * 6;
    return Math.round(16 + daily - this.rain * 4 - this.cloud * 2 + clamp(this.fog, 0, 1) * -1);
  }
}
