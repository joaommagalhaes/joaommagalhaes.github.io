/* ──────────────────────────────────────────────────────────────────────────
   Easter egg — Konami code (↑↑↓↓←→←→BA) launches a starship that flies OVER
   the page itself. The DOM stays visible; steering the ship up and down
   scrolls the whole document, so you literally fly across the CV. Purpose:
   every section drops a pulsing beacon anchored to its DOM position —
   collect all of them (a compass arrow points to the nearest one) to finish
   the run and trigger the finale.

   Rendering: a second, transparent WebGL canvas overlaid above the content
   (the background cosmos keeps its own canvas + camera untouched). The ship
   is hand-composed from primitives with glowing accent edge-lines — no
   model imports, same "hand-written" rule as the rest of the site. The
   background particles still part around the ship via window.__scene.shipPos.
   Inert under reduced-motion or if the 3D scene never booted.
   ────────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reducedMotion) {
  (function starship() {
    const t = (key, fallback) => {
      const lang = document.documentElement.lang;
      return (typeof locales !== 'undefined' && locales[lang] && locales[lang][key]) || fallback;
    };

    const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    let seqAt = 0;

    /* one beacon per site section, anchored to the element's document position */
    const BEACON_IDS = ['about', 'experience', 'ai', 'skills', 'education', 'languages', 'offscreen', 'lab', 'travel'];

    const ACCENT = 0x6c9bff, AMBER = 0xffc46b, GREEN = 0x5fd39a;
    const HULL = 0x141a26, HULL_LIGHT = 0x232c40;

    /* flight tuning — page-pixel units */
    const ACCEL = 2600, DAMP = 2.2, MAX_SPEED = 620, BOOST_SPEED = 1250;
    const COLLECT_R = 90, TRAIL_N = 90;

    let sys = null;          // lazily-built render system — zero cost until first launch
    let flying = false;
    let rafId = null, lastT = 0;
    const keys = new Set();
    const state = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, bank: 0, born: 0 };
    let beacons = [];        // { id, el, x, y, group, ring, glow, hit, hitAt }
    let collected = 0, finished = false;
    let hintEl = null, hintTimer = null, hudEl = null, hudCount = null, compassEl = null;

    /* background-scene world mapping (same fov/CAM_Z math as scene.js) so
       the cosmos particles part around the ship's screen position */
    const BG_HALF_H = Math.tan((55 / 2) * Math.PI / 180) * 10;
    const bgShipPos = new THREE.Vector3();

    /* ── build ───────────────────────────────────────────────────────── */

    function glowSprite(S, color, size, opacity) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(S.spriteCv), color,
        transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      sp.scale.set(size, size, 1);
      return sp;
    }

    /* the ship: a twin-engine delta fighter, nose along +X, page-pixel
       scale. Dark multi-segment hull + glowing accent edge-lines — the
       TRON look that matches the site's additive-glow cosmos. Animated
       parts are returned so the flight loop can drive them: ailerons
       deflect with bank, flame cones stretch with throttle, RCS thrusters
       puff on turns, a tail strobe blinks. */
    function buildShip(S) {
      const group = new THREE.Group();
      const edges = (mesh, color = ACCENT, opacity = 0.9) => {
        const l = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 18),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity })
        );
        mesh.add(l);
        return l;
      };
      // DoubleSide: port-side parts are mirrored (scale.y = -1) extrudes and
      // banking exposes the back faces of the flat shapes
      const mat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); return mesh; };

      /* ── fuselage: four segments, nose to tail, with panel-line edges ── */
      const nose = new THREE.Mesh(new THREE.ConeGeometry(4.2, 14, 10), mat(HULL_LIGHT));
      nose.rotation.z = -Math.PI / 2; // apex → +X
      edges(nose, ACCENT, 0.7);
      add(nose, 27, 0, 0);

      const fwd = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6.5, 12, 10), mat(HULL));
      fwd.rotation.z = Math.PI / 2;
      edges(fwd, ACCENT, 0.5);
      add(fwd, 14, 0, 0);

      const mid = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.5, 18, 10), mat(HULL));
      mid.rotation.z = Math.PI / 2;
      edges(mid, ACCENT, 0.5);
      add(mid, -1, 0, 0);

      const rear = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 5.2, 10, 10), mat(HULL_LIGHT));
      rear.rotation.z = Math.PI / 2;
      edges(rear, ACCENT, 0.6);
      add(rear, -15, 0, 0);

      // dorsal spine ridge along the back
      const spine = new THREE.Mesh(new THREE.BoxGeometry(26, 1.8, 2.2), mat(HULL_LIGHT));
      edges(spine, ACCENT, 0.5);
      add(spine, 0, 0, 6.2);

      /* ── canopy: dark glass, glowing rim, inner light ── */
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(4.4, 12, 8), mat(0x0d1420));
      canopy.scale.set(2, 1, 0.78);
      edges(canopy, ACCENT, 0.85);
      add(canopy, 11, 0, 5.4);
      const canopyGlow = glowSprite(S, ACCENT, 15, 0.4);
      canopyGlow.position.set(11, 0, 7.5);
      group.add(canopyGlow);

      /* ── wing-root intakes ── */
      [1, -1].forEach((side) => {
        const intake = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 3.4), mat(HULL_LIGHT));
        edges(intake, ACCENT, 0.6);
        add(intake, 3, side * 7.6, 0.5);
      });

      /* ── wings: main delta + raised strake + deflecting aileron + tip
             rail with nav light (red port / green starboard) ── */
      const wingShape = new THREE.Shape();
      wingShape.moveTo(11, 0);
      wingShape.lineTo(-17, 31);
      wingShape.lineTo(-15, 5);
      wingShape.lineTo(11, 0);
      const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 1.8, bevelEnabled: false });

      const strakeShape = new THREE.Shape();
      strakeShape.moveTo(13, 0);
      strakeShape.lineTo(-6, 15);
      strakeShape.lineTo(-4, 2.5);
      strakeShape.lineTo(13, 0);
      const strakeGeo = new THREE.ExtrudeGeometry(strakeShape, { depth: 1, bevelEnabled: false });

      const ailerons = [];
      [1, -1].forEach((side) => {
        const wing = new THREE.Mesh(wingGeo, mat(HULL));
        wing.scale.y = side;
        wing.position.z = -1;
        edges(wing);
        group.add(wing);

        const strake = new THREE.Mesh(strakeGeo, mat(HULL_LIGHT));
        strake.scale.y = side;
        strake.position.z = 0.4;
        edges(strake, ACCENT, 0.6);
        group.add(strake);

        // aileron: hinged flap at the trailing edge — geometry shifted so
        // its local origin is the hinge line, rotation.y = deflection
        const ailGeo = new THREE.BoxGeometry(5.5, 10, 0.9);
        ailGeo.translate(-2.75, 0, 0);
        const aileron = new THREE.Mesh(ailGeo, mat(HULL_LIGHT));
        edges(aileron, ACCENT, 0.8);
        add(aileron, -13.5, side * 17, -0.2);
        ailerons.push({ mesh: aileron, side });

        // wingtip rail + aviation nav light: red on port (+Y), green starboard
        const rail = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.6), mat(HULL_LIGHT));
        add(rail, -14.5, side * 29.5, 0);
        const tip = glowSprite(S, side > 0 ? 0xff5a6a : GREEN, 9, 0.95);
        tip.position.set(-16, side * 30.5, 1);
        group.add(tip);
      });

      /* ── tail: twin canted fins + horizontal stabilizers + strobe ── */
      const finShape = new THREE.Shape();
      finShape.moveTo(-9, 0);
      finShape.lineTo(-19, 14);
      finShape.lineTo(-17, 1);
      finShape.lineTo(-9, 0);
      const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 1.4, bevelEnabled: false });
      [1, -1].forEach((side) => {
        const fin = new THREE.Mesh(finGeo, mat(HULL_LIGHT));
        fin.rotation.x = Math.PI / 2 - side * 0.38; // canted out like a modern fighter
        fin.position.set(0, side * 4.5, 0);
        edges(fin);
        group.add(fin);
      });

      const stabShape = new THREE.Shape();
      stabShape.moveTo(0, 0);
      stabShape.lineTo(-9, 13);
      stabShape.lineTo(-7.5, 2);
      stabShape.lineTo(0, 0);
      const stabGeo = new THREE.ExtrudeGeometry(stabShape, { depth: 1, bevelEnabled: false });
      [1, -1].forEach((side) => {
        const stab = new THREE.Mesh(stabGeo, mat(HULL));
        stab.scale.y = side;
        stab.position.set(-12, side * 2, -1.5);
        edges(stab, ACCENT, 0.7);
        group.add(stab);
      });

      const strobe = glowSprite(S, 0xffffff, 8, 0);
      strobe.position.set(-17, 0, 11);
      group.add(strobe);

      /* ── engines: nacelle + intake ring + nozzle + animated flame cone ── */
      const exhausts = [];   // soft glow sprites
      const flames = [];     // stretching cones
      [1, -1].forEach((side) => {
        const y = side * 8.5;
        const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.9, 13, 10), mat(HULL_LIGHT));
        nacelle.rotation.z = Math.PI / 2;
        edges(nacelle, ACCENT, 0.55);
        add(nacelle, -13, y, -1.6);

        const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.7, 8, 20), mat(HULL));
        ring.rotation.y = Math.PI / 2; // face +X
        edges(ring, ACCENT, 0.9);
        add(ring, -6.5, y, -1.6);

        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 2.3, 4, 10), mat(0x0b0e15));
        nozzle.rotation.z = Math.PI / 2;
        edges(nozzle, AMBER, 0.8);
        add(nozzle, -21, y, -1.6);

        // flame: additive cone anchored at its base so throttle stretches it
        // backward only; the loop drives scale.y (pre-rotation length axis)
        const flameGeo = new THREE.ConeGeometry(2.4, 9, 8);
        flameGeo.translate(0, 4.5, 0); // base at local origin, apex at +9
        const flame = new THREE.Mesh(
          flameGeo,
          new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        flame.rotation.z = Math.PI / 2; // apex → -X (trailing)
        add(flame, -23, y, -1.6);
        flames.push(flame);

        const glow = glowSprite(S, ACCENT, 15, 0.8);
        glow.position.set(-24, y, -1.6);
        group.add(glow);
        exhausts.push(glow);
      });

      /* ── nose RCS thrusters — puff opposite the turn direction ── */
      const rcs = [1, -1].map((side) => {
        const puff = glowSprite(S, 0xd7e4ff, 10, 0);
        puff.position.set(20, side * 5.5, 1);
        group.add(puff);
        return { sprite: puff, side, k: 0 };
      });

      /* ── antenna + soft under-glow ── */
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 4), mat(HULL_LIGHT));
      antenna.rotation.x = Math.PI / 2;
      add(antenna, 18, 0, 6);
      const antennaTip = glowSprite(S, AMBER, 5, 0.9);
      antennaTip.position.set(18, 0, 10);
      group.add(antennaTip);

      const aura = glowSprite(S, ACCENT, 120, 0.15);
      aura.position.z = -8;
      group.add(aura);

      group.scale.setScalar(1.25);
      group.visible = false;
      return { group, exhausts, flames, ailerons, strobe, rcs };
    }

    function buildBeacon(S, color) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(26, 2.4, 8, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      g.add(ring);
      const core = glowSprite(S, color, 46, 0.8);
      g.add(core);
      return { group: g, ring, core };
    }

    function buildSystem() {
      const S = window.__scene;
      const canvas = document.createElement('canvas');
      canvas.id = 'ship-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

      const scene = new THREE.Scene();
      // orthographic, 1 unit = 1 CSS px, origin top-left, y down (matches page coords)
      const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -300, 300);

      const ship = buildShip(S);
      scene.add(ship.group);

      // engine trail — ring buffer of fading points (px-sized, no attenuation)
      const trailPos = new Float32Array(TRAIL_N * 3);
      const trailCol = new Float32Array(TRAIL_N * 3);
      const trailAge = new Float32Array(TRAIL_N).fill(1);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
      trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
      const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
        size: 9, sizeAttenuation: false, map: new THREE.CanvasTexture(S.spriteCv),
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      scene.add(trail);

      sys = { renderer, scene, camera, canvas, ship, trail, trailPos, trailCol, trailAge, trailIdx: 0, trailClock: 0 };
      resize();
      addEventListener('resize', () => { if (sys) { resize(); layoutBeacons(); } });
    }

    function resize() {
      const w = innerWidth, h = innerHeight;
      sys.renderer.setSize(w, h);
      sys.camera.left = 0; sys.camera.right = w;
      sys.camera.top = 0; sys.camera.bottom = -h;
      sys.camera.updateProjectionMatrix();
    }

    /* ── beacons ─────────────────────────────────────────────────────── */

    function makeBeacons() {
      const S = window.__scene;
      beacons = BEACON_IDS.map((id, i) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const b = buildBeacon(S, i % 2 ? AMBER : ACCENT);
        sys.scene.add(b.group);
        return { id, el, x: 0, y: 0, ...b, hit: false, hitAt: 0 };
      }).filter(Boolean);
      layoutBeacons();
    }

    function layoutBeacons() {
      for (const b of beacons) {
        const r = b.el.getBoundingClientRect();
        b.x = Math.max(70, Math.min(innerWidth - 70, r.left + r.width / 2 + scrollX));
        b.y = r.top + scrollY + Math.min(r.height / 2, 60);
      }
    }

    function collect(b, now) {
      b.hit = true;
      b.hitAt = now;
      collected++;
      b.el.classList.add('beacon-hit');
      setTimeout(() => b.el.classList.remove('beacon-hit'), 1400);
      updateHud();
      if (collected === beacons.length && !finished) {
        finished = true;
        showHint(t('ship.done', 'cosmos explored — thanks for flying ✦'), 5000);
        if (window.__scene && window.__scene.party) window.__scene.party();
      }
    }

    /* ── overlay chrome (hint, HUD, compass) ─────────────────────────── */

    function showHint(text, ms) {
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = 'ship-hint';
        document.body.appendChild(hintEl);
      }
      hintEl.textContent = text;
      requestAnimationFrame(() => hintEl.classList.add('on'));
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove('on'), ms);
    }

    function updateHud() {
      if (!hudEl) {
        hudEl = document.createElement('div');
        hudEl.id = 'ship-hud';
        hudCount = document.createElement('b');
        hudEl.append('✦ ', hudCount, ' · Esc');
        document.body.appendChild(hudEl);
      }
      hudCount.textContent = collected + '/' + beacons.length + ' ' + t('ship.beacons', 'beacons');
      hudEl.classList.add('on');
    }

    /* arrow at the edge of the viewport pointing at the nearest uncollected
       beacon — the anti-"where do I go?" device */
    function updateCompass() {
      if (!compassEl) {
        compassEl = document.createElement('div');
        compassEl.id = 'ship-compass';
        compassEl.textContent = '➤';
        document.body.appendChild(compassEl);
      }
      let best = null, bestD = Infinity;
      for (const b of beacons) {
        if (b.hit) continue;
        const dx = b.x - state.x, dy = b.y - state.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = b; }
      }
      if (!best) { compassEl.classList.remove('on'); return; }

      const vx = best.x - scrollX, vy = best.y - scrollY;
      const onScreen = vx > 40 && vx < innerWidth - 40 && vy > 40 && vy < innerHeight - 40;
      if (onScreen) { compassEl.classList.remove('on'); return; }

      const cx = innerWidth / 2, cy = innerHeight / 2;
      const ang = Math.atan2(vy - cy, vx - cx);
      const margin = 34;
      // clamp a point along the direction ray to the viewport edge box
      const tEdge = Math.min(
        Math.abs((cx - margin) / Math.cos(ang) || Infinity),
        Math.abs((cy - margin) / Math.sin(ang) || Infinity)
      );
      compassEl.style.transform =
        `translate(${cx + Math.cos(ang) * tEdge - 12}px, ${cy + Math.sin(ang) * tEdge - 12}px) rotate(${ang}rad)`;
      compassEl.classList.add('on');
    }

    /* ── flight loop ─────────────────────────────────────────────────── */

    const toScene = (px, py) => ({ x: px - scrollX, y: -(py - scrollY) }); // page → overlay world

    function tick(now) {
      if (!flying) return;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      // input → acceleration in page coords (y down)
      const ax = ((keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0));
      const ay = ((keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0));
      const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');

      state.vx += ax * ACCEL * dt;
      state.vy += ay * ACCEL * dt;
      state.vx -= state.vx * DAMP * dt;
      state.vy -= state.vy * DAMP * dt;
      const sp = Math.hypot(state.vx, state.vy);
      const cap = boosting ? BOOST_SPEED : MAX_SPEED;
      if (sp > cap) { state.vx *= cap / sp; state.vy *= cap / sp; }

      state.x += state.vx * dt;
      state.y += state.vy * dt;

      // stay on the page
      const docH = document.documentElement.scrollHeight;
      if (state.x < 40) { state.x = 40; state.vx = Math.abs(state.vx) * 0.4; }
      if (state.x > innerWidth - 40) { state.x = innerWidth - 40; state.vx = -Math.abs(state.vx) * 0.4; }
      if (state.y < 50) { state.y = 50; state.vy = Math.abs(state.vy) * 0.4; }
      if (state.y > docH - 50) { state.y = docH - 50; state.vy = -Math.abs(state.vy) * 0.4; }

      // the page follows the ship: keep it inside a vertical comfort band
      const bandTop = scrollY + innerHeight * 0.32;
      const bandBot = scrollY + innerHeight * 0.68;
      let target = scrollY;
      if (state.y < bandTop) target = state.y - innerHeight * 0.32;
      else if (state.y > bandBot) target = state.y - innerHeight * 0.68;
      if (target !== scrollY) scrollTo(0, scrollY + (target - scrollY) * Math.min(1, 6 * dt));

      // orientation: face velocity, bank into turns, gentle idle hover
      if (sp > 40) {
        const desired = Math.atan2(-state.vy, state.vx); // scene y is up
        let d = desired - state.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        state.angle += d * Math.min(1, 8 * dt);
        state.bank += (d * 1.6 - state.bank) * Math.min(1, 6 * dt);
      } else {
        state.bank *= 1 - Math.min(1, 4 * dt);
      }

      const g = sys.ship.group;
      const spos = toScene(state.x, state.y);
      const hover = sp < 40 ? Math.sin(now * 0.003) * 3 : 0;
      g.position.set(spos.x, spos.y + hover, 20);
      g.rotation.set(0, 0, state.angle);
      g.rotateX(Math.max(-0.9, Math.min(0.9, state.bank)));
      const bornK = Math.min(1, (now - state.born) / 450);
      g.scale.setScalar(1.15 * (0.4 + 0.6 * bornK)); // materialize on entry

      // engines: flame cones stretch with throttle + boost, with a fast
      // organic flicker; exhaust glows brighten to match
      const throttle = Math.min(1, sp / MAX_SPEED);
      const flick = 0.9 + Math.sin(now * 0.045) * 0.08 + Math.random() * 0.07;
      const flameLen = Math.max(0.35, (0.55 + throttle * 0.75 + (boosting ? 1.4 : 0)) * flick);
      sys.ship.flames.forEach((f) => {
        f.scale.y = flameLen;
        f.material.opacity = 0.4 + throttle * 0.3 + (boosting ? 0.3 : 0);
      });
      const glowK = 0.45 + Math.sin(now * 0.02) * 0.1 + throttle * 0.25 + (boosting ? 0.35 : 0);
      sys.ship.exhausts.forEach((g) => { g.material.opacity = Math.min(1, glowK); });

      // control surfaces: ailerons deflect with bank (opposite pair)
      sys.ship.ailerons.forEach((a) => { a.mesh.rotation.y = state.bank * 0.55 * a.side; });

      // white anti-collision strobe on the tail
      sys.ship.strobe.material.opacity = (now % 1400) < 110 ? 1 : 0;

      // nose RCS thrusters puff against the turn, then decay
      sys.ship.rcs.forEach((r) => {
        const firing = (state.bank > 0.18 && r.side < 0) || (state.bank < -0.18 && r.side > 0);
        r.k = firing ? 1 : r.k * (1 - Math.min(1, 10 * dt));
        r.sprite.material.opacity = r.k * 0.85;
      });

      // trail
      sys.trailClock += dt;
      if (sys.trailClock > 0.022 && sp > 30) {
        sys.trailClock = 0;
        sys.trailIdx = (sys.trailIdx + 1) % TRAIL_N;
        const back = 26;
        const i3 = sys.trailIdx * 3;
        sys.trailPos[i3] = spos.x - Math.cos(state.angle) * back + (Math.random() - 0.5) * 6;
        sys.trailPos[i3 + 1] = spos.y - Math.sin(state.angle) * back + (Math.random() - 0.5) * 6;
        sys.trailPos[i3 + 2] = 10;
        sys.trailAge[sys.trailIdx] = 0;
      }
      for (let i = 0; i < TRAIL_N; i++) {
        sys.trailAge[i] = Math.min(1, sys.trailAge[i] + dt * 0.9);
        const b = (1 - sys.trailAge[i]) * (boosting ? 1.25 : 0.85);
        const i3 = i * 3;
        sys.trailCol[i3] = 0.42 * b; sys.trailCol[i3 + 1] = 0.61 * b; sys.trailCol[i3 + 2] = 1.0 * b;
      }
      sys.trail.geometry.attributes.position.needsUpdate = true;
      sys.trail.geometry.attributes.color.needsUpdate = true;

      // beacons: pulse, place in overlay space, collect on proximity
      for (const b of beacons) {
        const bp = toScene(b.x, b.y);
        b.group.position.set(bp.x, bp.y, 0);
        if (!b.hit) {
          const k = 1 + Math.sin(now * 0.004 + b.y) * 0.1;
          b.group.scale.setScalar(k);
          b.ring.rotation.z = now * 0.001;
          const dx = b.x - state.x, dy = b.y - state.y;
          if (dx * dx + dy * dy < COLLECT_R * COLLECT_R) collect(b, now);
        } else {
          // burst: expand + fade over 0.5s, then hide
          const k = Math.min(1, (now - b.hitAt) / 500);
          b.group.scale.setScalar(1 + k * 2.2);
          b.ring.material.opacity = 0.9 * (1 - k);
          b.core.material.opacity = 0.8 * (1 - k);
          b.group.visible = k < 1;
        }
      }

      // let the background cosmos part around the ship
      if (window.__scene) {
        const aspect = innerWidth / innerHeight;
        bgShipPos.set(
          ((state.x - scrollX) / innerWidth * 2 - 1) * BG_HALF_H * aspect,
          -((state.y - scrollY) / innerHeight * 2 - 1) * BG_HALF_H,
          0
        );
        window.__scene.shipPos = bgShipPos;
      }

      updateCompass();
      sys.renderer.render(sys.scene, sys.camera);
      rafId = requestAnimationFrame(tick);
    }

    /* ── enter / exit ────────────────────────────────────────────────── */

    function enterFlight() {
      const S = window.__scene;
      if (!S) return; // no WebGL, no flight
      if (!sys) buildSystem();
      if (!beacons.length || finished) {
        // fresh mission (first run, or replay after finishing)
        beacons.forEach((b) => sys.scene.remove(b.group));
        beacons = [];
        collected = 0;
        finished = false;
        makeBeacons();
      } else {
        layoutBeacons();
      }

      flying = true;
      state.x = innerWidth / 2;
      state.y = scrollY + innerHeight / 2;
      state.vx = state.vy = 0;
      state.angle = Math.PI / 2; // nose pointing up the page (scene y-up)
      state.bank = 0;
      state.born = performance.now();
      keys.clear();

      sys.ship.group.visible = true;
      sys.trailAge.fill(1);
      document.documentElement.classList.add('starship-mode');
      showHint(t('ship.hint', 'arrows to fly · collect the beacons ✦ · Esc to land'), 4200);
      updateHud();

      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function exitFlight() {
      flying = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      document.documentElement.classList.remove('starship-mode');
      sys.ship.group.visible = false;
      sys.renderer.render(sys.scene, sys.camera); // clear the overlay
      if (window.__scene) window.__scene.shipPos = null;
      if (hintEl) hintEl.classList.remove('on');
      if (hudEl) hudEl.classList.remove('on');
      if (compassEl) compassEl.classList.remove('on');
      clearTimeout(hintTimer);
    }

    /* ── input ───────────────────────────────────────────────────────── */

    addEventListener('keydown', (e) => {
      if (e.repeat) { if (flying && e.code.startsWith('Arrow')) e.preventDefault(); return; }
      if (flying) {
        if (e.code === 'Escape') { exitFlight(); return; }
        keys.add(e.code);
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
        return;
      }
      const palette = document.getElementById('palette');
      if (palette && !palette.hidden) return; // palette owns its arrow keys
      seqAt = e.code === SEQUENCE[seqAt] ? seqAt + 1 : (e.code === SEQUENCE[0] ? 1 : 0);
      if (seqAt === SEQUENCE.length) { seqAt = 0; enterFlight(); }
    });
    addEventListener('keyup', (e) => { if (flying) keys.delete(e.code); });
  })();
}
