// Sky, sun and moon, fog, and the image-based lighting baked from the sky so
// glass towers and wet streets reflect the right time of day.

import * as THREE from 'three';
import { sunDirection, moonDirection } from '../sim/clock.js';
import { clamp, smoothstep, lerp } from '../sim/constants.js';
import { shared } from './materials.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform float uGlow;
uniform float uStars;
uniform float uMoon;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uCityGlow;
uniform float uFlash;
varying vec3 vDir;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, uGround, smoothstep(0.0, -0.1, h));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (0.16 * pow(sd, 5.0) + 0.55 * pow(sd, 42.0)) * uGlow;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * uSunDisc;

  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.82, 0.88, 1.0) * (smoothstep(0.99935, 0.9995, md) * 1.4 + pow(md, 160.0) * 0.06) * uMoon;

  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 230.0;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash13(id);
    if (r > 0.991) {
      vec3 o = (vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5) * 0.6;
      float s = smoothstep(0.13, 0.0, length(f - o));
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 9.0) + r * 120.0);
      col += vec3(0.9, 0.94, 1.0) * s * tw * uStars * (r - 0.991) * 110.0 * smoothstep(0.0, 0.25, h);
    }
  }

  if (h > 0.0 && uCloud > 0.01) {
    vec2 uv = d.xz / (h + 0.1) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv * 1.2);
    float cover = smoothstep(1.0 - uCloud * 0.9 - 0.05, 1.0 - uCloud * 0.9 + 0.3, n) * smoothstep(0.0, 0.16, h);
    float lit = 0.55 + 0.45 * pow(sd, 3.0);
    vec3 cc = mix(uCloudShade, uCloudLit, clamp((n - 0.35) * 1.8 * lit, 0.0, 1.0));
    col = mix(col, cc, cover * 0.94);
  }

  col += vec3(1.0, 0.58, 0.32) * uCityGlow * exp(-max(h, 0.0) * 16.0) * 0.12;
  col += vec3(0.75, 0.8, 1.0) * uFlash * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Lighting keyframes by sine of the sun's elevation.
const KEYS = [
  { e: -0.4, zenith: '#02050c', horizon: '#0a1220', sun: '#8aa4d6', sunI: 0, hemiSky: '#22324f', hemiGround: '#0a0c10', hemiI: 0.32, env: 0.22, exposure: 1.08 },
  { e: -0.14, zenith: '#06102a', horizon: '#1d2643', sun: '#8aa4d6', sunI: 0, hemiSky: '#27355a', hemiGround: '#0b0d12', hemiI: 0.34, env: 0.26, exposure: 1.06 },
  { e: -0.05, zenith: '#16244e', horizon: '#9b5a5f', sun: '#ff6a3a', sunI: 0, hemiSky: '#46507a', hemiGround: '#1a1714', hemiI: 0.42, env: 0.38, exposure: 1.04 },
  { e: 0.02, zenith: '#33518e', horizon: '#f08a4c', sun: '#ff7f3a', sunI: 1.1, hemiSky: '#8d8fb0', hemiGround: '#2a2119', hemiI: 0.55, env: 0.6, exposure: 1.05 },
  { e: 0.13, zenith: '#3c6bb0', horizon: '#f0be8a', sun: '#ffbe76', sunI: 2.6, hemiSky: '#a8bdd8', hemiGround: '#3a3123', hemiI: 0.5, env: 0.62, exposure: 1.0 },
  { e: 0.35, zenith: '#3672c2', horizon: '#b5d0ea', sun: '#fff0da', sunI: 3.4, hemiSky: '#bcd2ec', hemiGround: '#4a4230', hemiI: 0.48, env: 0.66, exposure: 1.0 },
  { e: 1.01, zenith: '#2c66b8', horizon: '#a6c8ea', sun: '#ffffff', sunI: 3.6, hemiSky: '#c4d8ef', hemiGround: '#50483a', hemiI: 0.5, env: 0.68, exposure: 1.0 },
];
const KEY_COLORS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround'];
for (const k of KEYS) for (const c of KEY_COLORS) k[c] = new THREE.Color(k[c]);

const OVERCAST = new THREE.Color('#8e959c');
const OVERCAST_NIGHT = new THREE.Color('#14171c');

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDisc: { value: 1 },
      uGlow: { value: 1 },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uCloud: { value: 0.2 },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uTime: shared.uTime,
      uCityGlow: { value: 0 },
      uFlash: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.radius = 2;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 2500;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xa6c8ea, 0.0003);
    scene.background = null;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, skyMat);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.envKey = null;
    this.envTimer = 0;

    this.state = { elevation: 0, night: 0, sunVisible: 1, dayLight: 1 };
    this._sun = [0, 0, 0];
    this._moon = [0, 0, 0];
    this._key = {};
    this._tmp = new THREE.Color();
    this.shadowSize = 0;
    this.setShadowQuality(2048, true);
  }

  setShadowQuality(size, enabled) {
    this.sun.castShadow = enabled;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  sample(e) {
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
    const k = this._key;
    for (const c of KEY_COLORS) {
      if (!k[c]) k[c] = new THREE.Color();
      k[c].copy(a[c]).lerp(b[c], t);
    }
    for (const n of ['sunI', 'hemiI', 'env', 'exposure']) k[n] = lerp(a[n], b[n], t);
    return k;
  }

  /**
   * @param {number} hour time of day
   * @param {object} weather smoothed weather parameters
   * @param {THREE.Vector3} focus point the camera looks at (shadows are fitted around it)
   * @param {number} viewDist camera distance to the focus point
   */
  update(hour, weather, focus, viewDist, realDt) {
    const u = this.uniforms;
    const sun = sunDirection(hour, this._sun);
    const moon = moonDirection(hour, this._moon);
    const e = sun[1];
    const k = this.sample(e);
    const cloud = weather.cloud;
    const night = smoothstep(0.06, -0.1, e);
    this.state.elevation = e;
    this.state.night = night;

    // Clouds and fog wash the sky toward grey; rain clouds are darker.
    const gloom = clamp(weather.rain * 0.6 + Math.max(0, cloud - 0.75) * 0.6, 0, 0.75);
    const grey = this._tmp.copy(OVERCAST_NIGHT).lerp(OVERCAST, 1 - night).multiplyScalar(1 - gloom * 0.55);
    const wash = clamp(cloud * 0.85 + weather.fog * 0.4, 0, 0.95);
    u.uZenith.value.copy(k.zenith).lerp(grey, wash * 0.9);
    u.uHorizon.value.copy(k.horizon).lerp(grey, wash);
    u.uGround.value.copy(u.uHorizon.value).multiplyScalar(0.55);
    u.uSunColor.value.copy(k.sun);
    u.uSunDir.value.set(sun[0], sun[1], sun[2]);
    u.uMoonDir.value.set(moon[0], moon[1], moon[2]);
    u.uSunDisc.value = (1 - smoothstep(0.35, 0.8, cloud)) * 14 * smoothstep(-0.03, 0.02, e);
    u.uGlow.value = (1 - cloud * 0.7) * smoothstep(-0.2, 0.0, e);
    u.uStars.value = night * (1 - smoothstep(0.3, 0.75, cloud)) * (1 - weather.fog * 0.8);
    u.uMoon.value = night * (1 - smoothstep(0.5, 0.9, cloud));
    u.uCloud.value = cloud;
    u.uCloudLit.value.copy(k.horizon).lerp(k.sun, 0.25).multiplyScalar(1 - night * 0.85).lerp(grey, cloud * 0.5);
    u.uCloudShade.value.copy(k.zenith).multiplyScalar(0.55).lerp(grey, 0.4 + cloud * 0.3).multiplyScalar(1 - cloud * 0.35);
    u.uCityGlow.value = night * (0.6 + cloud * 0.8);
    u.uFlash.value = weather.flash;

    // Fog takes the horizon color so the city melts into the sky.
    const fog = this.scene.fog;
    fog.color.copy(u.uHorizon.value).lerp(u.uZenith.value, 0.15);
    fog.density = 0.00022 + weather.fog * 0.0021 + weather.rain * 0.0005 + night * 0.00004;

    // Sunlight by day, moonlight by night; switch over while both are dim.
    const sunUp = e > -0.02;
    const dir = sunUp ? sun : moon;
    const lightI = sunUp ? k.sunI : 0.32 * smoothstep(-0.02, -0.15, e);
    const dim = 1 - cloud * 0.72 - weather.fog * 0.25;
    this.sun.intensity = lightI * Math.max(0.12, dim) * (1 - gloom * 0.5) + weather.flash * 2.5;
    if (sunUp) this.sun.color.copy(k.sun);
    else this.sun.color.setRGB(0.55, 0.65, 0.9);
    this.state.dayLight = sunUp ? k.sunI / 3.6 : 0;

    this.hemi.color.copy(k.hemiSky).lerp(grey, cloud * 0.5);
    this.hemi.groundColor.copy(k.hemiGround);
    this.hemi.intensity = k.hemiI * (1 + cloud * 0.25) * (1 - gloom * 0.45) + weather.flash * 1.5;
    this.scene.environmentIntensity = k.env * (1 - cloud * 0.3) * (1 - gloom * 0.5);

    // Fit the shadow frustum around what the camera is looking at, snapped to texels.
    const span = clamp(viewDist * 0.95, 110, 1100);
    const cam = this.sun.shadow.camera;
    if (cam.right !== span) {
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * span) / this.shadowSize;
    const lx = dir[0];
    const ly = dir[1];
    const lz = dir[2];
    // Light-space axes for snapping.
    const rx = -lz;
    const rz = lx;
    const rl = Math.hypot(rx, rz) || 1;
    const right = [rx / rl, 0, rz / rl];
    const up = [ly * right[2], lz * right[0] - lx * right[2], -ly * right[0]];
    const pr = Math.round((focus.x * right[0] + focus.z * right[2]) / texel) * texel;
    const pu = Math.round((focus.x * up[0] + focus.y * up[1] + focus.z * up[2]) / texel) * texel;
    const pf = focus.x * lx + focus.y * ly + focus.z * lz;
    const fx = right[0] * pr + up[0] * pu + lx * pf;
    const fy = up[1] * pu + ly * pf;
    const fz = right[2] * pr + up[2] * pu + lz * pf;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + lx * 1200, fy + Math.max(ly, 0.05) * 1200, fz + lz * 1200);
    this.sun.target.updateMatrixWorld();

    // Re-bake the environment map when the sky has changed noticeably.
    this.envTimer -= realDt;
    const key = `${Math.round(e * 60)}:${Math.round(cloud * 12)}:${Math.round(weather.fog * 8)}`;
    if (key !== this.envKey && this.envTimer <= 0) {
      this.envKey = key;
      this.envTimer = 0.25;
      // Stars would show up as sparkles in every dark window, so reflections leave them out.
      const stars = u.uStars.value;
      u.uStars.value = 0;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      u.uStars.value = stars;
      if (this.envTarget) this.envTarget.dispose();
      this.envTarget = rt;
      this.scene.environment = rt.texture;
    }
    return k;
  }

  followCamera(camera) {
    this.sky.position.copy(camera.position);
  }

  dispose() {
    if (this.envTarget) this.envTarget.dispose();
    this.pmrem.dispose();
  }
}
