'use strict';

/* Only run inside the core frame; a detached gallery tab is allowed. */
{
  const absolute = path => new URL(chrome.runtime.getURL(path));
  const uiPathname = absolute('data/ui/index.html').pathname;
  const galleryPathname = absolute('data/gallery/index.html').pathname;
  const corePathname = absolute('data/inject/core/index.html').pathname;

  const isUI = location.pathname === uiPathname;
  const isGallery = location.pathname === galleryPathname;
  const detached = isGallery && window.top === window;
  const inCore = (() => {
    if (window.top === window) {
      return false;
    }
    try {
      return window.parent.location.pathname === corePathname;
    }
    catch (e) { // cross-origin parent
      return false;
    }
  })();

  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false; // preserve insertion order and delay the frame's load event
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.append(script);
  });

  if ((isUI || isGallery) && (detached || inCore)) {
    // order matters: ui/index.js defines globals used by persist.js
    const sources = isUI
      ? ['data/utils.js', 'data/ui/persist.js', 'data/ui/index.js']
      : ['data/utils.js', 'data/gallery/index.js'];
    (async () => {
      for (const src of sources) {
        await load(chrome.runtime.getURL(src));
      }
      // dynamically injected scripts do not delay DOMContentLoaded; replay it
      // for listeners (persist.js) that registered after the real event
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
