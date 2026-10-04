// Street-level geometry: asphalt, paint, sidewalks and lawns, medians, the
// riverside promenades, bridges, park paths, ponds and fountains.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import {
  LANE_W, GUTTER, SIDEWALK_W, CROSSWALK_W, CURB_H, WATER_Y, SIDES, SIDE_VEC,
} from '../sim/constants.js';
import { createRoadMaterial, createPavingMaterial, createGroundMaterial, createWaterMaterial } from './materials.js';

const SIDEWALK = rgb('#a6a39b');
const CURB = rgb('#9c9992');
const PLAZA = rgb('#c4bdb0');
const YARD = rgb('#77736b');
const DIRT = rgb('#8a7558');
const PATH = rgb('#c7b38d');
const STONE = rgb('#a39d92');
const WHITE = rgb('#e6e6e0');
const YELLOW = rgb('#e3b324');
const STEEL = rgb('#3d4247');
const UV_SCALE = 7;
const PAINT_Y = 0.02;

export function buildStreets(city, net, { bridgePaint = '#9c3b2e' } = {}) {
  const road = new GeoBuilder({ color: false, uv: true });
  const paint = new GeoBuilder({ color: true });
  const paving = new GeoBuilder({ color: true });
  const decal = new GeoBuilder({ color: true });
  const lawn = new GeoBuilder({ color: true });
  const water = new GeoBuilder({ color: false });
  const steel = new GeoBuilder({ color: true });
  const medianTrees = [];

  // --- Asphalt ---------------------------------------------------------------
  for (const r of net.roads) {
    const { a: A, b: B } = r;
    const hw = r.width / 2;
    if (r.axis === 'ns') road.flat(A.x - hw, A.x + hw, A.portal ? A.z : A.z + A.hz, B.portal ? B.z : B.z - B.hz, 0, UV_SCALE);
    else road.flat(A.portal ? A.x : A.x + A.hx, B.portal ? B.x : B.x - B.hx, A.z - hw, A.z + hw, 0, UV_SCALE);
  }
  for (const I of net.inters) if (!I.portal) road.flat(I.x - I.hx, I.x + I.hx, I.z - I.hz, I.z + I.hz, 0, UV_SCALE);

  // --- Paint, medians and stop lines -------------------------------------------
  for (const r of net.roads) addRoadPaint(r, paint, paving, lawn, medianTrees);
  for (const I of net.inters) if (!I.portal) addCrosswalks(I, paint);

  // --- Blocks: sidewalk ring with a curb, and the ground inside ------------------
  for (const b of city.blocks) {
    const sw = SIDEWALK_W;
    paving.color(SIDEWALK);
    paving.flat(b.x0, b.x1, b.z0, b.z0 + sw, CURB_H);
    paving.flat(b.x0, b.x1, b.z1 - sw, b.z1, CURB_H);
    paving.flat(b.x0, b.x0 + sw, b.z0 + sw, b.z1 - sw, CURB_H);
    paving.flat(b.x1 - sw, b.x1, b.z0 + sw, b.z1 - sw, CURB_H);
    paving.color(CURB);
    paving.box(b.x0, b.x1, 0, CURB_H, b.z0, b.z1, { top: false });
    const x0 = b.x0 + sw;
    const x1 = b.x1 - sw;
    const z0 = b.z0 + sw;
    const z1 = b.z1 - sw;
    if (b.type === 'suburban' || b.type === 'residential' || b.type === 'park') {
      lawn.color([1, 1, 1]).flat(x0, x1, z0, z1, CURB_H);
    } else {
      const col = b.type === 'industrial' ? YARD : b.type === 'construction' ? DIRT : PLAZA;
      paving.color(col).flat(x0, x1, z0, z1, CURB_H);
    }
  }

  // --- City edge: sidewalks outside the ring road and along the river ------------
  const bd = city.bounds;
  const sw = SIDEWALK_W;
  const portalCuts = (axis) => net.roads.filter((r) => r.portal && r.axis === axis).map((r) => [(axis === 'ns' ? r.a.x : r.a.z) - r.width / 2, (axis === 'ns' ? r.a.x : r.a.z) + r.width / 2]);
  const riverCut = [[city.river.roadNorth, city.river.roadSouth]];
  const bridgeCuts = net.roads.filter((r) => r.bridge).map((r) => [r.a.x - r.width / 2 - sw, r.a.x + r.width / 2 + sw]);
  const strip = (x0, x1, z0, z1, alongX, cuts) => {
    for (const [s0, s1] of subtract(alongX ? [x0, x1] : [z0, z1], cuts)) {
      if (alongX) paving.color(SIDEWALK).box(s0, s1, 0, CURB_H, z0, z1);
      else paving.color(SIDEWALK).box(x0, x1, 0, CURB_H, s0, s1);
    }
  };
  strip(bd.x0, bd.x1, bd.z0, bd.z0 + sw, true, portalCuts('ns'));
  strip(bd.x0, bd.x1, bd.z1 - sw, bd.z1, true, portalCuts('ns'));
  strip(bd.x0, bd.x0 + sw, bd.z0 + sw, bd.z1 - sw, false, [...portalCuts('ew'), ...riverCut]);
  strip(bd.x1 - sw, bd.x1, bd.z0 + sw, bd.z1 - sw, false, [...portalCuts('ew'), ...riverCut]);
  // Riverside promenades with railings at the water's edge.
  const rv = city.river;
  for (const [z0, z1, edge] of [[rv.roadNorth, rv.zNorth, rv.zNorth - 0.25], [rv.zSouth, rv.roadSouth, rv.zSouth + 0.25]]) {
    for (const [s0, s1] of subtract([bd.x0 + sw, bd.x1 - sw], bridgeCuts)) {
      paving.color(PLAZA).box(s0, s1, 0, CURB_H, z0, z1);
      railing(steel, [s0 + 0.5, edge], [s1 - 0.5, edge], CURB_H);
    }
  }

  // --- Bridges -------------------------------------------------------------------
  const paintCol = rgb(bridgePaint);
  for (const r of net.roads) if (r.bridge) addBridge(r, city, paving, steel, paintCol);

  // --- Parks and plazas ------------------------------------------------------------
  for (const p of city.paths) decal.color(PATH).flat(p.x0, p.x1, p.z0, p.z1, CURB_H + 0.01);
  for (const p of city.ponds) {
    ellipse(water, p.x, p.z, p.rx, p.rz, CURB_H + 0.03);
    ellipseRing(decal, p.x, p.z, p.rx, p.rz, 1.2, CURB_H + 0.02, STONE);
  }
  for (const f of city.fountains) {
    paving.color(STONE).cylinder(f.x, f.z, f.r, f.r, CURB_H, CURB_H + 0.6, 24, true);
    paving.color(STONE).cylinder(f.x, f.z, 0.6, 0.45, CURB_H + 0.6, CURB_H + 1.8, 10, true);
    paving.color(STONE).cylinder(f.x, f.z, 1.6, 1.6, CURB_H + 1.8, CURB_H + 2.0, 14, true);
    ellipse(water, f.x, f.z, f.r - 0.35, f.r - 0.35, CURB_H + 0.62);
  }

  // --- Meshes ------------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'streets';
  const add = (builder, material, { shadows = true, cast = false, order = 0 } = {}) => {
    if (builder.empty) return null;
    const m = new THREE.Mesh(builder.build(), material);
    m.receiveShadow = shadows;
    m.castShadow = cast;
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  const roadMat = createRoadMaterial();
  const pavingMat = createPavingMaterial();
  const lawnMat = createGroundMaterial();
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const decalMat = createPavingMaterial();
  decalMat.polygonOffset = true;
  decalMat.polygonOffsetFactor = -2;
  decalMat.polygonOffsetUnits = -4;
  const waterMat = createWaterMaterial();
  waterMat.polygonOffset = true;
  waterMat.polygonOffsetFactor = -3;
  waterMat.polygonOffsetUnits = -6;
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });

  add(road, roadMat);
  add(paving, pavingMat, { cast: true });
  add(lawn, lawnMat);
  add(paint, paintMat);
  add(decal, decalMat);
  add(water, waterMat);
  add(steel, steelMat, { cast: true });
  return { group, medianTrees, materials: { roadMat, pavingMat, lawnMat, paintMat, decalMat, waterMat, steelMat } };
}

// ---------------------------------------------------------------------------

/** Remove the intervals in `cuts` from [a, b]. */
function subtract([a, b], cuts) {
  let parts = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
      else {
        if (c0 > p0) next.push([p0, c0]);
        if (c1 < p1) next.push([c1, p1]);
      }
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.5);
}

/** Lengthwise markings for one road, plus its median island where it has one. */
function addRoadPaint(r, paint, paving, lawn, medianTrees) {
  const A = r.a;
  const B = r.b;
  const ns = r.axis === 'ns';
  const c = ns ? A.x : A.z;
  const start = ns ? (A.portal ? A.z : A.z + A.hz + CROSSWALK_W) : (A.portal ? A.x : A.x + A.hx + CROSSWALK_W);
  const end = ns ? (B.portal ? B.z : B.z - B.hz - CROSSWALK_W) : (B.portal ? B.x : B.x - B.hx - CROSSWALK_W);
  const strip = (off, w, s0, s1, col) => {
    if (s1 - s0 < 0.2) return;
    paint.color(col);
    if (ns) paint.flat(c + off - w / 2, c + off + w / 2, s0, s1, PAINT_Y);
    else paint.flat(s0, s1, c + off - w / 2, c + off + w / 2, PAINT_Y);
  };
  const dashed = (off, w, s0, s1, col, dash = 3, gap = 6) => {
    for (let s = s0 + gap / 2; s < s1 - 1; s += dash + gap) strip(off, w, s, Math.min(s + dash, s1), col);
  };
  const hw = r.width / 2;
  if (r.median > 0) {
    const m = r.median / 2;
    strip(-m + 0.08, 0.12, start, end, YELLOW);
    strip(m - 0.08, 0.12, start, end, YELLOW);
    for (const sgn of [-1, 1]) {
      for (let k = 1; k < r.lanesPerDir; k++) dashed(sgn * (m + k * LANE_W), 0.13, start, end, WHITE);
      strip(sgn * (hw - GUTTER + 0.08), 0.13, start, end, WHITE);
    }
    // Planted median island (not on bridges or highways).
    if (!r.bridge && !r.portal) {
      const s0 = start + 1.6;
      const s1 = end - 1.6;
      if (s1 - s0 > 6) {
        const w = r.median - 0.5;
        if (ns) {
          paving.color(CURB).box(c - w / 2, c + w / 2, 0, 0.15, s0, s1, { top: false });
          lawn.color([0.95, 1, 0.95]).flat(c - w / 2, c + w / 2, s0, s1, 0.15);
        } else {
          paving.color(CURB).box(s0, s1, 0, 0.15, c - w / 2, c + w / 2, { top: false });
          lawn.color([0.95, 1, 0.95]).flat(s0, s1, c - w / 2, c + w / 2, 0.15);
        }
        for (let s = s0 + 7; s < s1 - 6; s += 15) {
          medianTrees.push(ns ? { x: c, z: s, s: 0.75, kind: 'round', tint: (s * 0.37) % 1, y: 0.15 } : { x: s, z: c, s: 0.75, kind: 'round', tint: (s * 0.37) % 1, y: 0.15 });
        }
      }
    }
  } else {
    strip(-0.11, 0.1, start, end, YELLOW);
    strip(0.11, 0.1, start, end, YELLOW);
  }
  // Stop lines across the inbound half at each signalized or junction end.
  for (const [I, sign, dir] of [[B, 1, 1], [A, -1, -1]]) {
    if (I.portal) continue;
    const s = dir > 0 ? end - 1.0 : start + 1.0;
    const half = [r.median / 2, hw - GUTTER];
    // Inbound lanes drive on the right: toward B (+axis) they are on the -x side for ns roads.
    const side = ns ? -sign : sign;
    const a0 = Math.min(side * half[0], side * half[1]);
    const a1 = Math.max(side * half[0], side * half[1]);
    const s0 = Math.min(s, s + dir * 0.45);
    const s1 = Math.max(s, s + dir * 0.45);
    paint.color(WHITE);
    if (ns) paint.flat(c + a0, c + a1, s0, s1, PAINT_Y);
    else paint.flat(s0, s1, c + a0, c + a1, PAINT_Y);
  }
}

/** Zebra crosswalks on every leg of an intersection. */
function addCrosswalks(I, paint) {
  paint.color(WHITE);
  for (const side of SIDES) {
    if (!I.legs[side]) continue;
    const [vx, vz] = SIDE_VEC[side];
    const ext = I.extent(side);
    const across = side === 'N' || side === 'S' ? I.hx : I.hz;
    const b0 = ext + 0.2;
    const b1 = ext + CROSSWALK_W - 0.2;
    for (let u = -across + 0.6; u < across - 0.5; u += 1.15) {
      const u1 = Math.min(u + 0.6, across - 0.4);
      if (vx === 0) {
        const z0 = I.z + vz * b0;
        const z1 = I.z + vz * b1;
        paint.flat(I.x + u, I.x + u1, Math.min(z0, z1), Math.max(z0, z1), PAINT_Y);
      } else {
        const x0 = I.x + vx * b0;
        const x1 = I.x + vx * b1;
        paint.flat(Math.min(x0, x1), Math.max(x0, x1), I.z + u, I.z + u1, PAINT_Y);
      }
    }
  }
}

function railing(g, p, q, y0) {
  g.color(STEEL);
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(1, Math.floor(len / 2.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = p[0] + (q[0] - p[0]) * t;
    const z = p[1] + (q[1] - p[1]) * t;
    g.box(x - 0.05, x + 0.05, y0, y0 + 1.05, z - 0.05, z + 0.05, { bottom: false });
  }
  g.beam([p[0], y0 + 1.05, p[1]], [q[0], y0 + 1.05, q[1]], 0.08, 0.06);
  g.beam([p[0], y0 + 0.55, p[1]], [q[0], y0 + 0.55, q[1]], 0.04, 0.04);
}

function addBridge(r, city, paving, steel, paintCol) {
  const rv = city.river;
  const x = r.a.x;
  const hw = r.width / 2;
  const sw = SIDEWALK_W;
  const zA = r.a.z + r.a.hz;
  const zB = r.b.z - r.b.hz;
  // Sidewalks along the whole span, and the deck under the water crossing.
  paving.color(SIDEWALK).box(x - hw - sw, x - hw, 0, CURB_H, zA, zB);
  paving.color(SIDEWALK).box(x + hw, x + hw + sw, 0, CURB_H, zA, zB);
  paving.color(rgb('#8f8b84')).box(x - hw - sw, x + hw + sw, -1.5, -0.02, rv.zNorth - 0.4, rv.zSouth + 0.4, { top: false, bottom: true });
  // Piers.
  const span = rv.zSouth - rv.zNorth;
  const piers = span > 50 ? 2 : 1;
  for (let k = 1; k <= piers; k++) {
    const z = rv.zNorth + (span * k) / (piers + 1);
    paving.color(rgb('#827e77')).box(x - hw - sw + 1.2, x + hw + sw - 1.2, WATER_Y - 2.5, -1.5, z - 1.4, z + 1.4, { bottom: false });
  }
  railing(steel, [x - hw - sw + 0.2, rv.zNorth - 2], [x - hw - sw + 0.2, rv.zSouth + 2], CURB_H);
  railing(steel, [x + hw + sw - 0.2, rv.zNorth - 2], [x + hw + sw - 0.2, rv.zSouth + 2], CURB_H);
  if (r.cls !== 'major') return;
  // Painted steel tied arches over the main bridges.
  steel.color(paintCol);
  const z0 = rv.zNorth - 3;
  const z1 = rv.zSouth + 3;
  const H = 15;
  const segs = 22;
  for (const sx of [x - hw - 0.35, x + hw + 0.35]) {
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const pt = [sx, CURB_H + H * 4 * t * (1 - t), z0 + (z1 - z0) * t];
      if (prev) steel.beam(prev, pt, 0.9, 1.1);
      if (i > 0 && i < segs && i % 2 === 0) steel.beam([sx, CURB_H, pt[2]], pt, 0.12, 0.12);
      prev = pt;
    }
    steel.beam([sx, CURB_H + 0.3, z0], [sx, CURB_H + 0.3, z1], 0.7, 0.6);
  }
  // Cross bracing over the roadway near the crown.
  for (const t of [0.35, 0.5, 0.65]) {
    const y = CURB_H + H * 4 * t * (1 - t);
    const z = z0 + (z1 - z0) * t;
    steel.beam([x - hw - 0.35, y, z], [x + hw + 0.35, y, z], 0.4, 0.4);
  }
}

function ellipse(g, cx, cz, rx, rz, y, seg = 40) {
  const center = g.v(cx, y, cz, 0, 1, 0);
  const ring = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push(g.v(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz, 0, 1, 0));
  }
  for (let i = 0; i < seg; i++) g.idx.push(center, ring[i + 1], ring[i]);
}

function ellipseRing(g, cx, cz, rx, rz, w, y, col, seg = 40) {
  g.color(col);
  const inner = [];
  const outer = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    inner.push(g.v(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz, 0, 1, 0));
    outer.push(g.v(cx + Math.cos(a) * (rx + w), y, cz + Math.sin(a) * (rz + w), 0, 1, 0));
  }
  for (let i = 0; i < seg; i++) g.idx.push(inner[i], inner[i + 1], outer[i + 1], inner[i], outer[i + 1], outer[i]);
}
