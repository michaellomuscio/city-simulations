// Instanced pedestrians with a walk cycle animated in the vertex shader.

import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { CURB_H } from '../sim/constants.js';

// Parts: 0 torso, 1 left leg, 2 right leg, 3 left arm, 4 right arm, 5 head. aInfo = (part, pivot height).
function figure() {
  const g = new GeoBuilder({ color: false, info: true });
  g.info(1, 0.86, 0, 0).box(-0.075, 0.075, 0, 0.88, -0.16, -0.03, { bottom: true });
  g.info(2, 0.86, 0, 0).box(-0.075, 0.075, 0, 0.88, 0.03, 0.16, { bottom: true });
  g.info(0, 0, 0, 0).box(-0.12, 0.12, 0.84, 1.44, -0.2, 0.2, { bottom: true });
  g.info(3, 1.38, 0, 0).box(-0.055, 0.055, 0.82, 1.42, -0.29, -0.2, { bottom: true });
  g.info(4, 1.38, 0, 0).box(-0.055, 0.055, 0.82, 1.42, 0.2, 0.29, { bottom: true });
  g.info(5, 0, 0, 0).box(-0.1, 0.11, 1.46, 1.7, -0.095, 0.095, { bottom: true });
  return g.build();
}

const PANTS = ['#2b3445', '#3b4a66', '#1e1f22', '#6b5b45'].map((c) => new THREE.Color(c));
const SKIN = ['#f1c7a5', '#d9a47c', '#b07a52', '#7a4e32', '#4a2f1f'].map((c) => new THREE.Color(c));

function personMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const glslColors = (name, list) => `vec3 ${name}(float i) {\n${list.map((c, k) => `  if (i < ${k}.5) return vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)});`).join('\n')}\n  return vec3(0.5);\n}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aInfo;
attribute vec2 aAnim;
attribute vec2 aLook;
varying float vPart;
varying vec2 vLook;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPart = aInfo.x;
vLook = aLook;
float swing = sin(aAnim.x) * aAnim.y;
float ang = 0.0;
if (vPart > 0.5 && vPart < 1.5) ang = swing * 0.55;
else if (vPart > 1.5 && vPart < 2.5) ang = -swing * 0.55;
else if (vPart > 2.5 && vPart < 3.5) ang = -swing * 0.45;
else if (vPart > 3.5 && vPart < 4.5) ang = swing * 0.45;
float py = aInfo.y;
vec2 q = vec2(transformed.x, transformed.y - py);
float ca = cos(ang);
float sa = sin(ang);
transformed.x = q.x * ca - q.y * sa;
transformed.y = q.x * sa + q.y * ca + py;
transformed.y += abs(sin(aAnim.x)) * 0.035 * aAnim.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vPart;
varying vec2 vLook;
${glslColors('pantsColor', PANTS)}
${glslColors('skinColor', SKIN)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vPart > 0.5 && vPart < 2.5) diffuseColor.rgb = pantsColor(vLook.x);
else if (vPart > 4.5) diffuseColor.rgb = skinColor(vLook.y);`);
  };
  mat.customProgramCacheKey = () => 'person-v1';
  return mat;
}

export class PeopleView {
  constructor(peds) {
    this.peds = peds;
    const cap = peds.maxPeds;
    const geo = figure();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.look.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', this.anim);
    geo.setAttribute('aLook', this.look);
    this.mesh = new THREE.InstancedMesh(geo, personMaterial(), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.name = 'people';
    this.pose = { x: 0, z: 0, dx: 1, dz: 0 };
    this.colors = new Map();
  }

  /** @param {number} alpha interpolation between the last two physics steps */
  update(alpha = 1) {
    const a = this.mesh.instanceMatrix.array;
    const col = this.mesh.instanceColor.array;
    const anim = this.anim.array;
    const look = this.look.array;
    let i = 0;
    for (const p of this.peds.peds) {
      this.peds.drawPose(p, alpha, this.pose);
      const { x, z, dx, dz } = this.pose;
      const e = p.edge;
      // Crosswalks are at road level, a curb step below the sidewalk.
      let y = CURB_H;
      if (e.kind === 'crosswalk' && !p.waiting && p.s > 1.9 && p.s < e.length - 1.9) y = 0;
      const k = p.scale * (p.fade < 1 ? p.fade : 1);
      const o = i * 16;
      a[o] = dx * k; a[o + 1] = 0; a[o + 2] = dz * k; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = k; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = -dz * k; a[o + 9] = 0; a[o + 10] = dx * k; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      let c = this.colors.get(p.shirt);
      if (!c) {
        c = new THREE.Color(p.shirt);
        this.colors.set(p.shirt, c);
      }
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      anim[i * 2] = p.phase;
      anim[i * 2 + 1] = p.amp;
      look[i * 2] = p.style;
      look[i * 2 + 1] = p.skin;
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.look.needsUpdate = true;
  }
}
