/* Copyright (C) 2014-2023 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* global tabId */
'use strict';

// remove the old iframe
for (const e of document.querySelectorAll('dialog.daimages')) {
  e.remove();
}
{
  const dialog = document.createElement('dialog');
  dialog.classList.add('daimages');
  dialog.onclose = dialog.onclick = () => self.onMessage({
    cmd: 'stop-collector',
    remove: true
  });

  const iframe = document.createElement('iframe');
  dialog.append(iframe);

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
        '&href=' + encodeURIComponent(location.href));

      (document.body || document.documentElement).append(dialog);
      dialog.showModal();
    });
  }

  // eslint-disable-next-line semi
  Boolean(dialog.style)
}
