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

  // remove the old panel
  for (const e of document.querySelectorAll('div.daimages-host, dialog.daimages')) {
    e.remove();
  }
  // invalidate the previous token even if this injection fails below
  self.token = null;

  /* a fresh secret per injection; the worker reads it from this isolated world */
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  self.token = token;

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
    self.token = null;
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

      (document.body || document.documentElement).append(host);
      dialog.showModal();
    });
  }

  Boolean(dialog.style)
})();
