import test from 'node:test';
import assert from 'node:assert/strict';
import { World, PHYSICS_DT } from '../src/sim/world.js';
import { WAIT } from '../src/sim/traffic.js';
import { findCollisions } from './helpers.js';

function run(world, seconds, onStep) {
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    world.physicsStep(PHYSICS_DT);
    if (onStep) onStep(i);
  }
}

for (const [size, seed, hour] of [['medium', 1, 17.5], ['small', 7, 8.2], ['large', 777, 12]]) {
  test(`${size} city at ${hour}h: no collisions, no deadlocks, no red-light running`, () => {
    const w = new World({ seed, size, hour });
    const tr = w.traffic;
    let redRuns = 0;
    let retiredStuck = 0;
    const commit = tr.commit.bind(tr);
    tr.commit = (c, turn) => {
      const sig = turn.inter.signal;
      const st = sig ? sig.state(turn.approachSide) : 'G';
      // Entering on red is only allowed for a left-turner clearing the intersection.
      if (st === 'R' && !(turn.movement === 'left' && (c.claimClearing || sig.clearing(turn.approachSide)))) redRuns++;
      commit(c, turn);
    };
    const retire = tr.retire.bind(tr);
    tr.retire = (c) => {
      if (c.stopped > 100) retiredStuck++;
      retire(c);
    };
    let collisions = 0;
    run(w, 240, (i) => {
      if (i % 10 === 0) collisions += findCollisions(tr).length;
    });
    assert.equal(collisions, 0, 'vehicles overlapped');
    assert.equal(redRuns, 0, 'a car entered on red');
    assert.equal(retiredStuck, 0, 'a car was stuck long enough to be removed');
    for (const c of tr.cars) {
      assert.ok(Number.isFinite(c.s) && Number.isFinite(c.v), 'non-finite state');
      assert.ok(c.v >= 0 && c.v < 30, 'implausible speed');
    }
    const st = tr.stats();
    assert.ok(Math.abs(st.count - tr.target) <= Math.max(12, tr.target * 0.06), `count ${st.count} vs target ${tr.target}`);
    assert.ok(st.avgSpeed > 2, 'traffic is gridlocked');
  });
}

test('cars keep their order and spacing within every lane', () => {
  const w = new World({ seed: 3, size: 'medium', hour: 8 });
  run(w, 120, () => {
    for (const seg of [...w.net.lanes, ...w.net.turns]) {
      const a = seg.cars;
      for (let k = 1; k < a.length; k++) {
        assert.ok(a[k - 1].s >= a[k].s, 'lane order broken');
        assert.ok(a[k - 1].s - a[k - 1].len - a[k].s > -0.3, 'cars overlap in a lane');
      }
    }
  });
});

test('left-turners yield to oncoming traffic that is not stopping', () => {
  const w = new World({ seed: 12, size: 'medium', hour: 12 });
  const tr = w.traffic;
  let yields = 0;
  run(w, 120, () => {
    for (const c of tr.cars) if (c.wait === WAIT.YIELD) yields++;
  });
  assert.ok(yields > 0, 'nobody ever yielded');
});
