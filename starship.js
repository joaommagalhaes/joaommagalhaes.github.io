/* ──────────────────────────────────────────────────────────────────────────
   Easter egg — Konami code (↑↑↓↓←→←→BA), or "fly" in the command palette,
   launches a starship that flies OVER the page itself. The DOM stays
   visible; steering the ship up and down scrolls the whole document, so
   you literally fly across the CV. It's an endless survival game in the
   spirit of Chrome's dinosaur: score climbs +1/s (+10 per beacon grabbed,
   ~3 always afloat), asteroids accumulate and speed up until one ends the
   run, R (or a tap) restarts instantly, best score persists in
   localStorage, and holding space burns a fuel bar for a speed boost.
   Pickups come in three kinds — ✦ beacon (points, chained collects build a
   ×combo), ◼ fuel cell (refills the boost tank), ◈ shield (rare; absorbs
   one asteroid hit) — with score popups, collect sparks, near-miss flashes
   and a crash shockwave for feedback.

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

    const ACCENT = 0x6c9bff, AMBER = 0xffc46b, GREEN = 0x5fd39a, RED = 0xff3b3b, VIOLET = 0xb18cff;
    const HULL = 0x141a26, HULL_LIGHT = 0x232c40;

    /* flight tuning — page-pixel units */
    const ACCEL = 2600, DAMP = 2.2, MAX_SPEED = 620, BOOST_SPEED = 1250;
    const COLLECT_R = 90, TRAIL_N = 90, SHIP_R = 22, TOUCH_MAX_D = 240;

    /* fuel: full burn drains it in ~2.5s, full recharge takes ~4s */
    const BOOST_DRAIN = 1 / 2.5, BOOST_REFILL = 1 / 4;
    const isMobile = matchMedia('(max-width: 760px)').matches;
    const isTouch = matchMedia('(pointer: coarse)').matches;

    /* endless-mode difficulty ramp: rocks accumulate and drift faster the
       longer you survive — the ramp restarts with every run */
    const BEACON_N = 3, BEACON_PTS = 10;
    const AST_START = 3;
    const AST_CAP = isMobile ? 8 : 14;   // fewer on small viewports
    const AST_ADD_EVERY = 15;            // seconds between extra rocks
    const AST_SPEED_RAMP = 0.004;        // +0.4%/s drift speed (+4% per 10s)
    const AST_SPEED_MAX = 2;             // capped at 2x

    let sys = null;          // lazily-built render system — zero cost until first launch
    let flying = false;
    let rafId = null, lastT = 0;
    const keys = new Set();
    const state = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, bank: 0, born: 0 };
    let beacons = [];        // BEACON_N reusable beacons, screen-space, relocated on collect
    let asteroids = [];      // { mesh, edgeMat, x, y, vx, vy, rvx, rvy, r, flashT }
    let hintEl = null, hintTimer = null, hudEl = null, hudCount = null, hudBest = null, fuelBar = null, shieldDot = null;
    let endEl = null, endTitle = null, endTime = null, endAgain = null;

    /* endless run state: the score arms on the first movement input, climbs
       +1/s (+BEACON_PTS per beacon), and freezes on the crash that ends the
       run; best score persists locally */
    let timerStart = null, score = 0, fuel = 1;
    let comboN = 0, lastCollectT = -1e9, shieldOn = false;
    let gameOver = false, goAt = 0, goX = 0, goY = 0, goFinal = 0, goNewBest = false, endShown = false;
    let bestScore = null;
    try { const b = parseInt(localStorage.getItem('starship-best-score'), 10); if (isFinite(b)) bestScore = b; } catch (e) { /* private mode etc — best just won't persist */ }

    /* touch: drag steers (thrust toward the touch point), double-tap toggles boost */
    let touchActive = false, touchX = 0, touchY = 0, touchBoostOn = false, lastTapT = 0;

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

    /* pickups: one pool of PICKUP-shaped groups; the type (and its look) is
       re-rolled on every respawn. A wireframe core spins inside the ring —
       ✦ beacon scores (×combo), ◼ fuel cell refills the boost tank,
       ◈ shield (rare) absorbs one asteroid hit. */
    const PICKUP_GEO = {
      beacon: new THREE.OctahedronGeometry(13),
      fuel: new THREE.BoxGeometry(17, 17, 17),
      shield: new THREE.IcosahedronGeometry(13, 0)
    };
    function buildPickup(S) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(26, 2.4, 8, 40),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 })
      );
      g.add(ring);
      const core = new THREE.Mesh(
        PICKUP_GEO.beacon,
        new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.85 })
      );
      g.add(core);
      const glow = glowSprite(S, ACCENT, 46, 0.8);
      g.add(glow);
      return { group: g, ring, core, glow };
    }
    function setPickupType(b, type) {
      b.type = type;
      const color = type === 'fuel' ? GREEN : type === 'shield' ? VIOLET : b.baseColor;
      b.core.geometry = PICKUP_GEO[type];
      b.core.material.color.setHex(color);
      b.ring.material.color.setHex(color);
      b.glow.material.color.setHex(color);
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

      // crash burst — glow sprites preallocated once, scattered outward from
      // the ship on game over with per-particle speed/size for a ragged blast
      const burst = Array.from({ length: 18 }, (_, i) => {
        const sp = glowSprite(S, i % 3 ? ACCENT : AMBER, 18, 0);
        sp.visible = false;
        scene.add(sp);
        return { sp, ang: 0, spd: 110 };
      });

      // crash shockwave ring — one reused mesh, scaled out while it fades
      const crashRing = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 48),
        new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      crashRing.visible = false;
      scene.add(crashRing);

      // collect sparks — small reusable radial burst at the pickup point
      const sparks = Array.from({ length: 9 }, () => {
        const sp = glowSprite(S, ACCENT, 12, 0);
        sp.visible = false;
        scene.add(sp);
        return { sp, ang: 0, spd: 0 };
      });

      // one-hit shield bubble, riding the ship group
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(38, 20, 14),
        new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      shield.visible = false;
      ship.group.add(shield);

      sys = {
        renderer, scene, camera, canvas, ship, trail, trailPos, trailCol, trailAge,
        trailIdx: 0, trailClock: 0, burst, crashRing, sparks, sparkT: -1e9, sparkX: 0, sparkY: 0, shield
      };
      resize();
      addEventListener('resize', () => { if (sys) { resize(); if (flying) beacons.forEach(placeBeacon); } });
    }

    function resize() {
      const w = innerWidth, h = innerHeight;
      sys.renderer.setSize(w, h);
      sys.camera.left = 0; sys.camera.right = w;
      sys.camera.top = 0; sys.camera.bottom = -h;
      sys.camera.updateProjectionMatrix();
    }

    /* ── beacons ─────────────────────────────────────────────────────── */
    /* endless: BEACON_N beacons live in screen space (like the asteroids);
       collecting one relocates the same object elsewhere in the viewport,
       so the pool never grows and nothing is left behind up the page */

    function placeBeacon(b) {
      const sx = state.x - scrollX, sy = state.y - scrollY;
      let x, y, tries = 6;
      do { // don't hand out a free +10 in the ship's lap
        x = 70 + Math.random() * (innerWidth - 140);
        y = 70 + Math.random() * (innerHeight - 140);
      } while (--tries && (x - sx) * (x - sx) + (y - sy) * (y - sy) < 220 * 220);
      b.x = x; b.y = y;
      b.hit = false; b.hitAt = 0;
      const roll = Math.random(); // shield is rare, and never offered twice
      setPickupType(b, !shieldOn && roll < 0.1 ? 'shield' : roll < 0.32 ? 'fuel' : 'beacon');
      b.ring.material.opacity = 0.9;
      b.core.material.opacity = 0.85;
      b.glow.material.opacity = 0.8;
      b.group.visible = true;
    }

    function makeBeacons() {
      const S = window.__scene;
      while (beacons.length < BEACON_N) {
        const b = buildPickup(S);
        b.baseColor = beacons.length % 2 ? AMBER : ACCENT;
        sys.scene.add(b.group);
        beacons.push({ x: 0, y: 0, ...b, hit: false, hitAt: 0 });
      }
      beacons.forEach(placeBeacon);
    }

    function sparkBurst(x, y, color, now) {
      sys.sparkT = now; sys.sparkX = x; sys.sparkY = y;
      for (const p of sys.sparks) {
        p.ang = Math.random() * Math.PI * 2;
        p.spd = 50 + Math.random() * 90;
        p.sp.material.color.setHex(color);
        p.sp.visible = true;
      }
    }

    function collect(b, now) {
      b.hit = true; // burst plays in tick(), then placeBeacon respawns it
      b.hitAt = now;
      if (b.type === 'fuel') {
        fuel = 1;
        popup(t('ship.fuel', 'fuel'), b.x, b.y, '#5fd39a');
      } else if (b.type === 'shield') {
        shieldOn = true;
        sys.shield.visible = true;
        popup(t('ship.shield', 'shield'), b.x, b.y, '#b18cff');
      } else {
        // chained collects (<4s apart) build a ×combo, capped at ×5
        comboN = now - lastCollectT < 4000 ? Math.min(5, comboN + 1) : 1;
        lastCollectT = now;
        const pts = BEACON_PTS * comboN;
        score += pts;
        popup('+' + pts + (comboN > 1 ? ' ×' + comboN : ''), b.x, b.y,
          b.baseColor === AMBER ? '#ffc46b' : '#6c9bff');
      }
      sparkBurst(b.x, b.y, b.core.material.color.getHex(), now);
    }

    /* floating score/pickup popups — a small pool of DOM divs, CSS-animated */
    const popEls = [];
    let popIdx = 0;
    function popup(text, x, y, color) {
      if (!popEls.length) {
        for (let i = 0; i < 6; i++) {
          const el = document.createElement('div');
          el.className = 'ship-pop';
          document.body.appendChild(el);
          popEls.push(el);
        }
      }
      const el = popEls[popIdx++ % popEls.length];
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = (y - 30) + 'px';
      el.style.color = color;
      el.classList.remove('on');
      void el.offsetWidth; // restart the animation
      el.classList.add('on');
    }

    /* crash / shield-hit screen shake on the overlay canvas */
    function shake() {
      sys.canvas.classList.remove('ship-shake');
      void sys.canvas.offsetWidth;
      sys.canvas.classList.add('ship-shake');
    }

    /* ── overlay chrome (hint, HUD, end screen) ──────────────────────── */

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
        hudBest = document.createElement('span');
        hudBest.className = 'ship-hud-best';
        const fuelWrap = document.createElement('div');
        fuelWrap.id = 'ship-fuel';
        fuelBar = document.createElement('i');
        fuelWrap.appendChild(fuelBar);
        shieldDot = document.createElement('span');
        shieldDot.className = 'ship-hud-shield';
        shieldDot.textContent = ' ◈';
        shieldDot.style.display = 'none';
        hudEl.append('✦ ', hudCount, hudBest, shieldDot, ' · Esc', fuelWrap);
        document.body.appendChild(hudEl);
      }
      hudEl.classList.add('on');
    }

    /* live score + best + fuel bar — driven every frame from the flight loop */
    function updateHudScore() {
      if (!hudCount) return;
      hudCount.textContent = t('ship.score', 'score') + ' ' + Math.floor(score);
      hudBest.textContent = bestScore != null ? ' · ' + t('ship.best', 'best') + ' ' + bestScore : '';
      shieldDot.style.display = shieldOn ? '' : 'none';
      fuelBar.style.width = Math.round(fuel * 100) + '%';
    }

    /* end-of-run overlay: final score, best, replay/land instructions */
    function showEndOverlay(finalScore, isNew) {
      if (!endEl) {
        endEl = document.createElement('div');
        endEl.id = 'ship-end';
        endTitle = document.createElement('div');
        endTitle.className = 'ship-end-title';
        endTime = document.createElement('div');
        endTime.className = 'ship-end-time';
        endAgain = document.createElement('div');
        endAgain.className = 'ship-end-again';
        endEl.append(endTitle, endTime, endAgain);
        document.body.appendChild(endEl);
      }
      endTitle.textContent = t('ship.gameover', 'game over');
      let line = t('ship.score', 'score') + ' ' + finalScore;
      if (isNew) line += ' — ' + t('ship.newbest', 'new best!');
      else if (bestScore != null) line += '  ·  ' + t('ship.best', 'best') + ' ' + bestScore;
      endTime.textContent = line;
      endAgain.textContent = t('ship.again', 'R — fly again · Esc — land');
      endEl.classList.add('on');
    }

    function hideEndOverlay() {
      if (endEl) endEl.classList.remove('on');
    }

    /* ── asteroids ───────────────────────────────────────────────────── */
    /* low-poly rocks drifting across the viewport (not the document — they
       live in screen space and wrap at the viewport edges, independent of
       scroll). Dark hull + subtle edge lines, same edges()-via-EdgesGeometry
       aesthetic as the ship. Built fresh per flight, removed on landing. */

    const ASTEROID_GEO = new THREE.IcosahedronGeometry(1, 0);

    /* atEdge: ramp-spawned rocks enter from a side so they never pop into
       existence on top of the ship; run-start rocks scatter anywhere that
       keeps a safe distance from the (centered) ship */
    function makeAsteroid(atEdge) {
      const r = 16 + Math.random() * 22;
      const mesh = new THREE.Mesh(ASTEROID_GEO, new THREE.MeshBasicMaterial({ color: HULL, side: THREE.DoubleSide }));
      mesh.scale.set(r * (0.75 + Math.random() * 0.5), r * (0.75 + Math.random() * 0.5), r * (0.75 + Math.random() * 0.5));
      const edgeMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 });
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(ASTEROID_GEO, 1), edgeMat));
      const ang = Math.random() * Math.PI * 2, spd = 14 + Math.random() * 24;
      let x, y;
      if (atEdge) {
        x = Math.random() < 0.5 ? -r * 1.3 : innerWidth + r * 1.3;
        y = Math.random() * innerHeight;
      } else {
        const sx = state.x - scrollX, sy = state.y - scrollY;
        let tries = 6;
        do {
          x = Math.random() * innerWidth;
          y = Math.random() * innerHeight;
        } while (--tries && (x - sx) * (x - sx) + (y - sy) * (y - sy) < 260 * 260);
      }
      return {
        mesh, edgeMat, r, x, y,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        rvx: (Math.random() - 0.5) * 0.5, rvy: (Math.random() - 0.5) * 0.5,
        flashT: 0
      };
    }

    function buildAsteroids() {
      asteroids = Array.from({ length: AST_START }, () => {
        const a = makeAsteroid(false);
        sys.scene.add(a.mesh);
        return a;
      });
    }

    function removeAsteroids() {
      asteroids.forEach((a) => sys.scene.remove(a.mesh));
      asteroids = [];
    }

    /* O(asteroids) per frame: drift (ramped) + wrap + spin, plus a single
       distance check against the ship — first contact ends the run */
    function updateAsteroids(dt, now) {
      if (!asteroids.length) return;
      const runT = timerStart == null ? 0 : (now - timerStart) / 1000;

      // ramp: one extra rock every AST_ADD_EVERY s up to the cap
      if (!gameOver && asteroids.length < Math.min(AST_CAP, AST_START + Math.floor(runT / AST_ADD_EVERY))) {
        const a = makeAsteroid(true);
        sys.scene.add(a.mesh);
        asteroids.push(a);
      }
      const spdK = Math.min(AST_SPEED_MAX, 1 + AST_SPEED_RAMP * runT);

      const shipVX = state.x - scrollX, shipVY = state.y - scrollY;
      for (const a of asteroids) {
        a.x += a.vx * spdK * dt;
        a.y += a.vy * spdK * dt;
        const pad = a.r * 1.3;
        if (a.x < -pad) a.x = innerWidth + pad; else if (a.x > innerWidth + pad) a.x = -pad;
        if (a.y < -pad) a.y = innerHeight + pad; else if (a.y > innerHeight + pad) a.y = -pad;
        a.mesh.position.set(a.x, -a.y, 15);
        a.mesh.rotation.x += a.rvx * dt;
        a.mesh.rotation.y += a.rvy * dt;

        if (a.flashT > 0) {
          a.flashT -= dt;
          if (a.flashT <= 0) { a.edgeMat.color.setHex(ACCENT); a.edgeMat.opacity = 0.35; }
        }

        // collision only once armed — an idle ship can't be sniped pre-run
        if (!gameOver && timerStart !== null) {
          const dx = shipVX - a.x, dy = shipVY - a.y;
          const minD = SHIP_R + a.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < minD * minD) die(a, now);
          else if (d2 < minD * minD * 4.8 && a.flashT <= 0) {
            a.flashT = 0.35; // near miss: the rock you almost ate glows amber
            a.edgeMat.color.setHex(AMBER);
            a.edgeMat.opacity = 0.85;
          }
        }
      }
    }

    /* crash: freeze the run, remember the score, kick off the burst; the
       end overlay appears once the ~0.8s explosion has played (in tick) */
    function die(a, now) {
      // shield absorbs the hit: the rock is flung back to an edge, run goes on
      if (shieldOn) {
        shieldOn = false;
        sys.shield.visible = false;
        const sx = state.x - scrollX, sy = state.y - scrollY;
        sparkBurst(sx, sy, VIOLET, now);
        popup(t('ship.shieldlost', 'shield down'), sx, sy, '#b18cff');
        a.x = Math.random() < 0.5 ? -a.r * 1.3 : innerWidth + a.r * 1.3;
        a.y = Math.random() * innerHeight;
        a.flashT = 0.5;
        a.edgeMat.color.setHex(VIOLET);
        a.edgeMat.opacity = 0.95;
        shake();
        return;
      }
      gameOver = true;
      goAt = now;
      goX = state.x - scrollX;
      goY = -(state.y - scrollY);
      goFinal = Math.floor(score);
      goNewBest = bestScore == null || goFinal > bestScore;
      if (goNewBest) {
        bestScore = goFinal;
        try { localStorage.setItem('starship-best-score', String(bestScore)); } catch (e) { /* private mode etc */ }
      }
      a.flashT = 0.8;
      a.edgeMat.color.setHex(RED);
      a.edgeMat.opacity = 0.95;
      sys.ship.group.visible = false;
      sys.burst.forEach((p) => {
        p.ang = Math.random() * Math.PI * 2;
        p.spd = 60 + Math.random() * 160;
        const s = 10 + Math.random() * 18;
        p.sp.scale.set(s, s, 1);
        p.sp.visible = true;
      });
      sys.crashRing.position.set(goX, goY, 24);
      sys.crashRing.visible = true;
      shake();
    }

    /* ── flight loop ─────────────────────────────────────────────────── */

    const toScene = (px, py) => ({ x: px - scrollX, y: -(py - scrollY) }); // page → overlay world

    function tick(now) {
      if (!flying) return;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      // game over: input is frozen; play the crash burst, keep the rocks
      // drifting and the trail fading, then reveal the end overlay
      if (gameOver) {
        const k = Math.min(1, (now - goAt) / 800);
        for (const p of sys.burst) {
          p.sp.position.set(goX + Math.cos(p.ang) * k * p.spd, goY + Math.sin(p.ang) * k * p.spd, 25);
          p.sp.material.opacity = 1 - k;
        }
        sys.crashRing.scale.setScalar(20 + k * 240);
        sys.crashRing.material.opacity = 0.85 * (1 - k);
        if (k >= 1 && !endShown) {
          endShown = true;
          sys.burst.forEach((p) => { p.sp.visible = false; });
          sys.crashRing.visible = false;
          showEndOverlay(goFinal, goNewBest);
        }
        updateAsteroids(dt, now);
        for (let i = 0; i < TRAIL_N; i++) {
          sys.trailAge[i] = Math.min(1, sys.trailAge[i] + dt * 0.9);
          const b = (1 - sys.trailAge[i]) * 0.85;
          const i3 = i * 3;
          sys.trailCol[i3] = 0.42 * b; sys.trailCol[i3 + 1] = 0.61 * b; sys.trailCol[i3 + 2] = 1.0 * b;
        }
        sys.trail.geometry.attributes.color.needsUpdate = true;
        updateHudScore();
        sys.renderer.render(sys.scene, sys.camera);
        rafId = requestAnimationFrame(tick);
        return;
      }

      // input → acceleration in page coords (y down). Touch drag (thrust
      // toward the touch point, force proportional to distance) overrides
      // keyboard while a finger is down.
      let ax = ((keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0));
      let ay = ((keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0));
      if (touchActive) {
        const tdx = touchX - state.x, tdy = touchY - state.y;
        const td = Math.hypot(tdx, tdy);
        if (td > 4) {
          const f = Math.min(1, td / TOUCH_MAX_D);
          ax = (tdx / td) * f;
          ay = (tdy / td) * f;
        } else { ax = 0; ay = 0; }
      }
      if (timerStart === null && (ax !== 0 || ay !== 0)) timerStart = now; // first move arms the score
      if (timerStart !== null) score += dt; // +1 per second survived, dino-style

      // boost: hold Space (or the touch double-tap toggle) burns the fuel
      // bar; it only refills once released, so running it dry is a real cost
      const boostInput = keys.has('Space') || touchBoostOn;
      if (boostInput && fuel > 0) fuel = Math.max(0, fuel - BOOST_DRAIN * dt);
      else if (!boostInput) fuel = Math.min(1, fuel + BOOST_REFILL * dt);
      const boosting = boostInput && fuel > 0;

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

      updateAsteroids(dt, now);

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
      const sc = 1.15 * (0.4 + 0.6 * bornK); // materialize on entry
      // speed stretch: the hull elongates slightly along its nose axis
      g.scale.set(sc * (1 + Math.min(0.2, (sp / BOOST_SPEED) * 0.2)), sc, sc);

      // engines: flame cones stretch with throttle + boost, with a fast
      // organic flicker; exhaust glows brighten to match
      const throttle = Math.min(1, sp / MAX_SPEED);
      const flick = 0.9 + Math.sin(now * 0.045) * 0.08 + Math.random() * 0.07;
      const flameLen = Math.max(0.35, (0.55 + throttle * 0.75 + (boosting ? 1.4 : 0)) * flick);
      sys.ship.flames.forEach((f) => {
        f.scale.y = flameLen;
        f.material.color.setHex(boosting ? AMBER : ACCENT); // afterburner runs hot
        f.material.opacity = 0.4 + throttle * 0.3 + (boosting ? 0.3 : 0);
      });
      const glowK = 0.45 + Math.sin(now * 0.02) * 0.1 + throttle * 0.25 + (boosting ? 0.35 : 0);
      sys.ship.exhausts.forEach((g) => {
        g.material.color.setHex(boosting ? AMBER : ACCENT);
        g.material.opacity = Math.min(1, glowK);
      });

      // shield bubble breathes while armed
      if (shieldOn) {
        sys.shield.material.opacity = 0.1 + Math.sin(now * 0.006) * 0.05;
        sys.shield.scale.setScalar(1 + Math.sin(now * 0.004) * 0.05);
      }

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

      // beacons: pulse (screen space, like the rocks), collect on proximity;
      // a collected beacon bursts for 0.5s then respawns elsewhere — endless
      for (const b of beacons) {
        b.group.position.set(b.x, -b.y, 0);
        if (!b.hit) {
          const k = 1 + Math.sin(now * 0.004 + b.y) * 0.1;
          b.group.scale.setScalar(k);
          b.ring.rotation.z = now * 0.001;
          b.core.rotation.x = now * 0.0011;
          b.core.rotation.y = now * 0.0017;
          const dx = b.x - (state.x - scrollX), dy = b.y - (state.y - scrollY);
          const d2 = dx * dx + dy * dy;
          if (d2 < COLLECT_R * COLLECT_R) collect(b, now);
          else if (d2 < 190 * 190) { // magnet: nearby pickups drift into the flight path
            b.x -= dx * 3.2 * dt;
            b.y -= dy * 3.2 * dt;
          }
        } else {
          const k = Math.min(1, (now - b.hitAt) / 500);
          b.group.scale.setScalar(1 + k * 2.2);
          b.ring.material.opacity = 0.9 * (1 - k);
          b.core.material.opacity = 0.85 * (1 - k);
          b.glow.material.opacity = 0.8 * (1 - k);
          if (k >= 1) placeBeacon(b);
        }
      }

      // collect sparks: radial burst fading over ~0.45s, then hidden
      const sk = (now - sys.sparkT) / 450;
      if (sk < 1) {
        for (const p of sys.sparks) {
          p.sp.position.set(sys.sparkX + Math.cos(p.ang) * sk * p.spd, -sys.sparkY + Math.sin(p.ang) * sk * p.spd, 5);
          p.sp.material.opacity = 0.9 * (1 - sk);
        }
      } else if (sys.sparks[0].sp.visible) {
        sys.sparks.forEach((p) => { p.sp.visible = false; });
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

      updateHudScore();
      sys.renderer.render(sys.scene, sys.camera);
      rafId = requestAnimationFrame(tick);
    }

    /* ── enter / exit ────────────────────────────────────────────────── */

    // fresh run — shared by entry, R-restart and the game-over tap-restart:
    // recenter the ship, rearm the score, respawn beacons, reset the ramp
    function resetRun() {
      state.x = innerWidth / 2;
      state.y = scrollY + innerHeight / 2;
      state.vx = state.vy = 0;
      state.angle = Math.PI / 2; // nose pointing up the page (scene y-up)
      state.bank = 0;
      state.born = performance.now();
      timerStart = null;
      score = 0;
      fuel = 1;
      comboN = 0;
      lastCollectT = -1e9;
      shieldOn = false;
      sys.shield.visible = false;
      sys.crashRing.visible = false;
      sys.sparks.forEach((p) => { p.sp.visible = false; });
      gameOver = false;
      endShown = false;
      hideEndOverlay();
      makeBeacons();
      removeAsteroids();
      buildAsteroids();
      sys.ship.group.visible = true;
      sys.burst.forEach((p) => { p.sp.visible = false; });
      updateHud();
    }

    function enterFlight() {
      const S = window.__scene;
      if (!S) return; // no WebGL, no flight
      if (!sys) buildSystem();
      resetRun();

      flying = true;
      keys.clear();
      touchActive = false;
      touchBoostOn = false;

      sys.trailAge.fill(1);
      document.documentElement.classList.add('starship-mode');
      showHint(isTouch
        ? t('ship.hint_touch', 'drag to fly · double-tap for boost · collect the beacons ✦')
        : t('ship.hint', 'arrows to fly · space to boost · grab beacons ✦ · dodge the rocks'), 4200);

      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function exitFlight() {
      flying = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      document.documentElement.classList.remove('starship-mode');
      sys.ship.group.visible = false;
      sys.burst.forEach((p) => { p.sp.visible = false; });
      sys.crashRing.visible = false;
      sys.sparks.forEach((p) => { p.sp.visible = false; });
      popEls.forEach((el) => el.classList.remove('on'));
      removeAsteroids();
      sys.renderer.render(sys.scene, sys.camera); // clear the overlay
      if (window.__scene) window.__scene.shipPos = null;
      if (hintEl) hintEl.classList.remove('on');
      if (hudEl) hudEl.classList.remove('on');
      hideEndOverlay();
      clearTimeout(hintTimer);
    }

    /* ── input ───────────────────────────────────────────────────────── */

    addEventListener('keydown', (e) => {
      if (e.repeat) { if (flying && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault(); return; }
      if (flying) {
        if (e.code === 'Escape') { exitFlight(); return; }
        if (e.code === 'KeyR') { resetRun(); return; }
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

    /* touch: drag steers (thrust toward the touch point, see tick()),
       double-tap toggles the boost hold on/off. A plain toggle — rather than
       "boost while the post-double-tap finger stays down" — is the simpler,
       more forgiving gesture on a small screen; ship.hint_touch documents it.
       Listeners are global but no-op unless flying, so normal page touch
       scrolling elsewhere is untouched. preventDefault backs up the
       touch-action: none set on <html> while in flight (style.css). */
    addEventListener('touchstart', (e) => {
      if (!flying) return;
      const tc = e.touches[0];
      const now = performance.now();
      if (gameOver) {
        // tap on the end overlay restarts (after the crash burst has played,
        // so frantic dying taps don't skip the score screen)
        if (now - goAt > 800) resetRun();
        e.preventDefault();
        return;
      }
      if (now - lastTapT < 300) touchBoostOn = !touchBoostOn;
      lastTapT = now;
      touchActive = true;
      touchX = tc.clientX + scrollX;
      touchY = tc.clientY + scrollY;
      e.preventDefault();
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      if (!flying || !touchActive) return;
      const tc = e.touches[0];
      touchX = tc.clientX + scrollX;
      touchY = tc.clientY + scrollY;
      e.preventDefault();
    }, { passive: false });
    const touchEnd = (e) => { if (flying) { touchActive = false; e.preventDefault(); } };
    addEventListener('touchend', touchEnd, { passive: false });
    addEventListener('touchcancel', touchEnd, { passive: false });

    /* command-palette entry point ("fly") — same door as the Konami code,
       so it inherits enterFlight's reduced-motion / no-WebGL guards */
    window.__starship = { fly: enterFlight };
  })();
}
