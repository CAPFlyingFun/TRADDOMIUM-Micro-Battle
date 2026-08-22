/**
 * A FLIGHT HUD DRAWN OVER THE REAL WORLD.
 *
 * Not shipping code — a proposal, rendered onto the clean plate that
 * `npm run plates` produces, so it is argued over the ground it will
 * actually be seen against rather than over a blank rectangle. Every
 * HUD mockup so far has been drawn on white, and the terrain here is
 * gold-brown, which is precisely the colour a gold instrument
 * disappears into.
 *
 *   npm run plates && npm run hud:draft      the mint instrument layer
 *   TONE=gold npm run hud:draft              the warm one, for comparison
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const plate = `data:image/png;base64,${readFileSync('plate-flight.png').toString('base64')}`;
const tone = process.env.TONE ?? 'mint';
const INK = tone === 'mint' ? '#a9f2c9' : '#ffe7b8';
const DIM = tone === 'mint' ? 'rgba(169,242,201,.55)' : 'rgba(255,231,184,.55)';
const WARN = '#ffb03a';

/** The altitude tape: ticks every 100 cm, labels every 200. */
function altTape(now) {
  const span = 500;             // cm shown above and below
  const h = 200;                // px tall
  const w = 124;
  const line = 62;              // where the tape's spine sits
  const px = (cm) => h / 2 - ((cm - now) / span) * (h / 2);
  let marks = '';
  const from = Math.floor((now - span) / 100) * 100;
  for (let cm = from; cm <= now + span; cm += 100) {
    if (cm < 0) continue;
    const y = px(cm);
    if (y < -2 || y > h + 2) continue;
    const big = cm % 200 === 0;
    marks += `<line x1="${line}" y1="${y.toFixed(1)}" x2="${line + (big ? 11 : 6)}"
      y2="${y.toFixed(1)}" stroke="${DIM}" stroke-width="1.4"/>`;
    if (big) marks += `<text x="${line + 16}" y="${(y + 3.5).toFixed(1)}" fill="${DIM}"
      font-size="10" font-family="ui-monospace,Menlo,monospace">${cm}</text>`;
  }
  // The reading, in a box pointing at the spine. Inside the viewBox —
  // the first draft drew it at negative x and it simply was not there.
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <line x1="${line}" y1="0" x2="${line}" y2="${h}" stroke="${DIM}" stroke-width="1.4"/>
    ${marks}
    <g transform="translate(${line} ${h / 2})">
      <path d="M0 0 L-8 -10 L-56 -10 L-56 10 L-8 10 Z" fill="rgba(8,12,8,.78)"
        stroke="${INK}" stroke-width="1.6"/>
      <text x="-51" y="5" fill="${INK}" font-size="15" font-weight="700"
        font-family="ui-monospace,Menlo,monospace">${now}</text>
    </g>
  </svg>`;
}

/** Horizon, a short pitch ladder, and the queen reticle. */
function reticle(pitch, roll) {
  const w = 320;
  const h = 150;
  const rung = (deg, label) => {
    const y = h / 2 - deg * 4.6 + pitch * 4.6;
    if (y < 6 || y > h - 6) return '';
    const half = deg === 0 ? 130 : 38;
    const gap = deg === 0 ? 30 : 0;
    const dash = deg < 0 ? 'stroke-dasharray="7 5"' : '';
    const tick = deg === 0 ? '' :
      `<line x1="${w / 2 - half}" y1="${y}" x2="${w / 2 - half}" y2="${y + (deg > 0 ? 5 : -5)}"
         stroke="${INK}" stroke-width="1.6"/>
       <line x1="${w / 2 + half}" y1="${y}" x2="${w / 2 + half}" y2="${y + (deg > 0 ? 5 : -5)}"
         stroke="${INK}" stroke-width="1.6"/>`;
    return `<line x1="${w / 2 - half}" y1="${y}" x2="${w / 2 - gap}" y2="${y}"
        stroke="${INK}" stroke-width="1.7" ${dash}/>
      <line x1="${w / 2 + gap}" y1="${y}" x2="${w / 2 + half}" y2="${y}"
        stroke="${INK}" stroke-width="1.7" ${dash}/>${tick}
      ${label ? `<text x="${w / 2 - half - 7}" y="${y + 3.5}" fill="${DIM}" font-size="9"
        text-anchor="end" font-family="ui-monospace,Menlo,monospace">${label}</text>` : ''}`;
  };
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <g transform="rotate(${-roll} ${w / 2} ${h / 2})">
      ${rung(10, '10')}${rung(0, '')}${rung(-10, '10')}
    </g>
  </svg>`;
}

/**
 * THE QUEEN AS THE INSTRUMENT'S OWN SYMBOL.
 *
 * The best idea in any of the three mockups. A fighter's boresight is a
 * W and a dot; hers is an ant, and it costs nothing to draw. It sits
 * ABOVE the model rather than on it — the first draft put it dead
 * centre and the two silhouettes fought each other.
 */
function queenMark() {
  return `<svg width="72" height="40" viewBox="0 0 72 40" fill="none"
    stroke="${INK}" stroke-width="1.9" stroke-linecap="round">
    <path d="M4 15 L22 20 M68 15 L50 20"/>
    <path d="M30 9 L24 2 M42 9 L48 2"/>
    <ellipse cx="36" cy="12.5" rx="5.2" ry="4.4"/>
    <ellipse cx="36" cy="21" rx="4.4" ry="5"/>
    <ellipse cx="36" cy="31.5" rx="6" ry="7"/>
  </svg>`;
}

const page = await (await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ['--disable-dev-shm-usage'],
})).newPage({ viewport: { width: 932, height: 430 } });

await page.setContent(`<body style="margin:0;width:932px;height:430px;position:relative;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden">
  <img src="${plate}" style="position:absolute;inset:0;width:100%;height:100%">

  <!-- everything below is the DRAFT, drawn over the real world -->
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.9))">${reticle(2.5, 7)}</div>
  <div style="position:absolute;left:50%;top:31%;transform:translate(-50%,-50%);
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.9))">${queenMark()}</div>

  <div style="position:absolute;right:14px;top:58%;transform:translateY(-50%);
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.9))">
    ${altTape(620)}
    <!-- ALT and VS together UNDER the tape: above it they ran into the
         weather chip, which already owns that corner. -->
    <div style="display:flex;align-items:baseline;gap:8px;margin-top:5px">
      <span style="color:${DIM};font-size:9px;letter-spacing:.2em">ALT cm</span>
      <span style="color:${DIM};font-size:9px;letter-spacing:.2em">VS</span>
      <span style="color:${INK};font-size:13px;font-weight:700">+8.4</span>
      <span style="font-size:9px;color:${DIM}">cm/s &#8593;</span>
    </div>
  </div>

  <!-- WIND, under where the weather chip already lives -->
  <div style="position:absolute;right:26px;top:64px;display:flex;align-items:center;gap:9px;
    background:rgba(10,14,9,.62);border:1px solid rgba(255,226,160,.28);border-radius:9px;
    padding:6px 10px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))">
    <div>
      <div style="color:rgba(255,226,160,.55);font-size:8px;letter-spacing:.24em">WIND</div>
      <div style="color:#ffe2a0;font-size:12px;font-weight:700">E 12<span
        style="color:rgba(255,226,160,.6);font-weight:500"> G 18</span></div>
      <div style="color:rgba(255,226,160,.45);font-size:8px">km/h</div>
    </div>
    <svg width="26" height="26" viewBox="0 0 26 26" style="transform:rotate(48deg)">
      <path d="M13 22 L13 5 M13 5 L8.5 10 M13 5 L17.5 10" stroke="#ffe2a0"
        stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </svg>
    <div style="color:${WARN};font-size:9px;font-weight:700;letter-spacing:.1em;
      line-height:1.15;text-align:center">&#9888;<br>STRONG</div>
  </div>

  <!-- AIR vs GROUND, in the space the pace readout already owns -->
  <div style="position:absolute;left:152px;bottom:22px;
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.9))">
    <div style="color:${DIM};font-size:9px;letter-spacing:.2em">AIR</div>
    <div style="color:${INK};font-size:17px;font-weight:700;line-height:1.05">70.0</div>
    <div style="color:${DIM};font-size:9px;letter-spacing:.2em;margin-top:3px">GND</div>
    <div style="color:${INK};font-size:13px;line-height:1.05">84.3 <span
      style="font-size:9px;color:${DIM}">cm/s</span></div>
  </div>
</body>`);
await page.waitForTimeout(400);
await page.screenshot({ path: `hud-${tone}.png` });
console.log(`hud-${tone}.png`);
process.exit(0);
