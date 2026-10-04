// Turns the generator's building descriptions into one merged mesh. Facade
// coordinates are fitted so every wall holds a whole number of window bays.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { WIN } from '../sim/cityGen.js';
import { createBuildingMaterial } from './materials.js';

const BAY = { [WIN.CURTAIN]: 1.6, [WIN.RIBBON]: 3.0, [WIN.PUNCHED]: 3.0, [WIN.HOUSE]: 4.2, [WIN.DECO]: 2.2, [WIN.INDUSTRIAL]: 6.0, 7: 6.0 };
const FRAME_STYLE = 7;
const PARAPET = 0.9;

export function buildBuildings(city) {
  const g = new GeoBuilder({ color: true, fac: true, info: true });
  const beacons = [];
  for (const b of city.buildings) {
    for (const p of b.parts) addPart(g, b, p);
    for (const e of b.extras) {
      if (e.type === 'beacon') beacons.push(e);
      else addExtra(g, b, e);
    }
  }
  const mesh = new THREE.Mesh(g.build(), createBuildingMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'buildings';
  return { mesh, beacons };
}

/** Integer seed: shaders hash it, and fractional values would vary pixel to pixel. */
const seedOf = (b) => Math.floor(b.seed * 4093);

function addPart(g, b, p) {
  const use = p.use ?? 0;
  const seed = seedOf(b);
  if (p.shape === 'box') {
    const style = p.frame ? FRAME_STYLE : p.style;
    const gable = p.roof && p.roof.startsWith('gable');
    const parapet = !gable && style !== WIN.HOUSE && style !== FRAME_STYLE && (p.x1 - p.x0) * (p.z1 - p.z0) > 60;
    const top = p.top ?? (parapet ? p.y1 - PARAPET - 0.1 : p.y1);
    g.color(rgb(p.color)).info(seed, style, use + (p.shop ? 8 : 0), top);
    const bay = BAY[style] || 3;
    const fit = (len) => (Math.max(1, Math.round(len / bay)) * bay) / len;
    g.box(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, { top: false }, style ? fit : null);
    const roofCol = rgb(p.roofColor || '#5d5f61');
    if (gable) {
      addGable(g, p, roofCol, rgb(p.color), seed);
    } else if (parapet) {
      // Recessed roof behind a low parapet; inward faces so it reads from above.
      const y = p.y1 - PARAPET;
      const t = 0.35;
      g.color(roofCol).info(seed, 0, 0, 0);
      g.flat(p.x0 + t, p.x1 - t, p.z0 + t, p.z1 - t, y);
      g.color(rgb(p.color, 0.8));
      g.quadN([p.x1 - t, y, p.z0 + t], [p.x0 + t, y, p.z0 + t], [p.x0 + t, p.y1, p.z0 + t], [p.x1 - t, p.y1, p.z0 + t], [0, 0, 1]);
      g.quadN([p.x0 + t, y, p.z1 - t], [p.x1 - t, y, p.z1 - t], [p.x1 - t, p.y1, p.z1 - t], [p.x0 + t, p.y1, p.z1 - t], [0, 0, -1]);
      g.quadN([p.x0 + t, y, p.z0 + t], [p.x0 + t, y, p.z1 - t], [p.x0 + t, p.y1, p.z1 - t], [p.x0 + t, p.y1, p.z0 + t], [1, 0, 0]);
      g.quadN([p.x1 - t, y, p.z1 - t], [p.x1 - t, y, p.z0 + t], [p.x1 - t, p.y1, p.z0 + t], [p.x1 - t, p.y1, p.z1 - t], [-1, 0, 0]);
      // Coping on top of the parapet.
      g.color(rgb(p.color, 1.1));
      g.flat(p.x0, p.x1, p.z0, p.z0 + t, p.y1);
      g.flat(p.x0, p.x1, p.z1 - t, p.z1, p.y1);
      g.flat(p.x0, p.x0 + t, p.z0 + t, p.z1 - t, p.y1);
      g.flat(p.x1 - t, p.x1, p.z0 + t, p.z1 - t, p.y1);
    } else {
      g.color(roofCol).info(seed, 0, 0, 0);
      g.flat(p.x0, p.x1, p.z0, p.z1, p.y1);
    }
    if (style === FRAME_STYLE) addConstructionFrame(g, p, seed);
    return;
  }
  g.color(rgb(p.color)).info(seed, 0, 0, 0);
  if (p.shape === 'cyl') {
    g.cylinder(p.x, p.z, p.r, p.r * (p.taper ?? 1), p.y0, p.y1, p.r > 3 ? 20 : 12, true);
    if (p.taper) {
      // Painted bands near the top of smokestacks.
      g.color(rgb('#e8e4dc'));
      const r1 = p.r * p.taper;
      const yb = p.y1 - 4;
      g.cylinder(p.x, p.z, r1 * 1.08 + (p.r - r1) * 0.05, r1 * 1.06, yb, yb + 1.6, 12, false);
    }
  } else if (p.shape === 'cone') {
    g.cone(p.x, p.z, p.r, p.y0, p.y1, 8);
  } else if (p.shape === 'dome') {
    g.dome(p.x, p.z, p.r, p.y0, 20, 7);
  }
}

/** Pitched roof with the ridge along x or z; slopes overhang the walls a little. */
function addGable(g, p, roofCol, wallCol, seed) {
  const alongX = p.roof === 'gable-x';
  const y = p.y1;
  const h = p.roofH || 2.5;
  const o = 0.45; // eave overhang
  const e = 0.3; // overhang at the gable ends
  if (alongX) {
    const zm = (p.z0 + p.z1) / 2;
    const hd = (p.z1 - p.z0) / 2;
    const drop = (o * h) / hd;
    const x0 = p.x0 - e;
    const x1 = p.x1 + e;
    const nN = norm([0, hd, -h]);
    const nS = norm([0, hd, h]);
    g.color(roofCol).info(seed, 0, 0, 0);
    g.quad([x1, y - drop, p.z0 - o], [x0, y - drop, p.z0 - o], [x0, y + h, zm], [x1, y + h, zm], nN);
    g.quad([x0, y - drop, p.z1 + o], [x1, y - drop, p.z1 + o], [x1, y + h, zm], [x0, y + h, zm], nS);
    g.color(wallCol);
    g.tri([p.x0, y, p.z0], [p.x0, y, p.z1], [p.x0, y + h, zm], [-1, 0, 0]);
    g.tri([p.x1, y, p.z1], [p.x1, y, p.z0], [p.x1, y + h, zm], [1, 0, 0]);
  } else {
    const xm = (p.x0 + p.x1) / 2;
    const hd = (p.x1 - p.x0) / 2;
    const drop = (o * h) / hd;
    const z0 = p.z0 - e;
    const z1 = p.z1 + e;
    const nW = norm([-h, hd, 0]);
    const nE = norm([h, hd, 0]);
    g.color(roofCol).info(seed, 0, 0, 0);
    g.quad([p.x0 - o, y - drop, z0], [p.x0 - o, y - drop, z1], [xm, y + h, z1], [xm, y + h, z0], nW);
    g.quad([p.x1 + o, y - drop, z1], [p.x1 + o, y - drop, z0], [xm, y + h, z0], [xm, y + h, z1], nE);
    g.color(wallCol);
    g.tri([p.x1, y, p.z0], [p.x0, y, p.z0], [xm, y + h, p.z0], [0, 0, -1]);
    g.tri([p.x0, y, p.z1], [p.x1, y, p.z1], [xm, y + h, p.z1], [0, 0, 1]);
  }
}

function addConstructionFrame(g, p, seed) {
  // Exposed slabs make the unfinished floors read from a distance.
  g.color(rgb('#b8b4ab')).info(seed, 0, 0, 0);
  const fh = p.floorH || 3.6;
  for (let y = p.y0 + fh; y < p.y1 - 0.1; y += fh) {
    g.box(p.x0 - 0.4, p.x1 + 0.4, y - 0.3, y, p.z0 - 0.4, p.z1 + 0.4, { top: true });
  }
}

function addExtra(g, b, e) {
  if (e.type === 'unit') {
    g.color(rgb('#8d9298')).info(seedOf(b), 0, 0, 0);
    g.box(e.x0, e.x1, e.y0, e.y1, e.z0, e.z1);
  } else if (e.type === 'watertank') {
    // Classic timber water tank on a steel stand.
    g.color(rgb('#4a4d50')).info(seedOf(b), 0, 0, 0);
    const legH = 1.4;
    const lr = e.r * 0.7;
    for (const [dx, dz] of [[-lr, -lr], [lr, -lr], [-lr, lr], [lr, lr]]) {
      g.box(e.x + dx - 0.12, e.x + dx + 0.12, e.y, e.y + legH, e.z + dz - 0.12, e.z + dz + 0.12);
    }
    g.color(rgb('#6b4f3b'));
    g.cylinder(e.x, e.z, e.r, e.r, e.y + legH, e.y + legH + e.h, 12, false);
    g.color(rgb('#4f4a44'));
    g.cone(e.x, e.z, e.r * 1.05, e.y + legH + e.h, e.y + legH + e.h + e.r * 0.7, 12);
  } else if (e.type === 'antenna') {
    g.color(rgb('#c4c9ce')).info(seedOf(b), 0, 0, 0);
    g.box(e.x - 0.18, e.x + 0.18, e.y, e.y + e.h, e.z - 0.18, e.z + 0.18);
    g.box(e.x - 0.9, e.x + 0.9, e.y + e.h * 0.6, e.y + e.h * 0.6 + 0.15, e.z - 0.08, e.z + 0.08);
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
