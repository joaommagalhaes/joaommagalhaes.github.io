document.addEventListener('DOMContentLoaded', function () {

  /* ── Font size ── */
  var SIZES = [18, 19, 20, 21, 22];
  var sizeIdx = 2; // Default 20px
  try {
    var saved = parseInt(localStorage.getItem('fontIdx'));
    if (!isNaN(saved) && saved >= 0 && saved < SIZES.length) sizeIdx = saved;
  } catch (e) {}

  function applyFont() {
    document.documentElement.style.fontSize = SIZES[sizeIdx] + 'px';
  }
  function adjustFont(dir) {
    sizeIdx = Math.max(0, Math.min(SIZES.length - 1, sizeIdx + dir));
    applyFont();
    try { localStorage.setItem('fontIdx', sizeIdx); } catch (e) {}
  }
  applyFont();

  /* ── Dark mode ── */
  function toggleTheme() {
    var html = document.documentElement;
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    var l = document.getElementById('icon-light');
    var d = document.getElementById('icon-dark');
    if (l) l.style.display = next === 'dark' ? 'none' : '';
    if (d) d.style.display = next === 'dark' ? '' : 'none';
    try { localStorage.setItem('theme', next); } catch (e) {}
  }

  try {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      var l = document.getElementById('icon-light');
      var d = document.getElementById('icon-dark');
      if (l) l.style.display = 'none';
      if (d) d.style.display = '';
    }
  } catch (e) {}

  /* ── TL;DR overlay ── */
  var tldrOverlay = document.getElementById('tldr');
  var btnTldr = document.getElementById('btn-tldr');
  var btnCloseTldr = document.getElementById('btn-close-tldr');
  var lastFocusedElement;

  function openTldr() {
    if (tldrOverlay) {
      lastFocusedElement = document.activeElement;
      tldrOverlay.classList.add('open');
      tldrOverlay.setAttribute('aria-hidden', 'false');
      if (btnTldr) btnTldr.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      
      var floaters = document.querySelectorAll('.toolbar, .btn-back-to-top');
      floaters.forEach(function(el) { el.classList.add('hidden-by-modal'); });

      setTimeout(function() { if (btnCloseTldr) btnCloseTldr.focus(); }, 100);
    }
  }
  function closeTldr() {
    if (tldrOverlay) {
      tldrOverlay.classList.remove('open');
      tldrOverlay.setAttribute('aria-hidden', 'true');
      if (btnTldr) btnTldr.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      
      var floaters = document.querySelectorAll('.toolbar, .btn-back-to-top');
      floaters.forEach(function(el) { el.classList.remove('hidden-by-modal'); });

      if (lastFocusedElement) lastFocusedElement.focus();
    }
  }

  if (tldrOverlay) {
    tldrOverlay.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeTldr();
      if (e.key === 'Tab') {
        var focusable = tldrOverlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) {
          var first = focusable[0];
          var last = focusable[focusable.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) { last.focus(); e.preventDefault(); }
          } else {
            if (document.activeElement === last) { first.focus(); e.preventDefault(); }
          }
        }
      }
    });
  }

  /* ── Internationalization (i18n) ── */
  var defaultLocale = 'en';
  var currentLocale = defaultLocale;
  var translations = {};

  try {
    var savedLocale = localStorage.getItem('locale');
    if (savedLocale === 'en' || savedLocale === 'pt') currentLocale = savedLocale;
  } catch (e) {}

  function updateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (translations[key]) {
        if (el.getAttribute('data-i18n-html') === 'true') {
          el.innerHTML = translations[key];
        } else {
          el.textContent = translations[key];
        }
      }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function(el) {
      var parts = el.getAttribute('data-i18n-attr').split('|');
      if (parts.length === 2) {
        var attr = parts[0];
        var key = parts[1];
        if (translations[key]) {
          el.setAttribute(attr, translations[key]);
        }
      }
    });

    // Update lang button UI
    var ptText = document.querySelector('.lang-text.pt');
    var enText = document.querySelector('.lang-text.en');
    if (ptText && enText) {
      if (currentLocale === 'en') {
        ptText.style.display = 'none';
        enText.style.display = '';
      } else {
        ptText.style.display = '';
        enText.style.display = 'none';
      }
    }
  }

  function loadTranslations(locale) {
    if (typeof locales !== 'undefined' && locales[locale]) {
      translations = locales[locale];
      document.documentElement.lang = locale;
      updateDOM();
    } else {
      console.error('Translations not found for locale:', locale);
    }
  }

  function toggleLanguage() {
    currentLocale = currentLocale === 'en' ? 'pt' : 'en';
    try { localStorage.setItem('locale', currentLocale); } catch (e) {}
    loadTranslations(currentLocale);
  }

  // Initial load
  loadTranslations(currentLocale);

  /* ── Button bindings ── */
  var bindings = {
    'btn-theme':      toggleTheme,
    'btn-tldr':       openTldr,
    'btn-close-tldr': closeTldr,
    'btn-font-down':  function () { adjustFont(-1); },
    'btn-font-up':    function () { adjustFont(1); },
    'btn-lang':       toggleLanguage
  };
  Object.keys(bindings).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', bindings[id]);
  });

  /* ── Reveal on Scroll ── */
  var observerOptions = { root: null, rootMargin: '0px', threshold: 0.15 };
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  document.querySelectorAll('.reveal, .section-label').forEach(function (el) {
    observer.observe(el);
  });

  /* ── Local Time ── */
  function updateTime() {
    var timeEl = document.getElementById('local-time');
    if (!timeEl) return;
    var now = new Date();
    var formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: '2-digit', minute: '2-digit'
    });
    timeEl.textContent = '· ' + formatter.format(now) + ' Local time';
  }
  updateTime();
  setInterval(updateTime, 60000);

  /* ── Scroll Events (Progress & Back to Top) ── */
  var progressBar = document.getElementById('progress-bar');
  var btnBackToTop = document.getElementById('btn-back-to-top');

  window.addEventListener('scroll', function() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    var progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    if (progressBar) progressBar.style.width = progress + '%';

    if (btnBackToTop) {
      if (scrollTop > 300) btnBackToTop.classList.add('visible');
      else btnBackToTop.classList.remove('visible');
    }
  }, { passive: true });

  if (btnBackToTop) {
    btnBackToTop.addEventListener('click', function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Section Nav: Smooth Scroll with Easing ── */
  var navLinks = document.querySelectorAll('.section-nav-link');

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function smoothScrollTo(targetY, duration) {
    var startY = window.scrollY;
    var diff = targetY - startY;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = easeInOutCubic(progress);
      window.scrollTo(0, startY + diff * eased);
      if (elapsed < duration) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  navLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var targetId = this.getAttribute('href').substring(1);
      var target = document.getElementById(targetId);
      if (target) {
        var navHeight = document.querySelector('.section-nav')
          ? document.querySelector('.section-nav').offsetHeight
          : 0;
        var targetY = target.getBoundingClientRect().top + window.scrollY - navHeight - 16;
        smoothScrollTo(targetY, 800);
      }
    });
  });

  /* ── Section Nav: Scroll-spy ── */
  var sectionIds = ['about', 'experience', 'ai', 'skills', 'education', 'languages', 'offscreen'];
  var sections = sectionIds.map(function(id) { return document.getElementById(id); }).filter(Boolean);

  var spyObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var activeId = entry.target.id;
        navLinks.forEach(function(link) {
          if (link.getAttribute('href') === '#' + activeId) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  }, { root: null, rootMargin: '-20% 0px -60% 0px', threshold: 0 });

  sections.forEach(function(section) {
    spyObserver.observe(section);
  });

  /* ── Touch Interactivity & Tooltip Bounds ── */
  var touchItems = document.querySelectorAll('.ik-item, .flag-item, .interactive-pill-wrapper');
  
  function checkBoundary(el) {
    if (!el.classList.contains('ik-item') && !el.classList.contains('flag-item')) return;
    var rect = el.getBoundingClientRect();
    var center = rect.left + rect.width / 2;
    var vw = window.innerWidth;
    el.classList.remove('align-left', 'align-right');
    if (center < 100) el.classList.add('align-left');
    else if (vw - center < 100) el.classList.add('align-right');
  }

  function clearTooltips() {
    touchItems.forEach(function(item) {
      item.classList.remove('tooltip-active');
    });
  }

  touchItems.forEach(function(item) {
    item.addEventListener('mouseenter', function() { checkBoundary(this); });
    item.addEventListener('click', function(e) {
      checkBoundary(this);
      // Toggle logic for interactive items to simulate hover on touch screens
      var isActive = this.classList.contains('tooltip-active');
      clearTooltips();
      if (!isActive) {
        this.classList.add('tooltip-active');
      }
      e.stopPropagation();
    });
  });

  document.addEventListener('click', function() {
    clearTooltips();
  });

});
