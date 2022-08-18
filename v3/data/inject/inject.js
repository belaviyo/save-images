/* Copyright (C) 2014-2022 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* global tabId */
'use strict';

// remove the old iframe
try {
  window.myframe.remove();
}
catch (e) {}

window.myframe = document.createElement('iframe');

window.myframe.setAttribute('style', `
  color-scheme: none;
  border: none;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  background-color: transparent;
  z-index: 10000000000;
`);

chrome.storage.local.get({
  width: 750,
  height: 650
}, ({width, height}) => {
  window.myframe.src = chrome.runtime.getURL('data/inject/core/index.html?' +
    'tabId=' + tabId +
    '&width=' + width +
    '&height=' + height +
    '&title=' + encodeURIComponent(document.title) +
    '&href=' + encodeURIComponent(location.href));
  document.body.appendChild(window.myframe);
});

