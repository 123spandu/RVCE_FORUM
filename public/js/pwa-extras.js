// public/js/pwa-extras.js — Install prompt, share-target receive, periodic sync helpers
(function () {
  var INSTALL_DISMISS_KEY = 'cc_install_dismissed_at';
  var DISMISS_DAYS = 14;
  var deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function recentlyDismissed() {
    try {
      var at = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
      return at && (Date.now() - at) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }

  function showInstallBanner(show) {
    var el = document.getElementById('pwaInstallBanner');
    if (!el) return;
    el.classList.toggle('d-none', !show);
  }

  function syncInstallNav() {
    var nav = document.getElementById('navInstallBtn');
    if (!nav) return;
    nav.classList.toggle('d-none', isStandalone());
  }

  async function runInstallPrompt() {
    if (isStandalone()) {
      alert('RVCE Connect is already installed on this device.');
      return;
    }
    if (!deferredPrompt) {
      alert('To install: use your browser menu → “Add to Home Screen” / “Install app”.\n\nTip: open over HTTPS (or localhost), then use Install in the address bar.');
      return;
    }
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (_) {}
    deferredPrompt = null;
    showInstallBanner(false);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone() && !recentlyDismissed()) {
      showInstallBanner(true);
    }
    syncInstallNav();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    showInstallBanner(false);
    syncInstallNav();
    try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch (_) {}
  });

  document.addEventListener('DOMContentLoaded', function () {
    syncInstallNav();

    var forceInstall = false;
    try {
      forceInstall = new URLSearchParams(location.search).get('install') === '1';
    } catch (_) {}

    if (isStandalone()) {
      showInstallBanner(false);
    } else if (forceInstall || (!recentlyDismissed() && deferredPrompt)) {
      if (forceInstall) {
        try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch (_) {}
      }
      showInstallBanner(true);
    }

    var installBtn = document.getElementById('pwaInstallBtn');
    var dismissBtn = document.getElementById('pwaInstallDismiss');
    var navInstallBtn = document.getElementById('navInstallBtn');

    if (installBtn) {
      installBtn.addEventListener('click', function () { runInstallPrompt(); });
    }
    if (navInstallBtn) {
      navInstallBtn.addEventListener('click', function () { runInstallPrompt(); });
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (_) {}
        showInstallBanner(false);
      });
    }

    // Register periodic background sync when supported (Chromium)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async function (reg) {
        try {
          if ('periodicSync' in reg) {
            var status = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (status.state === 'granted' || status.state === 'prompt') {
              await reg.periodicSync.register('cc-refresh-feeds', { minInterval: 12 * 60 * 60 * 1000 });
            }
          }
        } catch (e) {
          console.warn('Periodic sync unavailable:', e.message || e);
        }
      });
    }
  });

  window.CCInstall = {
    prompt: runInstallPrompt,
    isStandalone: isStandalone
  };
})();
