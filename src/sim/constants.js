// Street dimensions in meters, shared by the generator, the simulation and the renderer.
// Traffic drives on the right.

export const LANE_W = 3.3;
export const GUTTER = 0.5;
export const MEDIAN_W = 2.6;

export const LANES = { minor: 1, major: 2 };
export const ROAD_W = {
  minor: 2 * LANES.minor * LANE_W + 2 * GUTTER, // 7.6 m
  major: 2 * LANES.major * LANE_W + MEDIAN_W + 2 * GUTTER, // 16.8 m
};
export const MEDIAN = { minor: 0, major: MEDIAN_W };

/** Speed limits in m/s. */
export const SPEED = { minor: 11.1, major: 15.3, portal: 22.2 };

export const SIDEWALK_W = 4.2;
export const CROSSWALK_W = 3.4;
/** Distance between the stop line and the crosswalk. */
export const STOP_GAP = 1.0;
export const CURB_H = 0.16;

export const PROMENADE_W = 8;
export const RIVER_W = 64;
export const WATER_Y = -2.2;

/** Length of the highways that leave the city and fade into the haze. */
export const PORTAL_LEN = 1100;

export const SIDES = ['N', 'E', 'S', 'W'];
export const SIDE_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function sideOf(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'E' : 'W';
  return dz > 0 ? 'S' : 'N';
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
