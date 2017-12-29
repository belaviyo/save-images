/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

'use strict';

// remove the old iframe
try {
  window.iframe.remove();
}
catch (e) {}

window.iframe = document.createElement('iframe');
window.iframe.setAttribute('style', `
  border: none;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  width: 550px;
  height: 510px;
  max-width: 80%;
  margin: auto;
  background-color: #f0f0f0;
  z-index: 10000000000;
  box-shadow: 0 0 0 10000px rgba(0, 0, 0, 0.3);
`);
window.iframe.src = chrome.runtime.getURL('data/inject/index.html');
document.body.appendChild(window.iframe);

(callback => {
  document.addEventListener('click', e => {
    if (e.target !== window.iframe) {
      callback();
    }
  });
  chrome.runtime.onMessage.addListener(request => {
    if (request.cmd === 'close-me') {
      callback();
    }
  });
})(() => {
  if (window.iframe) {
    window.iframe.remove();
    window.iframe = null;
  }
});
