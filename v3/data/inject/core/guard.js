'use strict';

/* Only load the core interface when inject.js opened this frame.
 * The worker compares the token from the URL fragment with the live token in
 * the top frame's isolated world; a page-created frame cannot present it. */
{
  const token = location.hash.slice(1);
  let loaded = false;
  let authorizing = false;

  const sources = [
    'data/inject/core/components/notification-view/notification-view.js',
    'data/inject/core/inzip.js',
    'data/inject/core/index.js'
  ];

  /* the timeout only shows a hint; a late verification can still win, so a
     slow worker must not leave the panel permanently broken */
  const showMessage = () => {
    if (loaded || authorizing || document.getElementById('guard-message')) {
      return;
    }
    document.body.removeAttribute('data-guard');

    const p = document.createElement('p');
    p.id = 'guard-message';
    p.textContent = 'This interface is only available inside the extension.';
    document.body.append(p);
  };
  const hideMessage = () => {
    const p = document.getElementById('guard-message');
    if (p) {
      p.remove();
    }
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

  const timer = setTimeout(showMessage, 5000);

  const start = result => {
    if (loaded || authorizing) {
      return;
    }
    if (!result || result.ok !== true || Number.isInteger(result.tabId) === false) {
      throw Error('not authorized');
    }
    authorizing = true;
    clearTimeout(timer);
    hideMessage();
    self.verifiedTabId = result.tabId;

    (async () => {
      for (const src of sources) {
        await load(src);
      }
      loaded = true;
      document.body.removeAttribute('data-guard');
    })().catch(e => {
      console.error(e);
      authorizing = false;
      showMessage();
    });
  };

  Promise.resolve().then(verify).then(start).catch(e => {
    if (loaded || authorizing) {
      return;
    }
    clearTimeout(timer);
    console.warn('core verification failed:', e);
    showMessage();
  });
}
