// Countryside around the city: fields on both banks, the river and its stone
// embankments, and a ring of hills that fades into the haze.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { ValueNoise } from '../core/noise.js';
import { WATER_Y, smoothstep } from '../sim/constants.js';
import { createGroundMaterial, createWaterMaterial } from './materials.js';

const R = 6000;

export function buildTerrain(city) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const rv = city.river;

  const ground = new GeoBuilder({ color: true });
  ground.color([1, 1, 1]);
  ground.flat(-R, R, -R, rv.zNorth, -0.08);
  ground.flat(-R, R, rv.zSouth, R, -0.08);
  const groundMesh = new THREE.Mesh(ground.build(), createGroundMaterial());
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // Embankment walls down to the water.
  const banks = new GeoBuilder({ color: true });
  banks.color(rgb('#837d72'));
  banks.quad([-R, WATER_Y - 1.5, rv.zNorth], [R, WATER_Y - 1.5, rv.zNorth], [R, 0, rv.zNorth], [-R, 0, rv.zNorth], [0, 0, 1]);
  banks.quad([R, WATER_Y - 1.5, rv.zSouth], [-R, WATER_Y - 1.5, rv.zSouth], [-R, 0, rv.zSouth], [R, 0, rv.zSouth], [0, 0, -1]);
  banks.color(rgb('#2a2c28'));
  banks.flat(-R, R, rv.zNorth, rv.zSouth, WATER_Y - 1.5);
  const bankMesh = new THREE.Mesh(banks.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  bankMesh.receiveShadow = true;
  group.add(bankMesh);

  const water = new GeoBuilder({ color: false });
  water.flat(-R, R, rv.zNorth, rv.zSouth, WATER_Y);
  const waterMat = createWaterMaterial();
  const waterMesh = new THREE.Mesh(water.build(), waterMat);
  waterMesh.receiveShadow = true;
  group.add(waterMesh);

  group.add(buildHills(city));
  return { group, waterMat, groundMat: groundMesh.material };
}

function buildHills(city) {
  const noise = new ValueNoise(city.seed + 17);
  const g = new GeoBuilder({ color: true });
  const segs = 180;
  const rings = 10;
  const r0 = 2500;
  const r1 = 5600;
  const riverZ = (city.river.zNorth + city.river.zSouth) / 2;
  const riverHalf = (city.river.zSouth - city.river.zNorth) / 2;
  const low = rgb('#3e5233');
  const mid = rgb('#556347');
  const high = rgb('#6f7466');
  const pts = [];
  for (let j = 0; j <= rings; j++) {
    const row = [];
    const r = r0 + ((r1 - r0) * j) / rings;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const n = noise.fbm(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5 + j * 0.07, 4);
      let h = smoothstep(r0, r0 + 1400, r) * (60 + 520 * n * n) * (0.6 + 0.4 * smoothstep(r0, r1, r));
      const fromRiver = Math.abs(z - riverZ) - riverHalf;
      h *= smoothstep(60, 700, fromRiver); // the river valley stays open
      row.push([x, fromRiver < 25 ? WATER_Y - 2 : h - 0.5, z]);
    }
    pts.push(row);
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = pts[j][i];
      const b = pts[j + 1][i];
      const c = pts[j + 1][i + 1];
      const d = pts[j][i + 1];
      const h = (a[1] + b[1] + c[1] + d[1]) / 4;
      const t = Math.min(1, h / 380);
      g.color(t < 0.5 ? mix(low, mid, t * 2) : mix(mid, high, (t - 0.5) * 2));
      const n = faceNormal(a, b, c);
      g.quadN(a, b, c, d, n[1] < 0 ? [-n[0], -n[1], -n[2]] : n);
    }
  }
  const mesh = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.name = 'hills';
  return mesh;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}
