/* Copyright (C) 2014-2025 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* global tabId */
(() => {
  'use strict';

  /* a fresh secret per injection; the worker reads it from this isolated world */
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

  /* a panel only owns the tab rules while its own token is the live one */
  const invalidate = () => {
    if (self.token === token) {
      self.token = null;
      return true;
    }
    return false;
  };
  const removeRules = () => {
    try {
      chrome.runtime.sendMessage({
        cmd: 'remove-session-rules'
      }, () => void chrome.runtime.lastError);
    }
    catch (e) {}
  };
  const release = () => {
    if (invalidate()) {
      removeRules();
    }
  };

  // stop the previous panel's host watcher before intentionally removing it
  if (self.__daimagesHostWatch) {
    self.__daimagesHostWatch();
    self.__daimagesHostWatch = null;
  }

  // a previous panel must not survive this injection
  for (const e of document.querySelectorAll('div.daimages-host, dialog.daimages')) {
    e.remove();
  }

  /* the replaced panel loses ownership; this injection takes over */
  self.token = token;

  /* a top-level navigation destroys this document before the worker can see it */
  if (self.__daimagesPageHide) {
    removeEventListener('pagehide', self.__daimagesPageHide);
  }
  const onPageHide = e => {
    if (e.persisted === false) {
      release();
    }
  };
  self.__daimagesPageHide = onPageHide;
  addEventListener('pagehide', onPageHide);

  /* the panel lives in a closed shadow root so page scripts cannot read the iframe URL or token */
  const css = `
    dialog.daimages {
      --width: 750px;
      --height: 650px;

      padding: 0 !important;
      margin: auto !important;
      border: none !important;
      background-color: #eee !important;
      width: min(90vw, var(--width)) !important;
      height: min(80vh, var(--height)) !important;
      display: flex;
    }
    dialog.daimages::backdrop {
      background-color: rgba(0, 0, 0, 0.3);
    }
    dialog.daimages iframe {
      display: block !important;
      color-scheme: none;
      border: none;
      background-color: transparent;
      width: 100%;
      height: 100%;
    }
  `;

  const host = document.createElement('div');
  host.classList.add('daimages-host');

  const shadow = host.attachShadow({
    mode: 'closed'
  });

  // constructed stylesheets are not blocked by the page's CSP
  if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    }
    catch (e) {
      const style = document.createElement('style');
      style.textContent = css;
      shadow.append(style);
    }
  }
  else {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }

  const dialog = document.createElement('dialog');
  dialog.classList.add('daimages');
  dialog.onclose = dialog.onclick = () => {
    release();
    chrome.runtime.sendMessage({
      cmd: 'stop-collector',
      remove: true
    });
  };

  const iframe = document.createElement('iframe');
  dialog.append(iframe);
  shadow.append(dialog);

  if (dialog.style) {
    chrome.storage.local.get({
      width: 750,
      height: 650
    }, ({width, height}) => {
      dialog.style.setProperty('--width', width + 'px');
      dialog.style.setProperty('--height', height + 'px');

      iframe.src = chrome.runtime.getURL('data/inject/core/index.html?' +
        'tabId=' + tabId +
        '&title=' + encodeURIComponent(document.title) +
        '&href=' + encodeURIComponent(location.href) +
        '#' + token);

      const parent = document.body || document.documentElement;
      parent.append(host);
      dialog.showModal();

      /* the page can remove the host element at any time; that destroys the
         panel without firing dialog.close, so clean the rules explicitly */
      let observer;
      let interval;
      const stopWatching = () => {
        clearInterval(interval);
        if (observer) {
          observer.disconnect();
        }
      };
      const lost = () => host.isConnected === false;
      const onLost = () => {
        if (lost()) {
          stopWatching();
          release();
        }
      };
      interval = setInterval(onLost, 1000);
      observer = new MutationObserver(onLost);
      observer.observe(parent, {childList: true});
      self.__daimagesHostWatch = stopWatching;
    });
  }

  /* tells the worker whether the panel could be attached at all */
  return Boolean(dialog.style);
})();
