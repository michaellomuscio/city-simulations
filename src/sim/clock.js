// Time of day, the sun and moon, and the daily rhythms that drive traffic,
// foot traffic and lit windows.

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class Clock {
  constructor(hour = 16.5, day = 1) {
    this.seconds = hour * 3600;
    this.day = day;
  }

  advance(simSeconds) {
    this.seconds += simSeconds;
    while (this.seconds >= 86400) {
      this.seconds -= 86400;
      this.day++;
    }
    while (this.seconds < 0) {
      this.seconds += 86400;
      this.day = Math.max(1, this.day - 1);
    }
  }

  setHour(h) {
    this.seconds = ((h % 24) + 24) % 24 * 3600;
  }

  get hour() {
    return this.seconds / 3600;
  }

  get weekday() {
    return DAYS[(this.day - 1) % 7];
  }

  get weekend() {
    return (this.day - 1) % 7 >= 5;
  }

  /** "07:42" */
  label() {
    const m = Math.floor(this.seconds / 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}

/** Unit vector toward the sun (x east, y up, z south). Sunrise 06:30, sunset 18:30. */
export function sunDirection(hour, out = [0, 0, 0]) {
  const theta = ((hour - 6.5) / 12) * Math.PI;
  const tilt = (58 * Math.PI) / 180; // peak elevation
  const up = Math.sin(theta);
  const x = Math.cos(theta);
  const y = up * Math.sin(tilt);
  const z = up * Math.cos(tilt) + 0.12;
  const l = Math.hypot(x, y, z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

export function moonDirection(hour, out = [0, 0, 0]) {
  sunDirection(hour, out);
  const x = -out[0] * 0.9 + 0.15;
  const y = -out[1] + 0.12;
  const z = -out[2] * 0.8 + 0.25;
  const l = Math.hypot(x, y, z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

/** Piecewise-linear lookup in a 24-entry hourly table, wrapping at midnight. */
function hourly(table, hour) {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  return table[i] + (table[(i + 1) % 24] - table[i]) * t;
}

const TRAFFIC = [0.2, 0.14, 0.1, 0.09, 0.11, 0.22, 0.46, 0.85, 1.0, 0.82, 0.66, 0.64, 0.72, 0.7, 0.66, 0.72, 0.88, 1.0, 0.95, 0.75, 0.56, 0.45, 0.36, 0.27];
const TRAFFIC_WEEKEND = [0.26, 0.2, 0.14, 0.1, 0.09, 0.12, 0.2, 0.3, 0.42, 0.55, 0.66, 0.72, 0.76, 0.76, 0.74, 0.72, 0.72, 0.72, 0.7, 0.62, 0.52, 0.45, 0.4, 0.32];
const FOOT = [0.1, 0.07, 0.05, 0.04, 0.05, 0.1, 0.25, 0.55, 0.8, 0.75, 0.8, 0.9, 1.0, 1.0, 0.9, 0.85, 0.9, 0.95, 0.9, 0.75, 0.6, 0.45, 0.3, 0.18];

export function trafficLevel(hour, weekend = false) {
  return hourly(weekend ? TRAFFIC_WEEKEND : TRAFFIC, hour);
}

export function footLevel(hour) {
  return hourly(FOOT, hour);
}

// Share of windows lit, by building use (office, residential, retail, industrial, civic).
const LIT = [
  [0.08, 0.06, 0.06, 0.06, 0.06, 0.08, 0.2, 0.55, 0.8, 0.85, 0.85, 0.85, 0.82, 0.85, 0.85, 0.85, 0.82, 0.72, 0.5, 0.32, 0.22, 0.16, 0.12, 0.1],
  [0.14, 0.08, 0.05, 0.04, 0.04, 0.1, 0.24, 0.3, 0.2, 0.12, 0.1, 0.1, 0.12, 0.12, 0.12, 0.15, 0.24, 0.38, 0.5, 0.56, 0.56, 0.5, 0.4, 0.25],
  [0.08, 0.06, 0.06, 0.06, 0.06, 0.08, 0.2, 0.5, 0.85, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.92, 0.85, 0.7, 0.4, 0.15, 0.1],
  [0.45, 0.45, 0.45, 0.45, 0.45, 0.5, 0.65, 0.8, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.8, 0.7, 0.6, 0.5, 0.48, 0.46, 0.45, 0.45],
  [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.6, 0.9, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.9, 0.85, 0.7, 0.55, 0.5, 0.45, 0.35, 0.25, 0.2],
];

export function litShare(useCode, hour) {
  return hourly(LIT[useCode] || LIT[0], hour);
}

// Share of a building's people present, used by the inspector.
const PRESENCE = {
  residential: [0.95, 0.96, 0.97, 0.97, 0.96, 0.93, 0.85, 0.65, 0.42, 0.35, 0.33, 0.35, 0.38, 0.36, 0.36, 0.4, 0.5, 0.65, 0.78, 0.85, 0.9, 0.92, 0.94, 0.95],
  office: [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.06, 0.35, 0.8, 0.95, 0.97, 0.9, 0.75, 0.88, 0.95, 0.93, 0.85, 0.55, 0.22, 0.1, 0.06, 0.04, 0.03, 0.02],
  retail: [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.1, 0.35, 0.65, 0.8, 0.85, 0.9, 0.95, 0.95, 0.9, 0.9, 0.9, 0.9, 0.85, 0.7, 0.5, 0.25, 0.06, 0.03],
};

export function presence(use, hour) {
  const key = use === 'hotel' ? 'residential' : use === 'civic' || use === 'industrial' ? 'office' : use;
  return hourly(PRESENCE[key] || PRESENCE.office, hour);
}
