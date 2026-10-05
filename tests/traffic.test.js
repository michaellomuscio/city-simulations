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

test('moving cars are drawn smoothly between physics steps', () => {
  const w = new World({ seed: 5, size: 'small', hour: 11 });
  const tr = w.traffic;
  const watched = tr.cars.filter((c) => c.v > 5).slice(0, 40);
  const pose = { x: 0, z: 0, dx: 1, dz: 0 };
  const last = new Map();
  const moved = new Map();
  let worst = 0;
  // A 60 Hz display draws three frames for every physics step.
  for (let f = 0; f < 600; f++) {
    w.update(1 / 60, 1);
    for (const c of watched) {
      if (c.dead) continue;
      tr.drawPose(c, w.alpha, pose);
      const p = last.get(c);
      if (p) {
        const d = Math.hypot(pose.x - p.x, pose.z - p.z);
        if (moved.has(c)) worst = Math.max(worst, Math.abs(d - moved.get(c)));
        moved.set(c, d);
      }
      last.set(c, { x: pose.x, z: pose.z });
    }
  }
  // Drawn straight from the physics state, a car at 10 m/s would jump half a meter
  // every third frame and stand still in between.
  assert.ok(worst < 0.1, `movement between frames changed by up to ${worst.toFixed(3)} m`);
});

test('a car someone is watching or driving stays in the city', () => {
  const headedOut = (pin) => {
    const w = new World({ seed: 11, size: 'small', hour: 9 });
    const tr = w.traffic;
    const cars = tr.cars.filter((c) => c.seg.kind === 'lane' && !c.committed && c.nextTurn && !c.nextTurn.toLane.to.portal).slice(0, 40);
    for (const c of cars) c.pinned = pin;
    const out = new Set();
    run(w, 300, () => {
      for (const c of cars) if (c.seg.kind === 'lane' && c.seg.to.portal) out.add(c);
    });
    return out.size;
  };
  assert.ok(headedOut(false) > 0, 'expected some unwatched cars to leave town');
  assert.equal(headedOut(true), 0, 'a watched car took a highway out of town');
});
