// Instanced vehicles. Each type has three layers sharing instance transforms:
// painted body (per-car color), trim (glass, tires, bumpers) and lights
// (headlights, brake lights, indicators, taxi and bus signs).

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { TYPE_NAMES, VEHICLE_TYPES } from '../sim/traffic.js';
import { shared, beamTexture } from './materials.js';

const GLASS = rgb('#1a2027');
const TIRE = rgb('#141414');
const TRIM = rgb('#2b2e32');
const CHROME = rgb('#9aa0a6');
const CARGO = rgb('#e6e5df');
// Light kinds (stored in the green channel of aInfo.x): 0 head, 1 tail, 2 sign, 3 left indicator, 4 right indicator.
const HEAD = 0;
const TAIL = 1;
const SIGN = 2;
const IND_L = 3;
const IND_R = 4;

function octagon(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function wheels(trim, xs, halfW, r = 0.33, w = 0.24) {
  trim.color(TIRE);
  for (const x of xs) {
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? halfW - w : -halfW;
      trim.prismZ(octagon(x, r, r), z0, z0 + w);
    }
  }
}

function lightBox(L, kind, x0, x1, y0, y1, z0, z1, col) {
  L.color(col).info(kind, 0, 0, 0);
  L.box(x0, x1, y0, y1, z0, z1, { bottom: false });
}

/** Headlights at the front, tail lights and indicators at the rear corners. */
function standardLights(L, len, halfW, yHead, yTail, inset = 0.5) {
  const f = len / 2;
  for (const s of [-1, 1]) {
    const zi = s * (halfW - inset);
    const zo = s * (halfW - 0.12);
    lightBox(L, HEAD, f - 0.08, f + 0.03, yHead, yHead + 0.12, Math.min(zi, zo), Math.max(zi, zo), rgb('#fff6e6'));
    lightBox(L, TAIL, -f - 0.03, -f + 0.08, yTail, yTail + 0.14, Math.min(zi, zo), Math.max(zi, zo), rgb('#ff2a1a'));
    const zc0 = s * (halfW - 0.16);
    const zc1 = s * (halfW - 0.02);
    lightBox(L, s < 0 ? IND_L : IND_R, f - 0.1, f + 0.02, yHead - 0.12, yHead - 0.03, Math.min(zc0, zc1), Math.max(zc0, zc1), rgb('#ffb21e'));
    lightBox(L, s < 0 ? IND_L : IND_R, -f - 0.02, -f + 0.1, yTail - 0.12, yTail - 0.03, Math.min(zc0, zc1), Math.max(zc0, zc1), rgb('#ffb21e'));
  }
}

function buildType(type) {
  const spec = VEHICLE_TYPES[type];
  const body = new GeoBuilder({ color: false });
  const trim = new GeoBuilder({ color: true });
  const lights = new GeoBuilder({ color: true, info: true });
  const L = spec.len;
  const f = L / 2;
  const hw = spec.wid / 2;

  if (type === 'sedan' || type === 'taxi' || type === 'hatch' || type === 'suv') {
    const suv = type === 'suv';
    const hatch = type === 'hatch';
    const sill = suv ? 0.42 : 0.3;
    const belt = suv ? 1.02 : 0.82;
    const roof = suv ? 1.74 : hatch ? 1.46 : 1.42;
    body.prismZ([[-f, sill], [f, sill], [f, belt - 0.14], [f - 0.7, belt + 0.02], [-f + 0.1, belt + 0.04], [-f, belt - 0.1]], -hw, hw);
    trim.color(GLASS);
    const cabRear = hatch ? -f + 0.15 : suv ? -f + 0.35 : -f + 0.95;
    const cabFront = suv ? f - 1.15 : f - 1.25;
    const roofFront = suv ? f - 1.75 : f - 2.0;
    const roofRear = hatch ? -f + 0.35 : suv ? -f + 0.45 : -f + 1.3;
    trim.prismZ([[cabRear, belt], [cabFront, belt], [roofFront, roof - 0.04], [roofRear, roof - 0.02]], -hw + 0.1, hw - 0.1);
    body.prismZ([[roofRear - 0.02, roof - 0.06], [roofFront + 0.04, roof - 0.07], [roofFront, roof], [roofRear, roof]], -hw + 0.12, hw - 0.12);
    trim.color(TRIM);
    trim.box(f - 0.05, f + 0.06, sill, sill + 0.22, -hw + 0.05, hw - 0.05);
    trim.box(-f - 0.06, -f + 0.05, sill, sill + 0.22, -hw + 0.05, hw - 0.05);
    wheels(trim, [f - 0.85, -f + 0.85], hw + 0.02, suv ? 0.38 : 0.33);
    standardLights(lights, L, hw, belt - 0.2, belt - 0.16);
    if (type === 'taxi') lightBox(lights, SIGN, -0.4, 0.25, roof, roof + 0.22, -0.32, 0.32, rgb('#fff1c2'));
  } else if (type === 'van') {
    body.prismZ([[-f, 0.35], [f, 0.35], [f, 1.0], [f - 0.55, 1.25], [f - 1.1, 2.15], [-f, 2.2]], -hw, hw);
    trim.color(GLASS);
    trim.prismZ([[f - 0.6, 1.25], [f - 0.52, 1.26], [f - 1.06, 2.1], [f - 1.16, 2.1]], -hw + 0.12, hw - 0.12);
    trim.box(f - 1.9, f - 0.75, 1.28, 1.95, -hw - 0.01, hw + 0.01, { top: false });
    trim.color(TRIM);
    trim.box(f - 0.05, f + 0.06, 0.35, 0.6, -hw + 0.05, hw - 0.05);
    trim.box(-f - 0.06, -f + 0.05, 0.35, 0.6, -hw + 0.05, hw - 0.05);
    wheels(trim, [f - 0.95, -f + 1.0], hw + 0.02, 0.36);
    standardLights(lights, L, hw, 0.82, 0.9);
  } else if (type === 'truck') {
    // Cab up front, white box behind.
    body.prismZ([[f - 2.1, 0.5], [f, 0.5], [f, 1.5], [f - 0.35, 2.75], [f - 2.1, 2.75]], -hw + 0.05, hw - 0.05);
    trim.color(GLASS);
    trim.prismZ([[f - 0.12, 1.55], [f - 0.02, 1.56], [f - 0.36, 2.6], [f - 0.48, 2.6]], -hw + 0.18, hw - 0.18);
    trim.box(f - 1.6, f - 0.8, 1.6, 2.45, -hw + 0.04, hw - 0.04, { top: false });
    trim.color(CARGO);
    trim.box(-f, f - 2.25, 0.75, 3.3, -hw, hw);
    trim.color(TRIM);
    trim.box(-f, f, 0.45, 0.75, -hw + 0.15, hw - 0.15);
    wheels(trim, [f - 1.2, -f + 1.4, -f + 2.5], hw, 0.45, 0.3);
    standardLights(lights, L, hw, 0.95, 0.8, 0.45);
  } else if (type === 'bus') {
    body.box(-f, f, 0.35, 3.05, -hw, hw, { bottom: true });
    trim.color(GLASS);
    trim.box(-f + 0.6, f - 0.35, 1.35, 2.45, -hw - 0.012, hw + 0.012, { top: false, bottom: false, e: false, w: false });
    trim.box(f - 0.02, f + 0.015, 0.9, 2.55, -hw + 0.12, hw - 0.12, { top: false, bottom: false, n: false, s: false });
    trim.box(-f - 0.015, -f + 0.02, 1.6, 2.45, -hw + 0.2, hw - 0.2, { top: false, bottom: false, n: false, s: false });
    trim.color(CHROME);
    trim.box(-f * 0.5, f * 0.3, 3.05, 3.35, -hw + 0.35, hw - 0.35);
    trim.color(TRIM);
    trim.box(f - 0.04, f + 0.05, 0.35, 0.65, -hw + 0.05, hw - 0.05);
    wheels(trim, [f - 2.3, -f + 2.8], hw + 0.02, 0.48, 0.3);
    standardLights(lights, L, hw, 0.85, 0.95, 0.4);
    lightBox(lights, SIGN, f - 0.02, f + 0.03, 2.65, 2.95, -hw + 0.3, hw - 0.3, rgb('#ffb347'));
  }
  return { body: body.build(), trim: trim.build(), lights: lights.build() };
}

function lightsMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aInfo;
attribute vec2 aState;
varying float vKind;
varying vec2 vState;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKind = aInfo.x;
vState = aState;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uTime;
varying float vKind;
varying vec2 vState;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float k = 1.0;
float blink = step(0.5, fract(uTime * 1.6));
if (vKind < 0.5) k = 0.7 + uNight * 2.6;
else if (vKind < 1.5) k = 0.45 + uNight * 1.4 + vState.x * 4.0;
else if (vKind < 2.5) k = 0.9 + uNight * 2.5;
else if (vKind < 3.5) k = vState.y < -0.5 ? 0.2 + blink * 5.0 : 0.2;
else k = vState.y > 0.5 ? 0.2 + blink * 5.0 : 0.2;
diffuseColor.rgb *= k;`);
  };
  mat.customProgramCacheKey = () => 'vehicle-lights-v1';
  return mat;
}

export class VehicleView {
  constructor(traffic) {
    this.traffic = traffic;
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    const cap = traffic.maxCars;
    this.cap = cap;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 });
    const lightMat = lightsMaterial();
    this.types = {};
    for (const type of TYPE_NAMES) {
      const geo = buildType(type);
      const body = new THREE.InstancedMesh(geo.body, bodyMat, cap);
      const trim = new THREE.InstancedMesh(geo.trim, trimMat, cap);
      // Lights share the body's transforms but need their own per-car state.
      const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      state.setUsage(THREE.DynamicDrawUsage);
      geo.lights.setAttribute('aState', state);
      const lights = new THREE.InstancedMesh(geo.lights, lightMat, cap);
      lights.instanceMatrix = body.instanceMatrix;
      trim.instanceMatrix = body.instanceMatrix;
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.setColorAt(0, new THREE.Color(1, 1, 1));
      body.instanceColor.setUsage(THREE.DynamicDrawUsage);
      for (const m of [body, trim, lights]) {
        m.count = 0;
        m.frustumCulled = false;
      }
      body.castShadow = true;
      trim.castShadow = true;
      body.receiveShadow = true;
      this.types[type] = { body, trim, lights, state, n: 0, geo };
      this.group.add(body, trim, lights);
    }
    // The car being driven is drawn on its own: the painted body shows as a hood, while
    // glass, cab panels and lights would sit in front of the driver's eye, so they only
    // cast their shadow.
    this.cab = new THREE.Group();
    this.cab.visible = false;
    // Satin rather than gloss: seen this close, a low sun would glare off the hood.
    this.cabBody = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.2 }));
    this.cabBody.castShadow = true;
    this.cabBody.receiveShadow = true;
    this.cabTrim = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.cabTrim.castShadow = true;
    this.cab.add(this.cabBody, this.cabTrim);
    this.group.add(this.cab);
    // Headlight beams on the road surface.
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const beamGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, cap);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.beams.renderOrder = 3;
    this.group.add(this.beams);
    this.pose = { x: 0, z: 0, dx: 1, dz: 0 };
    this.color = new THREE.Color();
  }

  /**
   * @param {number} night how far the lights are on (0..1)
   * @param {number} alpha interpolation between the last two physics steps
   * @param {object|null} driven the car whose driver's seat the camera is in
   */
  update(night, alpha = 1, driven = null) {
    const tr = this.traffic;
    for (const type of TYPE_NAMES) this.types[type].n = 0;
    const beams = this.beams.instanceMatrix.array;
    let nb = 0;
    const showBeams = night > 0.05;
    this.cab.visible = false;
    for (const c of tr.cars) {
      tr.drawPose(c, alpha, this.pose);
      const { x, z, dx, dz } = this.pose;
      const k = c.fade < 1 ? 0.25 + 0.75 * c.fade * c.fade * (3 - 2 * c.fade) : 1;
      if (c === driven) {
        this.placeCab(c, x, z, dx, dz, k);
        if (showBeams && k > 0.9) nb = this.placeBeam(beams, nb, c, x, z, dx, dz);
        continue;
      }
      const T = this.types[c.type];
      const i = T.n++;
      const a = T.body.instanceMatrix.array;
      const o = i * 16;
      a[o] = dx * k; a[o + 1] = 0; a[o + 2] = dz * k; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = k; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = -dz * k; a[o + 9] = 0; a[o + 10] = dx * k; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
      if (c.paint !== c.color) {
        c.paint = c.color;
        c.rgb = new THREE.Color(c.color);
      }
      const col = T.body.instanceColor.array;
      col[i * 3] = c.rgb.r;
      col[i * 3 + 1] = c.rgb.g;
      col[i * 3 + 2] = c.rgb.b;
      // Brake lights, and indicators when about to turn or turning.
      let signal = 0;
      const turn = c.seg.kind === 'turn' ? c.seg : c.seg.length - c.s < 35 ? c.nextTurn : null;
      if (turn && turn.movement === 'left') signal = -1;
      else if (turn && turn.movement === 'right') signal = 1;
      T.state.array[i * 2] = c.brake;
      T.state.array[i * 2 + 1] = signal;
      if (showBeams && k > 0.9) nb = this.placeBeam(beams, nb, c, x, z, dx, dz);
    }
    for (const type of TYPE_NAMES) {
      const T = this.types[type];
      T.body.count = T.n;
      T.trim.count = T.n;
      T.lights.count = T.n;
      T.body.instanceMatrix.needsUpdate = true;
      T.body.instanceColor.needsUpdate = true;
      T.state.needsUpdate = true;
    }
    this.beams.count = nb;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beamMat.opacity = night * 0.3;
  }

  /** Headlight pool on the road ahead of a car. Returns the new beam count. */
  placeBeam(beams, nb, c, x, z, dx, dz) {
    const len = c.type === 'bus' || c.type === 'truck' ? 22 : 17;
    const wid = c.wid * 3.6;
    const b = nb * 16;
    const fx = x + dx * c.len * 0.5;
    const fz = z + dz * c.len * 0.5;
    beams[b] = dx * len; beams[b + 1] = 0; beams[b + 2] = dz * len; beams[b + 3] = 0;
    beams[b + 4] = 0; beams[b + 5] = 1; beams[b + 6] = 0; beams[b + 7] = 0;
    beams[b + 8] = -dz * wid; beams[b + 9] = 0; beams[b + 10] = dx * wid; beams[b + 11] = 0;
    beams[b + 12] = fx; beams[b + 13] = 0.06; beams[b + 14] = fz; beams[b + 15] = 1;
    return nb + 1;
  }

  placeCab(c, x, z, dx, dz, k) {
    const { geo } = this.types[c.type];
    this.cabBody.geometry = geo.body;
    this.cabTrim.geometry = geo.trim;
    this.cabBody.material.color.set(c.color);
    this.cab.position.set(x, 0, z);
    this.cab.rotation.y = Math.atan2(-dz, dx);
    this.cab.scale.setScalar(k);
    this.cab.visible = true;
  }
}
