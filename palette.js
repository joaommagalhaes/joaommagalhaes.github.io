/* ──────────────────────────────────────────────────────────────────────────
   Command palette — ⌘K / Ctrl+K.
   The interesting bit is the fuzzy matcher: a from-scratch subsequence
   scorer (~20 lines). Characters must appear in order; consecutive runs
   and word-boundary hits score higher, gaps cost a little. The same idea
   powers every editor's file switcher.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const overlay = document.getElementById('palette');
  const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');
  if (!overlay || !input || !list) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EMAIL = 'argento.literal.0j@icloud.com';

  const t = (key, fallback) => {
    const lang = document.documentElement.lang;
    return (typeof locales !== 'undefined' && locales[lang] && locales[lang][key]) || fallback;
  };
  /* search text spans both languages so "exp" finds "Experiência" in PT mode */
  const both = (key, fallback) => {
    if (typeof locales === 'undefined') return fallback;
    return ((locales.en[key] || '') + ' ' + (locales.pt[key] || '')) || fallback;
  };

  function go(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  const SECTIONS = [
    ['about', '01'], ['experience', '02'], ['ai', '03'], ['skills', '04'],
    ['education', '05'], ['languages', '06'], ['offscreen', '07'], ['lab', '08']
  ];

  const defs = [
    ...SECTIONS.map(([id, num]) => ({
      label: () => t('nav.' + id, id),
      search: () => both('nav.' + id, id),
      hint: num,
      run: () => go(id)
    })),
    {
      label: () => t('offscreen.travel', 'Travelled'),
      search: () => both('offscreen.travel', 'travel globe countries'),
      hint: '✈',
      run: () => go('travel')
    },
    {
      label: () => t('palette.cmd.lang', 'Toggle language (EN/PT)'),
      search: () => both('palette.cmd.lang', 'language idioma'),
      hint: '⌘',
      run: () => { const b = document.getElementById('btn-lang'); if (b) b.click(); }
    },
    {
      label: () => t('palette.cmd.hud', 'Toggle dev HUD'),
      search: () => both('palette.cmd.hud', 'hud debug fps'),
      hint: '⌘',
      run: () => { const b = document.getElementById('lab-hud-toggle'); if (b) b.click(); }
    },
    {
      label: () => t('palette.cmd.email', 'Copy email address'),
      search: () => both('palette.cmd.email', 'email copy contact'),
      hint: '⌘',
      run: () => { if (navigator.clipboard) navigator.clipboard.writeText(EMAIL).catch(() => {}); }
    },
    {
      label: () => t('palette.cmd.hire', 'Hire me — open email'),
      search: () => both('palette.cmd.hire', 'hire contratar job work'),
      hint: '⌘',
      run: () => { location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(t('palette.hire_subject', "Let's talk")); }
    },
    {
      label: () => t('palette.cmd.party', 'Party mode'),
      search: () => both('palette.cmd.party', 'party konami confetti festa'),
      hint: '✦',
      run: () => { if (window.__scene) window.__scene.party(); }
    },
    {
      label: () => t('palette.cmd.fly', 'Fly the starship'),
      search: () => both('palette.cmd.fly', 'fly ship starship konami nave voar'),
      hint: '🚀',
      run: () => { if (window.__starship) window.__starship.fly(); }
    },
    {
      label: () => t('palette.cmd.top', 'Back to top'),
      search: () => both('palette.cmd.top', 'top topo home'),
      hint: '↑',
      run: () => scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
    }
  ];

  /* ── the matcher ──
     Returns a score, or -1 when the query is not a subsequence of text.
     +run·3   consecutive characters beat scattered ones
     +8       word-start hits beat mid-word hits
     −0.5     every skipped character costs a little, so tighter matches win */
  function fuzzy(query, text) {
    const q = query.toLowerCase(), s = text.toLowerCase();
    let qi = 0, score = 0, run = 0;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) {
        run++;
        const wordStart = i === 0 || s[i - 1] === ' ' || s[i - 1] === '-' || s[i - 1] === '(';
        score += 2 + run * 3 + (wordStart ? 8 : 0);
        qi++;
      } else {
        run = 0;
        score -= 0.5;
      }
    }
    return qi === q.length ? score : -1;
  }

  let results = [];
  let active = 0;

  function render() {
    const q = input.value.trim();
    results = q
      ? defs.map((d) => [fuzzy(q, d.search()), d])
          .filter(([sc]) => sc >= 0)
          .sort((a, b) => b[0] - a[0])
          .map(([, d]) => d)
      : defs.slice();
    active = 0;
    list.innerHTML = '';
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'palette-empty';
      li.textContent = t('palette.empty', 'No matches');
      list.appendChild(li);
      input.removeAttribute('aria-activedescendant');
      return;
    }
    results.forEach((d, i) => {
      const li = document.createElement('li');
      li.id = 'palette-opt-' + i;
      li.setAttribute('role', 'option');
      li.innerHTML = '<span></span><em></em>';
      li.firstChild.textContent = d.label();
      li.lastChild.textContent = d.hint;
      li.addEventListener('mouseenter', () => { setActive(i); });
      li.addEventListener('click', () => { run(i); });
      list.appendChild(li);
    });
    setActive(0);
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
    input.setAttribute('aria-activedescendant', 'palette-opt-' + i);
    const el = list.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const d = results[i];
    close();
    if (d) d.run();
  }

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    input.value = '';
    render();
    input.focus();
  }

  function close() {
    overlay.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.hidden ? open() : close();
      return;
    }
    if (overlay.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive((active + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive((active - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results.length) run(active); }
    else if (e.key === 'Tab') { e.preventDefault(); } // single-field dialog: focus stays put
  });

  input.addEventListener('input', render);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  const btn = document.getElementById('btn-palette');
  if (btn) btn.addEventListener('click', open);
})();
