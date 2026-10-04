import test from 'node:test';
import assert from 'node:assert/strict';
import { World, PHYSICS_DT } from '../src/sim/world.js';

test('pedestrians start crossing only on a walk signal, with time to finish', () => {
  const w = new World({ seed: 9, size: 'medium', hour: 12.5 });
  const peds = w.peds;
  const before = new Map();
  let crossings = 0;
  for (let i = 0; i < 240 / PHYSICS_DT; i++) {
    for (const p of peds.peds) before.set(p.id, p.edge);
    w.physicsStep(PHYSICS_DT);
    for (const p of peds.peds) {
      const e = p.edge;
      // Detect the moment someone steps onto a signalized crossing.
      if (e.kind === 'crosswalk' && e.inter.signal && !p.waiting && p.s < p.speed * PHYSICS_DT * 1.5 && p.s >= 0 && before.get(p.id) !== e) {
        crossings++;
        const sig = e.inter.signal;
        assert.ok(sig.walkRemaining(e.side) > 0, `stepped out during ${sig.phase.id}`);
        assert.ok(sig.walkRemaining(e.side) + 0.5 >= e.length / p.speed, 'not enough time to cross');
      }
    }
  }
  assert.ok(crossings > 20, `only ${crossings} crossings observed`);
});

test('foot traffic follows the time of day', () => {
  const noon = new World({ seed: 2, size: 'small', hour: 12.5 });
  const night = new World({ seed: 2, size: 'small', hour: 3 });
  assert.ok(noon.peds.target > night.peds.target * 4);
  assert.ok(noon.traffic.target > night.traffic.target * 3);
});

test('crosswalk head counts stay consistent', () => {
  const w = new World({ seed: 31, size: 'small', hour: 13 });
  for (let i = 0; i < 90 / PHYSICS_DT; i++) w.physicsStep(PHYSICS_DT);
  const counts = new Map();
  for (const p of w.peds.peds) if (!p.waiting) counts.set(p.edge, (counts.get(p.edge) || 0) + 1);
  for (const e of w.net.pedEdges) assert.equal(e.walkers.length, counts.get(e) || 0, `edge ${e.id}`);
});
