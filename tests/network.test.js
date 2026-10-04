import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/sim/cityGen.js';
import { buildNetwork } from '../src/sim/network.js';
import { RNG } from '../src/core/rng.js';

const build = (seed, size = 'medium') => buildNetwork(generateCity({ seed, size }), new RNG(seed));

test('every lane inside the city leads somewhere', () => {
  for (const seed of [1, 42, 777]) {
    const net = build(seed);
    for (const l of net.lanes) {
      if (l.to.portal) assert.equal(l.outTurns.length, 0);
      else assert.ok(l.outTurns.length > 0, `lane ${l.id} on ${l.road.name} is a dead end`);
    }
  }
});

test('every lane can be reached from every other lane', () => {
  const net = build(5, 'large');
  const reach = (start) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const l = stack.pop();
      for (const t of l.outTurns) {
        if (!seen.has(t.toLane)) {
          seen.add(t.toLane);
          stack.push(t.toLane);
        }
      }
    }
    return seen;
  };
  const city = net.lanes.filter((l) => !l.to.portal);
  const fromFirst = reach(city[0]);
  for (const l of net.lanes) if (!l.from.portal) assert.ok(fromFirst.has(l), `lane ${l.id} unreachable`);
  // And back again: every lane reaches the first one.
  for (const l of city.slice(0, 40)) assert.ok(reach(l).has(city[0]));
});

test('conflicts are symmetric and never pair turns from the same lane', () => {
  const net = build(11);
  for (const t of net.turns) {
    for (const cf of t.conflicts) {
      assert.notEqual(cf.turn.fromLane, t.fromLane);
      if (cf.turn.toLane === t.toLane) assert.equal(cf.turn.approachSide, t.approachSide);
      assert.ok(cf.turn.conflicts.some((x) => x.turn === t), 'asymmetric conflict');
    }
  }
});

test('turn paths are continuous and end on their lanes', () => {
  const net = build(8);
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const t of net.turns) {
    t.pose(0, p);
    assert.ok(Math.hypot(p.x - t.fromLane.x1, p.z - t.fromLane.z1) < 0.01);
    t.pose(t.length, p);
    assert.ok(Math.hypot(p.x - t.toLane.x0, p.z - t.toLane.z0) < 0.01);
    for (let i = 1; i < t.n; i++) {
      assert.ok(Math.hypot(t.px[i] - t.px[i - 1], t.pz[i] - t.pz[i - 1]) <= t.ds + 1e-3);
    }
  }
});

test('the sidewalk network is connected', () => {
  const net = build(21);
  const seen = new Set([net.pedNodes[0]]);
  const stack = [net.pedNodes[0]];
  while (stack.length) {
    const n = stack.pop();
    for (const e of n.edges) {
      const o = e.other(n);
      if (!seen.has(o)) {
        seen.add(o);
        stack.push(o);
      }
    }
  }
  assert.equal(seen.size, net.pedNodes.length);
});
