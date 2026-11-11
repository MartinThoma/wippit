// Wippit! — service worker registration, auto-update and install prompt.

/**
 * @param {object} o
 * @param {() => void} o.onUpdateReady  called once a new version has taken control
 * @param {HTMLElement} o.installButton  shown when the browser offers installation
 */
export function setupPwa({ onUpdateReady, installButton }) {
  if ('serviceWorker' in navigator) {
    // On a first visit the page gains a controller without a "new version" existing.
    const hadController = !!navigator.serviceWorker.controller;
    let notified = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || notified) return;
      notified = true;
      onUpdateReady();
    });

    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        const check = () => reg.update().catch(() => {});
        setInterval(check, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
        window.addEventListener('online', check);
      } catch (err) {
        console.warn('Service worker registration failed:', err);
      }
    });
  }

  if (installButton) {
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      installButton.hidden = false;
    });
    installButton.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* ignore */ }
      deferred = null;
      installButton.hidden = true;
    });
    window.addEventListener('appinstalled', () => { installButton.hidden = true; });
  }
}
