// Road network for the traffic simulation: intersections, lanes, and the turn
// paths that connect lanes through each intersection, plus the sidewalk graph
// pedestrians walk on.

import {
  LANES, ROAD_W, MEDIAN, SPEED, LANE_W, SIDEWALK_W, CROSSWALK_W, STOP_GAP,
  SIDES, SIDE_VEC, OPPOSITE, sideOf, clamp,
} from './constants.js';
import { SignalController } from './signals.js';

const TURN_DS = 0.5; // resampling step for curved paths, meters
const CONFLICT_DIST = 2.4; // paths closer than this cannot be used at the same time
const WIDE_DIST = 4.6; // buses and trucks swing wider, so they also respect near misses

export class Intersection {
  constructor(id, node) {
    this.id = id;
    this.key = node.key;
    this.gi = node.i;
    this.gj = node.j;
    this.x = node.x;
    this.z = node.z;
    this.portal = !!node.portal;
    this.hx = 0; // half extent of the box along x (half width of the north-south road)
    this.hz = 0; // half extent along z (half width of the east-west road)
    this.legs = { N: null, E: null, S: null, W: null };
    this.inLanes = { N: [], E: [], S: [], W: [] }; // lanes arriving from each side
    this.outLanes = { N: [], E: [], S: [], W: [] }; // lanes leaving toward each side
    this.turns = [];
    this.signal = null;
    this.corners = null;
  }

  get legCount() {
    return SIDES.reduce((n, s) => n + (this.legs[s] ? 1 : 0), 0);
  }

  /** Distance from the center to the box edge on a given side. */
  extent(side) {
    return side === 'N' || side === 'S' ? this.hz : this.hx;
  }
}

export class Road {
  constructor(id, edge, a, b) {
    this.id = id;
    this.axis = edge.axis;
    this.cls = edge.cls;
    this.name = edge.name;
    this.bridge = !!edge.bridge;
    this.portal = !!edge.portal;
    this.a = a; // north or west end
    this.b = b; // south or east end
    this.lanesPerDir = LANES[edge.cls];
    this.width = ROAD_W[edge.cls];
    this.median = MEDIAN[edge.cls];
    this.speed = edge.portal ? SPEED.portal : SPEED[edge.cls];
    this.lanesAB = [];
    this.lanesBA = [];
  }
}

export class Lane {
  constructor(id, road, from, to, index) {
    this.kind = 'lane';
    this.id = id;
    this.road = road;
    this.from = from;
    this.to = to;
    this.index = index; // 0 = inner lane next to the center line
    this.dx = Math.sign(to.x - from.x);
    this.dz = Math.sign(to.z - from.z);
    this.exitSide = sideOf(this.dx, this.dz); // side of `from` it leaves through
    this.approachSide = OPPOSITE[this.exitSide]; // side of `to` it arrives from
    const rx = -this.dz;
    const rz = this.dx;
    const off = road.median / 2 + (index + 0.5) * LANE_W;
    this.offset = off;
    const startInset = from.portal ? 0 : from.extent(this.exitSide) + CROSSWALK_W + 0.2;
    const endInset = to.portal ? 0 : to.extent(this.approachSide) + CROSSWALK_W + STOP_GAP;
    this.x0 = from.x + this.dx * startInset + rx * off;
    this.z0 = from.z + this.dz * startInset + rz * off;
    this.x1 = to.x - this.dx * endInset + rx * off;
    this.z1 = to.z - this.dz * endInset + rz * off;
    this.length = Math.hypot(this.x1 - this.x0, this.z1 - this.z0);
    this.speed = road.speed;
    this.cars = []; // ordered front (largest s) to back
    this.outTurns = [];
    this.inTurns = [];
  }

  pose(s, out) {
    out.x = this.x0 + this.dx * s;
    out.z = this.z0 + this.dz * s;
    out.dx = this.dx;
    out.dz = this.dz;
    return out;
  }
}

export class Turn {
  constructor(id, inter, fromLane, toLane) {
    this.kind = 'turn';
    this.id = id;
    this.inter = inter;
    this.fromLane = fromLane;
    this.toLane = toLane;
    this.approachSide = fromLane.approachSide;
    this.exitSide = toLane.exitSide;
    this.movement = movementOf(fromLane, toLane);
    this.cars = [];
    this.reserved = []; // committed cars that have not crossed the stop line yet
    this.trailing = []; // cars that left the turn but whose tail is still on it
    this.claims = []; // cars waiting at the stop line that asked conflicting traffic to hold
    this.conflicts = []; // { turn, sMin, sMax } where s is measured along the other turn
    this.wide = []; // near misses that matter only when a long vehicle is involved
    this.buildPath();
  }

  buildPath() {
    const a = this.fromLane;
    const b = this.toLane;
    const pts = [];
    if (this.movement === 'straight') {
      pts.push([a.x1, a.z1], [b.x0, b.z0]);
    } else {
      // Straight lead-in to the box, a cubic curve through the box, then a lead-out.
      const leadIn = STOP_GAP + CROSSWALK_W * 0.5;
      const leadOut = CROSSWALK_W * 0.5 + 0.2;
      const q0 = [a.x1 + a.dx * leadIn, a.z1 + a.dz * leadIn];
      const q3 = [b.x0 - b.dx * leadOut, b.z0 - b.dz * leadOut];
      const k = a.dx === 0 ? [q0[0], q3[1]] : [q3[0], q0[1]];
      const c1 = [q0[0] + (k[0] - q0[0]) * 0.56, q0[1] + (k[1] - q0[1]) * 0.56];
      const c2 = [q3[0] + (k[0] - q3[0]) * 0.56, q3[1] + (k[1] - q3[1]) * 0.56];
      pts.push([a.x1, a.z1]);
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        pts.push([
          u * u * u * q0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q3[0],
          u * u * u * q0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q3[1],
        ]);
      }
      pts.push([b.x0, b.z0]);
      const r = Math.min(Math.hypot(k[0] - q0[0], k[1] - q0[1]), Math.hypot(k[0] - q3[0], k[1] - q3[1]));
      this.radius = r;
    }
    // Resample at a fixed arc-length step so pose lookups are O(1).
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const n = Math.max(2, Math.ceil(L / TURN_DS) + 1);
    this.length = L;
    this.ds = L / (n - 1);
    this.n = n;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.ds;
      while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
      const span = cum[seg + 1] - cum[seg] || 1;
      const t = clamp((s - cum[seg]) / span, 0, 1);
      this.px[i] = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t;
      this.pz[i] = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t;
    }
    this.pdx = new Float32Array(n);
    this.pdz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const dx = this.px[i1] - this.px[i0];
      const dz = this.pz[i1] - this.pz[i0];
      const l = Math.hypot(dx, dz) || 1;
      this.pdx[i] = dx / l;
      this.pdz[i] = dz / l;
    }
    const base = Math.min(a.speed, b.speed);
    this.speed = this.movement === 'straight' ? base : clamp(Math.sqrt(3.2 * (this.radius || 5)), 3.5, 9);
  }

  pose(s, out) {
    const f = clamp(s, 0, this.length) / this.ds;
    let i = Math.floor(f);
    let t = f - i;
    if (i >= this.n - 1) {
      i = this.n - 2;
      t = 1;
    }
    out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;
    const dx = this.pdx[i] + (this.pdx[i + 1] - this.pdx[i]) * t;
    const dz = this.pdz[i] + (this.pdz[i + 1] - this.pdz[i]) * t;
    const l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l;
    out.dz = dz / l;
    return out;
  }
}

function movementOf(fromLane, toLane) {
  const ax = fromLane.dx;
  const az = fromLane.dz;
  const bx = toLane.dx;
  const bz = toLane.dz;
  if (ax === bx && az === bz) return 'straight';
  // Right of travel direction (ax, az) is (-az, ax).
  if (bx === -az && bz === ax) return 'right';
  if (bx === az && bz === -ax) return 'left';
  return 'uturn';
}

// --- Pedestrian graph ------------------------------------------------------

export class PedNode {
  constructor(id, x, z, inter, corner) {
    this.id = id;
    this.x = x;
    this.z = z;
    this.inter = inter;
    this.corner = corner;
    this.edges = [];
  }
}

export class PedEdge {
  constructor(id, a, b, kind, inter = null, outward = null, side = null) {
    this.id = id;
    this.a = a;
    this.b = b;
    this.kind = kind; // 'sidewalk' | 'crosswalk'
    this.inter = inter; // intersection whose signal controls this crossing
    this.side = side; // for crosswalks: the leg being crossed
    this.walkers = []; // people walking on it right now
    this.length = Math.hypot(b.x - a.x, b.z - a.z);
    this.dx = (b.x - a.x) / (this.length || 1);
    this.dz = (b.z - a.z) / (this.length || 1);
    // Unit vector pointing away from traffic, used to spread walkers across the sidewalk.
    this.ox = outward ? outward[0] : -this.dz;
    this.oz = outward ? outward[1] : this.dx;
    a.edges.push(this);
    b.edges.push(this);
  }

  other(node) {
    return node === this.a ? this.b : this.a;
  }
}

// ---------------------------------------------------------------------------

export function buildNetwork(city, rng) {
  const inters = [];
  const byKey = new Map();
  for (const node of city.nodes) {
    const I = new Intersection(inters.length, node);
    inters.push(I);
    byKey.set(node.key, I);
  }

  const roads = [];
  for (const e of city.edges) {
    const a = byKey.get(e.a);
    const b = byKey.get(e.b);
    const r = new Road(roads.length, e, a, b);
    roads.push(r);
    if (e.axis === 'ns') {
      a.legs.S = r;
      b.legs.N = r;
    } else {
      a.legs.E = r;
      b.legs.W = r;
    }
  }

  // Box sizes come from the widths of the crossing roads.
  for (const I of inters) {
    if (I.portal) continue;
    const ns = I.legs.N || I.legs.S;
    const ew = I.legs.E || I.legs.W;
    I.hx = ns ? ns.width / 2 : 0;
    I.hz = ew ? ew.width / 2 : 0;
  }

  const lanes = [];
  for (const r of roads) {
    for (let k = 0; k < r.lanesPerDir; k++) {
      const ab = new Lane(lanes.length, r, r.a, r.b, k);
      lanes.push(ab);
      r.lanesAB.push(ab);
      const ba = new Lane(lanes.length, r, r.b, r.a, k);
      lanes.push(ba);
      r.lanesBA.push(ba);
    }
  }
  for (const l of lanes) {
    l.to.inLanes[l.approachSide].push(l);
    l.from.outLanes[l.exitSide].push(l);
  }

  // Turn paths. Inner lane (0) carries left turns, the curb lane carries right turns,
  // and every lane may continue straight into the matching lane.
  const turns = [];
  const addTurn = (I, lane, target) => {
    const turn = new Turn(turns.length, I, lane, target);
    turns.push(turn);
    I.turns.push(turn);
    lane.outTurns.push(turn);
    target.inTurns.push(turn);
  };
  for (const I of inters) {
    if (I.portal) continue;
    for (const inSide of SIDES) {
      for (const lane of I.inLanes[inSide]) {
        const n = lane.road.lanesPerDir;
        for (const outSide of SIDES) {
          if (outSide === inSide) continue; // no U-turns
          const exits = I.outLanes[outSide];
          if (!exits.length) continue;
          const probe = movementOf(lane, exits[0]);
          let targets = [];
          if (probe === 'straight') {
            // Straight on, either keeping the lane or moving one lane over (so cars can line
            // up for their next turn without lane changes between intersections).
            const k = Math.min(lane.index, exits.length - 1);
            targets = exits.filter((x) => Math.abs(x.index - k) <= 1);
          } else if (probe === 'left') {
            if (lane.index === 0) targets = exits;
          } else if (probe === 'right') {
            if (lane.index === n - 1) targets = exits;
          }
          for (const t of targets) addTurn(I, lane, t);
        }
      }
    }
    // Where the rules above leave a lane with nowhere to go (two-lane roads meeting at a
    // corner), every lane may make the available turns, each into its matching lane.
    for (const inSide of SIDES) {
      for (const lane of I.inLanes[inSide]) {
        if (lane.outTurns.length) continue;
        for (const outSide of SIDES) {
          if (outSide === inSide || !I.outLanes[outSide].length) continue;
          const exits = I.outLanes[outSide];
          addTurn(I, lane, exits.find((x) => x.index === Math.min(lane.index, exits.length - 1)));
        }
      }
    }
    computeConflicts(I);
  }
  for (const lane of lanes) computeSiblings(lane);

  // Signals at junctions with cross traffic.
  for (const I of inters) {
    if (I.portal) continue;
    const ns = !!(I.legs.N || I.legs.S);
    const ew = !!(I.legs.E || I.legs.W);
    if (ns && ew && I.legCount >= 3) I.signal = new SignalController(I, rng);
  }

  const peds = buildPedGraph(inters, roads);
  linkCrosswalks(turns);

  return {
    inters, roads, lanes, turns, ...peds,
    portalLanesIn: lanes.filter((l) => l.from.portal),
    portalLanesOut: lanes.filter((l) => l.to.portal),
    cityLanes: lanes.filter((l) => !l.from.portal && !l.to.portal),
    signals: inters.filter((I) => I.signal).map((I) => I.signal),
  };
}

/**
 * Turns that leave the same lane overlap at first. For each pair, record how far along
 * the other turn a car must travel before it is clear of this one.
 */
function computeSiblings(lane) {
  const T = lane.outTurns;
  const a = { x: 0, z: 0, dx: 0, dz: 0 };
  const b = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const t of T) t.siblings = [];
  for (const t1 of T) {
    for (const t2 of T) {
      if (t1 === t2) continue;
      // Distance from t2's path to the nearest point of t1, walking along t2.
      let sep = t2.length;
      for (let s = 0; s <= t2.length; s += 0.5) {
        t2.pose(s, b);
        let best = Infinity;
        for (let u = 0; u <= t1.length; u += 0.5) {
          t1.pose(u, a);
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < best) best = d;
        }
        if (best > 2.8) {
          sep = s;
          break;
        }
      }
      t1.siblings.push({ turn: t2, sep });
    }
  }
}

function computeConflicts(I) {
  const T = I.turns;
  // Sample every other point (about 1 m apart) with a bounding box for fast rejection.
  const samples = T.map((t) => {
    const idx = [];
    for (let i = 0; i < t.n; i += 2) idx.push(i);
    if (idx[idx.length - 1] !== t.n - 1) idx.push(t.n - 1);
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (let i = 0; i < t.n; i++) {
      x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]);
      z0 = Math.min(z0, t.pz[i]); z1 = Math.max(z1, t.pz[i]);
    }
    return { idx, x0, x1, z0, z1 };
  });
  const zone = (ta, tb, sa, sb, dist) => {
    const d2 = dist * dist;
    let aMin = Infinity; let aMax = -Infinity; let bMin = Infinity; let bMax = -Infinity;
    for (const i of sa.idx) {
      for (const j of sb.idx) {
        const dx = ta.px[i] - tb.px[j];
        const dz = ta.pz[i] - tb.pz[j];
        if (dx * dx + dz * dz < d2) {
          const si = i * ta.ds;
          const sj = j * tb.ds;
          if (si < aMin) aMin = si;
          if (si > aMax) aMax = si;
          if (sj < bMin) bMin = sj;
          if (sj > bMax) bMax = sj;
        }
      }
    }
    return aMin === Infinity ? null : { aMin, aMax, bMin, bMax };
  };
  for (let a = 0; a < T.length; a++) {
    for (let b = a + 1; b < T.length; b++) {
      const ta = T[a];
      const tb = T[b];
      if (ta.fromLane === tb.fromLane) continue;
      // Merges from different directions are sorted out by car following; side-by-side
      // paths into the same lane (lane shifts) must take turns.
      if (ta.toLane === tb.toLane && ta.approachSide !== tb.approachSide) continue;
      const sa = samples[a];
      const sb = samples[b];
      if (sa.x1 + WIDE_DIST < sb.x0 || sb.x1 + WIDE_DIST < sa.x0 || sa.z1 + WIDE_DIST < sb.z0 || sb.z1 + WIDE_DIST < sa.z0) continue;
      const hit = zone(ta, tb, sa, sb, CONFLICT_DIST);
      if (hit) {
        ta.conflicts.push({ turn: tb, sMin: hit.bMin, sMax: hit.bMax });
        tb.conflicts.push({ turn: ta, sMin: hit.aMin, sMax: hit.aMax });
        continue;
      }
      // Two straight paths stay parallel; anything turning can swing into a neighbor.
      if (ta.movement === 'straight' && tb.movement === 'straight') continue;
      const near = zone(ta, tb, sa, sb, WIDE_DIST);
      if (near) {
        ta.wide.push({ turn: tb, sMin: near.bMin, sMax: near.bMax });
        tb.wide.push({ turn: ta, sMin: near.aMin, sMax: near.aMax });
      }
    }
  }
}

function buildPedGraph(inters, roads) {
  const nodes = [];
  const edges = [];
  const off = SIDEWALK_W / 2;
  for (const I of inters) {
    if (I.portal) continue;
    const ox = I.hx + off;
    const oz = I.hz + off;
    const mk = (c, x, z) => {
      const n = new PedNode(nodes.length, x, z, I, c);
      nodes.push(n);
      return n;
    };
    I.corners = {
      NE: mk('NE', I.x + ox, I.z - oz),
      NW: mk('NW', I.x - ox, I.z - oz),
      SE: mk('SE', I.x + ox, I.z + oz),
      SW: mk('SW', I.x - ox, I.z + oz),
    };
    I.crosswalks = { N: null, E: null, S: null, W: null };
    const C = I.corners;
    const pairs = { N: [C.NW, C.NE], S: [C.SW, C.SE], E: [C.NE, C.SE], W: [C.NW, C.SW] };
    for (const side of SIDES) {
      const [p, q] = pairs[side];
      const v = SIDE_VEC[side];
      if (I.legs[side]) {
        const e = new PedEdge(edges.length, p, q, 'crosswalk', I, [v[0], v[1]], side);
        edges.push(e);
        I.crosswalks[side] = e;
      } else {
        edges.push(new PedEdge(edges.length, p, q, 'sidewalk', null, [v[0], v[1]]));
      }
    }
  }
  for (const r of roads) {
    if (r.portal) continue;
    const A = r.a.corners;
    const B = r.b.corners;
    if (r.axis === 'ns') {
      edges.push(new PedEdge(edges.length, A.SE, B.NE, 'sidewalk', null, [1, 0]));
      edges.push(new PedEdge(edges.length, A.SW, B.NW, 'sidewalk', null, [-1, 0]));
    } else {
      edges.push(new PedEdge(edges.length, A.NE, B.NW, 'sidewalk', null, [0, -1]));
      edges.push(new PedEdge(edges.length, A.SE, B.SW, 'sidewalk', null, [0, 1]));
    }
  }
  return { pedNodes: nodes, pedEdges: edges };
}

/** Where each turn path enters the crosswalk on its way out, so cars can stop short of walkers. */
function linkCrosswalks(turns) {
  for (const t of turns) {
    const I = t.inter;
    t.xwalk = I.crosswalks ? I.crosswalks[t.exitSide] : null;
    const [vx, vz] = SIDE_VEC[t.exitSide];
    const edge = I.extent(t.exitSide) - 0.3;
    t.xwalkS = t.length;
    for (let i = 0; i < t.n; i++) {
      if ((t.px[i] - I.x) * vx + (t.pz[i] - I.z) * vz >= edge) {
        t.xwalkS = i * t.ds;
        break;
      }
    }
    // Where along the crosswalk (measured from its first corner) the car drives over it.
    if (t.xwalk) {
      const p = t.pose(Math.min(t.length, t.xwalkS + CROSSWALK_W / 2), { x: 0, z: 0, dx: 0, dz: 0 });
      t.xwalkAt = (p.x - t.xwalk.a.x) * t.xwalk.dx + (p.z - t.xwalk.a.z) * t.xwalk.dz;
    }
  }
}
