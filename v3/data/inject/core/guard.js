'use strict';

/* Only load the core interface when inject.js opened this frame.
 * The worker compares the token from the URL fragment with the live token in
 * the top frame's isolated world; a page-created frame cannot present it. */
{
  const token = location.hash.slice(1);
  let settled = false;
  let loaded = false;

  const sources = [
    'data/inject/core/components/notification-view/notification-view.js',
    'data/inject/core/inzip.js',
    'data/inject/core/index.js'
  ];

  const blocked = () => {
    if (loaded) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    document.body.removeAttribute('data-guard');
    document.body.textContent = '';

    const p = document.createElement('p');
    p.textContent = 'This interface is only available inside the extension.';
    document.body.append(p);
  };

  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.async = false; // preserve insertion order
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.append(script);
  });

  const verify = async () => {
    if (!token) {
      throw Error('missing token');
    }
    return chrome.runtime.sendMessage({
      cmd: 'verify-core',
      token
    });
  };

  const timer = setTimeout(blocked, 5000);

  Promise.resolve().then(verify).then(result => {
    if (settled) {
      return;
    }
    if (!result || result.ok !== true || Number.isInteger(result.tabId) === false) {
      throw Error('not authorized');
    }
    settled = true;
    clearTimeout(timer);
    self.verifiedTabId = result.tabId;

    (async () => {
      for (const src of sources) {
        await load(src);
      }
      loaded = true;
      document.body.removeAttribute('data-guard');
    })().catch(e => {
      console.error(e);
      blocked();
    });
  }).catch(e => {
    if (settled) {
      return;
    }
    console.warn('core verification failed:', e);
    blocked();
  });
}
