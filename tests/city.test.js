import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, CITY_SIZES } from '../src/sim/cityGen.js';
import { ROAD_W } from '../src/sim/constants.js';

test('the same seed always builds the same city', () => {
  const a = generateCity({ seed: 1234, size: 'medium' });
  const b = generateCity({ seed: 1234, size: 'medium' });
  assert.equal(a.name, b.name);
  assert.equal(a.buildings.length, b.buildings.length);
  assert.deepEqual(a.xs, b.xs);
  assert.deepEqual(a.buildings.map((x) => x.height), b.buildings.map((x) => x.height));
});

test('different seeds build different cities', () => {
  const a = generateCity({ seed: 1, size: 'medium' });
  const b = generateCity({ seed: 2, size: 'medium' });
  assert.notDeepEqual(a.xs, b.xs);
});

for (const size of Object.keys(CITY_SIZES)) {
  test(`${size} city has every zone, a river, highways and a skyline`, () => {
    const c = generateCity({ seed: 99, size });
    const types = new Set(c.blocks.map((b) => b.type));
    for (const t of ['downtown', 'commercial', 'residential', 'suburban', 'industrial', 'park']) {
      assert.ok(types.has(t), `missing ${t}`);
    }
    assert.equal(c.portals.length, 4);
    assert.ok(c.bridgeLines.length >= 2);
    assert.ok(Math.max(...c.buildings.map((b) => b.height)) > 250, 'expected a landmark tower');
    assert.ok(c.population > 0 && c.jobs > 0);
  });
}

test('buildings stay off the streets', () => {
  for (const seed of [3, 17, 2024]) {
    const c = generateCity({ seed, size: 'medium' });
    const roads = [];
    c.xs.forEach((x, i) => roads.push({ axis: 'x', at: x, half: ROAD_W[c.majorX.includes(i) ? 'major' : 'minor'] / 2 }));
    c.zs.forEach((z, j) => roads.push({ axis: 'z', at: z, half: ROAD_W[c.majorZ.includes(j) ? 'major' : 'minor'] / 2 }));
    for (const b of c.buildings) {
      const { x0, x1, z0, z1 } = b.bbox;
      for (const r of roads) {
        // Roads through the big park were removed, so only check within the street grid.
        if (r.axis === 'x' && x0 < r.at + r.half && x1 > r.at - r.half) {
          const inPark = c.park && r.at > c.xs[c.park.i0] && r.at < c.xs[c.park.i1];
          assert.ok(inPark, `${b.name} overlaps the avenue at x=${r.at}`);
        }
        if (r.axis === 'z' && z0 < r.at + r.half && z1 > r.at - r.half) {
          const inPark = c.park && r.at > c.zs[c.park.j0] && r.at < c.zs[c.park.j1];
          assert.ok(inPark, `${b.name} overlaps the street at z=${r.at}`);
        }
      }
      assert.ok(!(z1 > c.river.zNorth && z0 < c.river.zSouth), `${b.name} stands in the river`);
    }
  }
});

test('every building has a finite footprint, height and street address', () => {
  for (const size of Object.keys(CITY_SIZES)) {
    const c = generateCity({ seed: 5, size });
    for (const b of c.buildings) {
      for (const k of ['x0', 'x1', 'z0', 'z1', 'y1']) assert.ok(Number.isFinite(b.bbox[k]), `${b.name} bbox.${k}`);
      assert.ok(b.height > 0 && Number.isFinite(b.height));
      assert.match(b.address, /^\d+ \S/, `${b.name} address "${b.address}"`);
    }
  }
});
