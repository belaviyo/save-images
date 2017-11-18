/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* globals JSZip, onClicked */
'use strict';

window.count = 0;
// Firefox does not support chrome.downloads.onDeterminingFilename yet
const diSupport = Boolean(chrome.downloads.onDeterminingFilename);

var download = (() => {
  let jobs = [];
  let zip;
  const indices = {};
  let tab;
  let request;

  function download(obj) {
    return fetch(obj.url).then(response => {
      if (response.ok) {
        const disposition = response.headers.get('Content-Disposition');
        let name;
        if (disposition) {
          const tmp = /filename=([^;]*)/.exec(disposition);
          if (tmp && tmp.length) {
            name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
          }
        }
        if (!name) {
          const type = response.headers.get('Content-Type');
          const url = obj.url.replace(/\/$/, '');
          const tmp = /(title|filename)=([^&]+)/.exec(url);
          if (tmp && tmp.length) {
            name = tmp[2];
          }
          else {
            name = url.substring(url.lastIndexOf('/') + 1);
          }
          name = decodeURIComponent(name.split('?')[0].split('&')[0]) || 'image';
          if (name.indexOf('.') === -1) {
            if (type) {
              name += '.' + type.split('/').pop().split(/[+;]/).shift();
            }
            else if (request.addJPG) {
              name += '.jpg';
            }
          }
        }
        name = name.slice(-20);
        if (name in indices) {
          const index = name.lastIndexOf('.') || name.length;
          const tmp = name.substr(0, index) + ' - ' + indices[name] + name.substr(index);
          indices[name] += 1;
          name = tmp;
        }
        else {
          indices[name] = 1;
        }
        return response.blob().then(blob => zip.file(name, blob));
      }
      else {
        throw Error('fetch failed');
      }
    });
  }

  function one() {
    chrome.browserAction.setBadgeText({
      tabId: tab.id,
      text: jobs.length ? String(jobs.length) : ''
    });
    chrome.tabs.sendMessage(tab.id, {
      cmd: 'progress',
      value: jobs.length
    });
    const url = jobs.shift();
    if (url) {
      download({url}).then(one, () => one());
    }
    else {
      zip.generateAsync({type: 'blob'})
      .then(content => {
        const time = new Date();
        let filename = tab.title += ' ' + time.toLocaleDateString() + ' ' + time.toLocaleTimeString();
        filename = filename
          .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-');
        filename += '.zip';
        const url = URL.createObjectURL(content);
        chrome.downloads.download({
          url,
          filename: request.custom ? request.custom + '/' + filename : filename,
          conflictAction: 'uniquify',
          saveAs: request.saveAs
        }, () => {
          chrome.tabs.sendMessage(tab.id, {
            cmd: 'close-me'
          });
          window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
      });
    }
  }

  return (_request, _tab) => {
    request = _request;
    tab = _tab;
    jobs = request.images.map(i => i.src);
    zip = new JSZip();
    one();
  };
})();

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'image-data') {
    // data URI
    if (request.src.startsWith('data:')) {
      let size = null;
      try {
        size = window.atob(request.src.split(',')[1]).length;
      }
      catch (e) {}

      return response({
        type: request.src.split('data:')[1].split(';')[0],
        size
      });
    }
    // http/https
    else {
      const req = new window.XMLHttpRequest();
      req.open('HEAD', request.src);
      req.timeout = 10000;
      req.onload = () => {
        let type = req.getResponseHeader('content-type');
        if (!type) {
          if (request.src.indexOf('.png') !== -1) {
            type = 'image/png';
          }
          else if (request.src.indexOf('.jpg') !== -1 || request.src.indexOf('.jpeg') !== -1) {
            type = 'image/jpeg';
          }
          else if (request.src.indexOf('.bmp') !== -1) {
            type = 'image/bmp';
          }
        }
        let size = null;
        try {
          size = Number(req.getResponseHeader('content-length'));
        }
        catch (e) {}
        // prevent error on usage of disconnected port (when iframe is closed before response is ready)
        try {
          response({size, type});
        }
        catch (e) {}
      };
      req.ontimeout = req.onerror = () => response({});
      req.send();
    }

    return true;
  }
  else if (request.cmd === 'get-images') {
    window.count -= 1;
    if (window.count !== 0) {
      throw new Error('this is not a permitted request');
    }
    response({
      domain: new URL(sender.tab.url).hostname,
      diSupport
    });
    chrome.tabs.executeScript(sender.tab.id, {
      code: String.raw`
        chrome.runtime.sendMessage({
          cmd: 'found-images',
          images: [...document.images].map(img => ({
            width: img.width,
            height: img.height,
            src: img.src
          })).filter(img => img.src)
        });
        try {
          // find background images
          let images = [...document.querySelectorAll('*')]
            .filter(e => e.style.backgroundImage)
            .map(e => e.style.backgroundImage)
            .filter(i => i.startsWith('url'))
            .map(i => i.replace(/^url\([\'\"]*/, '').replace(/[\'\"]*\)$/, ''));
          images = images.map(i => i.startsWith('//') ? document.location.protocol + i : i);
          images = images.map(i => i.startsWith('/') ? document.location.origin + i : i);
          images = images.filter((img, i, l) => l.indexOf(img) === i);
          if (images.length) {
            chrome.runtime.sendMessage({
              cmd: 'found-images',
              images: images.map(img => ({
                width: 0,
                height: 0,
                src: img
              })).filter(img => img.src)
            });
          }
        }
        catch (e) {}
      `,
      runAt: 'document_start',
      allFrames: true,
      matchAboutBlank: true
    });
  }
  else if (request.cmd === 'found-images') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'save-images') {
    chrome.notifications.create(null, {
      type: 'basic',
      iconUrl: '/data/icons/48.png',
      title: 'Save all Images',
      message: 'Saving ' + request.images.length + ' images'
    });
    download(request, sender.tab);
  }
  //
  if (request.cmd === 'close-me') {
    chrome.tabs.sendMessage(sender.tab.id, {
      cmd: 'close-me'
    });
  }
  if (request.cmd === 'reload-me') {
    onClicked(sender.tab);
  }
});
