// Builds large merged geometries (one draw call per material) from boxes, quads
// and prisms. Static city parts are batched this way; moving things are instanced.

import * as THREE from 'three';

const tmpColor = new THREE.Color();

/** Linear-space RGB triple from a CSS hex color. */
export function rgb(hex, k = 1) {
  tmpColor.set(hex);
  return [tmpColor.r * k, tmpColor.g * k, tmpColor.b * k];
}

export class GeoBuilder {
  /**
   * @param {object} o
   * @param {boolean} [o.color] per-vertex color
   * @param {boolean} [o.fac] per-vertex facade coordinates (u along the wall, v height), for the window shader
   * @param {boolean} [o.info] per-vertex vec4 for shader parameters
   * @param {boolean} [o.uv] plain uv coordinates
   */
  constructor({ color = true, fac = false, info = false, uv = false } = {}) {
    this.pos = [];
    this.nor = [];
    this.col = color ? [] : null;
    this.fac = fac ? [] : null;
    this.inf = info ? [] : null;
    this.uvs = uv ? [] : null;
    this.idx = [];
    this.n = 0;
    // Current attribute state applied to new vertices.
    this.c = [1, 1, 1];
    this.i4 = [0, 0, 0, 0];
  }

  color(c) {
    this.c = c;
    return this;
  }

  info(a, b, c, d) {
    this.i4 = [a, b, c, d];
    return this;
  }

  v(x, y, z, nx, ny, nz, u = 0, w = 0) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    if (this.col) this.col.push(this.c[0], this.c[1], this.c[2]);
    if (this.fac) this.fac.push(u, w);
    if (this.uvs) this.uvs.push(u, w);
    if (this.inf) this.inf.push(this.i4[0], this.i4[1], this.i4[2], this.i4[3]);
    return this.n++;
  }

  /** Quad a-b-c-d (counter-clockwise seen from the side the normal points to). */
  quad(a, b, c, d, n, uv = null) {
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], uv ? uv[0] : 0, uv ? uv[1] : 0);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], uv ? uv[2] : 0, uv ? uv[3] : 0);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], uv ? uv[4] : 0, uv ? uv[5] : 0);
    const i3 = this.v(d[0], d[1], d[2], n[0], n[1], n[2], uv ? uv[6] : 0, uv ? uv[7] : 0);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Like quad(), but fixes the winding so the face points along `n`. */
  quadN(a, b, c, d, n) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (dot >= 0) this.quad(a, b, c, d, n);
    else this.quad(d, c, b, a, n);
  }

  tri(a, b, c, n) {
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2]);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2]);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2]);
    this.idx.push(i0, i1, i2);
  }

  /** Horizontal rectangle facing up. */
  flat(x0, x1, z0, z1, y, uvScale = 0) {
    const uv = uvScale ? [x0 / uvScale, z1 / uvScale, x1 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale, x0 / uvScale, z0 / uvScale] : null;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], uv);
  }

  /**
   * Axis-aligned box. `faces` can skip sides: { top, bottom, n, s, e, w }.
   * With `wallUV`, side faces get facade coordinates (meters along the wall, world height).
   */
  box(x0, x1, y0, y1, z0, z1, faces = {}, wallUV = null) {
    const f = { top: true, bottom: false, n: true, s: true, e: true, w: true, ...faces };
    const fu = (len, u) => (wallUV ? wallUV(len) * u : 0);
    if (f.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0, z1, x1, z1, x1, z0, x0, z0]);
    if (f.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    const lx = x1 - x0;
    const lz = z1 - z0;
    // South (+z)
    if (f.s) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, y0, fu(lx, lx), y0, fu(lx, lx), y1, 0, y1]);
    // North (-z)
    if (f.n) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, y0, fu(lx, lx), y0, fu(lx, lx), y1, 0, y1]);
    // East (+x)
    if (f.e) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, y0, fu(lz, lz), y0, fu(lz, lz), y1, 0, y1]);
    // West (-x)
    if (f.w) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [0, y0, fu(lz, lz), y0, fu(lz, lz), y1, 0, y1]);
  }

  /** Box rotated about Y by `angle` around its center (cx, cz). */
  orientedBox(cx, cz, len, wid, y0, y1, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const pt = (lx, lz, y) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
    const hl = len / 2;
    const hw = wid / 2;
    const a = pt(-hl, -hw, y0); const b = pt(hl, -hw, y0); const cc = pt(hl, hw, y0); const d = pt(-hl, hw, y0);
    const a1 = pt(-hl, -hw, y1); const b1 = pt(hl, -hw, y1); const c1 = pt(hl, hw, y1); const d1 = pt(-hl, hw, y1);
    const nrm = (p, q) => {
      const dx = q[0] - p[0];
      const dz = q[2] - p[2];
      const l = Math.hypot(dx, dz) || 1;
      return [dz / l, 0, -dx / l];
    };
    this.quad(d1, c1, b1, a1, [0, 1, 0]);
    this.quad(b, a, a1, b1, nrm(a, b));
    this.quad(cc, b, b1, c1, nrm(b, cc));
    this.quad(d, cc, c1, d1, nrm(cc, d));
    this.quad(a, d, d1, a1, nrm(d, a));
  }

  /** Square-section beam from point p to point q (arches, cables, railings). */
  beam(p, q, w, h = w) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const f = [d[0] / L, d[1] / L, d[2] / L];
    // Pick a side vector perpendicular to the beam, preferring horizontal.
    let sx = -f[2];
    let sy = 0;
    let sz = f[0];
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) {
      sx = 1;
      sy = 0;
      sz = 0;
      sl = 1;
    }
    const side = [sx / sl, sy / sl, sz / sl];
    const up = [f[1] * side[2] - f[2] * side[1], f[2] * side[0] - f[0] * side[2], f[0] * side[1] - f[1] * side[0]];
    const corner = (base, a, b) => [base[0] + side[0] * a + up[0] * b, base[1] + side[1] * a + up[1] * b, base[2] + side[2] * a + up[2] * b];
    const hw = w / 2;
    const hh = h / 2;
    const faces = [
      [[hw, -hh], [hw, hh], side],
      [[hw, hh], [-hw, hh], up],
      [[-hw, hh], [-hw, -hh], [-side[0], -side[1], -side[2]]],
      [[-hw, -hh], [hw, -hh], [-up[0], -up[1], -up[2]]],
    ];
    for (const [a, b, n] of faces) {
      this.quadN(corner(p, a[0], a[1]), corner(p, b[0], b[1]), corner(q, b[0], b[1]), corner(q, a[0], a[1]), n);
    }
  }

  /** Vertical cylinder (optionally tapered) with a top cap. */
  cylinder(x, z, r0, r1, y0, y1, seg = 12, cap = true, wallUV = false) {
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const slope = (r0 - r1) / (y1 - y0 || 1);
    const circ = 2 * Math.PI * r0;
    for (let i = 0; i < seg; i++) {
      const [c0, s0] = ring[i];
      const [c1, s1] = ring[i + 1];
      const n0 = norm3(c0, slope, s0);
      const n1 = norm3(c1, slope, s1);
      const u0 = wallUV ? (i / seg) * circ : 0;
      const u1 = wallUV ? ((i + 1) / seg) * circ : 0;
      const a = this.v(x + c0 * r0, y0, z + s0 * r0, n0[0], n0[1], n0[2], u0, y0);
      const b = this.v(x + c0 * r1, y1, z + s0 * r1, n0[0], n0[1], n0[2], u0, y1);
      const c = this.v(x + c1 * r1, y1, z + s1 * r1, n1[0], n1[1], n1[2], u1, y1);
      const d = this.v(x + c1 * r0, y0, z + s1 * r0, n1[0], n1[1], n1[2], u1, y0);
      this.idx.push(a, b, c, a, c, d);
    }
    if (cap && r1 > 0) {
      const center = this.v(x, y1, z, 0, 1, 0);
      for (let i = 0; i < seg; i++) {
        const [c0, s0] = ring[i];
        const [c1, s1] = ring[i + 1];
        const a = this.v(x + c0 * r1, y1, z + s0 * r1, 0, 1, 0);
        const b = this.v(x + c1 * r1, y1, z + s1 * r1, 0, 1, 0);
        this.idx.push(center, b, a);
      }
    }
  }

  cone(x, z, r, y0, y1, seg = 10) {
    this.cylinder(x, z, r, 0.001, y0, y1, seg, false);
  }

  /** Upper hemisphere. */
  dome(x, z, r, y0, seg = 16, rings = 6) {
    const rows = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * (Math.PI / 2);
      const row = [];
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const nx = Math.cos(phi) * Math.cos(th);
        const ny = Math.sin(phi);
        const nz = Math.cos(phi) * Math.sin(th);
        row.push(this.v(x + nx * r, y0 + ny * r, z + nz * r, nx, ny, nz));
      }
      rows.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = rows[j][i];
        const b = rows[j + 1][i];
        const c = rows[j + 1][i + 1];
        const d = rows[j][i + 1];
        this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /** Prism extruded along z from a convex profile in the x-y plane (vehicle bodies). */
  prismZ(profile, z0, z1) {
    const n = profile.length;
    // Sides along the extrusion.
    for (let i = 0; i < n; i++) {
      const [ax, ay] = profile[i];
      const [bx, by] = profile[(i + 1) % n];
      const dx = bx - ax;
      const dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      const nrm = [dy / l, -dx / l, 0];
      this.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], nrm);
    }
    // Caps (fans); the profile is counter-clockwise seen from +z.
    const c0 = this.v(profile[0][0], profile[0][1], z1, 0, 0, 1);
    for (let i = 1; i < n - 1; i++) {
      const b = this.v(profile[i][0], profile[i][1], z1, 0, 0, 1);
      const c = this.v(profile[i + 1][0], profile[i + 1][1], z1, 0, 0, 1);
      this.idx.push(c0, b, c);
    }
    const d0 = this.v(profile[0][0], profile[0][1], z0, 0, 0, -1);
    for (let i = 1; i < n - 1; i++) {
      const b = this.v(profile[i][0], profile[i][1], z0, 0, 0, -1);
      const c = this.v(profile[i + 1][0], profile[i + 1][1], z0, 0, 0, -1);
      this.idx.push(d0, c, b);
    }
  }

  get empty() {
    return this.n === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.fac) g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.fac, 2));
    if (this.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.inf) g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.inf, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
