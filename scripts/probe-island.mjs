/**
 * probe:island — boots the island lab headless and drives it through
 * the real controls: the stick, the Auto drag-to-lock gesture, the pace
 * selector and a camera drag. Fails on console/page errors, on her
 * standing off the island, or on any of the movement rules breaking.
 *
 * Writes probe-island.png for eyes-on checks. Expects a server on
 * PROBE_URL (default vite preview :4173).
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/?scene=island';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({
    viewport: { width: 932, height: 430 },
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  // The island is 2 MB of elevation and 64 section meshes to build.
  await page.waitForFunction(() => window.__island !== undefined, { timeout: 60000 });
  await page.waitForTimeout(1200);

  const island = (fn) => page.evaluate(fn);
  const where = () => island(() => window.__island.where());
  const bearing = () => island(() => window.__island.bearing());
  const auto = () => island(() => window.__island.auto());
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

  /**
   * Let SIMULATED seconds pass, not wall-clock ones.
   *
   * A frame under SwiftShader is worth hundreds of milliseconds, so a
   * waitForTimeout buys a handful of frames rather than a second of
   * play — and with the movement now eased rather than instant, a
   * handful of frames is barely off the mark. Every check that means
   * "after N seconds of PLAY" waits on the scene's own clock.
   */
  const advance = async (seconds) => {
    const from = await island(() => window.__island.simTime());
    await page.waitForFunction(
      (until) => window.__island.simTime() >= until,
      from + seconds,
      { timeout: 120000 },
    );
  };

  const start = await island(() => ({
    ground: window.__island.groundUnderfoot(),
    triangles: window.__island.triangles(),
    drawCalls: window.__island.drawCalls(),
  }));
  if (start.ground <= 0) {
    throw new Error(`she spawned in the sea: ${start.ground.toFixed(2)}`);
  }

  // ── The pace is a CEILING ────────────────────────────────────────
  // Choosing a pace must not move her. That is the whole reason the
  // telegraph was scrapped, so it is the first thing checked.
  await island(() => window.__island.setPace('run'));
  const parked = await where();
  await advance(1);
  if (gap(await where(), parked) > 0.01) {
    throw new Error('selecting a pace moved her — it is a ceiling, not a throttle');
  }

  // ── Manual: she travels while asked, and stops when let go ───────
  await page.keyboard.down('KeyW');
  await advance(1.2);
  const covered = gap(await where(), parked);
  if (covered < 2) throw new Error(`a held push did not move her: ${covered.toFixed(2)}`);
  await page.keyboard.up('KeyW');
  // She coasts — the velocity eases rather than switching off, which is
  // deliberate — but she must actually stop, and soon.
  await advance(1.6);
  const resting = await island(() => window.__island.speed());
  if (resting > 0.1) {
    throw new Error(`she kept going after the stick was released: ${resting.toFixed(2)}`);
  }
  const stopped = await where();
  await advance(0.6);
  if (gap(await where(), stopped) > 0.1) throw new Error('she never came to rest');

  // Reverse exists, and is slower than going forward.
  const measure = async (key, seconds) => {
    const from = await where();
    await page.keyboard.down(key);
    await advance(seconds);
    await page.keyboard.up(key);
    const travelled = gap(await where(), from);
    await advance(0.8);
    return travelled;
  };
  const ahead = await measure('KeyW', 1);
  const astern = await measure('KeyS', 1);
  if (astern < 0.2) throw new Error('she would not back up');
  if (astern >= ahead) {
    throw new Error(`reverse was not slower: ${astern.toFixed(1)} against ${ahead.toFixed(1)}`);
  }

  // Sidestep moves her without turning her.
  const faced = await bearing();
  const sideways = await measure('KeyD', 1);
  if (sideways < 0.2) throw new Error('she would not sidestep');
  if (Math.abs((await bearing()) - faced) > 1e-6) {
    throw new Error('a sidestep turned her — it has to be a strafe');
  }

  // ── Auto: drag past the rim, release on the lock ─────────────────
  const stick = await page.evaluate(() => {
    const box = document.querySelector('[data-control="stick"]').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });

  // Full forward INSIDE the ring must not arm it: that happens constantly.
  await page.mouse.move(stick.x, stick.y);
  await page.mouse.down();
  await page.mouse.move(stick.x, stick.y - 64, { steps: 6 });
  await page.mouse.up();
  await advance(0.3);
  if ((await auto()) !== 'off') {
    throw new Error('a full-forward push engaged Auto on its own');
  }

  // Reaching the lock only ARMS it — sliding back out is a free
  // change of mind.
  await page.mouse.move(stick.x, stick.y);
  await page.mouse.down();
  await page.mouse.move(stick.x, stick.y - 135, { steps: 10 });
  await advance(0.3);
  if ((await auto()) !== 'ready') {
    throw new Error('the lock zone did not mark Auto ready');
  }
  await page.mouse.move(stick.x, stick.y - 80, { steps: 6 });
  await page.mouse.up();
  await advance(0.3);
  if ((await auto()) === 'active') {
    throw new Error('leaving the lock before release still engaged Auto');
  }

  // The whole gesture: out to the lock, released there.
  await page.mouse.move(stick.x, stick.y);
  await page.mouse.down();
  await page.mouse.move(stick.x, stick.y - 135, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await advance(0.3);
  if ((await auto()) !== 'active') {
    throw new Error('releasing inside the lock did not engage Auto');
  }

  const before = await where();
  await advance(1.2);
  const carried = gap(await where(), before);
  if (carried < 2) throw new Error(`Auto did not carry her: ${carried.toFixed(2)}`);

  // Sidestepping under Auto must not cancel it. Do it with a REAL
  // thumb, not the D key: a key gives exactly y = 0, which no cancel
  // rule however sloppy could ever trip, so it proves nothing. A thumb
  // aiming sideways lands around x 0.9 / y 0.09, and that is the case
  // an over-eager cone kills.
  await page.mouse.move(stick.x, stick.y);
  await page.mouse.down();
  await page.mouse.move(stick.x + 58, stick.y - 6, { steps: 6 });
  await advance(0.5);
  const wobbled = await auto();
  await page.mouse.up();
  await page.waitForTimeout(200);
  if (wobbled !== 'active') throw new Error('a wobbly sidestep cancelled Auto');

  await page.keyboard.down('KeyD');
  await advance(0.5);
  const stillAuto = await auto();
  await page.keyboard.up('KeyD');
  if (stillAuto !== 'active') throw new Error('a sidestep cancelled Auto');

  // A clear forward push takes manual control back.
  await page.keyboard.down('KeyW');
  await advance(0.4);
  const handedBack = await auto();
  await page.keyboard.up('KeyW');
  if (handedBack !== 'off') throw new Error('a clear forward push did not cancel Auto');

  // Desktop parity: a keyboard cannot drag past a rim, so Auto has a key.
  await page.keyboard.press('Equal');
  await advance(0.3);
  if ((await auto()) !== 'active') throw new Error('the Auto key did not engage it');
  await page.keyboard.press('Equal');
  await advance(0.3);
  if ((await auto()) !== 'off') throw new Error('the Auto key did not turn it off again');

  // And the pace keys must not be the camera keys: binding both to Q/E
  // meant a look-around changed her speed, which switched the low-speed
  // catch-up back on and steered her.
  await island(() => window.__island.setPace('walk'));
  await page.keyboard.press('KeyQ');
  await advance(0.3);
  if ((await island(() => window.__island.pace())) !== 'walk') {
    throw new Error('a camera key changed the pace');
  }
  await page.keyboard.press('Digit3');
  await advance(0.3);
  if ((await island(() => window.__island.pace())) !== 'run') {
    throw new Error('the pace keys did not pick a pace');
  }

  // ── Sprint: costs stamina, and exhaustion does not stop her ──────
  await island(() => window.__island.setPace('run'));
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await advance(1);
  const sprint = await island(() => ({
    speed: window.__island.speed(),
    stamina: window.__island.stamina(),
  }));
  if (sprint.stamina >= 1) throw new Error('sprinting cost no stamina');
  if (sprint.speed <= 12.5) {
    throw new Error(`a sprint was no faster than a run: ${sprint.speed.toFixed(1)}`);
  }

  // Picking a pace MID-SPRINT has to take. Sprint raises the ceiling
  // over whatever is selected, so leaving it on made every pace tap
  // look ignored: she stayed at a sprint until the reserve ran out.
  await page.click('[aria-label="crawl"]');
  await advance(1.5);
  const obeyed = await island(() => window.__island.speed());
  if (obeyed > 4) {
    throw new Error(`picking a pace mid-sprint was ignored: ${obeyed.toFixed(1)}`);
  }
  await island(() => window.__island.setPace('run'));
  await page.keyboard.up('Shift');
  await advance(0.3);
  await page.keyboard.down('Shift');
  await advance(1);
  // Wait for the bar itself rather than guessing at a duration: the
  // reserve refills, so a fixed wait races its re-arm mark and the
  // check passes or fails on timing rather than on behaviour.
  await page.waitForFunction(
    () => window.__island.stamina() <= 0.001,
    null,
    { timeout: 120000 },
  );
  // Long enough for the ease to actually land on the pace: measured a
  // frame or two after exhaustion she is at 12.7 and still falling,
  // which is eased off, not failed.
  await advance(1.5);
  const after = await island(() => ({
    speed: window.__island.speed(),
    stamina: window.__island.stamina(),
    pace: window.__island.pace(),
    sprinting: window.__island.sprinting(),
    auto: window.__island.auto(),
  }));
  const spent = after.speed;
  if (spent > 12.5) {
    throw new Error(
      `an exhausted sprint never eased off: ${JSON.stringify(after)}`,
    );
  }
  if (spent < 1) throw new Error('exhaustion stopped her — it must fall back to the pace');
  // And a held key must not pick the sprint back up on its own once
  // the reserve creeps over its re-arm mark.
  await advance(5);
  const resumed = await island(() => window.__island.speed());
  if (resumed > 12.5) {
    throw new Error(`a held sprint key re-armed itself: ${resumed.toFixed(1)}`);
  }
  await page.keyboard.up('Shift');
  await page.keyboard.up('KeyW');

  // And the bar comes back on its own — a bar that only falls is a trap.
  const dry = await island(() => window.__island.stamina());
  await advance(2);
  if ((await island(() => window.__island.stamina())) <= dry) {
    throw new Error('stamina did not recover at rest');
  }

  // ── Camera: independent, and only leads her when she is slow ─────
  // Compare camera positions rather than pixels: the WebGL canvas has
  // no preserved drawing buffer, so toDataURL reads back blank and the
  // check would pass or fail for reasons unrelated to the camera.
  const orbit = () =>
    page.evaluate(() => {
      const c = window.__island.cameraAt();
      const a = window.__island.where();
      return Math.atan2(c[0] - a[0], c[2] - a[2]);
    });
  const arc = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  const restYaw = await orbit();
  await page.keyboard.down('KeyE');
  await advance(1);
  await page.keyboard.up('KeyE');
  await advance(0.5);
  if (arc(await orbit(), restYaw) < 0.2) {
    throw new Error('the look control barely moved the camera');
  }

  // STEERING IS LOOKING. While she is driven, swinging the view must
  // bring her body round with it — there is no turn control at all, so
  // if this fails she cannot change direction by any means.
  await island(() => window.__island.setPace('walk'));
  await page.keyboard.down('KeyW');
  await advance(0.6);
  const driving = await bearing();
  await page.keyboard.down('KeyQ');
  await advance(1);
  await page.keyboard.up('KeyQ');
  await advance(0.4);
  const steered = arc(await bearing(), driving);
  await page.keyboard.up('KeyW');
  if (steered < 0.5) {
    throw new Error(`looking did not steer her while driven: ${steered.toFixed(3)} rad`);
  }

  // At rest she is left alone inside the deadzone: you can look well
  // round her and she just watches you over her shoulder.
  await advance(2);
  const idle = await bearing();
  // Swing the view to a FRACTION OF THE DEADZONE rather than for a
  // fixed time. A hard-coded duration silently stops being a "small
  // look" the moment either the deadzone or the key rate is retuned —
  // which is exactly what happened when the deadzone came down to 30.
  const deadzone = await island(() => window.__island.deadzone());
  await page.keyboard.down('KeyE');
  await page.waitForFunction((want) => {
    const c = window.__island.cameraAt();
    const a = window.__island.where();
    // The camera sits OPPOSITE her, so the heading it looks along is
    // half a turn from its bearing. Getting this backwards waits for
    // the camera to reach her nose, which never happens.
    const view = Math.atan2(c[0] - a[0], c[2] - a[2]) + Math.PI;
    const off = view - window.__island.bearing();
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) >= want;
  }, deadzone * 0.6, { timeout: 60000 }).catch(() => {
    throw new Error('the view never swung to a fraction of the deadzone');
  });
  await page.keyboard.up('KeyE');
  await advance(1);
  const shrugged = arc(await bearing(), idle);
  if (shrugged > 0.05) {
    throw new Error(`a look inside the deadzone turned her: ${shrugged.toFixed(3)} rad`);
  }

  // Her legs have to be moving while she does it. Turning on the spot
  // with six frozen legs is most of why a rotation read as a slide.
  const strideBefore = await island(() => window.__island.stride());
  // Past it she does come round — but only to the edge of the deadzone.
  const before2 = await bearing();
  await page.keyboard.down('KeyE');
  await advance(2);
  await page.keyboard.up('KeyE');
  await advance(2);
  const cameRound = arc(await bearing(), before2);
  if (cameRound < 0.2) {
    throw new Error(`a long look never brought her round: ${cameRound.toFixed(3)} rad`);
  }
  const strode = (await island(() => window.__island.stride())) - strideBefore;
  if (strode <= 0) throw new Error('she turned on the spot with her legs frozen');

  // ── Settings ─────────────────────────────────────────────────────
  // The panel exists so a feel argument can be settled on the phone
  // rather than by a build, so what matters is that moving a dial
  // actually reaches the game.
  await page.click('[data-ui="settings"]');
  await page.waitForSelector('[data-ui="settings-panel"]', { state: 'visible' });
  // The build has to identify itself. Testing from a deployed page
  // with nothing on screen to name it means the honest answer to "is
  // this the new one?" is always "probably".
  const stamped = await page.evaluate(() => ({
    version: document.querySelector('[data-ui="version"]')?.textContent ?? '',
    build: document.querySelector('[data-ui="build"]')?.textContent ?? '',
  }));
  if (!/v\d+\.\d+\.\d+/.test(stamped.version)) {
    throw new Error(`the panel shows no version: ${JSON.stringify(stamped.version)}`);
  }
  if (!stamped.build.trim() || stamped.build.includes('undefined')) {
    throw new Error(`the panel shows no build stamp: ${JSON.stringify(stamped.build)}`);
  }

  const wasFov = await island(() => window.__island.fov());
  await page.evaluate(() => {
    const slider = document.querySelector('input[data-dial="fov"]');
    slider.value = String(Number(slider.value) + 20);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await advance(0.3);
  const nowFov = await island(() => window.__island.fov());
  if (Math.abs(nowFov - wasFov) < 5) {
    throw new Error(`moving the FOV dial did not reach the camera: ${wasFov} -> ${nowFov}`);
  }
  // And it must persist, or it is a toy rather than a setting.
  const kept = await page.evaluate(
    () => JSON.parse(localStorage.getItem('traddomium.settings') ?? '{}').fov,
  );
  if (kept !== nowFov) throw new Error(`the FOV was not saved: ${kept} against ${nowFov}`);
  await page.evaluate(() => {
    const slider = document.querySelector('input[data-dial="fov"]');
    slider.value = '58';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-ui="settings"]');
  await advance(0.3);

  // ── Rotation ─────────────────────────────────────────────────────
  // Turning a phone fires resize before the viewport has settled, so a
  // handler that trusts the event reads the old size and strands the
  // canvas — which is what landscape -> portrait -> landscape used to do.
  // Poll rather than sample once. The resize is answered on the next
  // frame, and a frame here costs hundreds of milliseconds, so a fixed
  // wait measures whether the renderer was quick rather than whether
  // the canvas tracks its host.
  const fitted = async (label) => {
    const measure = () => page.evaluate(() => {
      const c = document.querySelector('canvas');
      return { cw: c.clientWidth, ch: c.clientHeight, vw: innerWidth, vh: innerHeight };
    });
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return Math.abs(c.clientWidth - innerWidth) <= 2
        && Math.abs(c.clientHeight - innerHeight) <= 2;
    }, null, { timeout: 30000 }).catch(async () => {
      const box = await measure();
      throw new Error(
        `canvas did not track the viewport in ${label}: `
        + `${box.cw}x${box.ch} against ${box.vw}x${box.vh}`,
      );
    });
  };

  await page.setViewportSize({ width: 430, height: 932 });
  await fitted('portrait');
  // Poll rather than sample once: the gate deliberately waits for the
  // viewport to hold still, and a frame here is worth hundreds of ms
  // under a software renderer.
  await page.waitForFunction(
    () => [...document.querySelectorAll('[role="alertdialog"]')]
      .some((el) => getComputedStyle(el).display !== 'none'),
    { timeout: 10000 },
  ).catch(() => { throw new Error('portrait did not ask the player to rotate'); });

  await page.setViewportSize({ width: 932, height: 430 });
  await fitted('back in landscape');
  await page.waitForFunction(
    () => [...document.querySelectorAll('[role="alertdialog"]')]
      .every((el) => getComputedStyle(el).display === 'none'),
    { timeout: 10000 },
  ).catch(() => { throw new Error('the rotate prompt stayed up in landscape'); });

  // The case the observer exists for: the canvas host changes size
  // WITHOUT a trustworthy window resize event.
  await page.evaluate(() => {
    const app = document.getElementById('app');
    app.style.right = '200px';
    app.style.bottom = '100px';
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    const app = document.getElementById('app');
    return Math.abs(c.clientWidth - app.clientWidth) <= 2
      && Math.abs(c.clientHeight - app.clientHeight) <= 2;
  }, null, { timeout: 30000 }).catch(() => {});
  const squeezed = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const app = document.getElementById('app');
    return {
      cw: c.clientWidth, ch: c.clientHeight,
      hw: app.clientWidth, hh: app.clientHeight,
    };
  });
  if (Math.abs(squeezed.cw - squeezed.hw) > 2 || Math.abs(squeezed.ch - squeezed.hh) > 2) {
    throw new Error(
      'canvas ignored a host resize that fired no window event: '
      + `${squeezed.cw}x${squeezed.ch} against ${squeezed.hw}x${squeezed.hh}`,
    );
  }
  await page.evaluate(() => {
    const app = document.getElementById('app');
    app.style.right = '';
    app.style.bottom = '';
  });
  await page.waitForTimeout(500);

  // ── Layout ───────────────────────────────────────────────────────
  const layout = async (label) => {
    await page.waitForTimeout(500);
    const found = await page.evaluate(() => {
      const strays = [];
      // [data-ui] covers the readouts too — the vitals cluster is not a
      // control, but it is still a panel that must not run off a small
      // window. The settings panel is display:none until opened, so it
      // measures zero and is skipped below rather than needing a case.
      const controls = 'button, [role="alertdialog"], [data-control], [data-ui]';
      for (const el of document.querySelectorAll(controls)) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.top < -1 || box.bottom > innerHeight + 1
          || box.left < -1 || box.right > innerWidth + 1) {
          strays.push(`${el.dataset.control ?? el.dataset.ui ?? el.getAttribute('aria-label') ?? el.tagName} `
            + `at ${Math.round(box.top)}..${Math.round(box.bottom)}`);
        }
      }
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const hits = (a, b) => Boolean(a && b
        && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom);
      const pace = box('[data-control="pace"]');
      return {
        strays,
        // Both left-thumb controls must sit where the left thumb is.
        paceGap: innerHeight - pace.bottom,
        stickGap: innerHeight - box('[data-control="stick"]').bottom,
        laneOnPace: hits(box('[data-control="auto-lane"]'), pace),
        vitalsOnPace: hits(box('[data-ui="vitals"]'), box('[data-ui="pace-rows"]')),
        stickOnPace: hits(box('[data-control="stick"]'), pace),
        // The action controls land here later; nothing may creep in.
        intoTheRight: [...document.querySelectorAll('[data-control]')]
          .some((el) => el.getBoundingClientRect().right > innerWidth * 0.66),
      };
    });

    if (found.strays.length) {
      throw new Error(`controls off screen in ${label}:\n  ${found.strays.join('\n  ')}`);
    }
    if (found.stickGap > 60 || found.paceGap > 60) {
      throw new Error(
        `controls float off the bottom in ${label}: `
        + `stick ${Math.round(found.stickGap)}px, pace ${Math.round(found.paceGap)}px`,
      );
    }
    if (found.laneOnPace) throw new Error(`the Auto lane covers the pace column in ${label}`);
    if (found.vitalsOnPace) throw new Error(`the vitals cluster covers the pace rows in ${label}`);
    if (found.stickOnPace) throw new Error(`the stick covers the pace column in ${label}`);
    if (found.intoTheRight) {
      throw new Error(`a movement control reached into the action area in ${label}`);
    }
  };

  await layout('landscape');
  // A short landscape window, the shape a browser toolbar leaves.
  await page.setViewportSize({ width: 932, height: 330 });
  await layout('a toolbar-height landscape window');
  await page.setViewportSize({ width: 844, height: 280 });
  await layout('a very short window');
  await page.setViewportSize({ width: 932, height: 430 });
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'probe-island.png' });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);

  console.log(
    `probe:island OK — spawned ${start.ground.toFixed(1)} units above the sea; `
    + `a pace alone moves nothing, a held push carried her ${covered.toFixed(1)} units `
    + 'and releasing stopped her; reverse and sidestep work; '
    + 'drag-to-lock arms, un-arms and engages, and survives a sidestep; '
    + `sprint reached ${sprint.speed.toFixed(1)} and fell back to ${spent.toFixed(1)}; `
    + `looking steered her ${steered.toFixed(2)} rad while driven and left her `
    + 'alone at rest inside the deadzone; '
    + `the settings panel says ${stamped.version.replace('TRADDOMIUM', '').trim()} `
    + `(${stamped.build}), reaches the camera and persists; `
    + 'survives a rotation and fits every window\n'
    + `  ${start.triangles.toLocaleString()} triangles in ${start.drawCalls} draw calls`,
  );
} finally {
  await browser.close();
}
