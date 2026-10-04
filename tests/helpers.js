// Shared test utilities: oriented-box overlap for vehicles, and a spatial sweep.

export function obbOverlap(c1, p1, c2, p2, shrink = 0.92) {
  const axes = [[p1.dx, p1.dz], [-p1.dz, p1.dx], [p2.dx, p2.dz], [-p2.dz, p2.dx]];
  const h1 = [(c1.len / 2) * shrink, (c1.wid / 2) * shrink];
  const h2 = [(c2.len / 2) * shrink, (c2.wid / 2) * shrink];
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  for (const [ax, az] of axes) {
    const r1 = h1[0] * Math.abs(p1.dx * ax + p1.dz * az) + h1[1] * Math.abs(-p1.dz * ax + p1.dx * az);
    const r2 = h2[0] * Math.abs(p2.dx * ax + p2.dz * az) + h2[1] * Math.abs(-p2.dz * ax + p2.dx * az);
    if (Math.abs(dx * ax + dz * az) > r1 + r2) return false;
  }
  return true;
}

/** Returns the list of overlapping vehicle pairs (fully faded-in cars only). */
export function findCollisions(traffic) {
  const grid = new Map();
  const poses = new Map();
  for (const c of traffic.cars) {
    if (c.fade < 0.95) continue;
    const p = traffic.pose(c, { x: 0, z: 0, dx: 0, dz: 0 });
    poses.set(c, p);
    const k = `${Math.floor(p.x / 14)},${Math.floor(p.z / 14)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  const hits = [];
  for (const [k, list] of grid) {
    const [gx, gz] = k.split(',').map(Number);
    for (const a of list) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const other = grid.get(`${gx + ox},${gz + oz}`);
          if (!other) continue;
          for (const b of other) {
            if (b.id <= a.id) continue;
            if (obbOverlap(a, poses.get(a), b, poses.get(b))) hits.push([a, b]);
          }
        }
      }
    }
  }
  return hits;
}
