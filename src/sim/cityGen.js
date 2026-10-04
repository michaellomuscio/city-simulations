// Procedural city layout. Produces plain data (no rendering): the street graph,
// city blocks with zoning, buildings, trees, street furniture and landmarks.

import { RNG } from '../core/rng.js';
import { ValueNoise } from '../core/noise.js';
import {
  ROAD_W, SIDEWALK_W, PROMENADE_W, RIVER_W, PORTAL_LEN, CROSSWALK_W, clamp, lerp,
} from './constants.js';
import { makeNames } from './names.js';

export const CITY_SIZES = {
  small: { nx: 8, nz: 7, label: 'Small' },
  medium: { nx: 11, nz: 10, label: 'Medium' },
  large: { nx: 14, nz: 12, label: 'Large' },
};

/** Facade treatments understood by the building shader. */
export const WIN = { NONE: 0, CURTAIN: 1, RIBBON: 2, PUNCHED: 3, HOUSE: 4, DECO: 5, INDUSTRIAL: 6 };
/** Occupancy profile used for lit windows and the inspector. */
export const USE = { office: 0, residential: 1, retail: 2, industrial: 3, civic: 4 };

export const FLOOR_H = { [WIN.CURTAIN]: 3.9, [WIN.RIBBON]: 3.7, [WIN.PUNCHED]: 3.3, [WIN.HOUSE]: 3.0, [WIN.DECO]: 3.8, [WIN.INDUSTRIAL]: 9.0, [WIN.NONE]: 3.5 };

const PALETTE = {
  glass: ['#2c3a47', '#34474f', '#3b4651', '#4a5866', '#2f3f3b', '#5a5248', '#6d7680'],
  deco: ['#b9ab93', '#a39782', '#c8bea9', '#8f8a80', '#7b746b'],
  brick: ['#8a4b38', '#9c5a3c', '#7a3f2e', '#a8674a', '#6e3b2f', '#b07a5a'],
  stone: ['#c9b79c', '#b8a88a', '#d5ccb9', '#a7a39b', '#c2b6a2', '#9a9184'],
  concrete: ['#a7a39b', '#8e9196', '#b4b1aa', '#9c9a94', '#c4c0b6'],
  apartment: ['#d9cfbf', '#c9a88a', '#9fb3a8', '#b9b2a6', '#d4b59a', '#a9a0c0', '#c7c0ae', '#8f9eaa'],
  siding: ['#e8e2d4', '#c9d3d8', '#d9c7a3', '#a7b8a0', '#b58a6b', '#8c9aa8', '#efe9df', '#c8b2a6'],
  houseRoof: ['#5b3a2e', '#3d3f45', '#7a4a3a', '#4a5560', '#6b4f3b', '#33373d'],
  metal: ['#9aa3a8', '#7d8b94', '#b5aea0', '#8a949b', '#a9b0b4'],
  flatRoof: ['#5d5f61', '#6b6b67', '#55585c', '#727069', '#4f5255'],
};

export function generateCity({ seed = 1, size = 'medium' } = {}) {
  const preset = CITY_SIZES[size] || CITY_SIZES.medium;
  const { nx, nz } = preset;
  const rng = new RNG(seed);
  const layoutRng = rng.fork('layout');
  const bRng = rng.fork('buildings');
  const fRng = rng.fork('furniture');
  const names = makeNames(rng.fork('names'));
  const noise = new ValueNoise(seed);

  // --- Street grid --------------------------------------------------------
  const majorX = majorLines(nx);
  const majorZ = majorLines(nz);
  const clsX = (i) => (majorX.has(i) ? 'major' : 'minor');
  const clsZ = (j) => (majorZ.has(j) ? 'major' : 'minor');
  const wX = (i) => ROAD_W[clsX(i)];
  const wZ = (j) => ROAD_W[clsZ(j)];

  // The river runs east-west through the gap between z-lines jr and jr+1.
  const jr = clamp(Math.round(nz * layoutRng.range(0.55, 0.68)), 2, nz - 3);
  const riverGap = wZ(jr) / 2 + wZ(jr + 1) / 2 + 2 * PROMENADE_W + RIVER_W;

  const xs = [0];
  for (let i = 1; i < nx; i++) xs.push(xs[i - 1] + Math.round(layoutRng.range(86, 124)));
  const zs = [0];
  for (let j = 1; j < nz; j++) zs.push(zs[j - 1] + (j - 1 === jr ? riverGap : Math.round(layoutRng.range(76, 106))));
  const cx0 = (xs[0] + xs[nx - 1]) / 2;
  const cz0 = (zs[0] + zs[nz - 1]) / 2;
  for (let i = 0; i < nx; i++) xs[i] -= cx0;
  for (let j = 0; j < nz; j++) zs[j] -= cz0;

  const river = {
    jr,
    name: names.river,
    zNorth: zs[jr] + wZ(jr) / 2 + PROMENADE_W, // water edge on the north bank
    zSouth: zs[jr + 1] - wZ(jr + 1) / 2 - PROMENADE_W,
    roadNorth: zs[jr] + wZ(jr) / 2,
    roadSouth: zs[jr + 1] - wZ(jr + 1) / 2,
  };

  const bridgeLines = new Set();
  for (let i = 0; i < nx; i++) if (majorX.has(i) || layoutRng.chance(0.35)) bridgeLines.add(i);

  // Downtown sits a couple of blocks north of the river so the skyline faces the water.
  const dci = clamp(Math.floor((nx - 1) / 2) - (layoutRng.chance(0.5) ? 1 : 0), 1, nx - 3);
  const dcj = clamp(jr - 2, 1, jr - 1);
  const downtown = { x: (xs[dci] + xs[dci + 1]) / 2, z: (zs[dcj] + zs[dcj + 1]) / 2 };

  const park = choosePark({ nx, jr, majorX, majorZ, xs, zs, dci, dcj, rng: layoutRng, size });
  const inPark = (i, j) => park && i >= park.i0 && i < park.i1 && j >= park.j0 && j < park.j1;

  // --- Graph: nodes and edges --------------------------------------------
  const nodes = new Map();
  const edges = [];
  const key = (i, j) => `${i},${j}`;
  const ensureNode = (i, j) => {
    const k = key(i, j);
    if (!nodes.has(k)) nodes.set(k, { key: k, i, j, x: xs[i], z: zs[j], portal: false });
    return k;
  };

  const lineNamesX = xs.map((_, i) => names.lineName('ns', majorX.has(i)));
  const lineNamesZ = zs.map((_, j) => names.lineName('ew', majorZ.has(j)));

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz - 1; j++) {
      if (j === jr && !bridgeLines.has(i)) continue;
      if (inPark(i - 1, j) && inPark(i, j)) continue;
      edges.push({
        a: ensureNode(i, j), b: ensureNode(i, j + 1), axis: 'ns', line: i,
        cls: clsX(i), bridge: j === jr, portal: false, name: lineNamesX[i],
      });
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (inPark(i, j - 1) && inPark(i, j)) continue;
      edges.push({
        a: ensureNode(i, j), b: ensureNode(i + 1, j), axis: 'ew', line: j,
        cls: clsZ(j), bridge: false, portal: false, name: lineNamesZ[j],
      });
    }
  }

  // Highways leaving the city on each side; cars enter and exit the simulation there.
  const portals = [];
  const midX = pickInteriorMajor(majorX, nx);
  const midZ = pickInteriorMajor(majorZ, nz, new Set([jr, jr + 1]));
  const addPortal = (side, i, j, x, z, axis, line, name) => {
    const k = `P:${side}`;
    nodes.set(k, { key: k, i, j, x, z, portal: true, side });
    const innerKey = key(side === 'N' || side === 'S' ? i : side === 'W' ? 0 : nx - 1, side === 'N' ? 0 : side === 'S' ? nz - 1 : j);
    const forward = side === 'S' || side === 'E';
    edges.push({
      a: forward ? innerKey : k, b: forward ? k : innerKey, axis, line, cls: 'major', bridge: false, portal: true,
      name: `${name} (Highway ${side === 'N' || side === 'S' ? 9 : 4})`,
    });
    portals.push({ side, key: k, x, z });
  };
  if (midX !== null) {
    addPortal('N', midX, -1, xs[midX], zs[0] - PORTAL_LEN, 'ns', midX, lineNamesX[midX]);
    addPortal('S', midX, nz, xs[midX], zs[nz - 1] + PORTAL_LEN, 'ns', midX, lineNamesX[midX]);
  }
  if (midZ !== null) {
    addPortal('W', -1, midZ, xs[0] - PORTAL_LEN, zs[midZ], 'ew', midZ, lineNamesZ[midZ]);
    addPortal('E', nx, midZ, xs[nx - 1] + PORTAL_LEN, zs[midZ], 'ew', midZ, lineNamesZ[midZ]);
  }

  // --- Blocks and zoning ---------------------------------------------------
  const R = 0.5 * Math.hypot(xs[nx - 1] - xs[0], zs[nz - 1] - zs[0]);
  const blocks = [];
  const cellBlock = new Map();
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz - 1; j++) {
      if (j === jr || inPark(i, j)) continue;
      const b = {
        id: blocks.length, i, j,
        x0: xs[i] + wX(i) / 2, x1: xs[i + 1] - wX(i + 1) / 2,
        z0: zs[j] + wZ(j) / 2, z1: zs[j + 1] - wZ(j + 1) / 2,
        type: 'residential', d: 0, south: j > jr,
      };
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      let d = Math.hypot((cx - downtown.x) * 0.95, (cz - downtown.z) * 1.1) / R;
      d += (noise.fbm(cx / 320 + 7.1, cz / 320 - 3.3) - 0.5) * 0.22;
      if (b.south) d += 0.1;
      b.d = d;
      b.type = d < 0.26 ? 'downtown' : d < 0.45 ? 'commercial' : d < 0.68 ? 'residential' : 'suburban';
      blocks.push(b);
      cellBlock.set(key(i, j), b);
    }
  }
  if (park) {
    const b = {
      id: blocks.length, i: park.i0, j: park.j0, big: true,
      x0: xs[park.i0] + wX(park.i0) / 2, x1: xs[park.i1] - wX(park.i1) / 2,
      z0: zs[park.j0] + wZ(park.j0) / 2, z1: zs[park.j1] - wZ(park.j1) / 2,
      type: 'park', d: 0.4, south: false, name: `${names.city.split(' ').pop()} Park`,
    };
    blocks.push(b);
    for (let i = park.i0; i < park.i1; i++) for (let j = park.j0; j < park.j1; j++) cellBlock.set(key(i, j), b);
  }

  // Industrial quarter on the south bank, upstream or downstream.
  const indEast = layoutRng.chance(0.5);
  const ind = { x: xs[indEast ? nx - 2 : 1], z: zs[Math.min(jr + 1, nz - 1)] + 60 };
  for (const b of blocks) {
    if (!b.south || b.type === 'park' || b.type === 'downtown') continue;
    const d = Math.hypot((b.x0 + b.x1) / 2 - ind.x, (b.z0 + b.z1) / 2 - ind.z);
    if (d < 240 && b.d > 0.4) b.type = 'industrial';
  }
  // Pocket parks, a civic plaza and a construction site.
  for (const b of blocks) {
    if (b.type !== 'park' && b.type !== 'downtown' && b.type !== 'industrial' && layoutRng.chance(0.06)) b.type = 'park';
  }
  const dtBlocks = blocks
    .filter((b) => b.type === 'downtown')
    .sort((a, b) => distTo(a, downtown) - distTo(b, downtown));
  if (dtBlocks.length > 2) dtBlocks[1].type = 'plaza';
  const constructionCandidates = blocks.filter((b) => b.type === 'commercial');
  if (constructionCandidates.length) layoutRng.pick(constructionCandidates).type = 'construction';

  // --- Buildings -----------------------------------------------------------
  const ctx = {
    rng: bRng, names, buildings: [], trees: [], paths: [], ponds: [], fountains: [], cranes: [], smokestacks: [],
    landmarkPlaced: false, downtown, xs, zs, lineNamesX, lineNamesZ,
  };
  // Center-most downtown block hosts the tallest tower.
  for (const b of blocks.sort((a, c) => a.d - c.d)) {
    switch (b.type) {
      case 'downtown': genDowntown(ctx, b); break;
      case 'commercial': genCommercial(ctx, b); break;
      case 'residential': genResidential(ctx, b); break;
      case 'suburban': genSuburban(ctx, b); break;
      case 'industrial': genIndustrial(ctx, b); break;
      case 'park': genPark(ctx, b); break;
      case 'plaza': genPlaza(ctx, b); break;
      case 'construction': genConstruction(ctx, b); break;
      default: break;
    }
  }
  blocks.sort((a, b) => a.id - b.id);

  // --- Street furniture ----------------------------------------------------
  const nodeHalf = (k) => {
    // Half extents of the intersection box, from the widths of the crossing roads.
    const n = nodes.get(k);
    if (n.portal) return { hx: 0, hz: 0 };
    return { hx: wX(n.i) / 2, hz: n.j >= 0 && n.j < nz ? wZ(n.j) / 2 : 0 };
  };
  const cellType = (i, j) => {
    if (j === jr) return 'river';
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return 'outside';
    const b = cellBlock.get(key(i, j));
    return b ? b.type : 'outside';
  };
  const lights = [];
  const leafy = new Set(['residential', 'suburban', 'commercial', 'park', 'plaza']);
  for (const e of edges) {
    const A = nodes.get(e.a);
    const B = nodes.get(e.b);
    const W = ROAD_W[e.cls];
    const ha = nodeHalf(e.a);
    const hb = nodeHalf(e.b);
    if (e.axis === 'ns') {
      const z0 = A.z + (A.portal ? 0 : ha.hz + CROSSWALK_W + 2);
      const z1 = B.z - (B.portal ? 0 : hb.hz + CROSSWALK_W + 2);
      const sides = [
        { s: 1, cell: cellType(e.line, A.j) },
        { s: -1, cell: cellType(e.line - 1, A.j) },
      ];
      for (const { s, cell } of sides) {
        const off = e.bridge ? W / 2 + SIDEWALK_W - 0.5 : W / 2 + 0.5;
        const x = A.x + s * off;
        const posts = [];
        placeAlong(z0, z1, e.portal ? 48 : 31, s > 0 ? 0 : 15, e.portal ? 360 : Infinity, A.portal, (z) => {
          lights.push({ x, z, ax: -s, az: 0 });
          posts.push(z);
        });
        if (!e.bridge && !e.portal && leafy.has(cell)) {
          placeAlong(z0 + 6, z1 - 6, fRng.range(12, 15), 7.5, Infinity, false, (z) => {
            if (posts.every((p) => Math.abs(p - z) > 3)) ctx.trees.push(streetTree(fRng, A.x + s * (W / 2 + 1.1), z, cell));
          });
        }
      }
    } else {
      const x0 = A.x + (A.portal ? 0 : ha.hx + CROSSWALK_W + 2);
      const x1 = B.x - (B.portal ? 0 : hb.hx + CROSSWALK_W + 2);
      const sides = [
        { s: 1, cell: cellType(A.i, e.line) },
        { s: -1, cell: cellType(A.i, e.line - 1) },
      ];
      for (const { s, cell } of sides) {
        const z = A.z + s * (W / 2 + 0.5);
        const posts = [];
        placeAlong(x0, x1, e.portal ? 48 : 31, s > 0 ? 0 : 15, e.portal ? 360 : Infinity, A.portal, (x) => {
          lights.push({ x, z, ax: 0, az: -s });
          posts.push(x);
        });
        if (!e.portal && leafy.has(cell)) {
          placeAlong(x0 + 6, x1 - 6, fRng.range(12, 15), 7.5, Infinity, false, (x) => {
            if (posts.every((p) => Math.abs(p - x) > 3)) ctx.trees.push(streetTree(fRng, x, A.z + s * (W / 2 + 1.1), cell));
          });
        }
      }
    }
  }
  // Promenade trees along both river banks.
  const xMin = xs[0] - wX(0) / 2;
  const xMax = xs[nx - 1] + wX(nx - 1) / 2;
  for (const z of [river.zNorth - PROMENADE_W * 0.5, river.zSouth + PROMENADE_W * 0.5]) {
    for (let x = xMin + 4; x < xMax - 4; x += fRng.range(11, 15)) {
      if (xs.some((lx, i) => bridgeLines.has(i) && Math.abs(x - lx) < wX(i) / 2 + SIDEWALK_W + 3)) continue;
      ctx.trees.push({ x, z, s: fRng.range(0.9, 1.25), kind: 'round', tint: fRng.next() });
    }
  }

  // --- Summary -------------------------------------------------------------
  let population = 0;
  let jobs = 0;
  for (const b of ctx.buildings) {
    population += b.residents;
    jobs += b.workers;
  }

  return {
    seed, size, name: names.city, nx, nz, xs, zs, majorX: [...majorX], majorZ: [...majorZ],
    lineNamesX, lineNamesZ, river, bridgeLines: [...bridgeLines], park, downtown,
    nodes: [...nodes.values()], edges, portals, blocks,
    buildings: ctx.buildings, trees: ctx.trees, lights, paths: ctx.paths, ponds: ctx.ponds,
    fountains: ctx.fountains, cranes: ctx.cranes, smokestacks: ctx.smokestacks,
    bounds: { x0: xMin - SIDEWALK_W, x1: xMax + SIDEWALK_W, z0: zs[0] - wZ(0) / 2 - SIDEWALK_W, z1: zs[nz - 1] + wZ(nz - 1) / 2 + SIDEWALK_W },
    population: Math.round(population / 10) * 10,
    jobs: Math.round(jobs / 10) * 10,
    busLivery: rng.pick(['#c8392e', '#1f6fb2', '#2e8b57', '#e08a1e']),
  };
}

// ---------------------------------------------------------------------------

function majorLines(n) {
  const set = new Set([0, n - 1]);
  const m = Math.max(2, Math.round((n - 1) / 3.4));
  for (let k = 1; k < m; k++) set.add(Math.round((k * (n - 1)) / m));
  return set;
}

function pickInteriorMajor(majors, n, exclude = new Set()) {
  let best = null;
  for (const i of majors) {
    if (i === 0 || i === n - 1 || exclude.has(i)) continue;
    if (best === null || Math.abs(i - (n - 1) / 2) < Math.abs(best - (n - 1) / 2)) best = i;
  }
  return best;
}

function distTo(b, p) {
  return Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z);
}

function choosePark({ nx, jr, majorX, majorZ, xs, zs, dci, dcj, rng, size }) {
  const pw = size === 'large' ? 3 : 2;
  const ph = 2;
  const options = [];
  for (let i0 = 1; i0 + pw <= nx - 2; i0++) {
    for (let j0 = 1; j0 + ph <= jr; j0++) {
      let ok = true;
      for (let i = i0 + 1; i < i0 + pw; i++) if (majorX.has(i)) ok = false;
      for (let j = j0 + 1; j < j0 + ph; j++) if (majorZ.has(j)) ok = false;
      if (dci >= i0 && dci < i0 + pw && dcj >= j0 && dcj < j0 + ph) ok = false;
      if (!ok) continue;
      const cx = (xs[i0] + xs[i0 + pw]) / 2;
      const cz = (zs[j0] + zs[j0 + ph]) / 2;
      const dcx = (xs[dci] + xs[dci + 1]) / 2;
      const dcz = (zs[dcj] + zs[dcj + 1]) / 2;
      const blocksAway = Math.hypot(cx - dcx, cz - dcz) / 100;
      options.push({ i0, j0, i1: i0 + pw, j1: j0 + ph, score: Math.abs(blocksAway - 2.6) + rng.next() * 0.8 });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => a.score - b.score);
  return options[0];
}

/** Calls fn at regular spacing along [a, b]; `limit` caps the distance from the start. */
function placeAlong(a, b, spacing, phase, limit, fromEnd, fn) {
  if (b - a < 4) return;
  if (fromEnd) {
    for (let p = b - phase; p > a && b - p < limit; p -= spacing) fn(p);
    return;
  }
  for (let p = a + phase; p < b && p - a < limit; p += spacing) fn(p);
}

function streetTree(rng, x, z, cell) {
  return { x, z, s: rng.range(0.8, 1.15) * (cell === 'suburban' ? 1.1 : 0.95), kind: 'round', tint: rng.next() };
}

function inner(b) {
  return { x0: b.x0 + SIDEWALK_W, x1: b.x1 - SIDEWALK_W, z0: b.z0 + SIDEWALK_W, z1: b.z1 - SIDEWALK_W };
}

function addressFor(ctx, x, z) {
  // Number along the nearest street, odd on one side and even on the other.
  let best = null;
  ctx.xs.forEach((lx, i) => {
    const d = Math.abs(x - lx);
    if (!best || d < best.d) best = { d, name: ctx.lineNamesX[i], along: z, side: x > lx };
  });
  ctx.zs.forEach((lz, j) => {
    const d = Math.abs(z - lz);
    if (!best || d < best.d) best = { d, name: ctx.lineNamesZ[j], along: x, side: z > lz };
  });
  let n = Math.max(2, Math.round((best.along + 2000) / 2.2));
  n = n - (n % 2) + (best.side ? 1 : 0);
  return `${n} ${best.name}`;
}

function newBuilding(ctx, props) {
  const { rng } = ctx;
  const b = {
    id: ctx.buildings.length,
    seed: rng.next(),
    parts: [],
    extras: [],
    residents: 0,
    workers: 0,
    year: 0,
    ...props,
  };
  ctx.buildings.push(b);
  return b;
}

function finishBuilding(ctx, b) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let maxY = 0;
  let floorArea = 0;
  for (const p of b.parts) {
    const round = p.shape === 'cyl' || p.shape === 'dome' || p.shape === 'cone';
    const x0 = round ? p.x - p.r : p.x0;
    const x1 = round ? p.x + p.r : p.x1;
    const z0 = round ? p.z - p.r : p.z0;
    const z1 = round ? p.z + p.r : p.z1;
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z1);
    maxY = Math.max(maxY, p.y1 + (p.roofH || 0));
    if (!round && p.style !== WIN.NONE) {
      const fh = FLOOR_H[p.style] || 3.5;
      floorArea += (x1 - x0) * (z1 - z0) * Math.max(1, Math.round((p.y1 - p.y0) / fh));
    }
  }
  b.bbox = { x0: minX, x1: maxX, z0: minZ, z1: maxZ, y0: 0, y1: maxY };
  b.x = (minX + maxX) / 2;
  b.z = (minZ + maxZ) / 2;
  b.height = Math.round(Math.max(...b.parts.map((p) => p.y1)) * 10) / 10;
  if (!b.floors) {
    const main = b.parts[0];
    b.floors = Math.max(1, Math.round(b.height / (FLOOR_H[main.style] || 3.5)));
  }
  b.address = addressFor(ctx, b.x, b.z);
  // Rough occupancy so the inspector and the population sign have real numbers.
  switch (b.use) {
    case 'residential': b.residents = b.kind === 'house' ? ctx.rng.int(1, 5) : Math.round(floorArea / 34); break;
    case 'office': b.workers = Math.round(floorArea / 14); break;
    case 'retail': b.workers = Math.round(floorArea / 40); b.residents = Math.round(floorArea / 70); break;
    case 'hotel': b.residents = Math.round(floorArea / 55); b.workers = Math.round(floorArea / 120); break;
    case 'industrial': b.workers = Math.round(floorArea / 90); break;
    case 'civic': b.workers = Math.round(floorArea / 30); break;
    default: break;
  }
  return b;
}

function useCode(use) {
  if (use === 'hotel') return USE.residential;
  return USE[use] ?? USE.office;
}

function boxPart(x0, x1, z0, z1, y0, y1, style, color, extra = {}) {
  return { shape: 'box', x0, x1, z0, z1, y0, y1, style, color, roof: 'flat', roofColor: extra.roofColor || '#5d5f61', ...extra };
}

// --- Zone generators -------------------------------------------------------

function genDowntown(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const cols = W > 72 && rng.chance(0.6) ? 2 : 1;
  const rows = D > 66 && rng.chance(0.5) ? 2 : 1;
  const xsplit = r.x0 + W * rng.range(0.42, 0.58);
  const zsplit = r.z0 + D * rng.range(0.42, 0.58);
  const gap = 2.5;
  const k = clamp(1 - block.d / 0.26, 0, 1);
  for (let c = 0; c < cols; c++) {
    for (let rr = 0; rr < rows; rr++) {
      const lot = {
        x0: cols === 1 ? r.x0 : c === 0 ? r.x0 : xsplit + gap,
        x1: cols === 1 ? r.x1 : c === 0 ? xsplit - gap : r.x1,
        z0: rows === 1 ? r.z0 : rr === 0 ? r.z0 : zsplit + gap,
        z1: rows === 1 ? r.z1 : rr === 0 ? zsplit - gap : r.z1,
      };
      const landmark = !ctx.landmarkPlaced;
      ctx.landmarkPlaced = true;
      tower(ctx, lot, clamp(k * rng.range(0.7, 1.2) + 0.15, 0, 1.1), landmark);
    }
  }
}

function tower(ctx, lot, k, landmark) {
  const { rng } = ctx;
  const style = rng.weighted([WIN.CURTAIN, WIN.RIBBON, WIN.DECO], [0.55, 0.28, 0.17]);
  const fh = FLOOR_H[style];
  let H = lerp(55, 230, clamp(k, 0, 1)) * rng.range(0.75, 1.15);
  if (landmark) H = rng.range(300, 360);
  const floors = Math.max(8, Math.round(H / fh));
  H = floors * fh;
  const color = style === WIN.DECO ? rng.pick(PALETTE.deco) : rng.pick(PALETTE.glass);
  const use = landmark ? 'office' : rng.weighted(['office', 'residential', 'hotel'], [0.62, 0.26, 0.12]);
  const b = newBuilding(ctx, {
    kind: 'tower', use, name: ctx.names.tower(), floors,
    year: style === WIN.DECO ? rng.int(1926, 1965) : rng.int(1972, 2025),
  });
  const roofColor = rng.pick(PALETTE.flatRoof);
  const m = 1.5;
  let x0 = lot.x0 + m; let x1 = lot.x1 - m; let z0 = lot.z0 + m; let z1 = lot.z1 - m;
  const cap = landmark ? 46 : 54;
  const shrinkTo = (a0, a1, max) => {
    const w = a1 - a0;
    if (w <= max) return [a0, a1];
    const c = (a0 + a1) / 2 + rng.range(-1, 1) * (w - max) * 0.3;
    return [c - max / 2, c + max / 2];
  };
  const form = landmark ? 'stepped' : rng.weighted(['slab', 'podium', 'stepped'], [0.3, 0.4, 0.3]);
  const code = useCode(use);
  if (form === 'podium' || form === 'stepped') {
    const pf = rng.int(3, 6);
    const ph = pf * fh;
    b.parts.push(boxPart(x0, x1, z0, z1, 0, ph, style === WIN.CURTAIN ? WIN.RIBBON : style, form === 'podium' ? rng.pick(PALETTE.stone) : color, { use: code, shop: true, roofColor }));
    const f = rng.range(0.55, 0.78);
    const tw = Math.min((x1 - x0) * f, cap);
    const td = Math.min((z1 - z0) * f, cap);
    const tcx = (x0 + x1) / 2 + rng.range(-1, 1) * ((x1 - x0) - tw) * 0.3;
    const tcz = (z0 + z1) / 2 + rng.range(-1, 1) * ((z1 - z0) - td) * 0.3;
    x0 = tcx - tw / 2; x1 = tcx + tw / 2; z0 = tcz - td / 2; z1 = tcz + td / 2;
    if (form === 'podium') {
      b.parts.push(boxPart(x0, x1, z0, z1, ph, H, style, color, { use: code, roofColor }));
    } else {
      const tiers = landmark ? 3 : rng.int(2, 3);
      let y = ph;
      for (let t = 0; t < tiers; t++) {
        const top = t === tiers - 1 ? H : Math.round((ph + (H - ph) * (t === 0 ? rng.range(0.45, 0.6) : rng.range(0.72, 0.85))) / fh) * fh;
        b.parts.push(boxPart(x0, x1, z0, z1, y, top, style, color, { use: code, roofColor }));
        y = top;
        const s = rng.range(0.74, 0.86);
        const cxm = (x0 + x1) / 2;
        const czm = (z0 + z1) / 2;
        const hw = ((x1 - x0) * s) / 2;
        const hd = ((z1 - z0) * s) / 2;
        x0 = cxm - hw; x1 = cxm + hw; z0 = czm - hd; z1 = czm + hd;
      }
    }
  } else {
    [x0, x1] = shrinkTo(x0, x1, cap);
    [z0, z1] = shrinkTo(z0, z1, cap);
    b.parts.push(boxPart(x0, x1, z0, z1, 0, H, style, color, { use: code, shop: true, roofColor }));
  }

  // Crown: spires, antennas or a mechanical penthouse, plus a beacon on tall towers.
  const top = b.parts[b.parts.length - 1];
  const tcx = (top.x0 + top.x1) / 2;
  const tcz = (top.z0 + top.z1) / 2;
  let crownTop = H;
  const crown = landmark ? 'spire' : rng.weighted(['spire', 'antenna', 'penthouse', 'flat'], [0.22, 0.25, 0.35, 0.18]);
  if (crown === 'spire') {
    const sh = landmark ? rng.range(45, 70) : H * rng.range(0.08, 0.14);
    b.parts.push({ shape: 'cone', x: tcx, z: tcz, r: Math.min(top.x1 - top.x0, top.z1 - top.z0) * 0.18, y0: H, y1: H + sh, color: '#c9ced3', style: WIN.NONE });
    crownTop = H + sh;
  } else if (crown === 'antenna') {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const ah = rng.range(10, 28);
      const ax = tcx + rng.range(-0.3, 0.3) * (top.x1 - top.x0);
      const az = tcz + rng.range(-0.3, 0.3) * (top.z1 - top.z0);
      b.extras.push({ type: 'antenna', x: ax, z: az, y: H, h: ah });
      crownTop = Math.max(crownTop, H + ah);
    }
  } else if (crown === 'penthouse') {
    const pw = (top.x1 - top.x0) * rng.range(0.4, 0.65);
    const pd = (top.z1 - top.z0) * rng.range(0.4, 0.65);
    const phh = rng.range(4, 7);
    b.parts.push(boxPart(tcx - pw / 2, tcx + pw / 2, tcz - pd / 2, tcz + pd / 2, H, H + phh, WIN.NONE, '#7b8086', { roofColor }));
    crownTop = H + phh;
  }
  if (crown !== 'spire') addRooftopUnits(ctx, b, top, H, rng.int(2, 5));
  if (crownTop > 110) b.extras.push({ type: 'beacon', x: tcx, z: tcz, y: crownTop + 0.6 });
  finishBuilding(ctx, b);
}

function addRooftopUnits(ctx, b, top, y, n) {
  const { rng } = ctx;
  const w = top.x1 - top.x0;
  const d = top.z1 - top.z0;
  for (let i = 0; i < n; i++) {
    const uw = Math.min(w * 0.3, rng.range(2.5, 6));
    const ud = Math.min(d * 0.3, rng.range(2.5, 5));
    const ux = top.x0 + 1 + rng.next() * Math.max(0.1, w - uw - 2);
    const uz = top.z0 + 1 + rng.next() * Math.max(0.1, d - ud - 2);
    b.extras.push({ type: 'unit', x0: ux, x1: ux + uw, z0: uz, z1: uz + ud, y0: y, y1: y + rng.range(1.4, 3) });
  }
}

function splitRun(rng, a0, a1, minW, maxW) {
  // Split [a0, a1] into consecutive spans of random width.
  const spans = [];
  let p = a0;
  while (a1 - p > maxW) {
    const w = rng.range(minW, maxW);
    if (a1 - (p + w) < minW) break;
    spans.push([p, p + w]);
    p += w;
  }
  spans.push([p, a1]);
  return spans;
}

function genCommercial(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const k = clamp(1 - (block.d - 0.26) / 0.2, 0, 1);
  const mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
  const rowsSpec = alongX ? [[r.z0, mid - 1.5], [mid + 1.5, r.z1]] : [[r.x0, mid - 1.5], [mid + 1.5, r.x1]];
  const palette = rng.chance(0.5) ? PALETTE.brick : rng.chance(0.5) ? PALETTE.stone : PALETTE.concrete;
  for (const [a0, a1] of rowsSpec) {
    const spans = alongX ? splitRun(rng, r.x0, r.x1, 18, 34) : splitRun(rng, r.z0, r.z1, 18, 34);
    for (const [s0, s1] of spans) {
      const style = rng.weighted([WIN.PUNCHED, WIN.RIBBON, WIN.DECO], [0.55, 0.25, 0.2]);
      const fh = FLOOR_H[style];
      const floors = rng.int(3, 5 + Math.round(9 * k));
      const H = floors * fh + 0.8;
      const use = rng.weighted(['retail', 'office', 'residential'], [0.45, 0.35, 0.2]);
      const b = newBuilding(ctx, { kind: 'midrise', use, name: use === 'residential' ? ctx.names.residential() : ctx.names.midrise(), floors, year: rng.int(1895, 2020) });
      const depthCut = rng.range(0, 6);
      const box = alongX
        ? (a0 < mid ? [s0 + 0.4, s1 - 0.4, a0, a1 - depthCut] : [s0 + 0.4, s1 - 0.4, a0 + depthCut, a1])
        : (a0 < mid ? [a0, a1 - depthCut, s0 + 0.4, s1 - 0.4] : [a0 + depthCut, a1, s0 + 0.4, s1 - 0.4]);
      const color = style === WIN.RIBBON ? rng.pick(PALETTE.concrete) : rng.pick(palette);
      const part = boxPart(box[0], box[1], box[2], box[3], 0, H, style, color, { use: useCode(use), shop: use !== 'office' || rng.chance(0.5), roofColor: rng.pick(PALETTE.flatRoof), top: floors * fh });
      b.parts.push(part);
      if (floors >= 6 && style !== WIN.RIBBON && rng.chance(0.35)) {
        const tx = lerp(part.x0 + 3, part.x1 - 3, rng.next());
        const tz = lerp(part.z0 + 3, part.z1 - 3, rng.next());
        b.extras.push({ type: 'watertank', x: tx, z: tz, y: H, r: rng.range(1.6, 2.4), h: rng.range(3.5, 5) });
      }
      addRooftopUnits(ctx, b, part, H, rng.int(1, 3));
      finishBuilding(ctx, b);
    }
  }
}

function genResidential(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const t = clamp((block.d - 0.45) / 0.23, 0, 1);
  const baseFloors = Math.round(lerp(8, 4, t));
  const palette = rng.chance(0.45) ? PALETTE.brick : PALETTE.apartment;
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;

  if (rng.chance(0.22) && W > 50 && D > 50) {
    // Slab blocks set in green space.
    const n = rng.int(2, 3);
    const alongX = W > D;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const len = (alongX ? D : W) * 0.7;
      const thick = rng.range(12, 15);
      const c = alongX ? lerp(r.x0, r.x1, f) : lerp(r.z0, r.z1, f);
      const mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      const floors = baseFloors + rng.int(2, 6);
      const H = floors * FLOOR_H[WIN.PUNCHED] + 0.8;
      const b = newBuilding(ctx, { kind: 'apartment', use: 'residential', name: ctx.names.residential(), floors, year: rng.int(1955, 2015) });
      const part = alongX
        ? boxPart(c - thick / 2, c + thick / 2, mid - len / 2, mid + len / 2, 0, H, WIN.PUNCHED, rng.pick(PALETTE.apartment), { use: USE.residential, roofColor: rng.pick(PALETTE.flatRoof), top: floors * FLOOR_H[WIN.PUNCHED] })
        : boxPart(mid - len / 2, mid + len / 2, c - thick / 2, c + thick / 2, 0, H, WIN.PUNCHED, rng.pick(PALETTE.apartment), { use: USE.residential, roofColor: rng.pick(PALETTE.flatRoof), top: floors * FLOOR_H[WIN.PUNCHED] });
      b.parts.push(part);
      addRooftopUnits(ctx, b, part, H, 2);
      finishBuilding(ctx, b);
    }
    scatterTrees(ctx, r, rng.int(8, 14), 4, ctx.buildings.slice(-n));
    return;
  }

  // Perimeter block around a planted courtyard.
  const depth = rng.range(12, 16);
  const sides = [
    { run: [r.x0, r.x1], fixed: [r.z0, r.z0 + depth], axis: 'x' },
    { run: [r.x0, r.x1], fixed: [r.z1 - depth, r.z1], axis: 'x' },
    { run: [r.z0 + depth, r.z1 - depth], fixed: [r.x0, r.x0 + depth], axis: 'z' },
    { run: [r.z0 + depth, r.z1 - depth], fixed: [r.x1 - depth, r.x1], axis: 'z' },
  ];
  for (const s of sides) {
    if (s.run[1] - s.run[0] < 8) continue;
    for (const [a, c] of splitRun(rng, s.run[0], s.run[1], 16, 34)) {
      const floors = clamp(baseFloors + rng.int(-1, 2), 3, 12);
      const style = WIN.PUNCHED;
      const H = floors * FLOOR_H[style] + 0.8;
      const b = newBuilding(ctx, { kind: 'apartment', use: 'residential', name: ctx.names.residential(), floors, year: rng.int(1900, 2020) });
      const part = s.axis === 'x'
        ? boxPart(a + 0.2, c - 0.2, s.fixed[0], s.fixed[1], 0, H, style, rng.pick(palette), { use: USE.residential, shop: rng.chance(0.25), roofColor: rng.pick(PALETTE.flatRoof), top: floors * FLOOR_H[style] })
        : boxPart(s.fixed[0], s.fixed[1], a + 0.2, c - 0.2, 0, H, style, rng.pick(palette), { use: USE.residential, shop: rng.chance(0.25), roofColor: rng.pick(PALETTE.flatRoof), top: floors * FLOOR_H[style] });
      b.parts.push(part);
      if (floors >= 6 && rng.chance(0.25)) {
        b.extras.push({ type: 'watertank', x: (part.x0 + part.x1) / 2, z: (part.z0 + part.z1) / 2, y: H, r: rng.range(1.6, 2.2), h: rng.range(3.5, 4.5) });
      }
      finishBuilding(ctx, b);
    }
  }
  const court = { x0: r.x0 + depth + 3, x1: r.x1 - depth - 3, z0: r.z0 + depth + 3, z1: r.z1 - depth - 3 };
  if (court.x1 - court.x0 > 6 && court.z1 - court.z0 > 6) {
    const area = (court.x1 - court.x0) * (court.z1 - court.z0);
    scatterTrees(ctx, court, Math.min(14, Math.round(area / 140)), 5);
  }
}

function genSuburban(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
  const rows = alongX ? [{ a0: r.z0, a1: mid, front: -1 }, { a0: mid, a1: r.z1, front: 1 }] : [{ a0: r.x0, a1: mid, front: -1 }, { a0: mid, a1: r.x1, front: 1 }];
  for (const row of rows) {
    const rowDepth = row.a1 - row.a0;
    const lots = alongX ? splitRun(rng, r.x0, r.x1, 15, 22) : splitRun(rng, r.z0, r.z1, 15, 22);
    for (const [s0, s1] of lots) {
      const lotW = s1 - s0;
      const setback = rng.range(4.5, 7);
      const hw = Math.min(lotW - 3.5, rng.range(9, 13));
      const hd = Math.min(rowDepth - setback - 6, rng.range(8, 11));
      if (hw < 6 || hd < 6) continue;
      const c = (s0 + s1) / 2 + rng.range(-1, 1) * Math.max(0, (lotW - hw) / 2 - 1.2);
      // Front of the lot faces the street on the outer edge of the row.
      const d0 = row.front < 0 ? row.a0 + setback : row.a1 - setback - hd;
      const d1 = d0 + hd;
      const floors = rng.chance(0.55) ? 2 : 1;
      const wallH = floors * FLOOR_H[WIN.HOUSE] + 0.3;
      const roofH = rng.range(2.2, 3.4);
      const ridge = rng.chance(0.75) ? (alongX ? 'x' : 'z') : (alongX ? 'z' : 'x');
      const b = newBuilding(ctx, { kind: 'house', use: 'residential', name: ctx.names.house(), floors, year: rng.int(1920, 2022) });
      const color = rng.pick(PALETTE.siding);
      const roofColor = rng.pick(PALETTE.houseRoof);
      const part = alongX
        ? boxPart(c - hw / 2, c + hw / 2, d0, d1, 0, wallH, WIN.HOUSE, color, { use: USE.residential, roof: `gable-${ridge}`, roofH, roofColor })
        : boxPart(d0, d1, c - hw / 2, c + hw / 2, 0, wallH, WIN.HOUSE, color, { use: USE.residential, roof: `gable-${ridge}`, roofH, roofColor });
      b.parts.push(part);
      const gRight = c + hw / 2 + 3.2;
      const gLeft = c - hw / 2 - 3.2;
      const gs = gRight + 3 <= s1 - 0.5 ? gRight : gLeft - 3 >= s0 + 0.5 ? gLeft : null;
      if (gs !== null && rng.chance(0.35)) {
        // Garage beside the house.
        const g0 = row.front < 0 ? d0 : d1 - 6;
        b.parts.push(alongX
          ? boxPart(gs - 3, gs + 3, g0, g0 + 6, 0, 3.1, WIN.NONE, color, { roofColor })
          : boxPart(g0, g0 + 6, gs - 3, gs + 3, 0, 3.1, WIN.NONE, color, { roofColor }));
      }
      finishBuilding(ctx, b);
      // Yard trees: backyard and sometimes front yard.
      const back = row.front < 0 ? [d1 + 2, row.a1 - 2] : [row.a0 + 2, d0 - 2];
      const nBack = rng.int(0, 2);
      for (let i = 0; i < nBack; i++) {
        if (back[1] - back[0] < 2) break;
        const along = lerp(s0 + 2, s1 - 2, rng.next());
        const across = lerp(back[0], back[1], rng.next());
        ctx.trees.push(alongX
          ? { x: along, z: across, s: rng.range(0.9, 1.4), kind: rng.chance(0.2) ? 'cone' : 'round', tint: rng.next() }
          : { x: across, z: along, s: rng.range(0.9, 1.4), kind: rng.chance(0.2) ? 'cone' : 'round', tint: rng.next() });
      }
    }
  }
}

function genIndustrial(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const tankStrip = len > 70 && rng.chance(0.55) ? 22 : 0;
  const a0 = (alongX ? r.x0 : r.z0) + (tankStrip ? tankStrip : 0);
  const a1 = alongX ? r.x1 : r.z1;
  const spans = (a1 - a0) > 60 && rng.chance(0.6) ? [[a0, (a0 + a1) / 2 - 4], [(a0 + a1) / 2 + 4, a1]] : [[a0, a1]];
  for (const [s0, s1] of spans) {
    const H = rng.range(8, 14);
    const b = newBuilding(ctx, { kind: 'warehouse', use: 'industrial', name: ctx.names.industrial(), floors: rng.int(1, 3), year: rng.int(1910, 2010) });
    const inset = 3;
    const part = alongX
      ? boxPart(s0 + inset, s1 - inset, r.z0 + inset, r.z1 - inset, 0, H, WIN.INDUSTRIAL, rng.pick(PALETTE.metal), { use: USE.industrial, roofColor: '#8d9196' })
      : boxPart(r.x0 + inset, r.x1 - inset, s0 + inset, s1 - inset, 0, H, WIN.INDUSTRIAL, rng.pick(PALETTE.metal), { use: USE.industrial, roofColor: '#8d9196' });
    b.parts.push(part);
    addRooftopUnits(ctx, b, part, H, rng.int(2, 4));
    finishBuilding(ctx, b);
  }
  if (tankStrip) {
    const s0 = alongX ? r.x0 : r.z0;
    const n = rng.int(1, 3);
    const span = alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    const b = newBuilding(ctx, { kind: 'tank', use: 'industrial', name: `${ctx.names.industrial()} Tank Farm`, floors: 1, year: rng.int(1950, 2005) });
    for (let i = 0; i < n; i++) {
      const rr = rng.range(5, 8);
      const along = s0 + tankStrip / 2;
      const across = (alongX ? r.z0 : r.x0) + ((i + 0.5) / n) * span;
      const h = rng.range(9, 15);
      b.parts.push({ shape: 'cyl', x: alongX ? along : across, z: alongX ? across : along, r: Math.min(rr, span / n / 2 - 1), y0: 0, y1: h, color: rng.pick(['#d9dcdc', '#c5c9c9', '#e3e0d6']), style: WIN.NONE });
    }
    finishBuilding(ctx, b);
  }
  if (rng.chance(0.55)) {
    const h = rng.range(32, 50);
    const x = alongX ? r.x1 - 6 : r.x0 + 6;
    const z = alongX ? r.z0 + 6 : r.z1 - 6;
    const b = newBuilding(ctx, { kind: 'chimney', use: 'industrial', name: 'Smokestack', floors: 1, year: rng.int(1905, 1960) });
    b.parts.push({ shape: 'cyl', x, z, r: 1.7, y0: 0, y1: h, color: '#8b4a3a', style: WIN.NONE, taper: 0.7 });
    finishBuilding(ctx, b);
    ctx.smokestacks.push({ x, z, y: h });
  }
}

function scatterTrees(ctx, r, n, minDist, avoid = []) {
  const { rng } = ctx;
  const placed = [];
  let tries = 0;
  while (placed.length < n && tries < n * 20) {
    tries++;
    const x = lerp(r.x0 + 2, r.x1 - 2, rng.next());
    const z = lerp(r.z0 + 2, r.z1 - 2, rng.next());
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
    if (avoid.some((b) => x > b.bbox.x0 - 3 && x < b.bbox.x1 + 3 && z > b.bbox.z0 - 3 && z < b.bbox.z1 + 3)) continue;
    const t = { x, z, s: rng.range(0.85, 1.35), kind: rng.chance(0.25) ? 'cone' : 'round', tint: rng.next() };
    placed.push(t);
    ctx.trees.push(t);
  }
}

function genPark(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const pathW = block.big ? 4 : 3;
  // Crossing footpaths.
  ctx.paths.push({ x0: cx - pathW / 2, x1: cx + pathW / 2, z0: r.z0 - SIDEWALK_W + 0.1, z1: r.z1 + SIDEWALK_W - 0.1 });
  ctx.paths.push({ x0: r.x0 - SIDEWALK_W + 0.1, x1: r.x1 + SIDEWALK_W - 0.1, z0: cz - pathW / 2, z1: cz + pathW / 2 });
  const blockers = [];
  if (block.big) {
    const pond = { x: cx + W * rng.range(-0.18, 0.18), z: cz + D * rng.range(-0.15, 0.15), rx: W * rng.range(0.14, 0.2), rz: D * rng.range(0.12, 0.18) };
    // Keep the pond clear of the paths.
    pond.x = cx + Math.sign(pond.x - cx || 1) * Math.max(Math.abs(pond.x - cx), pond.rx + pathW + 3);
    pond.z = cz + Math.sign(pond.z - cz || 1) * Math.max(Math.abs(pond.z - cz), pond.rz + pathW + 3);
    ctx.ponds.push(pond);
    blockers.push(pond);
    ctx.paths.push({ x0: r.x0 + 10, x1: r.x1 - 10, z0: r.z0 + 10, z1: r.z0 + 10 + pathW });
    ctx.paths.push({ x0: r.x0 + 10, x1: r.x1 - 10, z0: r.z1 - 10 - pathW, z1: r.z1 - 10 });
    ctx.paths.push({ x0: r.x0 + 10, x1: r.x0 + 10 + pathW, z0: r.z0 + 10, z1: r.z1 - 10 });
    ctx.paths.push({ x0: r.x1 - 10 - pathW, x1: r.x1 - 10, z0: r.z0 + 10, z1: r.z1 - 10 });
    ctx.fountains.push({ x: cx, z: cz, r: 5 });
  }
  const area = W * D;
  const n = Math.round(area / (block.big ? 150 : 170));
  const placed = [];
  let tries = 0;
  while (placed.length < n && tries < n * 25) {
    tries++;
    const x = lerp(r.x0 + 2.5, r.x1 - 2.5, rng.next());
    const z = lerp(r.z0 + 2.5, r.z1 - 2.5, rng.next());
    if (Math.abs(x - cx) < pathW + 2 || Math.abs(z - cz) < pathW + 2) continue;
    if (blockers.some((p) => ((x - p.x) / (p.rx + 4)) ** 2 + ((z - p.z) / (p.rz + 4)) ** 2 < 1)) continue;
    if (block.big && (Math.abs(x - (r.x0 + 10 + pathW / 2)) < pathW || Math.abs(x - (r.x1 - 10 - pathW / 2)) < pathW || Math.abs(z - (r.z0 + 10 + pathW / 2)) < pathW || Math.abs(z - (r.z1 - 10 - pathW / 2)) < pathW)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 6.5)) continue;
    const t = { x, z, s: rng.range(0.9, 1.5), kind: rng.chance(0.3) ? 'cone' : 'round', tint: rng.next() };
    placed.push(t);
    ctx.trees.push(t);
  }
}

function genPlaza(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  // City Hall on one half, a public square with a fountain on the other.
  const b = newBuilding(ctx, { kind: 'civic', use: 'civic', name: 'City Hall', floors: 4, year: rng.int(1898, 1932) });
  const stone = '#d8d0bf';
  let hall;
  if (alongX) {
    const mid = (r.x0 + r.x1) / 2;
    hall = boxPart(r.x0 + 4, mid - 4, r.z0 + 6, r.z1 - 6, 0, 18, WIN.DECO, stone, { use: USE.civic, roofColor: '#7d8a86', top: 15.2 });
    ctx.fountains.push({ x: (mid + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: 6 });
  } else {
    const mid = (r.z0 + r.z1) / 2;
    hall = boxPart(r.x0 + 6, r.x1 - 6, r.z0 + 4, mid - 4, 0, 18, WIN.DECO, stone, { use: USE.civic, roofColor: '#7d8a86', top: 15.2 });
    ctx.fountains.push({ x: (r.x0 + r.x1) / 2, z: (mid + r.z1) / 2, r: 6 });
  }
  b.parts.push(hall);
  const hx = (hall.x0 + hall.x1) / 2;
  const hz = (hall.z0 + hall.z1) / 2;
  b.parts.push(boxPart(hx - 7, hx + 7, hz - 7, hz + 7, 18, 30, WIN.DECO, stone, { use: USE.civic, roofColor: '#7d8a86', top: 26.6 }));
  b.parts.push({ shape: 'dome', x: hx, z: hz, r: 7.5, y0: 30, y1: 37.5, color: '#6f9c8f', style: WIN.NONE });
  b.parts.push({ shape: 'cone', x: hx, z: hz, r: 0.9, y0: 37, y1: 44, color: '#c9b46a', style: WIN.NONE });
  finishBuilding(ctx, b);
  const f = ctx.fountains[ctx.fountains.length - 1];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.trees.push({ x: f.x + Math.cos(a) * 16, z: f.z + Math.sin(a) * 16, s: 0.9, kind: 'round', tint: rng.next() });
  }
}

function genConstruction(ctx, block) {
  const { rng } = ctx;
  const r = inner(block);
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const w = Math.min(36, (r.x1 - r.x0) * 0.6);
  const d = Math.min(30, (r.z1 - r.z0) * 0.6);
  const floors = rng.int(5, 11);
  const fh = 3.6;
  const b = newBuilding(ctx, { kind: 'construction', use: 'construction', name: `${ctx.names.tower()} (under construction)`, floors, year: 2026 });
  b.parts.push(boxPart(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0, floors * fh, WIN.NONE, '#a9a69f', { roofColor: '#8f8c86', frame: true, floorH: fh }));
  finishBuilding(ctx, b);
  const crane = {
    x: cx + w / 2 + 6, z: cz - d / 2 - 4,
    h: floors * fh + rng.range(28, 40), jib: rng.range(38, 52), angle: rng.range(0, Math.PI * 2), speed: rng.range(0.05, 0.12),
  };
  ctx.cranes.push(crane);
}
