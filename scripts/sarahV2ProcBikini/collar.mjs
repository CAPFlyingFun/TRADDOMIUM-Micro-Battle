// WHERE A STRAP LIES ROUND A NECK — the same measurement the game's lanyard makes (src/view/HumanBadge.ts,
// measureWearer), ported so the bikini's neck cords rest exactly where the badge's lanyard does: at
// the BASE of the neck, in the corner where the side of the neck flattens onto the shoulder.
const CELL = 0.01;
export function measureCollar(P, neckJoint, { clear = 0.004 } = {}) {
  const count = P.length / 3, ringY = neckJoint[1] + 0.03;
  let neckX = neckJoint[0], neckZ = neckJoint[2], neckR = 0.055;
  for (let pass = 0; pass < 2; pass += 1) { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < count; i += 1) { const x = P[i * 3], z = P[i * 3 + 2]; if (Math.abs(P[i * 3 + 1] - ringY) > 0.006) continue; if (Math.hypot(x - neckX, z - neckZ) > 0.075) continue; a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    if (!Number.isFinite(a)) break; neckZ = (c + d) / 2; neckR = ((b - a) + (d - c)) / 4; }
  const BINS = 13, tops = new Float64Array(BINS);
  const profile = (ang) => { tops.fill(-Infinity); for (let i = 0; i < count; i += 1) { const vy = P[i * 3 + 1]; if (vy > ringY + 0.005 || vy < ringY - 0.2) continue; const dx = P[i * 3] - neckX, dz = P[i * 3 + 2] - neckZ; const da = Math.atan2(dx, dz) - ang; if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > 0.21) continue; const bin = Math.round((Math.hypot(dx, dz) - 0.03) / CELL); if (bin < 0 || bin >= BINS) continue; if (vy > tops[bin]) tops[bin] = vy; } return tops; };
  const angles = [40, 75, 105, 140, 180], found = [];
  for (const deg of angles) { const top = profile(deg * Math.PI / 180); let corner = null;
    for (let b = 0; b < BINS - 1; b += 1) { if (!Number.isFinite(top[b]) || !Number.isFinite(top[b + 1])) continue; if (top[b + 1] > ringY - 0.005) continue; if (top[b] - top[b + 1] < 0.008) { corner = { r: 0.03 + b * CELL, y: top[b] }; break; } }
    found.push(corner); }
  let sideY = 0, sides = 0; for (let k = 1; k <= 3; k += 1) if (found[k]) { sideY += found[k].y; sides += 1; } sideY = sides ? sideY / sides : neckJoint[1] + 0.04;
  const collar = angles.map((deg, k) => { const a = deg * Math.PI / 180, dx = Math.sin(a), dz = Math.cos(a); let c = found[k];
    if (!c) { let r = 0; for (let i = 0; i < count; i += 1) { if (Math.abs(P[i * 3 + 1] - sideY) > 0.006) continue; const ex = P[i * 3] - neckX, ez = P[i * 3 + 2] - neckZ; const da = Math.atan2(ex, ez) - a; if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > 0.21) continue; const rr = Math.hypot(ex, ez); if (rr < 0.11 && rr > r) r = rr; } c = { r: r > 0 ? r : neckR, y: sideY }; }
    const r = c.r + CELL / 2 + clear; return { deg, p: [neckX + dx * r, c.y + clear, neckZ + dz * r] }; });
  return { neck: { x: neckX, z: neckZ, r: neckR, ringY }, collar };
}
