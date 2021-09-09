/* Copyright (C) 2014-2021 Joe Ertaba
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

{
  const onclick = e => {
    if (e.isTrusted && window.myframe && window.myframe.contains(e.target) === false) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const onmessage = request => request.cmd === 'close-me' && close();

  const close = () => {
    try {
      window.myframe.remove();
      window.myframe = null;
      document.removeEventListener('click', onclick);
      chrome.runtime.onMessage.removeListener(onmessage);
      chrome.runtime.sendMessage({
        cmd: 'stop'
      });
    }
    catch (e) {}
  };
  document.addEventListener('click', onclick, true);
  chrome.runtime.onMessage.addListener(onmessage);
}


chrome.storage.local.get({
  width: 750,
  height: 650
}, ({width, height}) => {
  window.myframe.setAttribute('style', `
    border: none;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    width: ${width}px;
    max-width: 80%;
    height: ${height}px;
    max-height: 90%;
    margin: auto;
    background-color: #f0f0f0;
    z-index: 10000000000;
    box-shadow: 0 0 0 10000px rgba(0, 0, 0, 0.3);
  `);
  window.myframe.src = chrome.runtime.getURL('data/inject/core/index.html?' +
    'tabId=' + tabId +
    '&title=' + encodeURIComponent(document.title) +
    '&href=' + encodeURIComponent(location.href));
  document.body.appendChild(window.myframe);
});
