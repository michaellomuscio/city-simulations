// DOM side of the app: panels, controls, keyboard shortcuts and the inspector.

import { VEHICLE_TYPES } from '../sim/traffic.js';
import { presence } from '../sim/clock.js';

const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('en-US');
const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog' };
const WEATHER_ICON = { clear: 'i-sun', cloudy: 'i-cloud', rain: 'i-rain', storm: 'i-storm', fog: 'i-fog' };
const USE_LABEL = {
  office: 'Office tower', residential: 'Apartments', hotel: 'Hotel', retail: 'Shops and offices', industrial: 'Industry',
  civic: 'Civic building', construction: 'Construction site',
};
const PREFS_KEY = 'signal-city:prefs';

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable (private windows, previews); preferences are optional.
  }
}

export class Hud {
  constructor(app) {
    this.app = app;
    this.history = [];
    this.lastSample = -1;
    this.tick = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 60;
    this.selection = null;
    this.toastTimer = 0;
    this.bind();
  }

  bind() {
    const app = this.app;
    $('playBtn').addEventListener('click', () => app.togglePause());
    for (const b of $('speedSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setSpeed(Number(b.dataset.speed)));
    $('timeSlider').addEventListener('input', (e) => app.setHour(Number(e.target.value) / 60));
    for (const b of $('weatherSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setWeather(b.dataset.weather));
    for (const b of $('camSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setCamera(b.dataset.cam));
    $('settingsBtn').addEventListener('click', () => this.toggleDrawer());
    $('drawerClose').addEventListener('click', () => this.toggleDrawer(false));
    $('helpBtn').addEventListener('click', () => this.toggleHelp(true));
    $('helpClose').addEventListener('click', () => this.toggleHelp(false));
    $('help').addEventListener('click', (e) => {
      if (e.target === $('help')) this.toggleHelp(false);
    });
    $('inspClose').addEventListener('click', () => app.select(null));
    $('statsToggle').addEventListener('click', () => {
      const s = $('stats');
      const collapsed = s.dataset.collapsed !== 'true';
      s.dataset.collapsed = String(collapsed);
      $('statsToggle').setAttribute('aria-expanded', String(!collapsed));
    });
    if (window.matchMedia('(max-width: 640px)').matches) $('stats').dataset.collapsed = 'true';
    $('diceBtn').addEventListener('click', () => {
      $('seedInput').value = String(Math.floor(Math.random() * 99999) + 1);
    });
    $('cityForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const size = new FormData(e.target).get('size') || 'medium';
      app.build($('seedInput').value || '1', size);
      this.toggleDrawer(false);
    });
    const pct = (v) => `${Math.round(v * 100)}%`;
    $('trafficRange').addEventListener('input', (e) => {
      $('trafficOut').textContent = pct(Number(e.target.value));
      app.setDensity(Number(e.target.value), null);
    });
    $('footRange').addEventListener('input', (e) => {
      $('footOut').textContent = pct(Number(e.target.value));
      app.setDensity(null, Number(e.target.value));
    });
    $('dayLength').addEventListener('change', (e) => app.setDayLength(Number(e.target.value)));
    $('qualitySelect').addEventListener('change', (e) => app.setQuality(e.target.value, true));

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        app.togglePause();
      } else if (['1', '2', '3', '4'].includes(k)) app.setSpeed([1, 2, 4, 8][Number(k) - 1]);
      else if (k === 't') app.setCamera('tour');
      else if (k === 'c') app.setCamera('follow');
      else if (k === 'v') app.toggleDrive();
      else if (k === 'h') document.body.classList.toggle('hud-hidden');
      else if (k === '?') this.toggleHelp(true);
      else if (k === 'escape') {
        if (!$('help').hidden) this.toggleHelp(false);
        else if (!$('drawer').hidden) this.toggleDrawer(false);
        else {
          app.setCamera('orbit');
          app.select(null);
        }
      }
    });
  }

  toggleDrawer(open = $('drawer').hidden) {
    $('drawer').hidden = !open;
    $('settingsBtn').setAttribute('aria-expanded', String(open));
    if (open) $('seedInput').focus({ preventScroll: true });
  }

  toggleHelp(open) {
    $('help').hidden = !open;
    if (open) $('helpClose').focus();
  }

  syncControls(state) {
    $('playBtn').querySelector('use').setAttribute('href', state.paused ? '#i-play' : '#i-pause');
    $('playBtn').setAttribute('aria-label', state.paused ? 'Resume simulation' : 'Pause simulation');
    for (const b of $('speedSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
    for (const b of $('weatherSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.weather === state.weather));
    for (const b of $('camSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.cam === state.camera));
  }

  syncSettings(prefs, world) {
    $('seedInput').value = String(prefs.seed ?? world.seed);
    const radio = { small: 'sizeSmall', medium: 'sizeMedium', large: 'sizeLarge' }[world.size];
    $(radio).checked = true;
    $('trafficRange').value = String(prefs.traffic ?? 1);
    $('trafficOut').textContent = `${Math.round((prefs.traffic ?? 1) * 100)}%`;
    $('footRange').value = String(prefs.foot ?? 1);
    $('footOut').textContent = `${Math.round((prefs.foot ?? 1) * 100)}%`;
    $('dayLength').value = String(prefs.dayLength ?? 720);
    $('qualitySelect').value = prefs.quality;
  }

  setCity(world) {
    $('cityName').textContent = world.city.name;
    $('cityPop').textContent = num.format(world.city.population);
    document.title = `${world.city.name} · Signal City`;
    this.history = [];
    this.lastSample = -1;
  }

  showLoader(name, step) {
    const l = $('loader');
    l.hidden = false;
    l.classList.remove('done');
    if (name) $('loaderName').textContent = name;
    if (step) $('loaderStep').textContent = step;
  }

  hideLoader() {
    const l = $('loader');
    l.classList.add('done');
    setTimeout(() => {
      if (l.classList.contains('done')) l.hidden = true;
    }, 600);
  }

  toast(text, ms = 3200) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      t.hidden = true;
    }, ms);
  }

  frame(dt) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.tick += dt;
    if (this.tick < 0.2) return;
    this.tick = 0;
    this.render();
  }

  render() {
    const app = this.app;
    const w = app.world;
    if (!w) return;
    const clock = w.clock;
    $('clockTime').textContent = clock.label();
    $('clockDay').textContent = `${clock.weekday} · Day ${clock.day}`;
    const wx = w.weather;
    $('weatherLabel').textContent = `${WEATHER_LABEL[wx.kind]} · ${wx.temperature(clock.hour)}°C`;
    const night = app.atmos.state.night > 0.5;
    const icon = wx.kind === 'clear' || wx.kind === 'cloudy' && wx.cloud < 0.5 ? (night ? 'i-moon' : 'i-sun') : WEATHER_ICON[wx.kind];
    $('skyIcon').querySelector('use').setAttribute('href', `#${icon}`);
    const slider = $('timeSlider');
    if (document.activeElement !== slider) slider.value = String(Math.floor(clock.hour * 60));

    const st = w.traffic.stats();
    const kmh = Math.round(st.avgSpeed * 3.6);
    $('statCars').textContent = num.format(st.count);
    $('quickCars').textContent = num.format(st.count);
    $('statSpeed').textContent = String(kmh);
    $('quickSpeed').textContent = String(kmh);
    $('statStopped').textContent = String(Math.round(st.stoppedShare * 100));
    $('statPeds').textContent = num.format(w.peds.stats().count);
    const pill = $('flowPill');
    const state = st.flow > 0.42 ? 'go' : st.flow > 0.26 ? 'caution' : 'stop';
    pill.dataset.state = state;
    pill.textContent = state === 'go' ? 'Moving' : state === 'caution' ? 'Busy' : 'Congested';
    $('fps').textContent = `${Math.round(this.fps)} fps`;

    // One sample every ten simulated minutes, 24 hours kept.
    const slot = Math.floor((clock.day * 86400 + clock.seconds) / 600);
    if (slot !== this.lastSample) {
      this.lastSample = slot;
      this.history.push(st.count);
      if (this.history.length > 144) this.history.shift();
      this.drawSpark();
    }
    if (this.selection) this.renderInspector();
  }

  drawSpark() {
    const c = $('spark');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const data = this.history;
    const max = Math.max(10, ...data) * 1.1;
    const css = getComputedStyle(document.documentElement);
    const lane = css.getPropertyValue('--lane').trim() || '#f2c230';
    const edge = css.getPropertyValue('--edge').trim();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(H * f) + 0.5);
      ctx.lineTo(W, Math.round(H * f) + 0.5);
      ctx.stroke();
    }
    if (data.length < 2) return;
    const x = (i) => (i / 143) * (W - 6) + 2;
    const y = (v) => H - 3 - (v / max) * (H - 8);
    ctx.beginPath();
    ctx.moveTo(x(0), H);
    data.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(data.length - 1), H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `${lane}55`);
    grad.addColorStop(1, `${lane}00`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = lane;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const lx = x(data.length - 1);
    const ly = y(data[data.length - 1]);
    ctx.fillStyle = lane;
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Inspector -------------------------------------------------------------------

  select(hit) {
    this.selection = hit;
    const panel = $('inspector');
    if (!hit) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    this.renderInspector(true);
  }

  renderInspector(rebuildActions = false) {
    const hit = this.selection;
    const app = this.app;
    const w = app.world;
    let rows = [];
    if (hit.kind === 'car') {
      const c = hit.car;
      if (c.dead) {
        this.app.select(null);
        return;
      }
      const d = w.traffic.describe(c);
      $('inspKind').textContent = 'Vehicle';
      $('inspTitle').textContent = VEHICLE_TYPES[c.type].label;
      $('inspSub').textContent = `Plate ${c.plate}`;
      rows = [
        ['Speed', `${Math.round(c.v * 3.6)} km/h`],
        ['Doing', d.status],
        ['On', d.road],
        ['Heading', d.heading],
        ['Driven', `${(c.odo / 1000).toFixed(2)} km · ${c.blocks} blocks`],
      ];
      if (rebuildActions) {
        this.actions([
          { id: 'follow', label: 'Follow', icon: 'i-car', pressed: app.rig.mode === 'follow' && app.rig.car === c, run: () => app.followSelected() },
          { id: 'drive', label: "Driver's seat", icon: 'i-eye', pressed: app.rig.mode === 'drive' && app.rig.car === c, run: () => app.toggleDrive() },
        ]);
      } else {
        this.press('follow', app.rig.mode === 'follow' && app.rig.car === c);
        this.press('drive', app.rig.mode === 'drive' && app.rig.car === c);
      }
    } else if (hit.kind === 'building') {
      const b = hit.building;
      $('inspKind').textContent = b.kind === 'house' ? 'House' : b.kind === 'tower' && b.use === 'office' ? 'Office tower' : USE_LABEL[b.use] || 'Building';
      $('inspTitle').textContent = b.name;
      $('inspSub').textContent = b.address;
      const people = b.residents + b.workers;
      const here = people ? Math.round((b.residents * presence('residential', w.clock.hour)) + (b.workers * presence(b.use === 'retail' ? 'retail' : 'office', w.clock.hour))) : 0;
      rows = [
        ['Height', `${Math.round(b.height)} m · ${b.floors} ${b.floors === 1 ? 'floor' : 'floors'}`],
        ['Built', b.kind === 'construction' ? 'Under construction' : String(b.year)],
      ];
      if (b.residents) rows.push([b.use === 'hotel' ? 'Guests' : 'Residents', num.format(b.residents)]);
      if (b.workers) rows.push(['Jobs', num.format(b.workers)]);
      if (people) rows.push(['Inside now', `about ${num.format(here)}`]);
      if (rebuildActions) this.actions([{ id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() }]);
    } else if (hit.kind === 'intersection') {
      const I = hit.inter;
      const sig = I.signal;
      const ns = (I.legs.N || I.legs.S).name;
      const ew = (I.legs.E || I.legs.W).name;
      $('inspKind').textContent = 'Intersection';
      $('inspTitle').textContent = `${shortName(ns)} & ${shortName(ew)}`;
      const ph = sig.describe();
      $('inspSub').textContent = `Signals · ${Math.round(ph.cycle)} s cycle`;
      const lamp = (side) => {
        const s = sig.state(side);
        return `<span class="signal" aria-label="${side} ${s === 'G' ? 'green' : s === 'Y' ? 'yellow' : 'red'}"><i class="${s === 'R' ? 'on-R' : ''}"></i><i class="${s === 'Y' ? 'on-Y' : ''}"></i><i class="${s === 'G' ? 'on-G' : ''}"></i></span>`;
      };
      const queue = (side) => I.inLanes[side].reduce((n, l) => n + l.cars.filter((c) => c.v < 1).length, 0);
      const sides = ['N', 'E', 'S', 'W'].filter((s) => I.legs[s] && I.inLanes[s].length);
      let walkers = 0;
      for (const s of ['N', 'E', 'S', 'W']) if (I.crosswalks[s]) walkers += I.crosswalks[s].walkers.length;
      rows = [
        ['Phase', `${ph.label} · ${Math.ceil(ph.remaining)} s`],
        ...sides.map((s) => [`From ${s}`, { html: `${queue(s)} waiting ${lamp(s)}` }]),
        ['Crossing now', `${walkers} ${walkers === 1 ? 'person' : 'people'}`],
      ];
      if (rebuildActions) this.actions([{ id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() }]);
    }
    const dl = $('inspRows');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      if (typeof v === 'object') dd.innerHTML = v.html;
      else dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  actions(list) {
    const box = $('inspActions');
    box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.className = 'action';
      b.dataset.action = a.id;
      b.innerHTML = `<svg aria-hidden="true"><use href="#${a.icon}"/></svg><span>${a.label}</span>`;
      if (a.pressed !== undefined) b.setAttribute('aria-pressed', String(a.pressed));
      b.addEventListener('click', () => a.run());
      box.append(b);
    }
  }

  press(id, on) {
    const b = $('inspActions').querySelector(`[data-action="${id}"]`);
    if (b) b.setAttribute('aria-pressed', String(on));
  }
}

function shortName(n) {
  return n.replace(/ \(Highway \d+\)/, '').replace(' Boulevard', ' Blvd').replace(' Avenue', ' Ave').replace(' Street', ' St');
}
