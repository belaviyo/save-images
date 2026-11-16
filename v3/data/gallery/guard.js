'use strict';

/* Only run the gallery inside the core panel or as a detached tab. */
{
  const inCore = (() => {
    try {
      return window.parent.location.pathname === new URL(chrome.runtime.getURL('data/inject/core/index.html')).pathname;
    }
    catch (e) { // cross-origin parent
      return false;
    }
  })();

  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.async = false; // preserve insertion order
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.append(script);
  });

  if (window.top === window || inCore) {
    (async () => {
      for (const src of ['data/utils.js', 'data/gallery/index.js']) {
        await load(src);
      }
      // dynamically injected scripts do not delay DOMContentLoaded; replay it
      // for listeners that registered after the real event
      if (document.readyState !== 'loading') {
        document.dispatchEvent(new Event('DOMContentLoaded'));
      }
    })().catch(e => console.error(e));
  }
  else {
    document.body.textContent = '';

    const p = document.createElement('p');
    p.textContent = 'This interface is only available inside the extension.';
    document.body.append(p);
  }
}
