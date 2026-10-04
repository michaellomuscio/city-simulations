// Small ambient effects: smoke drifting from factory chimneys, fountain spray,
// and rain streaks that follow the camera.

import * as THREE from 'three';
import { glowTexture } from './materials.js';

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mvPosition.z, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(capacity, { color, blending = THREE.NormalBlending, soft = 0.0 }) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1e9);
    this.life = new Float32Array(capacity).fill(1);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMap: { value: glowTexture(64, soft, 1.5) },
      uScale: { value: 400 },
      uColor: { value: new THREE.Color(color) },
    }]);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(x, y, z, vx, vy, vz, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
  }

  flush() {
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

export class Effects {
  constructor(city) {
    this.group = new THREE.Group();
    this.group.name = 'effects';
    this.stacks = city.smokestacks;
    this.fountains = city.fountains;
    this.smoke = new Particles(Math.max(1, this.stacks.length * 70), { color: 0xd8d6d2, soft: 0.0 });
    this.spray = new Particles(Math.max(1, this.fountains.length * 260), { color: 0xe8f4ff, soft: 0.3 });
    this.group.add(this.smoke.points, this.spray.points);
    this.emitT = 0;
    this.sprayT = 0;
  }

  setViewport(height, pixelRatio, fov) {
    const scale = (height * pixelRatio) / (2 * Math.tan((fov * Math.PI) / 360));
    this.smoke.uniforms.uScale.value = scale;
    this.spray.uniforms.uScale.value = scale;
  }

  /** dt in simulated seconds; `wind` 0..1; `light` tints smoke at night. */
  update(dt, wind, light) {
    if (dt <= 0) return;
    const s = this.smoke;
    this.emitT += dt;
    while (this.emitT > 0.22) {
      this.emitT -= 0.22;
      for (const st of this.stacks) s.emit(st.x + (Math.random() - 0.5), st.y + 0.5, st.z + (Math.random() - 0.5), 0, 2.2, 0, 14);
    }
    const drift = 1.2 + wind * 4;
    for (let i = 0; i < s.cap; i++) {
      const age = (s.age[i] += dt);
      if (age > s.life[i]) {
        s.alpha[i] = 0;
        continue;
      }
      const t = age / s.life[i];
      s.vel[i * 3] += (drift - s.vel[i * 3]) * dt * 0.3;
      s.vel[i * 3 + 1] *= 1 - dt * 0.12;
      s.pos[i * 3] += s.vel[i * 3] * dt;
      s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
      s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt + Math.sin(age * 0.7 + i) * 0.02;
      s.size[i] = 3 + t * 16;
      s.alpha[i] = Math.min(1, t * 6) * (1 - t) * 0.42;
    }
    s.uniforms.uColor.value.setRGB(0.85 * light + 0.1, 0.84 * light + 0.1, 0.82 * light + 0.11);
    s.flush();

    const p = this.spray;
    this.sprayT += dt;
    while (this.sprayT > 0.012) {
      this.sprayT -= 0.012;
      for (const f of this.fountains) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.35;
        p.emit(f.x + Math.cos(a) * 0.2, 2.1, f.z + Math.sin(a) * 0.2, Math.cos(a) * r, 6.2 + Math.random() * 1.2, Math.sin(a) * r, 1.6);
      }
    }
    for (let i = 0; i < p.cap; i++) {
      const age = (p.age[i] += dt);
      if (age > p.life[i]) {
        p.alpha[i] = 0;
        continue;
      }
      p.vel[i * 3 + 1] -= 9.8 * dt;
      p.pos[i * 3] += p.vel[i * 3] * dt;
      p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt;
      p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
      if (p.pos[i * 3 + 1] < 0.7) p.age[i] = 1e9;
      p.size[i] = 0.35 + age * 0.25;
      p.alpha[i] = 0.55 * (1 - age / p.life[i]);
    }
    p.uniforms.uColor.value.setRGB(0.75 * light + 0.15, 0.82 * light + 0.15, 0.9 * light + 0.18);
    p.flush();
  }
}

// --- Rain --------------------------------------------------------------------------

const RAIN_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uStreak;
varying float vFade;
void main() {
  vec3 off = uVel * uTime;
  vec3 p = fract((aSeed.xyz * uBox + off - uCenter) / uBox) * uBox;
  vec3 world = uCenter - uBox * 0.5 + p;
  world -= uVel * uStreak * aSeed.w;
  vec3 rel = world - uCenter;
  vFade = (1.0 - smoothstep(0.25, 0.5, length(rel.xz) / uBox.x)) * smoothstep(-0.5, -0.35, rel.y / uBox.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}`;

export class Rain {
  constructor(count = 9000) {
    const seeds = new Float32Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let e = 0; e < 2; e++) {
        const o = (i * 2 + e) * 4;
        seeds[o] = x;
        seeds[o + 1] = y;
        seeds[o + 2] = z;
        seeds[o + 3] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(110, 60, 110) },
      uVel: { value: new THREE.Vector3(1.5, -11, 0.8) },
      uStreak: { value: 0.07 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xaab8c8) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 5;
  }

  update(realTime, camera, rain, wind, night) {
    this.lines.visible = rain > 0.02;
    if (!this.lines.visible) return;
    this.uniforms.uTime.value = realTime;
    this.uniforms.uCenter.value.copy(camera.position);
    this.uniforms.uVel.value.set(1 + wind * 4, -11 - rain * 3, 0.6 + wind * 2);
    this.uniforms.uOpacity.value = rain * (0.55 - night * 0.2);
    this.uniforms.uColor.value.setRGB(0.62 - night * 0.3, 0.68 - night * 0.3, 0.76 - night * 0.3);
  }
}
