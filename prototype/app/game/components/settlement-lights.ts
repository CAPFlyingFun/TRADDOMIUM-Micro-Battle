// Ported verbatim (types added) from TMB-Story visual/paint/island.js @ dfe810e670a42867b014dae4a206df5d80350414
// https://github.com/CAPFlyingFun/TMB-Story — procedural settlement lights, seeded (mulberry32).
/* eslint-disable */
// Procedural paint for the island set: the settlement's lights. A painter draws once,
// into a canvas the stage places in world coordinates, and is seeded so the picture is
// the same on every device and every play. (The clouds are images, made by
// scripts/make-island-art.py.)

function rng(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  return (r() + r() + r() - 1.5) / 1.5; // roughly -1..1, weighted to the middle
}

function blob(g: any, x: number, y: number, radius: number, rgb: string, alpha: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
}

// The research settlement at night, seen from far above: a warm haze over the clearing,
// faint streets, porch lights and windows, and a few colder white lights where the
// laboratories are. Nearly five hundred people: a small town, not a city.
export function settlementLights(canvas: HTMLCanvasElement, o: { w: number; seed?: number }) {
  const g = canvas.getContext("2d")!;
  const k = canvas.width / o.w; // canvas pixels per world pixel
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = rng(o.seed || 7);
  g.globalCompositeOperation = "lighter";

  // A warm haze over the town, lumpy rather than round.
  for (let i = 0; i < 7; i++) blob(g, cx + gauss(r) * 90 * k, cy + gauss(r) * 55 * k, (90 + r() * 70) * k, "255,160,80", 0.05);

  // Streets: a loose grid, slightly turned, faded out toward the edge of the town.
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.21);
  g.lineWidth = 1.1 * k;
  const streets: number[][][] = [];
  for (let i = -5; i <= 5; i++) {
    const off = i * 34 * k + gauss(r) * 6 * k;
    const len = (200 - Math.abs(i) * 22) * k;
    streets.push([[-len, off], [len, off + gauss(r) * 10 * k]]);
    streets.push([[off * 0.9, -len * 0.62], [off * 0.9 + gauss(r) * 10 * k, len * 0.62]]);
  }
  for (const [[x0, y0], [x1, y1]] of streets) {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, "rgba(255,190,120,0)");
    grad.addColorStop(0.5, "rgba(255,190,120,0.11)");
    grad.addColorStop(1, "rgba(255,190,120,0)");
    g.strokeStyle = grad;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  // Lights sit on the streets, denser toward the middle.
  const lights: [number, number, boolean][] = [];
  for (let n = 0; n < 340; n++) {
    const s = streets[Math.floor(r() * streets.length)];
    const p = 0.5 + gauss(r) * 0.5;
    const x = s[0][0] + (s[1][0] - s[0][0]) * p + gauss(r) * 5 * k;
    const y = s[0][1] + (s[1][1] - s[0][1]) * p + gauss(r) * 5 * k;
    if ((x / (220 * k)) ** 2 + (y / (150 * k)) ** 2 > 1) continue;
    lights.push([x, y, r() < 0.12]);
  }
  // The laboratory complex: a tight block of colder, brighter light near the centre.
  for (let n = 0; n < 26; n++) lights.push([30 * k + gauss(r) * 34 * k, -18 * k + gauss(r) * 22 * k, true]);

  for (const [x, y, lab] of lights) {
    const rgb = lab ? "205,228,255" : "255,196,120";
    blob(g, x, y, (lab ? 4.5 : 4) * k, rgb, lab ? 0.22 : 0.22);
  }
  for (const [x, y, lab] of lights) {
    g.fillStyle = lab ? "rgba(235,245,255,0.95)" : "rgba(255,226,170,0.9)";
    const d = (lab ? 1.1 : 0.8) * k * (0.7 + r() * 0.6);
    g.fillRect(x - d / 2, y - d / 2, d, d);
  }
  g.restore();
}

