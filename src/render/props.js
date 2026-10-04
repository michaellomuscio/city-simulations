// Instanced street furniture: trees, streetlights and their light pools, traffic
// and pedestrian signals (updated live from the simulation), aviation beacons
// and construction cranes.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { LANE_W, GUTTER, SIDEWALK_W, CURB_H, SIDES, SIDE_VEC } from '../sim/constants.js';
import { shared, glowTexture } from './materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

function setTRS(mesh, i, x, y, z, rotY, sx, sy = sx, sz = sx) {
  _q.setFromAxisAngle(_up, rotY);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(i, _m);
}

// --- Trees -----------------------------------------------------------------------

const LEAVES = ['#3d6b2f', '#4f7a34', '#5d8a3a', '#355e2a', '#6a8f3c', '#47702f', '#5b7f2e'];
const CONIFER = ['#2c4d2a', '#2f5530', '#36593a', '#284426'];

function swayMaterial(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uRain = shared.uRain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uRain;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
float k = max(position.y - 2.0, 0.0) * (0.035 + uRain * 0.06);
transformed.x += sin(uTime * 1.4 + ph) * k;
transformed.z += cos(uTime * 1.1 + ph * 1.3) * k * 0.7;
#endif`);
  };
  mat.customProgramCacheKey = () => 'sway-v1';
  return mat;
}

export function buildTrees(trees, quality) {
  const group = new THREE.Group();
  group.name = 'trees';
  const round = trees.filter((t) => t.kind !== 'cone');
  const cone = trees.filter((t) => t.kind === 'cone');

  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 2.6, 5, 1, true).translate(0, 1.3, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1, 1).scale(2.3, 2.5, 2.3).translate(0, 4.4, 0);
  const coneGeo = mergeCones();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
  const leafMat = swayMaterial(0xffffff);

  const make = (geo, mat, list, colors) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((t, i) => {
      setTRS(mesh, i, t.x, t.y ?? CURB_H, t.z, (t.tint || 0) * 6.28, t.s, t.s * (0.9 + (t.tint || 0) * 0.25), t.s);
      if (colors) {
        _c.set(colors[Math.floor((t.tint || 0) * colors.length) % colors.length]);
        _c.multiplyScalar(0.85 + ((t.tint * 7.3) % 1) * 0.3);
        mesh.setColorAt(i, _c);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    return mesh;
  };
  const trunks = make(trunkGeo, trunkMat, trees, null);
  const crowns = make(roundGeo, leafMat, round, LEAVES);
  const conifers = make(coneGeo, leafMat, cone, CONIFER);
  for (const m of [trunks, crowns, conifers]) m.castShadow = quality !== 'low';
  group.add(trunks, crowns, conifers);
  return group;
}

function mergeCones() {
  const g = new GeoBuilder({ color: false });
  g.cylinder(0, 0, 2.3, 0.01, 1.4, 6.0, 7, false);
  g.cylinder(0, 0, 1.7, 0.01, 4.2, 8.6, 7, false);
  return g.build();
}

// --- Streetlights ---------------------------------------------------------------

export class StreetLights {
  constructor(lights) {
    this.group = new THREE.Group();
    this.group.name = 'streetlights';
    const n = lights.length;
    const post = new GeoBuilder({ color: false });
    post.cylinder(0, 0, 0.13, 0.09, 0, 8, 6, true);
    post.beam([0, 7.85, 0], [1.7, 7.9, 0], 0.12, 0.12);
    post.box(1.4, 2.1, 7.72, 7.98, -0.2, 0.2, { bottom: true });
    const postMesh = new THREE.InstancedMesh(post.build(), new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.6 }), n);
    const headGeo = new THREE.BoxGeometry(0.62, 0.05, 0.3).translate(1.75, 7.7, 0);
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const headMesh = new THREE.InstancedMesh(headGeo, this.headMat, n);
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: glowTexture(128, 0.05, 1.8), color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const poolMesh = new THREE.InstancedMesh(poolGeo, this.poolMat, n);
    lights.forEach((l, i) => {
      const rot = Math.atan2(-l.az, l.ax);
      setTRS(postMesh, i, l.x, CURB_H, l.z, rot, 1);
      setTRS(headMesh, i, l.x, CURB_H, l.z, rot, 1);
      setTRS(poolMesh, i, l.x + l.ax * 1.9, CURB_H + 0.05, l.z + l.az * 1.9, rot, 12, 1, 12);
    });
    for (const m of [postMesh, headMesh, poolMesh]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    postMesh.castShadow = true;
    poolMesh.renderOrder = 2;
    this.group.add(postMesh, headMesh, poolMesh);
  }

  update(night, flicker = 0) {
    const on = night;
    this.headMat.color.setRGB(0.6 + on * 3.0, 0.55 + on * 2.4, 0.45 + on * 1.5);
    this.poolMat.opacity = on * 0.24 * (1 - flicker * 0.3);
    this.group.children[2].visible = on > 0.01;
  }
}

// --- Traffic signals -----------------------------------------------------------------

const LAMP_ON = [new THREE.Color(7, 0.35, 0.18), new THREE.Color(7, 4.2, 0.3), new THREE.Color(0.3, 6, 2.6)];
const LAMP_OFF = [new THREE.Color(0.14, 0.03, 0.02), new THREE.Color(0.13, 0.1, 0.02), new THREE.Color(0.02, 0.12, 0.07)];
const PED_WALK = new THREE.Color(4.5, 4.6, 4.8);
const PED_STOP = new THREE.Color(5, 1.6, 0.25);
const PED_DARK = new THREE.Color(0.08, 0.05, 0.03);
// The mast for traffic arriving from a side stands on the far corner, to the driver's right.
const POLE_CORNER = { N: [-1, 1], S: [1, -1], E: [-1, -1], W: [1, 1] };

export class SignalHardware {
  constructor(net) {
    this.group = new THREE.Group();
    this.group.name = 'signals';
    const steel = new GeoBuilder({ color: false });
    const housings = new GeoBuilder({ color: false });
    this.lamps = []; // { sig, side, k }
    this.peds = []; // { sig, side }
    const lampPos = [];
    const pedPos = [];
    for (const I of net.inters) {
      const sig = I.signal;
      if (!sig) continue;
      for (const side of SIDES) {
        const lanes = I.inLanes[side];
        if (!lanes.length) continue;
        const [cxs, czs] = POLE_CORNER[side];
        const px = I.x + cxs * (I.hx + 0.7);
        const pz = I.z + czs * (I.hz + 0.7);
        const [vx, vz] = SIDE_VEC[side]; // toward the approaching traffic
        // Arm runs across the approach lanes, toward the center line.
        const ax = vz !== 0 ? -cxs : 0;
        const az = vx !== 0 ? -czs : 0;
        const road = lanes[0].road;
        const reach = 0.7 + GUTTER + road.lanesPerDir * LANE_W + road.median / 2;
        steel.cylinder(px, pz, 0.16, 0.12, CURB_H, 6.6, 8, true);
        steel.beam([px, 6.3, pz], [px + ax * reach, 6.3, pz + az * reach], 0.16, 0.2);
        for (const lane of lanes) {
          const d = 0.7 + GUTTER + (road.lanesPerDir - 1 - lane.index) * LANE_W + LANE_W / 2;
          const hx = px + ax * d;
          const hz = pz + az * d;
          // Head is wide along the arm and shallow toward the traffic.
          const wx = 0.22 * Math.abs(ax) + 0.15 * Math.abs(az);
          const wz = 0.22 * Math.abs(az) + 0.15 * Math.abs(ax);
          housings.box(hx - wx, hx + wx, 5.05, 6.2, hz - wz, hz + wz, { bottom: true });
          for (let k = 0; k < 3; k++) {
            lampPos.push([hx + vx * 0.17, 5.98 - k * 0.36, hz + vz * 0.17]);
            this.lamps.push({ sig, side, k });
          }
        }
      }
      // Pedestrian signals on short posts at each corner, one facing across each crosswalk.
      for (const [cx, cz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const px = I.x + cx * (I.hx + 1.4);
        const pz = I.z + cz * (I.hz + 1.4);
        steel.cylinder(px, pz, 0.08, 0.07, CURB_H, 3.3, 6, true);
        // Crosswalk across the north/south leg on this corner's side, and the east/west one.
        const nsSide = cz < 0 ? 'N' : 'S';
        const ewSide = cx > 0 ? 'E' : 'W';
        if (I.legs[nsSide]) {
          pedPos.push([px - cx * 0.18, 2.9, pz, Math.PI / 2 * (cx > 0 ? 1 : -1)]);
          this.peds.push({ sig, side: nsSide });
        }
        if (I.legs[ewSide]) {
          pedPos.push([px, 2.9, pz - cz * 0.18, cz > 0 ? Math.PI : 0]);
          this.peds.push({ sig, side: ewSide });
        }
      }
    }
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.5, metalness: 0.5 });
    const steelMesh = new THREE.Mesh(steel.build(), steelMat);
    steelMesh.castShadow = true;
    const housingMesh = new THREE.Mesh(housings.build(), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }));
    housingMesh.castShadow = true;
    this.group.add(steelMesh, housingMesh);

    const lampGeo = new THREE.SphereGeometry(0.13, 8, 6);
    this.lampMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampPos.length));
    lampPos.forEach((p, i) => setTRS(this.lampMesh, i, p[0], p[1], p[2], 0, 1));
    this.lampMesh.count = lampPos.length;
    this.lampMesh.instanceMatrix.needsUpdate = true;
    this.lampMesh.computeBoundingSphere();
    const pedGeo = new THREE.BoxGeometry(0.34, 0.34, 0.08);
    this.pedMesh = new THREE.InstancedMesh(pedGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, pedPos.length));
    pedPos.forEach((p, i) => setTRS(this.pedMesh, i, p[0], p[1], p[2], p[3], 1));
    this.pedMesh.count = pedPos.length;
    this.pedMesh.instanceMatrix.needsUpdate = true;
    this.pedMesh.computeBoundingSphere();
    this.group.add(this.lampMesh, this.pedMesh);
    // Prime the color buffers.
    for (let i = 0; i < this.lamps.length; i++) this.lampMesh.setColorAt(i, LAMP_OFF[0]);
    for (let i = 0; i < this.peds.length; i++) this.pedMesh.setColorAt(i, PED_DARK);
  }

  update(time) {
    const lamps = this.lamps;
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      const st = L.sig.state(L.side);
      const on = (st === 'R' && L.k === 0) || (st === 'Y' && L.k === 1) || (st === 'G' && L.k === 2);
      this.lampMesh.setColorAt(i, on ? LAMP_ON[L.k] : LAMP_OFF[L.k]);
    }
    this.lampMesh.instanceColor.needsUpdate = true;
    const blink = Math.sin(time * Math.PI * 2) > 0;
    for (let i = 0; i < this.peds.length; i++) {
      const P = this.peds[i];
      const light = P.sig.pedLight(P.side);
      const col = light === 'walk' ? PED_WALK : light === 'flash' ? (blink ? PED_STOP : PED_DARK) : PED_STOP;
      this.pedMesh.setColorAt(i, col);
    }
    if (this.pedMesh.instanceColor) this.pedMesh.instanceColor.needsUpdate = true;
  }
}

// --- Aviation beacons ------------------------------------------------------------------

export class Beacons {
  constructor(beacons) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.75, 8, 6), this.mat, Math.max(1, beacons.length));
    beacons.forEach((b, i) => setTRS(this.mesh, i, b.x, b.y, b.z, 0, 1));
    this.mesh.count = beacons.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.name = 'beacons';
  }

  update(time, night) {
    const on = (time % 1.6) < 0.55;
    const k = on ? 2.5 + night * 6 : 0.15;
    this.mat.color.setRGB(k, k * 0.06, k * 0.03);
  }
}

// --- Cranes -----------------------------------------------------------------------------

export class Cranes {
  constructor(cranes) {
    this.group = new THREE.Group();
    this.group.name = 'cranes';
    this.tops = [];
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a91c, roughness: 0.55, metalness: 0.3 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8e8b85, roughness: 0.9 });
    for (const c of cranes) {
      const mast = new GeoBuilder({ color: false });
      const s = 1.0;
      // Lattice mast: four chords with diagonal bracing.
      for (const [dx, dz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) mast.beam([dx, 0, dz], [dx, c.h, dz], 0.22, 0.22);
      for (let y = 0; y < c.h - 3; y += 3) {
        mast.beam([-s, y, -s], [s, y + 3, -s], 0.1, 0.1);
        mast.beam([s, y, s], [-s, y + 3, s], 0.1, 0.1);
        mast.beam([-s, y, s], [-s, y + 3, -s], 0.1, 0.1);
        mast.beam([s, y, -s], [s, y + 3, s], 0.1, 0.1);
      }
      const mastMesh = new THREE.Mesh(mast.build(), yellow);
      mastMesh.position.set(c.x, CURB_H, c.z);
      mastMesh.castShadow = true;
      const top = new THREE.Group();
      top.position.set(c.x, CURB_H + c.h, c.z);
      const jib = new GeoBuilder({ color: false });
      jib.beam([-14, 0.6, 0], [c.jib, 0.6, 0], 1.1, 1.2);
      jib.beam([0, 0.6, 0], [0, 8, 0], 0.6, 0.6);
      jib.beam([0, 8, 0], [c.jib * 0.6, 1.2, 0], 0.08, 0.08);
      jib.beam([0, 8, 0], [-12, 1.2, 0], 0.08, 0.08);
      jib.box(-1.2, 1.4, -1.4, 0.0, -1.2, 1.2);
      jib.beam([c.jib * 0.55, 0, 0], [c.jib * 0.55, -c.h * 0.6, 0], 0.05, 0.05);
      const jibMesh = new THREE.Mesh(jib.build(), yellow);
      jibMesh.castShadow = true;
      const weight = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 2.6).translate(-12, -0.4, 0), concrete);
      weight.castShadow = true;
      top.add(jibMesh, weight);
      top.rotation.y = c.angle;
      this.tops.push({ top, speed: c.speed, phase: c.angle });
      this.group.add(mastMesh, top);
    }
  }

  update(simTime) {
    for (const t of this.tops) {
      // Swing back and forth like a crane at work, pausing at each end.
      t.top.rotation.y = t.phase + Math.sin(simTime * t.speed) * 1.2;
    }
  }
}
