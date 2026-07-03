document.addEventListener('DOMContentLoaded', function () {

  /* ── Internationalization (i18n) ── */
  var currentLocale = 'en';
  var translations = {};

  try {
    var savedLocale = localStorage.getItem('locale');
    if (savedLocale === 'en' || savedLocale === 'pt') currentLocale = savedLocale;
  } catch (e) {}

  function updateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (translations[key]) {
        if (el.getAttribute('data-i18n-html') === 'true') {
          el.innerHTML = translations[key];
        } else {
          el.textContent = translations[key];
        }
      }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var parts = el.getAttribute('data-i18n-attr').split('|');
      if (parts.length === 2 && translations[parts[1]]) {
        el.setAttribute(parts[0], translations[parts[1]]);
      }
    });

    var ptText = document.querySelector('.lang-text.pt');
    var enText = document.querySelector('.lang-text.en');
    if (ptText && enText) {
      ptText.style.display = currentLocale === 'en' ? 'none' : '';
      enText.style.display = currentLocale === 'en' ? '' : 'none';
    }
  }

  function loadTranslations(locale) {
    if (typeof locales !== 'undefined' && locales[locale]) {
      translations = locales[locale];
      document.documentElement.lang = locale;
      updateDOM();
      updateTime();
    } else {
      console.error('Translations not found for locale:', locale);
    }
  }

  var btnLang = document.getElementById('btn-lang');
  if (btnLang) {
    btnLang.addEventListener('click', function () {
      currentLocale = currentLocale === 'en' ? 'pt' : 'en';
      try { localStorage.setItem('locale', currentLocale); } catch (e) {}
      loadTranslations(currentLocale);
    });
  }

  /* ── Local Time ── */
  var timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit', minute: '2-digit'
  });

  function updateTime() {
    var timeEl = document.getElementById('local-time');
    if (!timeEl) return;
    var label = translations['hero.local_time'] || 'Local time';
    timeEl.textContent = timeFormatter.format(new Date()) + ' · ' + label;
  }
  setInterval(updateTime, 60000);

  loadTranslations(currentLocale);

  /* ── Reveal on Scroll ── */
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

  /* ── Scroll Events (Progress & Back to Top) ── */
  var progressBar = document.getElementById('progress-bar');
  var btnBackToTop = document.getElementById('btn-back-to-top');

  window.addEventListener('scroll', function () {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    var progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    if (progressBar) progressBar.style.width = progress + '%';

    if (btnBackToTop) {
      btnBackToTop.classList.toggle('visible', scrollTop > 300);
    }
  }, { passive: true });

  if (btnBackToTop) {
    btnBackToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Section Nav: Scroll-spy ── */
  var navLinks = document.querySelectorAll('.section-nav-link');
  var sectionIds = ['about', 'experience', 'ai', 'skills', 'education', 'languages', 'offscreen'];
  // observe each section's body (labels are tiny); remember the id it belongs to
  var spyTargets = sectionIds.map(function (id) {
    var label = document.getElementById(id);
    if (!label) return null;
    var body = label.nextElementSibling;
    var el = (body && body.classList.contains('section-body')) ? body : label;
    el.setAttribute('data-spy', id);
    return el;
  }).filter(Boolean);

  var spyObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var id = entry.target.getAttribute('data-spy');
        navLinks.forEach(function (link) {
          link.classList.toggle('active', link.getAttribute('href') === '#' + id);
        });
      }
    });
  }, { rootMargin: '-15% 0px -55% 0px', threshold: 0 });

  spyTargets.forEach(function (el) {
    spyObserver.observe(el);
  });

});
