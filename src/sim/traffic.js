// Vehicle simulation. Each car follows the Intelligent Driver Model (IDM) behind
// whatever is ahead of it: another car, a merging car, or a stop line. Entering
// an intersection requires a green (or a yellow it can't stop for), a clear path
// across any conflicting turn, room on the far side, and, for left turns, a gap
// in oncoming traffic.

import { OPPOSITE, clamp } from './constants.js';

export const VEHICLE_TYPES = {
  sedan: { label: 'Sedan', len: 4.6, wid: 1.85, a: 2.2, b: 3.0, vf: 1.0, weight: 38 },
  hatch: { label: 'Hatchback', len: 4.0, wid: 1.75, a: 2.3, b: 3.0, vf: 1.0, weight: 15 },
  suv: { label: 'SUV', len: 4.9, wid: 2.0, a: 2.0, b: 3.0, vf: 1.0, weight: 17 },
  taxi: { label: 'Taxi', len: 4.7, wid: 1.85, a: 2.4, b: 3.2, vf: 1.05, weight: 9 },
  van: { label: 'Delivery van', len: 5.4, wid: 2.05, a: 1.7, b: 2.8, vf: 0.95, weight: 8 },
  truck: { label: 'Box truck', len: 7.6, wid: 2.4, a: 1.2, b: 2.5, vf: 0.88, weight: 5 },
  bus: { label: 'City bus', len: 11.8, wid: 2.55, a: 1.1, b: 2.4, vf: 0.85, weight: 5 },
};
export const TYPE_NAMES = Object.keys(VEHICLE_TYPES);

const PAINT = [
  ['#f2f2ef', 21], ['#1c1d21', 18], ['#b9bec4', 15], ['#6e737a', 14], ['#23395b', 7], ['#a3262a', 8],
  ['#2e5fa8', 5], ['#2f5d4a', 3], ['#c8b89a', 3], ['#d9822b', 2], ['#3f8f8b', 2], ['#5b2a4e', 2],
];

export const WAIT = { NONE: 0, RED: 1, CONFLICT: 2, BLOCKED: 3, YIELD: 4, QUEUE: 5, PEDS: 6 };

const LOOK = 70; // how far ahead a front car evaluates the next intersection, m
const STOP_OFFSET = 1.2; // virtual obstacle beyond the stop line, so cars stop just short of it
const FADE_TIME = 0.8;
const STUCK_LIMIT = 150;

const TURN_WEIGHTS = { straight: 0.55, right: 0.25, left: 0.2 };
const LONG = 7; // vehicles longer than this swing wide through turns
const CLAIM_AFTER = 2.5; // seconds blocked by crossing traffic before asking it to hold
const LEFT_PATIENCE = 25; // seconds a left-turner yields before oncoming traffic lets it through

function removeCar(arr, c) {
  const i = arr.indexOf(c);
  if (i >= 0) arr.splice(i, 1);
}

/** Keeps `arr` ordered from the front-most car (largest s) to the rear-most. */
function insertCar(arr, c) {
  let i = arr.length;
  while (i > 0 && arr[i - 1].s < c.s) i--;
  arr.splice(i, 0, c);
}

export class Traffic {
  constructor(net, rng, { maxCars = 600, busLivery = '#c8392e' } = {}) {
    this.net = net;
    this.rng = rng;
    this.maxCars = maxCars;
    this.busLivery = busLivery;
    this.cars = [];
    this.target = 0;
    this.nextId = 1;
    this.time = 0;
    this.portalTimer = 0;
    this.leaving = 0;
    this.typeWeights = TYPE_NAMES.map((t) => VEHICLE_TYPES[t].weight);
    this._a = { x: 0, z: 0, dx: 0, dz: 0 };
    this._b = { x: 0, z: 0, dx: 0, dz: 0 };
  }

  setTarget(n) {
    this.target = clamp(Math.round(n), 0, this.maxCars);
  }

  /** Fill the streets right away (used when a city is generated). */
  populate(n) {
    const lanes = this.net.cityLanes;
    let tries = 0;
    while (this.cars.length < n && tries < n * 30) {
      tries++;
      const lane = lanes[Math.floor(this.rng.next() * lanes.length)];
      const s = this.rng.range(8, lane.length - 6);
      const c = this.spawn(lane, s, this.rng.range(0.4, 0.9) * lane.speed, false);
      if (c) c.fade = 1;
    }
  }

  step(dt) {
    this.time += dt;
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) cars[i].acc = this.accel(cars[i]);
    for (let i = 0; i < cars.length; i++) this.move(cars[i], dt);
    let w = 0;
    let leaving = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.dead) {
        this.detach(c);
        continue;
      }
      if (c.leaving) leaving++;
      cars[w++] = c;
    }
    cars.length = w;
    this.leaving = leaving;
    this.balance(dt);
  }

  // --- Car following ---------------------------------------------------------

  idm(c, v0, gap, vLead) {
    const v = c.v;
    const sStar = c.s0 + Math.max(0, v * c.T + (v * (v - vLead)) / (2 * Math.sqrt(c.a * c.b)));
    const free = v0 > 0.1 ? (v / v0) ** 4 : 1;
    const g = gap > 0.05 ? gap : 0.05;
    return c.a * (1 - free - (sStar / g) ** 2);
  }

  accel(c) {
    const seg = c.seg;
    const cars = seg.cars;
    const idx = cars.indexOf(c);
    const dist = seg.length - c.s;
    let v0 = seg.speed * c.vf;
    let acc = Infinity;
    c.wait = WAIT.NONE;

    const turn = seg.kind === 'lane' ? c.nextTurn : null;
    if (turn) {
      // Slow down ahead of a curve.
      const vt = turn.movement === 'straight' ? turn.speed * c.vf : turn.speed;
      const vmax = Math.sqrt(vt * vt + 2 * 1.8 * Math.max(0, dist - 3));
      if (vmax < v0) v0 = vmax;
    }

    if (idx > 0) {
      // Follow the car ahead in the same lane or turn.
      const L = cars[idx - 1];
      const gap = L.s - L.len - c.s;
      acc = this.idm(c, v0, gap, L.v);
      if (L.v < 0.5 && gap < 12) c.wait = WAIT.QUEUE;
    } else if (seg.kind === 'lane') {
      if (turn && dist < LOOK) {
        if (!c.committed) {
          const verdict = this.permission(c, turn, dist);
          if (verdict === WAIT.NONE) {
            if (dist < this.commitDistance(c)) this.commit(c, turn);
          } else {
            c.wait = verdict;
            acc = this.idm(c, v0, dist + STOP_OFFSET, 0);
          }
        }
        acc = Math.min(acc, this.lookThrough(c, turn, dist, v0));
        // People crossing where we will drive: pull up and wait short of the crosswalk.
        if (this.pedsInWay(turn)) {
          acc = Math.min(acc, this.idm(c, v0, dist + turn.xwalkS - 1.2 + STOP_OFFSET, 0));
          if (c.wait === WAIT.NONE && dist < 15) c.wait = WAIT.PEDS;
        }
      }
    } else {
      acc = Math.min(acc, this.lookExit(c, seg, dist, v0));
      if (c.s < seg.xwalkS - 0.6 && this.pedsInWay(seg)) {
        acc = Math.min(acc, this.idm(c, v0, seg.xwalkS - 1.2 - c.s + STOP_OFFSET, 0));
        c.wait = WAIT.PEDS;
      }
    }
    if (seg.kind === 'turn') {
      // Cars that left the same lane on a neighboring path are still alongside at first.
      for (const sib of seg.siblings) acc = Math.min(acc, this.followSibling(c, sib, -c.s, v0));
    }

    if (acc === Infinity) acc = this.idm(c, v0, Infinity, 0);
    return clamp(acc, -9, c.a);
  }

  /** Leaders beyond the stop line: cars in the turn, cars merging into the same exit lane, the exit lane's tail. */
  /**
   * Follow cars on a turn that shares our starting lane, including ones whose tail is
   * still on it. `offset` converts their position along the turn into a gap from our front.
   */
  followSibling(c, sib, offset, v0) {
    let acc = Infinity;
    const t = sib.turn;
    for (const o of t.cars) {
      if (o.s + offset > 0 && o.s - o.len < sib.sep) acc = Math.min(acc, this.idm(c, v0, o.s - o.len + offset, o.v));
    }
    for (const o of t.trailing) {
      const s = t.length + o.s;
      if (s - o.len < sib.sep) acc = Math.min(acc, this.idm(c, v0, s - o.len + offset, o.v));
    }
    return acc;
  }

  lookThrough(c, turn, dist, v0) {
    let acc = Infinity;
    for (const sib of turn.siblings) acc = Math.min(acc, this.followSibling(c, sib, dist, v0));
    if (turn.cars.length) {
      const L = turn.cars[turn.cars.length - 1];
      return Math.min(acc, this.idm(c, v0, dist + L.s - L.len, L.v));
    }
    const exit = turn.toLane;
    const mine = dist + turn.length;
    for (const t of exit.inTurns) {
      if (t === turn) continue;
      for (const o of t.cars) {
        const theirs = t.length - o.s;
        if (theirs < mine) acc = Math.min(acc, this.idm(c, v0, mine - theirs - o.len, o.v));
      }
    }
    if (exit.cars.length) {
      const L = exit.cars[exit.cars.length - 1];
      acc = Math.min(acc, this.idm(c, v0, mine + L.s - L.len, L.v));
    }
    return acc;
  }

  lookExit(c, turn, dist, v0) {
    let acc = Infinity;
    const exit = turn.toLane;
    for (const t of exit.inTurns) {
      if (t === turn) continue;
      for (const o of t.cars) {
        const theirs = t.length - o.s;
        if (theirs < dist || (theirs === dist && o.id < c.id)) acc = Math.min(acc, this.idm(c, v0, dist - theirs - o.len, o.v));
      }
    }
    if (exit.cars.length) {
      const L = exit.cars[exit.cars.length - 1];
      acc = Math.min(acc, this.idm(c, v0, dist + L.s - L.len, L.v));
    }
    return acc;
  }

  commitDistance(c) {
    return Math.max(3, (c.v * c.v) / 5 + c.v * 0.3 + 1.5);
  }

  commit(c, turn) {
    c.committed = true;
    c.yieldWait = 0;
    c.claimWait = 0;
    if (c.claim) this.releaseClaim(c);
    turn.reserved.push(c);
  }

  uncommit(c) {
    removeCar(c.nextTurn.reserved, c);
    c.committed = false;
  }

  /** May this car enter `turn` now? Returns WAIT.NONE or the reason it must wait. */
  permission(c, turn, dist) {
    const I = turn.inter;
    const sig = I.signal;
    if (sig) {
      // Left-turners who waited through the green for a gap may clear on yellow, and with a
      // claim also afterwards (crossing traffic holds for them), but never into the walk phase.
      const clearing = turn.movement === 'left' && c.yieldWait > 1 && dist < 4;
      const st = sig.state(turn.approachSide);
      if (st === 'R') {
        const pid = sig.phase.id;
        const held = c.claim === turn && c.claimClearing && pid !== 'PED' && pid !== 'PED_CLEAR';
        if (!held && !(clearing && sig.clearing(turn.approachSide))) return WAIT.RED;
      }
      if (st === 'Y') {
        // Stop if it can be done comfortably.
        const need = (c.v * c.v) / (2 * Math.max(0.5, dist));
        if (need < 3.5 && !clearing) return WAIT.RED;
      }
    }
    const longSelf = c.len > LONG;
    for (const cf of turn.conflicts) if (this.occupied(cf, false) || this.claimedAhead(cf.turn, c, false)) return WAIT.CONFLICT;
    for (const cf of turn.wide) if (this.occupied(cf, !longSelf) || this.claimedAhead(cf.turn, c, !longSelf)) return WAIT.CONFLICT;
    // Don't block the box: the car must fit on the far side.
    const exit = turn.toLane;
    let room = exit.length;
    if (exit.cars.length) {
      const L = exit.cars[exit.cars.length - 1];
      room = L.s - L.len;
    }
    for (const t of exit.inTurns) {
      for (const o of t.cars) room -= o.len + 2.5;
      for (const o of t.reserved) if (o !== c) room -= o.len + 2.5;
    }
    if (room < c.len + 2.5) return WAIT.BLOCKED;
    // While people cross ahead, only one car pulls into the intersection to wait.
    if (turn.cars.length && this.pedsInWay(turn)) return WAIT.PEDS;
    if (turn.movement === 'left') {
      for (const lane of I.inLanes[OPPOSITE[turn.approachSide]]) {
        const o = lane.cars[0];
        // Only oncoming cars that will actually come through matter.
        if (!o || o.committed || o.v < 0.8 || o.wait !== WAIT.NONE) continue;
        if (o.nextTurn && o.nextTurn.movement === 'left') continue;
        const d = lane.length - o.s;
        if (d < LOOK && d / o.v < 4.5) return WAIT.YIELD;
      }
    }
    return WAIT.NONE;
  }

  /** Is anyone on the exit crosswalk within reach of this turn's path (or about to step into it)? */
  pedsInWay(turn) {
    const e = turn.xwalk;
    if (!e || !e.walkers.length) return false;
    for (const p of e.walkers) {
      const forward = p.from === e.a;
      const u = forward ? p.s : e.length - p.s;
      const gap = u - turn.xwalkAt;
      const approaching = forward ? gap < 0 : gap > 0;
      if (Math.abs(gap) < 2.8 || (approaching && Math.abs(gap) < 2.8 + p.speed * 2.5)) return true;
    }
    return false;
  }

  /** Has someone who has been waiting longer than `c` asked traffic on `t` to hold? */
  claimedAhead(t, c, longOnly) {
    for (const o of t.claims) {
      if (o === c || (longOnly && o.len <= LONG)) continue;
      if (!c.claim || o.claimAt < c.claimAt) return true;
    }
    return false;
  }

  /**
   * Fairness at the stop line. A front car that keeps being blocked by crossing traffic
   * during its green (or a left-turner left waiting when its green ends) claims its turn;
   * conflicting cars that arrive later then hold until it has gone.
   */
  updateClaim(c, dt) {
    const turn = c.nextTurn;
    const front = c.seg.kind === 'lane' && !c.committed && turn && c.seg.cars[0] === c && c.seg.length - c.s < 5;
    let want = false;
    let clearingClaim = false;
    if (front) {
      const sig = turn.inter.signal;
      const st = sig ? sig.state(turn.approachSide) : 'G';
      const pid = sig ? sig.phase.id : '';
      const endOfGreen = st === 'Y' || (sig && sig.clearing(turn.approachSide));
      if (c.wait === WAIT.CONFLICT && st !== 'R') want = true;
      if (turn.movement === 'left' && c.wait === WAIT.YIELD && st === 'G' && c.yieldWait > LEFT_PATIENCE) want = true;
      if (turn.movement === 'left' && c.yieldWait > 1 && (endOfGreen || (c.claimClearing && st === 'R' && pid !== 'PED' && pid !== 'PED_CLEAR'))) {
        want = c.wait === WAIT.CONFLICT || c.wait === WAIT.YIELD || c.wait === WAIT.RED;
        clearingClaim = want;
      }
    }
    if (want) {
      c.claimWait += dt;
      const patient = c.wait === WAIT.YIELD && !clearingClaim;
      if (!c.claim && (patient || c.claimWait > (clearingClaim ? 0.3 : CLAIM_AFTER))) {
        c.claim = turn;
        c.claimAt = this.time;
        c.claimClearing = clearingClaim;
        turn.claims.push(c);
      }
    } else {
      c.claimWait = 0;
      if (c.claim) this.releaseClaim(c);
    }
  }

  releaseClaim(c) {
    removeCar(c.claim.claims, c);
    c.claim = null;
    c.claimClearing = false;
  }

  /** Is any vehicle (or, with `longOnly`, any bus or truck) inside the conflict zone `cf`? */
  occupied(cf, longOnly) {
    const t = cf.turn;
    for (const o of t.reserved) if (!longOnly || o.len > LONG) return true;
    for (const o of t.cars) if ((!longOnly || o.len > LONG) && o.s - o.len < cf.sMax + 1) return true;
    for (const o of t.trailing) if ((!longOnly || o.len > LONG) && t.length + o.s - o.len < cf.sMax + 1) return true;
    return false;
  }

  // --- Motion -------------------------------------------------------------------

  move(c, dt) {
    const v = c.v;
    const a = c.acc;
    let v1 = v + a * dt;
    let ds;
    if (v1 <= 0) {
      ds = a < 0 ? Math.min(v * dt, (v * v) / (-2 * a)) : 0;
      v1 = 0;
    } else {
      ds = 0.5 * (v + v1) * dt;
    }
    c.v = v1;
    c.s += ds;
    c.odo += ds;
    c.brake = a < -0.9 || v1 < 0.15 ? 1 : 0;
    if (v1 < 0.3) c.stopped += dt;
    else c.stopped = 0;
    if (c.wait === WAIT.YIELD) c.yieldWait += dt;
    else if (c.wait === WAIT.NONE && v1 > 2) c.yieldWait = 0;
    if (c.claim || c.wait === WAIT.CONFLICT || c.yieldWait > 1) this.updateClaim(c, dt);
    // A committed car that ended up stopped short of a red light gives its slot back.
    if (c.committed && v1 < 0.3 && c.seg.kind === 'lane') {
      const sig = c.nextTurn.inter.signal;
      if (sig && sig.state(c.nextTurn.approachSide) === 'R') this.uncommit(c);
    }

    if (c.fadeDir !== 0) {
      c.fade = clamp(c.fade + (c.fadeDir * dt) / FADE_TIME, 0, 1);
      if (c.fadeDir > 0 && c.fade >= 1) c.fadeDir = 0;
      if (c.fadeDir < 0 && c.fade <= 0) c.dead = true;
    }
    if (c.stopped > STUCK_LIMIT && !c.leaving) this.retire(c);

    while (!c.dead && c.s >= c.seg.length) {
      if (!this.advance(c)) break;
    }
    if (c.trail && (c.seg.kind !== 'lane' || c.s - c.len >= 0)) this.untrail(c);
  }

  untrail(c) {
    removeCar(c.trail.trailing, c);
    c.trail = null;
  }

  advance(c) {
    const seg = c.seg;
    if (seg.kind === 'lane') {
      const turn = c.nextTurn;
      if (!turn) {
        c.dead = true; // left the city on a highway
        return false;
      }
      if (!c.committed) {
        if (this.permission(c, turn, 0) === WAIT.NONE) this.commit(c, turn);
        else {
          c.s = seg.length - 0.01;
          c.v = 0;
          return false;
        }
      }
      removeCar(seg.cars, c);
      removeCar(turn.reserved, c);
      c.s -= seg.length;
      c.prev2 = c.prev1;
      c.prev1 = seg;
      c.seg = turn;
      insertCar(turn.cars, c);
      c.committed = false;
      return true;
    }
    const lane = seg.toLane;
    removeCar(seg.cars, c);
    c.s -= seg.length;
    c.prev2 = c.prev1;
    c.prev1 = seg;
    c.seg = lane;
    insertCar(lane.cars, c);
    if (c.trail) this.untrail(c);
    if (c.s < c.len) {
      c.trail = seg;
      seg.trailing.push(c);
    }
    c.nextTurn = this.chooseTurn(c, lane);
    c.blocks++;
    return true;
  }

  pickMove(moves) {
    let total = 0;
    for (const m of moves) total += TURN_WEIGHTS[m] || 0;
    let r = this.rng.next() * total;
    for (const m of moves) {
      r -= TURN_WEIGHTS[m] || 0;
      if (r < 0) return m;
    }
    return moves.values().next().value ?? null;
  }

  chooseTurn(c, lane) {
    if (lane.to.portal || !lane.outTurns.length) return null;
    const moves = new Set(lane.outTurns.map((t) => t.movement));
    let m = c.plannedMove;
    if (!m || !moves.has(m)) m = this.pickMove(moves);
    const options = lane.outTurns.filter((t) => t.movement === m);
    // Plan one road ahead so the car ends up in a lane that allows its next move.
    const nextMoves = new Set();
    for (const t of options) for (const u of t.toLane.outTurns) nextMoves.add(u.movement);
    const next = nextMoves.size ? this.pickMove(nextMoves) : null;
    let good = options.filter((t) => t.toLane.to.portal || t.toLane.outTurns.some((u) => u.movement === next));
    if (!good.length) good = options;
    // Usually keep the lane when that works.
    const keep = good.filter((t) => t.toLane.index === lane.index);
    if (keep.length && this.rng.next() < 0.85) good = keep;
    c.plannedMove = next;
    return good[Math.floor(this.rng.next() * good.length)];
  }

  // --- Lifecycle ----------------------------------------------------------------

  pickType() {
    return this.rng.weighted(TYPE_NAMES, this.typeWeights);
  }

  paintFor(type) {
    if (type === 'taxi') return '#f2c200';
    if (type === 'bus') return this.busLivery;
    if (type === 'truck') return this.rng.weighted(['#f2f2ef', '#d8d4cc', '#2e5fa8', '#a3262a'], [6, 2, 1, 1]);
    return this.rng.weighted(PAINT.map((p) => p[0]), PAINT.map((p) => p[1]));
  }

  plate() {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    const r = this.rng;
    const l = () => L[r.int(0, L.length - 1)];
    return `${r.int(1, 9)}${l()}${l()}${l()} ${r.int(100, 999)}`;
  }

  spawn(lane, s, v, fadeIn = true, type = this.pickType()) {
    if (this.cars.length >= this.maxCars) return null;
    const spec = VEHICLE_TYPES[type];
    if (s - spec.len < 0 || s > lane.length - 4) return null;
    const arr = lane.cars;
    let i = arr.length;
    while (i > 0 && arr[i - 1].s < s) i--;
    const ahead = arr[i - 1];
    const behind = arr[i];
    if (ahead && ahead.s - ahead.len - s < 8) return null;
    if (behind && s - spec.len - behind.s < 8 + behind.v * 1.2) return null;
    const r = this.rng;
    const c = {
      id: this.nextId++,
      type,
      len: spec.len,
      wid: spec.wid,
      a: spec.a * r.range(0.9, 1.1),
      b: spec.b,
      T: r.range(1.0, 1.6),
      s0: r.range(1.8, 2.4),
      vf: spec.vf * r.range(0.9, 1.12),
      color: this.paintFor(type),
      plate: this.plate(),
      seg: lane,
      s,
      v: Math.min(v, lane.speed),
      acc: 0,
      committed: false,
      nextTurn: null,
      plannedMove: null,
      prev1: null,
      prev2: null,
      trail: null,
      claim: null,
      claimAt: 0,
      claimWait: 0,
      claimClearing: false,
      fade: fadeIn ? 0 : 1,
      fadeDir: fadeIn ? 1 : 0,
      dead: false,
      leaving: false,
      odo: 0,
      blocks: 0,
      stopped: 0,
      wait: WAIT.NONE,
      yieldWait: 0,
      brake: 0,
      born: this.time,
    };
    arr.splice(i, 0, c);
    c.nextTurn = this.chooseTurn(c, lane);
    this.cars.push(c);
    return c;
  }

  /** Fade a car out where it is. */
  retire(c) {
    if (c.leaving) return;
    c.leaving = true;
    c.fadeDir = -1;
  }

  detach(c) {
    removeCar(c.seg.cars, c);
    if (c.trail) this.untrail(c);
    if (c.claim) this.releaseClaim(c);
    if (c.committed && c.nextTurn) removeCar(c.nextTurn.reserved, c);
    c.committed = false;
  }

  balance(dt) {
    const active = this.cars.length - this.leaving;
    const deficit = this.target - active;
    this.portalTimer -= dt;
    if (deficit > 0 && this.portalTimer <= 0) {
      this.portalTimer = 1.4;
      for (const lane of this.net.portalLanesIn) {
        const type = this.pickType();
        this.spawn(lane, VEHICLE_TYPES[type].len + 0.5, lane.speed * 0.85, true, type);
      }
    }
    if (deficit > 0) {
      // Top up inside the city, quickly when far below target.
      const attempts = Math.min(deficit, Math.max(1, Math.round(deficit * dt * 0.6)));
      const lanes = this.net.cityLanes;
      for (let k = 0; k < attempts; k++) {
        if (this.rng.next() > 0.5 + deficit / 40) continue;
        const lane = lanes[Math.floor(this.rng.next() * lanes.length)];
        this.spawn(lane, this.rng.range(10, lane.length - 8), lane.speed * this.rng.range(0.3, 0.7), true);
      }
    } else if (deficit < -4) {
      const n = Math.min(-deficit, Math.max(1, Math.round(-deficit * dt * 0.25)));
      for (let k = 0; k < n; k++) {
        const c = this.cars[Math.floor(this.rng.next() * this.cars.length)];
        if (c && !c.leaving && !c.pinned) this.retire(c);
      }
    }
  }

  // --- Queries ------------------------------------------------------------------

  pointAt(c, s, out) {
    let seg = c.seg;
    if (s < 0 && c.prev1) {
      s += c.prev1.length;
      seg = c.prev1;
      if (s < 0 && c.prev2) {
        s += c.prev2.length;
        seg = c.prev2;
      }
    }
    return seg.pose(s < 0 ? 0 : s, out);
  }

  /** World position of the car's center and its heading, following the path through turns. */
  pose(c, out) {
    const A = this.pointAt(c, c.s - c.len * 0.18, this._a);
    const B = this.pointAt(c, c.s - c.len * 0.82, this._b);
    let dx = A.x - B.x;
    let dz = A.z - B.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
      dx = A.dx;
      dz = A.dz;
    } else {
      dx /= l;
      dz /= l;
    }
    out.x = (A.x + B.x) / 2;
    out.z = (A.z + B.z) / 2;
    out.dx = dx;
    out.dz = dz;
    return out;
  }

  stats() {
    let n = 0;
    let speed = 0;
    let ratio = 0;
    let stopped = 0;
    for (const c of this.cars) {
      if (c.leaving || c.fade < 0.5) continue;
      n++;
      speed += c.v;
      ratio += Math.min(1, c.v / (c.seg.speed * c.vf));
      if (c.v < 1) stopped++;
    }
    return {
      count: n,
      avgSpeed: n ? speed / n : 0,
      flow: n ? ratio / n : 1,
      stoppedShare: n ? stopped / n : 0,
    };
  }

  describe(c) {
    const lane = c.seg.kind === 'lane' ? c.seg : c.seg.toLane;
    const heading = { N: 'North', S: 'South', E: 'East', W: 'West' }[lane.exitSide];
    let status;
    if (c.seg.kind === 'turn' && c.seg.movement !== 'straight') status = `Turning ${c.seg.movement}`;
    else if (c.wait === WAIT.RED) status = 'Waiting at a red light';
    else if (c.wait === WAIT.YIELD) status = 'Yielding to oncoming traffic';
    else if (c.wait === WAIT.CONFLICT) status = 'Waiting for the intersection to clear';
    else if (c.wait === WAIT.BLOCKED) status = 'Keeping the intersection clear';
    else if (c.wait === WAIT.PEDS) status = 'Waiting for pedestrians';
    else if (c.wait === WAIT.QUEUE || c.v < 1) status = 'In traffic';
    else if (c.acc < -1) status = 'Braking';
    else status = 'Cruising';
    return { road: lane.road.name, heading: `${heading}bound`, status };
  }
}
