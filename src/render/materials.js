// Shared materials. Most extend MeshStandardMaterial through onBeforeCompile so
// they keep physically based lighting, shadows and fog while adding procedural
// detail: windows that light up at night, wet asphalt, rippling water.

import * as THREE from 'three';

/** Uniforms shared by every material that reacts to time of day or weather. */
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 = day, 1 = full night (artificial lights at full strength)
  uLit: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // lit window share: office, residential, retail, industrial
  uLitCivic: { value: 0.5 },
  uWet: { value: 0 },
  uRain: { value: 0 },
};

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// --- Buildings -----------------------------------------------------------------
//
// aFac = facade coordinates in meters (u along the wall, scaled so windows fit
// exactly; v = height). aInfo = (seed, window style, use + 8 * shopfront, top of windows).

const BUILDING_PARS = /* glsl */ `
uniform float uNight;
uniform vec4 uLit;
uniform float uLitCivic;
uniform float uTime;
varying vec2 vFac;
varying vec4 vInfo;
varying vec3 vWorld;
${HASH}
// Box-filtered periodic pulse: fraction of [x - w/2, x + w/2] where fract(x) is in [a, b].
float pulseInt(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float fpulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return (pulseInt(x + 0.5 * w, a, b) - pulseInt(x - 0.5 * w, a, b)) / w;
}
`;

const BUILDING_FRAG = /* glsl */ `
  float wStyle = floor(vInfo.y + 0.5);
  float wCode = floor(vInfo.z + 0.5);
  float wUse = mod(wCode, 8.0);
  float wShop = step(7.5, wCode);
  float wTop = vInfo.w;
  // Integer-valued attributes are rounded so interpolation noise can't flip hashes per pixel.
  float wSeed = floor(vInfo.x + 0.5);
  vec2 wSeed2 = vec2(mod(wSeed, 61.0), floor(wSeed / 61.0));
  float win = 0.0;
  float lit = 0.0;
  float crown = 0.0;
  vec3 glassCol = vec3(0.05, 0.065, 0.08);
  vec3 litCol = vec3(1.0, 0.72, 0.42);
  float glassMetal = 0.6;
  float wallRough = 0.85;
  if (wStyle > 0.5 && vFac.y < wTop + 0.01) {
    vec2 cell = vec2(3.0, 3.3);
    vec4 m = vec4(0.25, 0.75, 0.28, 0.82); // x0, x1, y0, y1 of the pane inside a cell
    if (wStyle < 1.5) { cell = vec2(1.6, 3.9); m = vec4(0.04, 0.96, 0.05, 0.95); glassMetal = 0.9; wallRough = 0.35; }
    else if (wStyle < 2.5) { cell = vec2(3.0, 3.7); m = vec4(0.0, 1.0, 0.3, 0.86); glassMetal = 0.8; wallRough = 0.7; }
    else if (wStyle < 3.5) { cell = vec2(3.0, 3.3); m = vec4(0.24, 0.76, 0.26, 0.8); }
    else if (wStyle < 4.5) { cell = vec2(4.2, 3.0); m = vec4(0.3, 0.7, 0.3, 0.78); wallRough = 0.9; }
    else if (wStyle < 5.5) { cell = vec2(2.2, 3.8); m = vec4(0.22, 0.78, 0.0, 1.0); wallRough = 0.75; }
    else if (wStyle < 6.5) { cell = vec2(6.0, 100.0); m = vec4(0.06, 0.94, 0.0, 1.0); wallRough = 0.6; }
    else { cell = vec2(6.0, 3.6); m = vec4(0.07, 0.93, 0.12, 1.0); }

    vec2 p = vFac / cell;
    vec2 fw = fwidth(p);
    vec2 id = floor(p);
    float wx = fpulse(p.x, m.x, m.y, fw.x);
    float wy = fpulse(p.y, m.z, m.w, fw.y);
    if (wStyle > 5.5 && wStyle < 6.5) {
      // Clerestory band just under the roof line of sheds.
      wy = smoothstep(wTop - 2.6, wTop - 2.4, vFac.y) * (1.0 - smoothstep(wTop - 1.1, wTop - 0.9, vFac.y));
      id.y = 0.0;
    }
    win = wx * wy;
    // Ground floors: big shop windows on retail frontages, a door-ish gap elsewhere.
    if (wShop > 0.5 && vFac.y < 4.2) {
      float sx = fpulse(vFac.x / 6.0, 0.06, 0.94, fwidth(vFac.x / 6.0));
      win = sx * smoothstep(0.35, 0.45, vFac.y) * (1.0 - smoothstep(3.3, 3.4, vFac.y));
      id = vec2(floor(vFac.x / 6.0), -1.0);
    }
    float fine = clamp(max(fw.x, fw.y) * 1.6 - 0.35, 0.0, 1.0);

    float h = hash12(id + wSeed2 * 17.0);
    float ratio = wUse < 0.5 ? uLit.x : wUse < 1.5 ? uLit.y : wUse < 2.5 ? uLit.z : wUse < 3.5 ? uLit.w : uLitCivic;
    if (wShop > 0.5 && vFac.y < 4.2) ratio = uLit.z;
    lit = mix(step(h, ratio), ratio, fine);
    float h2 = hash12(id.yx + wSeed2 * 23.0 + 5.0);
    litCol = h2 < 0.55 ? vec3(1.0, 0.7, 0.4) : h2 < 0.85 ? vec3(1.0, 0.86, 0.66) : h2 < 0.95 ? vec3(0.78, 0.88, 1.0) : vec3(0.55, 0.7, 1.0);
    litCol *= mix(0.55, 1.15, hash12(id + 3.7));
    // Per-window variety turns into sparkle once windows are smaller than a few pixels.
    litCol = mix(litCol, vec3(0.86, 0.66, 0.44), fine);

    if (wStyle < 1.5) {
      // Curtain wall: the wall color is the glass tint; mullions are lighter metal.
      glassCol = diffuseColor.rgb * mix(mix(0.75, 1.15, hash12(id + wSeed2 * 7.0)), 0.95, fine);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.48, 0.5), 0.6);
    } else if (wStyle > 6.5) {
      // Building under construction: open floors between concrete slabs.
      glassCol = vec3(0.02, 0.02, 0.025);
      lit = 0.0;
    } else {
      // Dark glass, with blinds drawn in some windows.
      float hb = hash12(id + 11.0);
      glassCol = mix(vec3(0.03, 0.04, 0.055), vec3(0.1, 0.11, 0.12), hb);
      glassCol = mix(glassCol, vec3(0.52, 0.49, 0.43), step(0.8, hb) * 0.55);
      glassCol = mix(glassCol, vec3(0.1, 0.105, 0.11), fine);
    }
    // Rooftop crown lighting on tall towers after dark.
    if (wTop > 110.0 && (wStyle < 1.5 || (wStyle > 4.5 && wStyle < 5.5))) {
      crown = smoothstep(wTop - 1.6, wTop - 1.3, vFac.y) * (1.0 - smoothstep(wTop - 0.4, wTop - 0.1, vFac.y));
    }
    win = clamp(win, 0.0, 1.0);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win);
`;

export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uLit = shared.uLit;
    shader.uniforms.uLitCivic = shared.uLitCivic;
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFac;
attribute vec4 aInfo;
varying vec2 vFac;
varying vec4 vInfo;
varying vec3 vWorld;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFac = aFac;
vInfo = aInfo;
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${BUILDING_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${BUILDING_FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(wStyle > 0.5 ? wallRough : roughnessFactor, 0.08, win);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, glassMetal, win);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 crownCol = hash12(wSeed2 + 0.5) < 0.5 ? vec3(0.75, 0.85, 1.0) : vec3(1.0, 0.78, 0.45);
totalEmissiveRadiance += win * lit * litCol * 1.25 * uNight * uNight;
totalEmissiveRadiance += crown * crownCol * 1.6 * uNight;`);
  };
  mat.customProgramCacheKey = () => 'building-v1';
  return mat;
}

// --- Asphalt -------------------------------------------------------------------

function noiseTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createRoadMaterial() {
  const tex = noiseTexture(256, (ctx, n) => {
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 66 + Math.random() * 30 + (Math.random() < 0.02 ? 25 : 0);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v + 1;
      img.data[i * 4 + 2] = v + 4;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x8a8d92, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.uWet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= mix(1.0, 0.55, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.18, uWet);`);
  };
  mat.customProgramCacheKey = () => 'road-v1';
  return mat;
}

/** Concrete and paving with world-space speckle, darker when wet. */
export function createPavingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet;
varying vec3 vWorldP;
${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float pn = vnoise(vWorldP.xz * 1.7) * 0.5 + vnoise(vWorldP.xz * 0.21) * 0.5;
diffuseColor.rgb *= mix(0.86, 1.08, pn) * mix(1.0, 0.7, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.3, uWet);`);
  };
  mat.customProgramCacheKey = () => 'paving-v1';
  return mat;
}

/** Grass and fields: large-scale color variation so open ground doesn't look flat. */
export function createGroundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet;
varying vec3 vWorldP;
${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 gp = vWorldP.xz;
float patchy = vnoise(gp * 0.03) * 0.6 + vnoise(gp * 0.25) * 0.4;
vec3 g1 = vec3(0.16, 0.25, 0.09);
vec3 g2 = vec3(0.27, 0.32, 0.13);
vec3 grass = mix(g1, g2, smoothstep(0.3, 0.7, patchy));
// Farmland beyond the city: a patchwork of plots with slightly wobbly edges.
vec2 plot = gp / vec2(150.0, 110.0) + vec2(vnoise(gp * 0.02), vnoise(gp * 0.02 + 7.0)) * 0.25;
vec2 pid = floor(plot);
float crop = hash12(pid + 0.5);
vec3 field = crop < 0.3 ? vec3(0.42, 0.37, 0.17) : crop < 0.5 ? vec3(0.3, 0.36, 0.12) : crop < 0.62 ? vec3(0.33, 0.25, 0.15) : grass;
vec2 pf = fract(plot);
float hedge = smoothstep(0.0, 0.02, min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y)));
float farm = smoothstep(900.0, 1300.0, length(gp));
grass = mix(grass, mix(vec3(0.12, 0.18, 0.08), field * (0.9 + patchy * 0.2), hedge), farm);
diffuseColor.rgb *= grass * mix(1.0, 0.8, uWet);`);
  };
  mat.customProgramCacheKey = () => 'ground-v1';
  return mat;
}

export function createWaterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d3640, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uRain = shared.uRain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uRain;
varying vec3 vWorldP;
${HASH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 q = vWorldP.xz;
  float t = uTime;
  float e = 0.6;
  float n0 = vnoise(q * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise(q * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float nx = vnoise((q + vec2(e, 0.0)) * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise((q + vec2(e, 0.0)) * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float nz = vnoise((q + vec2(0.0, e)) * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise((q + vec2(0.0, e)) * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float amp = 0.35 + uRain * 0.6;
  vec3 wn = normalize(vec3(-(nx - n0) * amp / e * 4.0, 1.0, -(nz - n0) * amp / e * 4.0));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => 'water-v1';
  return mat;
}

/** Soft radial glow texture for light pools, headlight beams and smoke. */
export function glowTexture(size = 128, inner = 0.0, falloff = 1.6) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = r < inner ? 1 : Math.max(0, 1 - (r - inner) / (1 - inner));
      const v = Math.round(255 * a ** falloff);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Headlight beam: bright near the car, fading forward and to the sides. */
export function beamTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size; // along the beam, 0 at the car
      const v = (y + 0.5) / size * 2 - 1; // across
      const spread = 0.25 + u * 0.75;
      const across = Math.max(0, 1 - Math.abs(v) / spread);
      const along = Math.min(1, u * 8) * (1 - u) ** 1.4;
      const a = across ** 1.5 * along;
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, a * 1.6));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
