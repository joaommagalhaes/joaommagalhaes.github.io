/* Morphing particle swarm — one canvas, one renderer, one particle population
   that reforms into a formation per section as you scroll.
   Boot fails soft: without WebGL (or if data fails to load) the page is the
   plain readable site. */
import * as THREE from 'three';

const canvas = document.getElementById('bg-canvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(max-width: 760px)').matches;

const BG = 0x0a0c10;
const ACCENT = new THREE.Color(0x6c9bff);
const DIM = new THREE.Color(0x39415a);
const INK = new THREE.Color(0xe8ebf2);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
const CAM_Z = 10;
camera.position.z = CAM_Z;

const halfH = Math.tan(THREE.MathUtils.degToRad(55 / 2)) * CAM_Z;
const halfW = () => halfH * camera.aspect;

const N = isMobile ? 4500 : 9000;

/* ── Soft round sprite ── */
const spriteCv = document.createElement('canvas');
spriteCv.width = spriteCv.height = 64;
{
  const c = spriteCv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
}

/* ── Swarm buffers ── */
const pos = new Float32Array(N * 3);
const col = new Float32Array(N * 3);
const phase = new Float32Array(N);
for (let i = 0; i < N; i++) {
  pos[i * 3] = (Math.random() - 0.5) * 40;
  pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
  pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 4;
  DIM.toArray(col, i * 3);
  phase[i] = Math.random() * Math.PI * 2;
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));

/* GPU sparkle: per-particle size (rare oversized "hero" dots) + organic
   3-axis drift + twinkle, injected into the stock PointsMaterial shader.
   Replaces the old per-frame CPU sine wobble. uTime stays 0 under reduced
   motion, so the injected terms are static there. */
const uTime = { value: 0 };
function sparkleSizes(n) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = Math.random() < 0.03 ? 2 + Math.random() * 0.8 : 0.6 + Math.pow(Math.random(), 2) * 1.1;
  }
  return a;
}
function injectSparkle(mat, drift) {
  mat.customProgramCacheKey = () => 'sparkle' + drift; // drift is baked into the source
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying float vTw;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed += ${drift.toFixed(4)} * vec3(
  sin(uTime * 0.62 + aPhase * 3.1),
  cos(uTime * 0.45 + aPhase * 5.3),
  sin(uTime * 0.71 + aPhase * 4.7));
vTw = 0.5 + 0.5 * sin(uTime * (0.9 + fract(aPhase * 0.318) * 1.6) + aPhase * 13.0);`)
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize * (0.82 + 0.36 * vTw);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTw;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * (0.65 + 0.35 * vTw) );');
  };
}
geometry.setAttribute('aSize', new THREE.BufferAttribute(sparkleSizes(N), 1));
geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

const material = new THREE.PointsMaterial({
  size: isMobile ? 0.055 : 0.045,
  map: new THREE.CanvasTexture(spriteCv),
  vertexColors: true,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true
});
injectSparkle(material, 0.022);
const points = new THREE.Points(geometry, material);
scene.add(points);

/* Distant static stars for depth */
{
  const sp = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    sp[i * 3] = (Math.random() - 0.5) * 60;
    sp[i * 3 + 1] = (Math.random() - 0.5) * 40;
    sp[i * 3 + 2] = -20 - Math.random() * 20;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(sparkleSizes(500), 1));
  const sPhase = new Float32Array(500);
  for (let i = 0; i < 500; i++) sPhase[i] = Math.random() * Math.PI * 2;
  sg.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
  const sm = new THREE.PointsMaterial({
    size: 0.06, map: new THREE.CanvasTexture(spriteCv), color: 0x2a3348,
    transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending
  });
  injectSparkle(sm, 0.01);
  scene.add(new THREE.Points(sg, sm));
}

/* Line layers (neural edges / constellation links) */
function makeLines(maxSegs, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSegs * 6), 3));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const l = new THREE.LineSegments(g, m);
  l.visible = false;
  scene.add(l);
  return l;
}
const neuralLines = makeLines(200, 0x3b5bd6);
const constelLines = makeLines(60, 0x3b5bd6);

/* ── Helpers ── */
function scatter(arr, i3, spreadX, spreadY, cx, cy, cz) {
  arr[i3] = cx + (Math.random() - 0.5) * spreadX;
  arr[i3 + 1] = cy + (Math.random() - 0.5) * spreadY;
  arr[i3 + 2] = (cz || 0) + (Math.random() - 0.5) * 3;
}
function mixColor(out, i3, base, accentChance) {
  (Math.random() < accentChance ? ACCENT : DIM).toArray(out, i3);
  if (base) base.toArray(out, i3);
}

/* Every formation: { pos: Float32Array, col: Float32Array } of length N*3 */
const formations = [];
const F = {}; // named refs

function newFormation(name) {
  const f = { name, pos: new Float32Array(N * 3), col: new Float32Array(N * 3) };
  formations.push(f);
  F[name] = f;
  return f;
}

function fillAmbient(f, from, density) {
  for (let i = from; i < N; i++) {
    const i3 = i * 3;
    scatter(f.pos, i3, halfW() * 2.4, halfH * 2.4, 0, 0, -3);
    const c = Math.random() < density ? DIM : new THREE.Color(0x141a26);
    c.toArray(f.col, i3);
  }
}

/* 01 — HERO: particle typography */
async function buildName(f) {
  try { await document.fonts.load('600 200px Geist'); } catch (e) {}
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const lines = isMobile ? ['JOÃO', 'MAGALHÃES'] : ['JOÃO MAGALHÃES'];
  const fontPx = 200;
  ctx.font = `600 ${fontPx}px Geist, sans-serif`;
  const widths = lines.map(t => ctx.measureText(t).width);
  cv.width = Math.ceil(Math.max(...widths)) + 40;
  cv.height = fontPx * 1.2 * lines.length + 40;
  ctx.font = `600 ${fontPx}px Geist, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  lines.forEach((t, li) => ctx.fillText(t, cv.width / 2, 20 + fontPx * 1.2 * (li + 0.5)));
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;

  // boundary between "JOÃO " (ink) and "MAGALHÃES" (accent) on desktop
  const joaoW = ctx.measureText('JOÃO ').width;
  const fullW = ctx.measureText('JOÃO MAGALHÃES').width;
  const boundaryX = cv.width / 2 - fullW / 2 + joaoW;

  const pts = [];
  const step = isMobile ? 5 : 4;
  for (let y = 0; y < cv.height; y += step) {
    for (let x = 0; x < cv.width; x += step) {
      if (img[(y * cv.width + x) * 4 + 3] > 128) pts.push([x, y]);
    }
  }
  /* Fit to the DOM h1's live box (.name) instead of a viewport-proportional
     guess: whatever space the real heading reserves is exactly the box the
     particles fit into, so the particle name can never overlap
     .hero-role/.hero-tagline below it. buildName runs before body gets
     .has-3d, so the h1 is still laid out (and visible) when we measure it.
     Particles are allowed to overflow the box by ~8% for an organic,
     non-clipped-looking edge. Falls back to the old viewport-proportional
     fit if the element is missing or not yet laid out (zero-size rect). */
  const nameEl = document.querySelector('.name');
  const rect = nameEl ? nameEl.getBoundingClientRect() : null;
  let scale, offX, offY;
  if (rect && rect.width > 0 && rect.height > 0) {
    const worldPerPxX = (halfW() * 2) / innerWidth;
    const worldPerPxY = (halfH * 2) / innerHeight;
    const boxW = rect.width * worldPerPxX * 1.08;
    const boxH = rect.height * worldPerPxY * 1.08;
    scale = Math.min(boxW / cv.width, boxH / cv.height);
    offX = ((rect.left + rect.right) / 2 - innerWidth / 2) * worldPerPxX;
    offY = -((rect.top + rect.bottom) / 2 - innerHeight / 2) * worldPerPxY;
  } else {
    // fallback: fit into ~82% viewport width (tighter height cap on mobile)
    const targetW = halfW() * 2 * (isMobile ? 0.86 : 0.82);
    const hCap = isMobile ? 0.3 : 0.5;
    scale = Math.min(targetW / cv.width, (halfH * 2 * hCap) / cv.height);
    offX = 0;
    offY = halfH * 0.06;
  }
  const count = Math.min(pts.length, N - 800);
  for (let i = 0; i < count; i++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    const i3 = i * 3;
    f.pos[i3] = (p[0] - cv.width / 2) * scale + (Math.random() - 0.5) * 0.015 + offX;
    f.pos[i3 + 1] = -(p[1] - cv.height / 2) * scale + (Math.random() - 0.5) * 0.015 + offY;
    f.pos[i3 + 2] = (Math.random() - 0.5) * 0.3;
    const isAccent = isMobile ? p[1] > cv.height / 2 : p[0] > boundaryX;
    (isAccent ? ACCENT : INK).toArray(f.col, i3);
  }
  fillAmbient(f, count, 0.5);
}

/* 02 — ABOUT: orbital core */
function buildCore(f, side) {
  const cx = side * halfW() * 0.5, R = Math.min(halfW(), halfH) * 0.34;
  const nCore = Math.floor(N * 0.55), nRing = Math.floor(N * 0.25);
  for (let i = 0; i < nCore; i++) {
    const i3 = i * 3;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = R * Math.cbrt(Math.random());
    const s = Math.sqrt(1 - u * u);
    f.pos[i3] = cx + r * s * Math.cos(th);
    f.pos[i3 + 1] = r * s * Math.sin(th);
    f.pos[i3 + 2] = r * u;
    mixColor(f.col, i3, null, 0.12);
  }
  for (let i = nCore; i < nCore + nRing; i++) {
    const i3 = i * 3;
    const ring = i % 2 === 0 ? 1.5 : 1.9;
    const a = Math.random() * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) * R * ring, Math.sin(a) * R * ring * 0.35, (Math.random() - 0.5) * 0.2);
    v.applyAxisAngle(new THREE.Vector3(1, 0, 0), i % 2 === 0 ? 0.5 : -0.4);
    f.pos[i3] = cx + v.x; f.pos[i3 + 1] = v.y; f.pos[i3 + 2] = v.z;
    mixColor(f.col, i3, null, 0.5);
  }
  fillAmbient(f, nCore + nRing, 0.4);
}

/* 03 — EXPERIENCE: stream with 4 waypoints */
const streamState = { highlight: -1, wayStart: 0, perWay: 0 };
function buildStream(f, side) {
  const cx = side * halfW() * 0.52;
  const H = halfH * 1.5;
  const way = [0.85, 0.45, -0.05, -0.55].map(t => new THREE.Vector3(
    cx + Math.sin(t * 4.2) * halfW() * 0.16, t * H, 0));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(cx, H * 1.2, -1), ...way, new THREE.Vector3(cx, -H * 1.2, -1)
  ]);
  const nStream = Math.floor(N * 0.6), perWay = Math.floor(N * 0.06);
  for (let i = 0; i < nStream; i++) {
    const i3 = i * 3;
    const p = curve.getPoint(Math.random());
    const sp = 0.5;
    f.pos[i3] = p.x + (Math.random() - 0.5) * sp;
    f.pos[i3 + 1] = p.y + (Math.random() - 0.5) * sp * 0.6;
    f.pos[i3 + 2] = p.z + (Math.random() - 0.5) * sp;
    mixColor(f.col, i3, null, 0.08);
  }
  let idx = nStream;
  streamState.wayStart = nStream;
  streamState.perWay = perWay;
  for (const w of way) {
    for (let k = 0; k < perWay; k++, idx++) {
      const i3 = idx * 3;
      const r = 0.34 * Math.cbrt(Math.random());
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      f.pos[i3] = w.x + r * s * Math.cos(th);
      f.pos[i3 + 1] = w.y + r * s * Math.sin(th);
      f.pos[i3 + 2] = w.z + r * u;
      ACCENT.toArray(f.col, i3);
    }
  }
  fillAmbient(f, idx, 0.4);
}

/* 04 — AI: layered neural net */
const neural = { nodes: [], edges: [], burst: -1e9 };
function buildNeural(f, side) {
  const cx = side * halfW() * 0.5;
  const layers = [4, 6, 6, 3];
  const lw = halfW() * 0.62, lh = halfH * 1.0;
  neural.nodes = [];
  layers.forEach((n, li) => {
    for (let k = 0; k < n; k++) {
      neural.nodes.push({
        v: new THREE.Vector3(
          cx - lw / 2 + (li / (layers.length - 1)) * lw,
          -lh / 2 + ((k + 0.5) / n) * lh,
          (Math.random() - 0.5) * 0.6),
        layer: li
      });
    }
  });
  neural.edges = [];
  let off = 0;
  layers.forEach((n, li) => {
    if (li === layers.length - 1) return;
    const next = layers[li + 1];
    for (let a = 0; a < n; a++) for (let b = 0; b < next; b++) {
      if (Math.random() < 0.75) neural.edges.push([off + a, off + n + b]);
    }
    off += n;
  });
  const perNode = Math.floor((N * 0.5) / neural.nodes.length);
  let idx = 0;
  for (const nd of neural.nodes) {
    for (let k = 0; k < perNode; k++, idx++) {
      const i3 = idx * 3;
      const r = 0.22 * Math.cbrt(Math.random());
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      f.pos[i3] = nd.v.x + r * s * Math.cos(th);
      f.pos[i3 + 1] = nd.v.y + r * s * Math.sin(th);
      f.pos[i3 + 2] = nd.v.z + r * u;
      mixColor(f.col, i3, null, 0.35);
    }
  }
  // pulse particles travel edges at runtime — reserve a block
  neural.pulseStart = idx;
  neural.pulseCount = Math.min(240, N - idx - 500);
  for (let k = 0; k < neural.pulseCount; k++, idx++) {
    ACCENT.toArray(f.col, idx * 3);
    f.pos[idx * 3] = cx; f.pos[idx * 3 + 1] = 0; f.pos[idx * 3 + 2] = 0;
  }
  // static edge lines
  const lp = neuralLines.geometry.attributes.position;
  neural.edges.slice(0, 200).forEach((e, k) => {
    neural.nodes[e[0]].v.toArray(lp.array, k * 6);
    neural.nodes[e[1]].v.toArray(lp.array, k * 6 + 3);
  });
  neuralLines.geometry.setDrawRange(0, Math.min(neural.edges.length, 200) * 2);
  lp.needsUpdate = true;
  fillAmbient(f, idx, 0.4);
}

/* 05 — SKILLS: constellation of brand-logo nodes */
const SKILLS = [
  ['Angular', 'angular'], ['React / React Native', 'react'], ['TypeScript', 'typescript'],
  ['JavaScript', 'javascript'], ['HTML & CSS', 'html5'], ['Node.js', 'nodedotjs'],
  ['PHP', 'php'], ['Python', 'python'], ['MySQL', 'mysql'], ['RabbitMQ', 'rabbitmq'],
  ['Microservices', 'kubernetes'], ['Real-time', 'socketdotio'], ['System Design', 'blueprint'],
  ['Git', 'git'], ['Docker', 'docker'], ['CI/CD', 'githubactions'], ['Ionic', 'ionic']
];
const constel = { nodes: [], edges: [], rot: 0, baseCx: 0, highlight: -1, sprites: null };
function buildConstellation(f, side) {
  const cx = side * halfW() * 0.5;
  constel.baseCx = cx;
  const R = Math.min(halfW(), halfH) * 0.52;
  constel.nodes = SKILLS.map(([name], i) => {
    const u = (i / SKILLS.length) * 2 - 1 + (Math.random() - 0.5) * 0.1;
    const th = i * 2.399963; // golden angle spiral on sphere
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    return { name, base: new THREE.Vector3(R * s * Math.cos(th), R * u, R * s * Math.sin(th)) };
  });
  constel.edges = [];
  for (let i = 0; i < constel.nodes.length; i++) {
    const j = (i + 1) % constel.nodes.length;
    constel.edges.push([i, j]);
    if (i % 3 === 0) constel.edges.push([i, (i + 5) % constel.nodes.length]);
  }
  const perNode = Math.floor((N * 0.45) / constel.nodes.length);
  constel.perNode = perNode;
  let idx = 0;
  for (const nd of constel.nodes) {
    for (let k = 0; k < perNode; k++, idx++) {
      const i3 = idx * 3;
      const r = k === 0 ? 0 : 0.16 * Math.cbrt(Math.random());
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      f.pos[i3] = cx + nd.base.x + r * s * Math.cos(th);
      f.pos[i3 + 1] = nd.base.y + r * s * Math.sin(th);
      f.pos[i3 + 2] = nd.base.z + r * u;
      (k < 3 ? ACCENT : DIM).toArray(f.col, i3);
    }
  }
  constel.count = idx;
  constel.base = f.pos.slice(0, idx * 3); // pristine copy; rotation rewrites from this
  fillAmbient(f, idx, 0.4);
}
function updateConstellation() {
  // rotate node cluster; rewrite node particle block (from pristine base) + lines
  const m = new THREE.Matrix4().makeRotationY(constel.rot);
  const dst = F.constellation.pos;
  for (let i = 0; i < constel.nodes.length; i++) {
    const nd = constel.nodes[i];
    nd.cur = (nd.cur || new THREE.Vector3()).copy(nd.base).applyMatrix4(m);
    nd.cur.x += constel.baseCx;
  }
  let idx = 0;
  for (let i = 0; i < constel.nodes.length; i++) {
    const nd = constel.nodes[i];
    const dx = nd.cur.x - (nd.base.x + constel.baseCx);
    const dy = nd.cur.y - nd.base.y;
    const dz = nd.cur.z - nd.base.z;
    for (let k = 0; k < constel.perNode; k++, idx++) {
      const i3 = idx * 3;
      dst[i3] = constel.base[i3] + dx;
      dst[i3 + 1] = constel.base[i3 + 1] + dy;
      dst[i3 + 2] = constel.base[i3 + 2] + dz;
    }
  }
  const lp = constelLines.geometry.attributes.position;
  constel.edges.forEach((e, k) => {
    constel.nodes[e[0]].cur.toArray(lp.array, k * 6);
    constel.nodes[e[1]].cur.toArray(lp.array, k * 6 + 3);
  });
  constelLines.geometry.setDrawRange(0, constel.edges.length * 2);
  lp.needsUpdate = true;
}

/* Brand-logo sprites for the constellation (fails soft: nodes stay dots) */
async function loadSkillIcons() {
  const group = new THREE.Group();
  scene.add(group);
  constel.sprites = [];
  await Promise.all(SKILLS.map(async ([, slug], i) => {
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`);
      if (!r.ok) throw new Error(slug);
      let svg = await r.text();
      // simple-icons SVGs are dimensionless + black; give them size and ink
      svg = svg.replace('<svg ', '<svg width="128" height="128" fill="#d7e4ff" ');
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const cv2 = document.createElement('canvas');
      cv2.width = cv2.height = 128;
      cv2.getContext('2d').drawImage(img, 8, 8, 112, 112);
      URL.revokeObjectURL(url);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv2), transparent: true, opacity: 0, depthWrite: false
      }));
      sp.visible = false;
      group.add(sp);
      constel.sprites[i] = sp;
    } catch (err) { /* node stays a dot */ }
  }));
}

/* 06 — EDUCATION: growth rings */
const ringsState = { highlight: -1, per: 0 };
function buildRings(f, side) {
  const cx = side * halfW() * 0.5;
  const rings = 4;
  const nRing = Math.floor((N * 0.7) / rings);
  ringsState.per = nRing;
  const tilt = new THREE.Vector3(1, 0.15, 0).normalize();
  let idx = 0;
  for (let ri = 0; ri < rings; ri++) {
    const R = (0.8 + ri * 0.55) * Math.min(halfW(), halfH) * 0.28;
    for (let k = 0; k < nRing; k++, idx++) {
      const i3 = idx * 3;
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, (Math.random() - 0.5) * 0.1);
      v.applyAxisAngle(tilt, 0.9);
      f.pos[i3] = cx + v.x; f.pos[i3 + 1] = v.y; f.pos[i3 + 2] = v.z;
      mixColor(f.col, i3, null, ri === 0 ? 0.5 : 0.12);
    }
  }
  fillAmbient(f, idx, 0.4);
}

/* 07 — LANGUAGES: proto-globe nebula. Also the resting formation behind
   "Beyond the Screen" (that section has no data-scene of its own) — so it
   doubles as a home for 4 icebreaker topic clusters, hover-lit below. */
const WINE = new THREE.Color(0x8a3a52);
const nebulaState = { highlight: -1, clusters: [] }; // [{start, count}] per topic
function buildNebula(f, side) {
  const cx = side * halfW() * 0.45;
  const R = Math.min(halfW(), halfH) * 0.5;
  const n = Math.floor(N * 0.5);

  /* one tight cluster per icebreaker card, in DOM order: camino, wine, history, collecting */
  const topics = [
    { u: 0.55, th: 0.6, color: CAMINO },
    { u: 0.05, th: 2.6, color: WINE },
    { u: -0.35, th: 4.3, color: INK },
    { u: -0.6, th: 5.7, color: ACCENT }
  ];
  const perTopic = Math.floor(n * 0.05);
  nebulaState.clusters = [];
  let idx = 0;
  for (const topic of topics) {
    nebulaState.clusters.push({ start: idx, count: perTopic });
    for (let k = 0; k < perTopic; k++, idx++) {
      const i3 = idx * 3;
      const u = Math.max(-1, Math.min(1, topic.u + (Math.random() - 0.5) * 0.22));
      const th = topic.th + (Math.random() - 0.5) * 0.5;
      const s = Math.sqrt(1 - u * u);
      const r = R * (0.85 + Math.random() * 0.3);
      f.pos[i3] = cx + r * s * Math.cos(th);
      f.pos[i3 + 1] = r * u;
      f.pos[i3 + 2] = r * s * Math.sin(th);
      topic.color.toArray(f.col, i3);
    }
  }
  for (let i = idx; i < n; i++) {
    const i3 = i * 3;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = R * (0.85 + Math.random() * 0.3);
    f.pos[i3] = cx + r * s * Math.cos(th);
    f.pos[i3 + 1] = r * u;
    f.pos[i3 + 2] = r * s * Math.sin(th);
    mixColor(f.col, i3, null, 0.1);
  }
  fillAmbient(f, n, 0.45);
}

/* 08 — GLOBE */
/* rot init: -(90° + 15°) puts lon ≈ 15°E (Europe) face-on to the camera */
const globe = {
  dots: [], names: [], rot: -1.83, rotVel: 0, rotTarget: null,
  pitch: 0, pitchVel: 0, pitchTarget: null,
  zoom: 1, zoomTarget: 1,
  dragging: false, highlight: -1, caminoLit: false, R: 1
};

/* Camino Português, Valença → Santiago (walked ×3) — [lon, lat] waypoints,
   drawn as an amber arc slightly above the surface. c = -2 marks a route dot. */
const CAMINO = new THREE.Color(0xffc46b);
const CAMINOS = [
  [[-8.64, 41.90], [-8.64, 42.05], [-8.61, 42.28], [-8.64, 42.43], [-8.66, 42.74], [-8.55, 42.88]]
];

function lonLatToV(lon, lat, R) {
  const lo = lon * Math.PI / 180, la = lat * Math.PI / 180;
  return new THREE.Vector3(
    R * Math.cos(la) * Math.cos(lo),
    R * Math.sin(la),
    -R * Math.cos(la) * Math.sin(lo));
}

function buildGlobe(f, data) {
  globe.names = data.names;
  let dots = data.dots;
  if (isMobile) dots = dots.filter((d, i) => d[2] >= 0 || i % 2 === 0);
  globe.R = Math.min(halfW(), halfH) * (isMobile ? 0.62 : 0.72);
  globe.dots = dots.map(d => ({ v: lonLatToV(d[0], d[1], globe.R), c: d[2] }));

  /* interpolate route waypoints into dense dot trails */
  for (const route of CAMINOS) {
    for (let s = 0; s < route.length - 1; s++) {
      const [lon1, lat1] = route[s], [lon2, lat2] = route[s + 1];
      const segN = Math.max(2, Math.round(Math.hypot(lon2 - lon1, lat2 - lat1) * 6));
      for (let k = 0; k < segN; k++) {
        const t = k / segN;
        globe.dots.push({
          v: lonLatToV(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t, globe.R * 1.012),
          c: -2
        });
      }
    }
  }

  const count = Math.min(globe.dots.length, N - 300);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const c = globe.dots[i].c;
    globe.dots[i].v.toArray(f.pos, i3);
    (c >= 0 ? ACCENT : c === -2 ? CAMINO : DIM).toArray(f.col, i3);
    if (c >= 0) {
      f.col[i3] *= 1.25; f.col[i3 + 1] *= 1.25; f.col[i3 + 2] *= 1.25;
    }
  }
  globe.count = count;
  fillAmbient(f, count, 0.35);

  // per-country centroid → the rotation that brings it face-on (legend hover)
  const sums = data.names.map(() => new THREE.Vector3());
  for (const d of globe.dots) if (d.c >= 0) sums[d.c].add(d.v);
  globe.rotFor = sums.map(v => {
    v.normalize();
    return -Math.PI / 2 - Math.atan2(-v.z, v.x);
  });
  // pitch that brings the (already face-on) centroid down to screen center
  globe.pitchFor = sums.map(v => Math.asin(v.y)); // v normalized above
}
const _gm = new THREE.Matrix4();
const _gx = new THREE.Matrix4();
function updateGlobe(out, colOut) {
  _gm.makeRotationY(globe.rot);
  _gx.makeRotationX(globe.pitch);
  _gm.premultiply(_gx); // world = Rx(pitch) · Ry(yaw)
  const e = _gm.elements;
  const src = F.globe, zm = globe.zoom, Rz = globe.R * zm;
  for (let i = 0; i < globe.count; i++) {
    const i3 = i * 3;
    const x = src.pos[i3], y = src.pos[i3 + 1], z = src.pos[i3 + 2];
    const zr = (e[2] * x + e[6] * y + e[10] * z) * zm;
    out[i3] = (e[0] * x + e[4] * y + e[8] * z) * zm;
    out[i3 + 1] = (e[1] * x + e[5] * y + e[9] * z) * zm;
    out[i3 + 2] = zr;
    // depth shading: back-side dots fade so the globe reads as a solid sphere
    let s = 0.18 + 0.82 * Math.max(0, Math.min(1, (zr / Rz + 1) / 2 * 1.4));
    if (globe.highlight >= 0 && globe.dots[i].c === globe.highlight) s *= 2.4;
    else if (globe.caminoLit && globe.dots[i].c === -2) s *= 2.4;
    colOut[i3] = src.col[i3] * s;
    colOut[i3 + 1] = src.col[i3 + 1] * s;
    colOut[i3 + 2] = src.col[i3 + 2] * s;
  }
  // ambient tail beyond the rotated dots stays as authored
  out.set(src.pos.subarray(globe.count * 3), globe.count * 3);
  colOut.set(src.col.subarray(globe.count * 3), globe.count * 3);
}

/* ── Cinematic intro: supernova → first formation ──
   A one-shot source, deliberately NOT pushed into formations[]/order so
   scroll-driven blending never sees it. Particles start on a distant sphere
   shell and spiral inward; per-particle stagger reuses the existing phase[]
   array so no extra randomness/allocation is needed at runtime. */
const INTRO_DUR = 2.6;
const nova = reducedMotion ? null : { pos: new Float32Array(N * 3), col: new Float32Array(N * 3) };
const stagger = reducedMotion ? null : new Float32Array(N);
if (stagger) {
  for (let i = 0; i < N; i++) stagger[i] = phase[i] / (Math.PI * 2) * 1.2;
}
let introStart = null;
let introDone = reducedMotion; // reduced motion: skip the effect entirely, zero cost
function buildNova(src) {
  if (!nova) return;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = 16 + Math.random() * 4;
    nova.pos[i3] = r * s * Math.cos(th);
    nova.pos[i3 + 1] = r * u;
    nova.pos[i3 + 2] = -4 + r * s * Math.sin(th);
    nova.col[i3] = src.col[i3] * 0.5;
    nova.col[i3 + 1] = src.col[i3 + 1] * 0.5;
    nova.col[i3 + 2] = src.col[i3 + 2] * 0.5;
  }
}

/* ── Build all formations ── */
const stageEls = [...document.querySelectorAll('[data-scene]')];
const sides = {}; // data-scene -> +1 (right) / -1 (left)
stageEls.forEach(el => {
  sides[el.getAttribute('data-scene')] =
    el.getAttribute('data-stage-side') === 'left' ? -1 : 1;
});

async function build() {
  const res = await fetch('globe-dots.json');
  const globeData = await res.json();

  const nameF = newFormation('name');
  await buildName(nameF);
  buildNova(nameF);
  buildCore(newFormation('core'), sides.core || 1);
  buildStream(newFormation('stream'), sides.stream || -1);
  buildNeural(newFormation('neural'), sides.neural || 1);
  buildConstellation(newFormation('constellation'), sides.constellation || -1);
  buildRings(newFormation('rings'), sides.rings || 1);
  buildNebula(newFormation('nebula'), sides.nebula || 1);
  buildGlobe(newFormation('globe'), globeData);
  loadSkillIcons().catch(() => {}); // decorative; dots remain if CDN unreachable
}

/* ── Scroll → stage progress ── */
const order = ['name', 'core', 'stream', 'neural', 'constellation', 'rings', 'nebula', 'globe'];
let anchors = [];
function computeAnchors() {
  anchors = order.map(name => {
    if (name === 'name') return 0;
    const el = document.querySelector(`[data-scene="${name}"]`);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.top + scrollY - innerHeight * 0.45;
  });
}

function stageProgress() {
  const y = scrollY;
  let i = 0;
  while (i < anchors.length - 1 && y >= anchors[i + 1]) i++;
  if (i >= anchors.length - 1) return anchors.length - 1;
  const span = anchors[i + 1] - anchors[i] || 1;
  let t = (y - anchors[i]) / span;
  t = t * t * (3 - 2 * t); // smoothstep
  return i + t;
}

/* ── Interaction ── */
const pointer = { x: 0, y: 0, worldX: 0, worldY: 0, down: false, lastX: 0, lastY: 0, moved: false };
const tip = document.getElementById('scene-tip');
let stageF = 0;

addEventListener('pointermove', (e) => {
  pointer.moved = true;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointer.worldX = pointer.x * halfW();
  pointer.worldY = pointer.y * halfH;

  if (pointer.down) {
    const dx = e.clientX - pointer.lastX;
    const dy = e.clientY - pointer.lastY;
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
    if (nearStage('globe')) {
      globe.rotVel = dx * 0.0035; globe.rot += dx * 0.0035;
      globe.pitchVel = dy * 0.0035; globe.pitch += dy * 0.0035;
    }
    if (nearStage('constellation')) constel.rot += dx * 0.005;
    return;
  }
  hoverCheck(e);
}, { passive: true });

addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button, .section-body, .globe-list')) return;
  if (nearStage('globe') || nearStage('constellation')) {
    pointer.down = true;
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
    document.body.classList.add('scene-grabbing');
  } else if (!reducedMotion) {
    emitWave(e.clientX, e.clientY);
  }
});
const endDrag = () => {
  pointer.down = false;
  document.body.classList.remove('scene-grabbing');
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag); // touch scroll takeover must not leave a stuck drag

// zoom: trackpad pinch arrives as ctrl+wheel; plain wheel keeps scrolling the page
addEventListener('wheel', (e) => {
  if (!nearStage('globe') || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  globe.zoomTarget = Math.min(2.4, Math.max(0.55, globe.zoomTarget * Math.exp(-e.deltaY * 0.0025)));
}, { passive: false });

function nearStage(name) {
  const i = order.indexOf(name);
  return Math.abs(stageF - i) < 0.5;
}

const raycaster = new THREE.Raycaster();
const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
function hoverCheck(e) {
  if (!tip) return;
  // over interactive DOM (legend, tags, links)? that element drives the scene — hands off
  if (e.target && e.target.closest && e.target.closest('.globe-list, .tag, a, button')) {
    tip.classList.remove('on');
    document.body.classList.remove('scene-pointer');
    return;
  }
  let label = null;
  if (nearStage('globe') && globe.count) {
    sphere.radius = globe.R * globe.zoom;
    raycaster.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
    const hit = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
    globe.highlight = -1;
    if (hit) {
      hit.multiplyScalar(1 / globe.zoom);
      hit.applyMatrix4(new THREE.Matrix4().makeRotationX(-globe.pitch));
      hit.applyMatrix4(new THREE.Matrix4().makeRotationY(-globe.rot));
      let best = -1, bestD = globe.R * 0.09;
      for (const d of globe.dots) {
        if (d.c < 0) continue;
        const dist = d.v.distanceTo(hit);
        if (dist < bestD) { bestD = dist; best = d.c; }
      }
      if (best >= 0) { label = globe.names[best]; globe.highlight = best; }
    }
    setLegendLit(globe.highlight);
  } else if (nearStage('constellation') && constel.nodes.length) {
    let best = -1, bestD = 44;
    for (let ni = 0; ni < constel.nodes.length; ni++) {
      const nd = constel.nodes[ni];
      if (!nd.cur) continue;
      const p = nd.cur.clone().project(camera);
      const sx = (p.x + 1) / 2 * innerWidth, sy = (-p.y + 1) / 2 * innerHeight;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bestD) { bestD = d; best = ni; }
    }
    constel.highlight = best;
    if (best >= 0) label = constel.nodes[best].name;
  }
  if (label) {
    tip.textContent = label;
    tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
    tip.classList.add('on');
    document.body.classList.add('scene-pointer');
  } else {
    tip.classList.remove('on');
    document.body.classList.remove('scene-pointer');
  }
}

/* ── DOM ↔ scene bindings ── */
let legendEls = [];
function setLegendLit(idx) {
  legendEls.forEach((el, i) => el.classList.toggle('lit', i === idx));
}

function bindDom() {
  legendEls = [...document.querySelectorAll('.globe-list .flag-item')];
  legendEls.forEach((el, i) => {
    el.addEventListener('mouseenter', () => {
      globe.highlight = i;
      globe.rotTarget = globe.rotFor ? globe.rotFor[i] : null;
      globe.pitchTarget = globe.pitchFor ? globe.pitchFor[i] : null;
      setLegendLit(i);
      if (reducedMotion && globe.rotTarget != null) {
        globe.rot = globe.rotTarget;
        globe.pitch = globe.pitchTarget || 0;
        renderStatic();
      }
    });
    el.addEventListener('mouseleave', () => {
      globe.highlight = -1;
      globe.rotTarget = null;
      globe.pitchTarget = null;
      setLegendLit(-1);
      if (reducedMotion) renderStatic();
    });
  });

  const caminoEl = document.getElementById('globe-camino');
  if (caminoEl) {
    caminoEl.addEventListener('mouseenter', () => {
      globe.caminoLit = true;
      if (reducedMotion) renderStatic();
    });
    caminoEl.addEventListener('mouseleave', () => {
      globe.caminoLit = false;
      if (reducedMotion) renderStatic();
    });
  }

  document.querySelectorAll('[data-scene="stream"] + .section-body .entry').forEach((el, i) => {
    el.addEventListener('mouseenter', () => { streamState.highlight = i; });
    el.addEventListener('mouseleave', () => { streamState.highlight = -1; });
  });

  document.querySelectorAll('[data-scene="rings"] + .section-body .edu-entry').forEach((el, i) => {
    el.addEventListener('mouseenter', () => { ringsState.highlight = i; });
    el.addEventListener('mouseleave', () => { ringsState.highlight = -1; });
  });

  // icebreaker cards → nebula topic clusters (DOM order matches buildNebula's topics[])
  document.querySelectorAll('.interest-card').forEach((el, i) => {
    el.addEventListener('mouseenter', () => { nebulaState.highlight = i; });
    el.addEventListener('mouseleave', () => { nebulaState.highlight = -1; });
    el.addEventListener('focus', () => { nebulaState.highlight = i; });
    el.addEventListener('blur', () => { nebulaState.highlight = -1; });
  });

  // skill tags → constellation nodes (i18n-safe via data-i18n key aliases)
  const KEY_ALIAS = {
    'skills.arch.micro': 'Microservices',
    'skills.arch.realtime': 'Real-time',
    'skills.arch.design': 'System Design'
  };
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  document.querySelectorAll('[data-scene="constellation"] + .section-body .tag').forEach(el => {
    const name = KEY_ALIAS[el.getAttribute('data-i18n')] || el.textContent;
    const tn = norm(name);
    const idx = SKILLS.findIndex(([n]) => {
      const nn = norm(n);
      return nn === tn || tn.startsWith(nn) || nn.startsWith(tn);
    });
    if (idx < 0) return;
    el.addEventListener('mouseenter', () => { constel.highlight = idx; });
    el.addEventListener('mouseleave', () => { constel.highlight = -1; });
  });

  document.querySelectorAll('[data-scene="neural"] + .section-body .tag').forEach(el => {
    el.addEventListener('mouseenter', () => { neural.burst = clock.getElapsedTime(); });
  });
}

/* ── Render loop ── */
const target = new Float32Array(N * 3);
const targetCol = new Float32Array(N * 3);
const scratch = new Float32Array(N * 3);
const scratchCol = new Float32Array(N * 3);
const clock = new THREE.Clock();
let rafId = null;

/* live-tunable via the dev HUD (lab.js) */
const tune = { k: 0.075 };

/* scroll-velocity streaks: smoothed px/frame velocity, sampled from scrollY
   each frame — no scroll listener needed, and it decays to 0 at rest. */
let scrollVel = 0, lastScrollY = scrollY;

/* click shockwave: fixed pool of 3 concurrent ripples, no per-click allocation */
const waves = [{ x: 0, y: 0, t0: -1e9 }, { x: 0, y: 0, t0: -1e9 }, { x: 0, y: 0, t0: -1e9 }];
let waveIdx = 0;
function emitWave(clientX, clientY) {
  const x = (clientX / innerWidth) * 2 - 1;
  const y = -(clientY / innerHeight) * 2 + 1;
  const w = waves[waveIdx];
  w.x = x * halfW(); w.y = y * halfH; w.t0 = clock.getElapsedTime();
  waveIdx = (waveIdx + 1) % waves.length;
}

/* bloom (desktop only): dynamically loaded post-processing, fail-soft.
   window.__scene.bloom reports 'on' | 'off(fps)' | 'unavailable'. */
let composer = null, bloomPass = null;
let bloomState = 'unavailable';
let bloomWinStart = -1, bloomWinFrames = 0;
function bloomSize() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  return { w: Math.max(1, Math.floor(w / 2)), h: Math.max(1, Math.floor(h / 2)) };
}
async function setupBloom() {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js')
    ]);
    const s = bloomSize();
    const c = new EffectComposer(renderer);
    c.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(s.w, s.h), 0.55, 0.6, 0.15);
    c.addPass(bloomPass);
    scene.background = new THREE.Color(BG);
    composer = c;
    bloomState = 'on';
  } catch (e) {
    composer = null;
    bloomState = 'unavailable';
  }
}

function computeTargets(time) {
  const p = stageProgress();
  stageF = p;
  const i = Math.min(Math.floor(p), formations.length - 2);
  const t = Math.min(p - i, 1);
  const A = formations[i], B = formations[i + 1] || A;

  // dynamic per-frame formation updates
  const active = new Set([A.name, B.name]);
  let globePos = null;
  if (active.has('globe') && globe.count) {
    if (!pointer.down) {
      if (globe.rotTarget != null) {
        // legend hover: shortest-path ease to the country's face-on rotation
        let d = globe.rotTarget - globe.rot;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        globe.rot += d * 0.07;
        let dp = (globe.pitchTarget || 0) - globe.pitch;
        dp = Math.atan2(Math.sin(dp), Math.cos(dp));
        globe.pitch += dp * 0.07;
      } else {
        globe.rot += 0.0016 + (globe.rotVel *= 0.95);
        globe.pitch += (globe.pitchVel *= 0.95);
      }
    }
    globe.zoom += (globe.zoomTarget - globe.zoom) * 0.08;
    updateGlobe(scratch, scratchCol);
    globePos = scratch;
  }
  if (active.has('constellation') && constel.nodes.length) {
    updateConstellation();
  }
  const burstK = Math.max(0, 1 - (time - neural.burst));
  if (active.has('neural') && neural.pulseCount) {
    const src = F.neural;
    for (let k = 0; k < neural.pulseCount; k++) {
      const e = neural.edges[k % neural.edges.length];
      const a = neural.nodes[e[0]].v, b = neural.nodes[e[1]].v;
      const tt = (time * 0.25 + phase[k]) % 1;
      const idx = (neural.pulseStart + k) * 3;
      src.pos[idx] = a.x + (b.x - a.x) * tt;
      src.pos[idx + 1] = a.y + (b.y - a.y) * tt;
      src.pos[idx + 2] = a.z + (b.z - a.z) * tt;
    }
  }

  for (let j = 0; j < N * 3; j++) {
    const aGlobe = A.name === 'globe' && globePos;
    const bGlobe = B.name === 'globe' && globePos;
    const aP = aGlobe ? globePos[j] : A.pos[j];
    const bP = bGlobe ? globePos[j] : B.pos[j];
    target[j] = aP + (bP - aP) * t;
    const aC = aGlobe ? scratchCol[j] : A.col[j];
    const bC = bGlobe ? scratchCol[j] : B.col[j];
    targetCol[j] = aC + (bC - aC) * t;
  }

  // cinematic intro: supernova collapses into the first formation, staggered per-particle
  if (!introDone && nova) {
    if (introStart == null) introStart = time;
    const introT = time - introStart;
    if (introT >= INTRO_DUR) {
      introDone = true; // after this, cost is a single boolean check above
    } else {
      const theta = 2.2 * Math.pow(1 - introT / INTRO_DUR, 2);
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      for (let i = 0; i < N; i++) {
        const i3 = i * 3;
        let w = (introT - stagger[i]) / 1.4;
        w = w < 0 ? 0 : w > 1 ? 1 : w;
        w = w * w * (3 - 2 * w); // smoothstep
        const nx = nova.pos[i3], ny = nova.pos[i3 + 1], nz = nova.pos[i3 + 2];
        const rx = nx * cosT + nz * sinT; // rotate nova position around Y by the decaying swirl angle
        const rz = nz * cosT - nx * sinT;
        target[i3] = rx + (target[i3] - rx) * w;
        target[i3 + 1] = ny + (target[i3 + 1] - ny) * w;
        target[i3 + 2] = rz + (target[i3 + 2] - rz) * w;
        targetCol[i3] = nova.col[i3] + (targetCol[i3] - nova.col[i3]) * w;
        targetCol[i3 + 1] = nova.col[i3 + 1] + (targetCol[i3 + 1] - nova.col[i3 + 1]) * w;
        targetCol[i3 + 2] = nova.col[i3 + 2] + (targetCol[i3 + 2] - nova.col[i3 + 2]) * w;
      }
    }
  }

  // scroll-velocity streaks: fast scrolling stretches particles along the scroll direction
  if (!reducedMotion) {
    scrollVel += (scrollY - lastScrollY - scrollVel) * 0.2;
    lastScrollY = scrollY;
    if (Math.abs(scrollVel) < 0.001) scrollVel = 0; // decay to exactly 0 at rest
    const streak = Math.max(-1.8, Math.min(1.8, scrollVel * 0.04));
    if (streak !== 0) {
      for (let k = 0; k < N; k++) {
        target[k * 3 + 1] += streak * (0.5 + 0.5 * Math.sin(phase[k]));
      }
    }
  }

  // click shockwave: up to 3 concurrent ripples push nearby particles outward
  let anyWaveActive = false;
  for (let wi = 0; wi < waves.length; wi++) if (time - waves[wi].t0 < 1.6) { anyWaveActive = true; break; }
  if (anyWaveActive) {
    for (let k = 0; k < N; k++) {
      const i3 = k * 3;
      const px = target[i3], py = target[i3 + 1];
      for (let wi = 0; wi < waves.length; wi++) {
        const age = time - waves[wi].t0;
        if (age < 0 || age >= 1.6) continue;
        const dx = px - waves[wi].x, dy = py - waves[wi].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.0001) continue;
        const R = age * 9, wth = 1.1;
        const diff = Math.abs(d - R);
        if (diff < wth) {
          const decay = 1 - age / 1.6;
          const push = (1 - diff / wth) * decay;
          target[i3] += (dx / d) * push;
          target[i3 + 1] += (dy / d) * push;
          const b = 1 + push * 1.6; // the ripple lights what it moves
          targetCol[i3] *= b; targetCol[i3 + 1] *= b; targetCol[i3 + 2] *= b;
        }
      }
    }
  }

  // text-driven flares: hovering an entry/tag lights its counterpart in the scene
  if (active.has('stream') && streamState.highlight >= 0) {
    boostCol(streamState.wayStart + streamState.highlight * streamState.perWay, streamState.perWay, 2.4);
  }
  if (active.has('rings') && ringsState.highlight >= 0) {
    // education entries run newest→oldest; growth rings run inner=oldest
    boostCol(ringsState.per * (3 - ringsState.highlight), ringsState.per, 2.2);
  }
  if (active.has('constellation') && constel.highlight >= 0) {
    boostCol(constel.highlight * constel.perNode, constel.perNode, 2.2);
  }
  if (active.has('neural') && burstK > 0 && neural.pulseCount) {
    boostCol(neural.pulseStart, neural.pulseCount, 1 + burstK * 1.8);
  }
  if (active.has('nebula') && nebulaState.highlight >= 0) {
    const c = nebulaState.clusters[nebulaState.highlight];
    if (c) boostCol(c.start, c.count, 2.4);
  }

  // hero cursor repulsion (only once the pointer is real — default (0,0) would blast a hole)
  const heroW = 1 - Math.min(p, 1);
  if (heroW > 0.05 && !isMobile && pointer.moved) {
    const r2 = 1.1;
    for (let k = 0; k < N; k++) {
      const i3 = k * 3;
      const dx = target[i3] - pointer.worldX;
      const dy = target[i3 + 1] - pointer.worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.0001) {
        const push = (1 - d2 / r2) * 0.9 * heroW;
        const d = Math.sqrt(d2);
        target[i3] += (dx / d) * push;
        target[i3 + 1] += (dy / d) * push;
        const b = 1 + push * 1.4; // cursor as a torch: displaced particles glow
        targetCol[i3] *= b; targetCol[i3 + 1] *= b; targetCol[i3 + 2] *= b;
      }
    }
  }

  // starship repulsion (easter egg) — same idea as the hero cursor repulsion
  // above, extended to 3D and keyed to the ship's world position instead of
  // the 2D pointer. Inert unless starship.js sets window.__scene.shipPos.
  if (window.__scene && window.__scene.shipPos) {
    const sp = window.__scene.shipPos, r2 = 2.4;
    for (let k = 0; k < N; k++) {
      const i3 = k * 3;
      const dx = target[i3] - sp.x;
      const dy = target[i3 + 1] - sp.y;
      const dz = target[i3 + 2] - sp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2 && d2 > 0.0001) {
        const push = (1 - d2 / r2) * 1.1;
        const d = Math.sqrt(d2);
        target[i3] += (dx / d) * push;
        target[i3 + 1] += (dy / d) * push;
        target[i3 + 2] += (dz / d) * push;
      }
    }
  }

  // tooltip only makes sense near its interactive stages
  if (tip && tip.classList.contains('on') && !nearStage('globe') && !nearStage('constellation')) {
    tip.classList.remove('on');
    globe.highlight = -1;
    setLegendLit(-1);
    document.body.classList.remove('scene-pointer');
  }

  // line layer opacity
  const wN = 1 - Math.min(Math.abs(p - order.indexOf('neural')), 1);
  neuralLines.material.opacity = wN * (0.18 + burstK * 0.3);
  neuralLines.visible = wN > 0.02;
  const wC = 1 - Math.min(Math.abs(p - order.indexOf('constellation')), 1);
  constelLines.material.opacity = wC * (isMobile ? 0.16 : 0.3);
  constelLines.visible = wC > 0.02;

  // brand-logo sprites ride their constellation nodes
  if (constel.sprites) {
    const show = wC > 0.05 && constel.nodes.length && constel.nodes[0].cur;
    for (let si = 0; si < constel.sprites.length; si++) {
      const sp = constel.sprites[si];
      if (!sp) continue;
      sp.visible = !!show;
      if (show) {
        sp.position.copy(constel.nodes[si].cur);
        const hot = si === constel.highlight;
        // mobile: text flows over the scene, so logos stay small and quiet
        sp.material.opacity = Math.max(0, (wC - 0.35) / 0.65) * (isMobile ? 0.3 : hot ? 1 : 0.8);
        const s = isMobile ? 0.34 : hot ? 0.64 : 0.46;
        sp.scale.set(s, s, 1);
      }
    }
  }
}

function boostCol(start, count, mult) {
  const a = start * 3, b = Math.min((start + count) * 3, targetCol.length);
  for (let j = a; j < b; j++) targetCol[j] *= mult;
}

let roll = 0;
function frame() {
  const time = clock.getElapsedTime();
  uTime.value = time; // drives GPU drift + twinkle (replaced the CPU wobble loop)
  computeTargets(time);

  const posAttr = geometry.attributes.position.array;
  const colAttr = geometry.attributes.color.array;
  const k = tune.k;
  for (let j = 0; j < N * 3; j++) {
    posAttr[j] += (target[j] - posAttr[j]) * k;
    colAttr[j] += (targetCol[j] - colAttr[j]) * 0.06;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;

  camera.position.x += (pointer.worldX * 0.03 - camera.position.x) * 0.04;
  camera.position.y += (pointer.worldY * 0.02 - camera.position.y) * 0.04;
  camera.lookAt(0, 0, 0);
  // scroll tilt: fast scrolling banks the camera a touch; settles back to 0
  roll += (Math.max(-60, Math.min(60, scrollVel)) * -0.00022 - roll) * 0.08;
  camera.rotation.z += roll;

  if (composer) {
    // stage-aware bloom: the hero blooms hard, later stages settle down
    bloomPass.strength = 0.45 + 0.3 * Math.max(0, 1 - stageF);
    // FPS guard: rolling ~3s window; a sustained drop permanently disables bloom
    if (bloomWinStart < 0) { bloomWinStart = time; bloomWinFrames = 0; }
    bloomWinFrames++;
    const winSpan = time - bloomWinStart;
    if (winSpan >= 3) {
      if (bloomWinFrames / winSpan < 45) {
        composer = null;
        scene.background = null;
        bloomState = 'off(fps)';
      } else {
        bloomWinStart = time; bloomWinFrames = 0;
      }
    }
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (window.__scene) window.__scene.frames++;
  rafId = requestAnimationFrame(frame);
}

/* Reduced motion: settle instantly per section, render on scroll only */
function renderStatic() {
  computeTargets(0);
  geometry.attributes.position.array.set(target);
  geometry.attributes.color.array.set(targetCol);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  computeAnchors();
  if (composer) {
    composer.setSize(innerWidth, innerHeight);
    const s = bloomSize();
    bloomPass.setSize(s.w, s.h);
  }
  if (reducedMotion) renderStatic();
});

build().then(() => {
  document.body.classList.add('has-3d');
  bindDom();
  computeAnchors();
  // re-measure after layout settles (fonts/images)
  setTimeout(computeAnchors, 600);
  addEventListener('load', computeAnchors);

  if (reducedMotion) {
    renderStatic();
    addEventListener('scroll', renderStatic, { passive: true });
  } else {
    if (!isMobile) setupBloom(); // fire-and-forget; CDN failure or slow load leaves plain render
    frame();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
      else if (rafId === null) frame();
    });
  }
}).catch(err => {
  console.error('scene disabled:', err);
  canvas.remove();
});

/* Introspection surface — the dev HUD (lab.js) and the command palette read
   from here. Inert until something reads it. */
window.__scene = {
  constel, streamState, ringsState, nebulaState, neural, globe, frames: 0,
  N, order, tune, points,
  spriteCv,
  get bloom() { return bloomState; },
  /* starship easter egg (starship.js) sets this while flying; the particle
     repulsion block in computeTargets reads it. Inert while null. */
  shipPos: null,
  get stageF() { return stageF; },
  /* scatter every particle; the morph loop pulls them home */
  party() {
    const p = geometry.attributes.position.array;
    for (let i = 0; i < p.length; i++) p[i] += (Math.random() - 0.5) * 4;
    geometry.attributes.position.needsUpdate = true;
    if (reducedMotion) renderStatic();
  },
  snap() { renderer.render(scene, camera); return renderer.domElement.toDataURL(); }
};
