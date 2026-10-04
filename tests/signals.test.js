import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/sim/cityGen.js';
import { buildNetwork } from '../src/sim/network.js';
import { RNG } from '../src/core/rng.js';

const net = buildNetwork(generateCity({ seed: 4, size: 'small' }), new RNG(4));

test('cross directions are never released together', () => {
  for (const sig of net.signals) {
    for (let t = 0; t < 300; t += 0.25) {
      sig.update(0.25);
      const ns = sig.state('N');
      const ew = sig.state('E');
      assert.equal(sig.state('S'), ns);
      assert.equal(sig.state('W'), ew);
      assert.ok(ns === 'R' || ew === 'R', `both axes moving in ${sig.phase.id}`);
    }
  }
});

test('people walk only alongside the parallel green, with time to get across', () => {
  for (const sig of net.signals) {
    let sawWalk = false;
    for (let t = 0; t < sig.cycle * 2; t += 0.1) {
      sig.update(0.1);
      for (const side of ['N', 'E', 'S', 'W']) {
        const left = sig.walkRemaining(side);
        if (left <= 0) continue;
        sawWalk = true;
        const parallel = side === 'N' || side === 'S' ? 'E' : 'N';
        assert.equal(sig.state(parallel), 'G');
        assert.equal(sig.state(side), 'R', 'traffic crossing the crosswalk has green');
      }
      if (sig.phase.id === 'EW_G' && sig.elapsed < 0.11) {
        assert.ok(sig.walkRemaining('N') >= sig.crossEW / 1.25, 'green too short to cross');
      }
    }
    assert.ok(sawWalk);
  }
});

test('only the all-red after its own yellow counts as clearing time', () => {
  const sig = net.signals[1];
  for (let t = 0; t < 200; t += 0.1) {
    sig.update(0.1);
    if (sig.clearing('N')) assert.equal(sig.phases[(sig.index + sig.phases.length - 1) % sig.phases.length].id, 'NS_Y');
    if (sig.clearing('E')) assert.equal(sig.phases[(sig.index + sig.phases.length - 1) % sig.phases.length].id, 'EW_Y');
  }
});
