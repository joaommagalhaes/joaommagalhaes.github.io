/* ──────────────────────────────────────────────────────────────────────────
   The Lab — hand-written demos. No libraries; the source is the exhibit.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* palette comes from the page's design tokens so the demos read as one system */
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
  const C = {
    panel: '#0b0e15',
    ink: tok('--ink', '#e8ebf2'),
    muted: tok('--muted', '#8b93a7'),
    rule: tok('--rule', '#1e2330'),
    accent: tok('--accent', '#6c9bff'),
    green: '#5fd39a',
    amber: '#ffc46b',
    wall: '#232a3a'
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('en-US');
  const t = (key, fallback) => {
    const lang = document.documentElement.lang;
    return (typeof locales !== 'undefined' && locales[lang] && locales[lang][key]) || fallback;
  };

  /* ══ 01 · The JS event loop, visualized ══════════════════════════════════
     Every scenario is a hand-authored, deterministic timeline — not a live
     interpreter. A real instrumented JS engine (à la Loupe) needs an AST
     parser to reinstrument arbitrary code; that's a different, much bigger
     tool. Scenarios live in eventloop-scenarios.json (edit that file to add
     more — tabs render dynamically from whatever's in there); the mechanics
     of each one are precomputed as an array of snapshots, verified by hand
     against real V8 semantics — Step/Play just walks the array. */
  (function eventLoop() {
    const card = $('lab-eventloop');
    if (!card) return;

    const tabsEl = card.querySelector('.el-tabs');
    const codeEl = card.querySelector('.el-code');
    const stackEl = card.querySelector('.el-stack');
    const microEl = card.querySelector('.el-micro');
    const macroEl = card.querySelector('.el-macro');
    const consoleEl = card.querySelector('.el-console');
    const noteEl = card.querySelector('.el-note');
    const stepBtn = $('lab-el-step');
    const playBtn = $('lab-el-play');
    const resetBtn = $('lab-el-reset');

    let SCENARIOS = [];
    let tabs = [];
    let current = 0, stepIdx = 0, playing = false, timer = null, visible = false;
    let prevStep = null; // last-rendered step, for pop-in diffing

    /* only newly-appeared items get the pop animation, not the whole lane
       on every render — diff against what was showing before */
    function chips(el, lane, items, prevItems) {
      el.textContent = '';
      if (!items.length) {
        const span = document.createElement('span');
        span.className = 'el-chip el-chip-empty';
        span.textContent = t('lab.eventloop.empty', '(empty)');
        el.appendChild(span);
        return;
      }
      items.forEach((label) => {
        const span = document.createElement('span');
        const isNew = !prevItems || !prevItems.includes(label);
        span.className = 'el-chip el-chip-' + lane + (isNew ? ' el-pop' : '');
        span.textContent = label;
        el.appendChild(span);
      });
    }

    function render() {
      const scenario = SCENARIOS[current];
      const step = scenario.steps[stepIdx];
      const prev = prevStep;

      codeEl.textContent = '';
      scenario.code.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'el-code-line' + (i === step.line ? ' active' : '');
        div.textContent = line;
        codeEl.appendChild(div);
      });

      chips(stackEl, 'stack', step.stack, prev && prev.stack);
      chips(microEl, 'micro', step.micro, prev && prev.micro);
      chips(macroEl, 'macro', step.macro, prev && prev.macro);

      consoleEl.textContent = '';
      if (!step.log.length) {
        const div = document.createElement('div');
        div.className = 'el-chip-empty';
        div.textContent = t('lab.eventloop.no_output', '(no output yet)');
        consoleEl.appendChild(div);
      } else {
        const prevLen = (prev && prev.log.length) || 0;
        step.log.forEach((line, i) => {
          const div = document.createElement('div');
          div.className = 'el-log-line' + (i >= prevLen ? ' el-pop' : '');
          div.textContent = line;
          consoleEl.appendChild(div);
        });
      }
      consoleEl.scrollTop = consoleEl.scrollHeight;

      noteEl.textContent = step.note;
      const atEnd = stepIdx >= scenario.steps.length - 1;
      stepBtn.disabled = atEnd;
      if (atEnd) stop();
      prevStep = step;
    }

    function goStep() {
      const scenario = SCENARIOS[current];
      if (stepIdx < scenario.steps.length - 1) stepIdx++;
      render();
    }

    function selectScenario(i) {
      stop();
      current = i;
      stepIdx = 0;
      prevStep = null;
      tabs.forEach((el, k) => el.classList.toggle('active', k === i));
      render();
    }

    function play() {
      playing = true;
      playBtn.textContent = t('lab.eventloop.pause', 'pause');
      tick();
    }
    function stop() {
      playing = false;
      playBtn.textContent = t('lab.eventloop.play', 'play');
      clearTimeout(timer);
      timer = null;
    }
    function tick() {
      if (!playing || !visible) return;
      goStep();
      if (stepIdx >= SCENARIOS[current].steps.length - 1) { stop(); return; }
      timer = setTimeout(tick, 900);
    }

    function showError() {
      tabsEl.textContent = '';
      codeEl.textContent = '';
      [stackEl, microEl, macroEl, consoleEl].forEach((el) => { el.textContent = ''; });
      noteEl.textContent = t('lab.eventloop.load_error', 'Could not load the scenarios — try reloading the page.');
      noteEl.classList.add('el-note-error');
      [stepBtn, playBtn, resetBtn].forEach((b) => { b.disabled = true; });
    }

    function boot(scenarios) {
      if (!Array.isArray(scenarios) || !scenarios.length) throw new Error('empty scenario list');
      SCENARIOS = scenarios;
      tabsEl.textContent = '';
      tabs = scenarios.map((s, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lab-btn' + (i === 0 ? ' active' : '');
        btn.textContent = s.title;
        btn.addEventListener('click', () => selectScenario(i));
        tabsEl.appendChild(btn);
        return btn;
      });

      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (!visible) stop();
      }, { rootMargin: '80px' }).observe(card);
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

      stepBtn.addEventListener('click', () => { stop(); goStep(); });
      playBtn.addEventListener('click', () => { playing ? stop() : play(); });
      resetBtn.addEventListener('click', () => selectScenario(current));

      selectScenario(0);
    }

    fetch('eventloop-scenarios.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(boot)
      .catch((err) => { console.error('event-loop scenarios failed to load:', err); showError(); });
  })();

  /* ══ 02 · Under the hood — dev HUD ══════════════════════════════════════
     Reads the introspection surface the background scene exposes on
     window.__scene. Zero cost until opened: the panel is built on first
     toggle and polls only while visible. Labels stay in English on
     purpose — it's a dev tool. */
  (function hud() {
    const btn = $('lab-hud-toggle');
    if (!btn) return;

    let panel = null, spark = null, timer = null, open = false;
    let lastFrames = 0, lastAt = 0;
    const samples = [];

    function build() {
      panel = document.createElement('div');
      panel.id = 'dev-hud';
      panel.innerHTML =
        '<div class="hud-row hud-title"><span>scene internals</span><button type="button" id="hud-close" aria-label="Close HUD">×</button></div>' +
        '<canvas id="hud-spark" width="220" height="44" aria-hidden="true"></canvas>' +
        '<div class="hud-row"><span>fps</span><b id="hud-fps">—</b></div>' +
        '<div class="hud-row"><span>particles</span><b id="hud-n">—</b></div>' +
        '<div class="hud-row"><span>formation</span><b id="hud-stage">—</b></div>' +
        '<label class="hud-row"><span>morph k</span><input type="range" id="hud-k" min="0.01" max="0.2" step="0.005"></label>' +
        '<label class="hud-row"><span>pt size</span><input type="range" id="hud-size" min="0.02" max="0.12" step="0.005"></label>';
      document.body.appendChild(panel);
      spark = $('hud-spark').getContext('2d');
      $('hud-close').addEventListener('click', () => toggle(false));
      $('hud-k').addEventListener('input', (e) => {
        if (window.__scene) window.__scene.tune.k = +e.target.value;
      });
      $('hud-size').addEventListener('input', (e) => {
        if (window.__scene) window.__scene.points.material.size = +e.target.value;
      });
    }

    function sample() {
      const s = window.__scene;
      const now = performance.now();
      if (s && lastAt) {
        const fps = Math.max(0, Math.min(120, ((s.frames - lastFrames) / (now - lastAt)) * 1000));
        samples.push(fps);
        if (samples.length > 44) samples.shift();
        $('hud-fps').textContent = fps > 1 ? String(Math.round(fps)) : '—';
        const i = Math.min(Math.floor(s.stageF), s.order.length - 1);
        const frac = Math.round((s.stageF - i) * 100);
        $('hud-stage').textContent = s.order[i] + (frac > 0 && i < s.order.length - 1
          ? ' → ' + s.order[i + 1] + ' ' + frac + '%' : '');
      }
      if (s) { lastFrames = s.frames; }
      lastAt = now;

      /* sparkline, 0–80 fps scale */
      const w = 220, h = 44;
      spark.clearRect(0, 0, w, h);
      spark.strokeStyle = 'rgba(139,147,167,0.35)';
      spark.strokeRect(0.5, 0.5, w - 1, h - 1);
      spark.beginPath();
      spark.strokeStyle = C.accent;
      for (let i = 0; i < samples.length; i++) {
        const x = (i / 43) * (w - 6) + 3;
        const y = h - 4 - (Math.min(samples[i], 80) / 80) * (h - 8);
        i === 0 ? spark.moveTo(x, y) : spark.lineTo(x, y);
      }
      spark.stroke();
    }

    function toggle(on) {
      open = on;
      if (open && !panel) build();
      if (panel) panel.classList.toggle('on', open);
      syncBtn();
      clearInterval(timer);
      timer = null;
      if (open) {
        const s = window.__scene;
        $('hud-n').textContent = s ? fmt(s.N) : 'scene offline';
        if (s) {
          $('hud-k').value = String(s.tune.k);
          $('hud-size').value = String(s.points.material.size);
        }
        samples.length = 0;
        lastAt = 0;
        sample();
        timer = setInterval(sample, 400);
      }
    }

    function syncBtn() {
      btn.textContent = open
        ? t('lab.hood.hud_close', 'close HUD')
        : t('lab.hood.hud', 'open dev HUD');
    }

    btn.addEventListener('click', () => toggle(!open));
    /* the language toggle rewrites the button via data-i18n; re-sync after */
    const langBtn = $('btn-lang');
    if (langBtn) langBtn.addEventListener('click', () => setTimeout(syncBtn));
  })();
})();
