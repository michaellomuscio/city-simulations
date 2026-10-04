// Signal City: wires the simulation, the renderer and the HUD together.

import * as THREE from 'three';
import { Stage, QUALITY } from './render/stage.js';
import { CameraRig } from './render/cameraRig.js';
import { Atmosphere } from './render/atmosphere.js';
import { buildTerrain } from './render/terrain.js';
import { buildStreets } from './render/streets.js';
import { buildBuildings } from './render/buildings.js';
import { buildTrees, StreetLights, SignalHardware, Beacons, Cranes } from './render/props.js';
import { VehicleView } from './render/vehicles.js';
import { PeopleView } from './render/people.js';
import { Effects, Rain } from './render/effects.js';
import { Picker } from './render/picker.js';
import { shared } from './render/materials.js';
import { World, seedFrom, PHYSICS_DT } from './sim/world.js';
import { litShare } from './sim/clock.js';
import { smoothstep } from './sim/constants.js';
import { Hud, loadPrefs, savePrefs } from './ui/hud.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const BRIDGE_PAINT = ['#9c3b2e', '#2f6f73', '#d9d4c7', '#3c5a8a'];

function defaultQuality() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return small || coarse ? 'medium' : 'high';
}

class App {
  constructor() {
    this.prefs = { seed: '2041', size: 'medium', traffic: 1, foot: 1, dayLength: 720, quality: defaultQuality(), ...loadPrefs() };
    if (!QUALITY[this.prefs.quality]) this.prefs.quality = defaultQuality();
    this.stage = new Stage(document.getElementById('viewport'));
    this.stage.setQuality(this.prefs.quality);
    this.atmos = new Atmosphere(this.stage.renderer, this.stage.scene);
    this.atmos.setShadowQuality(QUALITY[this.prefs.quality].shadowSize, QUALITY[this.prefs.quality].shadows);
    this.rig = new CameraRig(this.stage.camera, this.stage.renderer.domElement);
    this.rig.onModeChange = () => this.syncControls();
    this.picker = new Picker(this.stage.camera, this.stage.renderer.domElement);
    this.rain = new Rain();
    this.stage.scene.add(this.rain.lines);
    this.hud = new Hud(this);
    this.speed = 1;
    this.paused = false;
    this.world = null;
    this.views = null;
    this.selection = null;
    this.perf = { time: 0, frames: 0, warmup: 6, checked: false };
    this.marker = this.createMarker();
    this.stage.scene.add(this.marker.group);
    this.stage.onResize.push((w, h, pr) => this.views && this.views.effects.setViewport(h, pr, this.stage.camera.fov));
    this.bindPointer();
    this.last = performance.now();
    this.frame = this.frame.bind(this);
  }

  async start() {
    await this.build(this.prefs.seed, this.prefs.size, 17);
    requestAnimationFrame(this.frame);
  }

  // --- City lifecycle -----------------------------------------------------------------

  async build(seedText, size, hour = null) {
    const seed = seedFrom(seedText);
    this.hud.showLoader(null, 'Surveying streets');
    await nextFrame();
    await nextFrame();
    const prev = this.world;
    const world = new World({
      seed, size, traffic: this.prefs.traffic, foot: this.prefs.foot,
      hour: hour ?? (prev ? prev.clock.hour : 17), weather: prev ? prev.weather.kind : 'clear',
    });
    if (prev) {
      world.clock.day = prev.clock.day;
      world.weather.setMode(prev.weather.mode);
    }
    this.hud.showLoader(world.city.name, 'Raising the skyline');
    await nextFrame();
    const views = this.buildViews(world);
    this.select(null);
    this.disposeViews();
    this.world = world;
    this.views = views;
    this.stage.scene.add(views.group);
    views.effects.setViewport(this.stage.container.clientHeight, this.stage.pixelRatio, this.stage.camera.fov);
    this.rig.setBounds(world.city.bounds, world.city.downtown, world.city.buildings);
    this.rig.home(world.city);
    this.prefs.seed = String(seedText);
    this.prefs.size = world.size;
    savePrefs(this.prefs);
    this.hud.setCity(world);
    this.hud.syncSettings(this.prefs, world);
    this.syncControls();
    // Compile shaders and upload buffers before revealing the city.
    this.atmos.update(world.clock.hour, world.weather, this.rig.focus, this.rig.distance, 1);
    this.stage.renderer.compile(this.stage.scene, this.stage.camera);
    this.hud.hideLoader();
  }

  buildViews(world) {
    const q = QUALITY[this.stage.quality];
    const group = new THREE.Group();
    group.name = 'city';
    const terrain = buildTerrain(world.city);
    const streets = buildStreets(world.city, world.net, { bridgePaint: BRIDGE_PAINT[world.seed % BRIDGE_PAINT.length] });
    const buildings = buildBuildings(world.city);
    const trees = buildTrees([...world.city.trees, ...streets.medianTrees], q.treeShadows ? 'high' : 'low');
    const lights = new StreetLights(world.city.lights);
    const signals = new SignalHardware(world.net);
    const beacons = new Beacons(buildings.beacons);
    const cranes = new Cranes(world.city.cranes);
    const vehicles = new VehicleView(world.traffic);
    const people = new PeopleView(world.peds);
    const effects = new Effects(world.city);
    group.add(terrain.group, streets.group, buildings.mesh, trees, lights.group, signals.group, beacons.mesh, cranes.group, vehicles.group, people.mesh, effects.group);
    return { group, terrain, streets, buildings, trees, lights, signals, beacons, cranes, vehicles, people, effects };
  }

  disposeViews() {
    if (!this.views) return;
    this.stage.scene.remove(this.views.group);
    const seen = new Set();
    this.views.group.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
      if (o.isInstancedMesh) o.dispose();
    });
    this.views = null;
  }

  // --- Controls used by the HUD -----------------------------------------------------------

  syncControls() {
    const mode = this.rig.mode === 'drive' ? 'follow' : this.rig.mode;
    this.hud.syncControls({
      paused: this.paused, speed: this.speed, camera: mode, weather: this.world ? this.world.weather.mode : 'auto',
    });
    if (this.selection) this.hud.renderInspector(true);
  }

  togglePause() {
    this.paused = !this.paused;
    this.syncControls();
  }

  setSpeed(s) {
    this.speed = s;
    this.paused = false;
    this.syncControls();
  }

  setHour(h) {
    if (!this.world) return;
    this.world.clock.setHour(h);
    this.world.updateTargets();
  }

  setWeather(mode) {
    if (!this.world) return;
    this.world.weather.setMode(mode);
    this.syncControls();
  }

  setDensity(traffic, foot) {
    if (traffic !== null) this.prefs.traffic = traffic;
    if (foot !== null) this.prefs.foot = foot;
    if (this.world) {
      this.world.trafficDensity = this.prefs.traffic;
      this.world.footDensity = this.prefs.foot;
      this.world.updateTargets();
    }
    savePrefs(this.prefs);
  }

  setDayLength(seconds) {
    this.prefs.dayLength = seconds;
    savePrefs(this.prefs);
  }

  setQuality(q, byUser = false) {
    this.stage.setQuality(q);
    const s = QUALITY[this.stage.quality];
    this.atmos.setShadowQuality(s.shadowSize, s.shadows);
    // Shadow support is compiled into shaders, so rebuild them.
    this.stage.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.needsUpdate = true;
    });
    if (this.views) {
      for (const m of this.views.trees.children) m.castShadow = s.treeShadows;
      this.views.effects.setViewport(this.stage.container.clientHeight, this.stage.pixelRatio, this.stage.camera.fov);
    }
    this.prefs.quality = this.stage.quality;
    if (byUser) this.prefs.qualityChosen = true;
    savePrefs(this.prefs);
    document.getElementById('qualitySelect').value = this.stage.quality;
  }

  setCamera(mode) {
    if (!this.world) return;
    if (mode === 'orbit') this.rig.release();
    else if (mode === 'tour') this.rig.tour();
    else if (mode === 'follow') {
      let car = this.selection && this.selection.kind === 'car' ? this.selection.car : null;
      if (!car) car = this.nearestCar();
      if (car) {
        this.select({ kind: 'car', car });
        this.rig.follow(car, this.world.traffic);
      }
    }
    this.syncControls();
  }

  nearestCar() {
    const tr = this.world.traffic;
    const f = this.rig.focus;
    const pose = { x: 0, z: 0, dx: 1, dz: 0 };
    let best = null;
    let bestD = Infinity;
    for (const c of tr.cars) {
      if (c.fade < 1 || c.leaving || (c.seg.kind === 'lane' && c.seg.road.portal)) continue;
      tr.pose(c, pose);
      const d = (pose.x - f.x) ** 2 + (pose.z - f.z) ** 2 + (c.v < 1 ? 4000 : 0);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  followSelected() {
    const c = this.selection && this.selection.kind === 'car' ? this.selection.car : null;
    if (!c) return;
    if (this.rig.mode === 'follow' && this.rig.car === c) this.rig.release();
    else this.rig.follow(c, this.world.traffic);
    this.syncControls();
  }

  toggleDrive() {
    const c = this.rig.car || (this.selection && this.selection.kind === 'car' ? this.selection.car : null);
    if (!c) {
      this.hud.toast('Select a car first, then take the driver’s seat.');
      return;
    }
    if (this.rig.mode === 'drive') this.rig.follow(c, this.world.traffic);
    else {
      this.select({ kind: 'car', car: c });
      this.rig.drive(c);
    }
    this.syncControls();
  }

  frameSelection() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'building') {
      const b = s.building.bbox;
      const size = Math.max(b.x1 - b.x0, b.z1 - b.z0, b.y1 * 0.8);
      this.rig.frame(new THREE.Vector3((b.x0 + b.x1) / 2, b.y1 * 0.45, (b.z0 + b.z1) / 2), size);
    } else if (s.kind === 'intersection') {
      this.rig.frame(new THREE.Vector3(s.inter.x, 0, s.inter.z), 34);
    }
  }

  select(hit) {
    if (this.selection && this.selection.kind === 'car' && this.selection.car !== this.rig.car) this.selection.car.pinned = false;
    this.selection = hit;
    if (hit && hit.kind === 'car') hit.car.pinned = true;
    this.hud.select(hit);
    this.updateMarker(true);
  }

  // --- Picking ----------------------------------------------------------------------------

  bindPointer() {
    const dom = this.stage.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointerup', (e) => {
      if (!down || !this.world) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 500) {
        const hit = this.picker.pick(e.clientX, e.clientY, this.world);
        this.select(hit);
      }
      down = null;
    });
  }

  createMarker() {
    const group = new THREE.Group();
    group.name = 'selection';
    const lane = new THREE.Color('#f2c230');
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
      new THREE.LineBasicMaterial({ color: lane.clone().multiplyScalar(2.2), transparent: true, opacity: 0.9 }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: lane.clone().multiplyScalar(2.5), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.renderOrder = 4;
    box.visible = false;
    ring.visible = false;
    group.add(box, ring);
    return { group, box, ring, pose: { x: 0, z: 0, dx: 1, dz: 0 } };
  }

  updateMarker() {
    const m = this.marker;
    const s = this.selection;
    m.box.visible = false;
    m.ring.visible = false;
    if (!s || !this.world) return;
    if (s.kind === 'building') {
      const b = s.building.bbox;
      m.box.visible = true;
      m.box.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      m.box.scale.set(b.x1 - b.x0 + 1.5, b.y1 + 1, b.z1 - b.z0 + 1.5);
    } else if (s.kind === 'car') {
      if (this.rig.mode === 'drive') return;
      this.world.traffic.pose(s.car, m.pose);
      m.ring.visible = true;
      const r = s.car.len * 0.75;
      m.ring.position.set(m.pose.x, 0.08, m.pose.z);
      m.ring.scale.set(r, 1, r);
    } else if (s.kind === 'intersection') {
      const I = s.inter;
      m.box.visible = true;
      m.box.position.set(I.x, 0, I.z);
      m.box.scale.set(I.hx * 2 + 8, 0.4, I.hz * 2 + 8);
    }
    const pulse = 0.65 + 0.35 * Math.sin(shared.uTime.value * 4);
    m.ring.material.opacity = 0.85 * pulse;
  }

  // --- Frame loop -------------------------------------------------------------------------

  frame(now) {
    requestAnimationFrame(this.frame);
    const raw = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    const dt = Math.min(0.1, raw);
    this.last = now;
    const w = this.world;
    const v = this.views;
    if (!w || !v) return;

    w.clockRate = 86400 / this.prefs.dayLength;
    const steps = w.update(dt, this.paused ? 0 : this.speed);
    const simDt = steps * PHYSICS_DT;
    shared.uTime.value += dt;
    const t = shared.uTime.value;

    const hour = w.clock.hour;
    const wx = w.weather;
    const k = this.atmos.update(hour, wx, this.rig.focus, this.rig.distance, dt);
    const night = this.atmos.state.night;
    // Lights come on at dusk, and early under heavy cloud or fog.
    const lightsOn = Math.min(1, Math.max(night, smoothstep(0.7, 1.0, wx.cloud) * 0.45 + wx.fog * 0.35 + wx.rain * 0.2));
    shared.uNight.value = lightsOn;
    shared.uLit.value.set(litShare(0, hour), litShare(1, hour), litShare(2, hour), litShare(3, hour));
    shared.uLitCivic.value = litShare(4, hour);
    shared.uWet.value = wx.wet;
    shared.uRain.value = wx.rain;
    this.stage.renderer.toneMappingExposure = k.exposure * (1 + wx.flash * 0.5);
    this.stage.bloom.strength = 0.1 + lightsOn * 0.32;

    v.vehicles.update(lightsOn);
    v.people.update();
    v.signals.update(t);
    v.lights.update(lightsOn);
    v.beacons.update(t, night);
    v.cranes.update(w.simTime);
    v.effects.update(simDt, wx.wind, 1 - night * 0.75);
    this.rain.update(t, this.stage.camera, wx.rain, wx.wind, night);

    // The camera runs on wall-clock time so moves finish on time even at low frame rates.
    this.rig.update(raw, w.traffic);
    this.atmos.followCamera(this.stage.camera);
    this.updateMarker();
    this.hud.frame(dt);
    this.watchPerformance(dt);
    this.stage.render();
  }

  /** Step quality down once if the device can't keep up (unless the user picked a level). */
  watchPerformance(dt) {
    const p = this.perf;
    if (p.checked || this.prefs.qualityChosen || document.hidden) return;
    if (p.warmup > 0) {
      p.warmup -= dt;
      return;
    }
    p.time += dt;
    p.frames++;
    if (p.time < 4) return;
    const fps = p.frames / p.time;
    p.time = 0;
    p.frames = 0;
    const order = ['low', 'medium', 'high'];
    const i = order.indexOf(this.stage.quality);
    if (fps < 26 && i > 0) {
      this.setQuality(order[i - 1]);
      this.hud.toast(`Switched to ${QUALITY[order[i - 1]].label.toLowerCase()} graphics to keep things smooth.`);
      p.warmup = 3;
    } else {
      p.checked = true;
    }
  }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.getElementById('loaderStep').textContent = 'This browser can’t run WebGL 2, which the 3D view needs.';
} else {
  const app = new App();
  window.signalCity = app;
  app.start().catch((err) => {
    console.error(err);
    document.getElementById('loaderStep').textContent = 'Something went wrong while building the city. Reload to try again.';
  });
}
