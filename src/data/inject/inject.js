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

{
  let directory;
  const onclick = e => {
    if (e.isTrusted && window.iframe && window.iframe.contains(e.target) === false) {
      close();
    }
  };
  const onmessage = (request, sender, response) => {
    if (request.cmd === 'close-me') {
      close();
    }
    else if (request.cmd === 'directory') {
      try {
        window.showDirectoryPicker().then(d => {
          directory = d;
          response();
        }).catch(e => {
          console.warn('Cannot assign a directory', e);
          response(e.message);
        });
      }
      catch (e) {
        response(e.message);
      }
      return true;
    }
    else if (request.cmd === 'write-binary') {
      Promise.all([
        fetch(request.href),
        directory.getFileHandle(request.filename, {
          create: true
        }).then(file => file.createWritable())
      ]).then(([response, writable]) => {
        return writable.truncate(0).then(() => response.body.pipeTo(writable));
      }).then(() => response(), e => response(e.message));

      return true;
    }
  };
  const close = () => {
    if (window.iframe) {
      window.iframe.remove();
      window.iframe = null;
      document.removeEventListener('click', onclick);
      chrome.runtime.onMessage.removeListener(onmessage);
      chrome.runtime.sendMessage({
        cmd: 'stop'
      });
    }
  };
  document.addEventListener('click', onclick);
  chrome.runtime.onMessage.addListener(onmessage);
}


chrome.storage.local.get({
  width: 750,
  height: 650
}, ({width, height}) => {
  window.iframe.setAttribute('style', `
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
  window.iframe.src = chrome.runtime.getURL('data/inject/selector.html');
  document.body.appendChild(window.iframe);
});
