// theme.js — shared light/dark theme controller for all pages.
// Loaded synchronously in <head> so the theme is applied before first paint (no flash).
(function () {
  var KEY = 'cc_theme';

  function current() {
    var t = localStorage.getItem(KEY);
    return (t === 'dark' || t === 'light') ? t : 'light';
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Match browser chrome / PWA status bar to the theme.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#0f7a4d');
    // Update any toggle button icons (sun in dark = "switch to light").
    var icons = document.querySelectorAll('[data-theme-toggle] i');
    for (var i = 0; i < icons.length; i++) {
      icons[i].className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    }
    // Let charts / panels redraw with readable theme colors.
    try {
      window.dispatchEvent(new CustomEvent('cc-theme-change', { detail: { theme: theme } }));
    } catch (_) {}
  }

  // Apply immediately at parse time (runs in <head>).
  apply(current());

  window.toggleTheme = function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  };

  // Wire up toggle buttons once the DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {
    apply(current());
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', window.toggleTheme);
    }
  });
})();
