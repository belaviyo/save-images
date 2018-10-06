/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* globals JSZip, onClicked, notify */
'use strict';

window.count = 0;

function timeout() {
  return Number(localStorage.getItem('timeout') || 10) * 1000;
}
/* guess filename */
function guess(disposition, type, src, name) {
  if (!name && disposition) {
    const tmp = /filename\*=UTF-8''([^;]*)/.exec(disposition);
    if (tmp && tmp.length) {
      name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
      name = decodeURIComponent(name);
    }
  }
  if (!name && disposition) {
    const tmp = /filename=([^;]*)/.exec(disposition);
    if (tmp && tmp.length) {
      name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
    }
  }
  if (!name) {
    const url = src.replace(/\/$/, '');
    const tmp = /(title|filename)=([^&]+)/.exec(url);
    if (tmp && tmp.length) {
      name = tmp[2];
    }
    else {
      name = url.substring(url.lastIndexOf('/') + 1);
    }
    try {
      name = decodeURIComponent(name.split('?')[0].split('&')[0]) || 'image';
      // make sure name is writable
      name = name.replace(/[`~!@#$%^&*()_|+\-=?;:'",<>{}[\]\\/]/gi, '-');
    }
    catch(e) {}
  }
  if (disposition && name) {
    const arr = [...name].map(v => v.charCodeAt(0)).filter(v => v <= 255);
    name = (new TextDecoder('UTF-8')).decode(Uint8Array.from(arr));
  }
  if (name.indexOf('.') === -1) {
    if (type) {
      name += '.' + type.split('/').pop().split(/[+;]/).shift();
    }
  }
  return name;
}

var downloads = {};

function Download() {
  this.zip = new JSZip();
  this.indices = {};
  this.abort = false;
}
Download.prototype.init = function(request, tab) {
  this.request = request;
  this.tab = tab;
  this.jobs = request.images;
  this.length = this.jobs.length;
  this.jobsIndex = 1;

  this.one();
};
Download.prototype.terminate = function() {
  if (this.abort === false) {
    notify(`Image downloading is canceled for "${this.tab.title}".
Do not close the panel if you want to keep downloading`);
  }
  chrome.browserAction.setBadgeText({
    tabId: this.tab.id,
    text: ''
  });
  this.abort = true;
  this.jobs = [];
};
Download.prototype.one = function() {
  if (this.abort) {
    return;
  }
  const {id} = this.tab;
  const jobs = this.jobs;
  const request = this.request;

  chrome.browserAction.setBadgeText({
    tabId: id,
    text: jobs.length ? String(jobs.length) : ''
  });
  chrome.tabs.sendMessage(id, {
    cmd: 'progress',
    value: jobs.length
  });
  const [j1, j2, j3, j4, j5] = [jobs.shift(), jobs.shift(), jobs.shift(), jobs.shift(), jobs.shift()];
  if (j1) {
    Promise.all([
      j1 ? this.download(j1, this.jobsIndex).catch(() => {}) : Promise.resolve(),
      j2 ? this.download(j2, this.jobsIndex + 1).catch(() => {}) : Promise.resolve(),
      j3 ? this.download(j3, this.jobsIndex + 2).catch(() => {}) : Promise.resolve(),
      j4 ? this.download(j4, this.jobsIndex + 3).catch(() => {}) : Promise.resolve(),
      j5 ? this.download(j5, this.jobsIndex + 4).catch(() => {}) : Promise.resolve()
    ]).then(() => {
      this.jobsIndex += 5;
      this.one()
    });
  }
  else {
    this.zip.generateAsync({type: 'blob'})
    .then(content => {
      const url = URL.createObjectURL(content);
      chrome.downloads.download({
        url,
        filename: request.filename,
        conflictAction: 'uniquify',
        saveAs: request.saveAs
      }, () => {
        chrome.tabs.sendMessage(id, {
          cmd: 'close-me'
        });
        delete downloads[id];
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    });
  }
};
Download.prototype.download = function(obj, jobIndex) {
  return new Promise((resolve, reject) => {
    const request = this.request;
    const indices = this.indices;

    if (this.abort) {
      return;
    }

    const req = new XMLHttpRequest(); // do not use fetch API as it cannot get CORS headers
    req.open('GET', obj.src);
    req.timeout = 10000;
    req.onerror = req.ontimeout = reject;
    req.responseType = 'blob';
    req.onload = () => {
      const disposition = req.getResponseHeader('Content-Disposition');
      const type = req.getResponseHeader('Content-Type');
      let guessedName = guess(disposition, type, obj.src, obj.filename);

      const index = guessedName.lastIndexOf('.') || guessedName.length;
      name = guessedName.substr(0, index);
      let extension = guessedName.substr(index);

      if (extension.length == 0 && request.addJPG) {
        extension = '.jpg';
      }
      if (name in indices) {
        name += ' - ' + indices[name]; 
        indices[name] += 1;
      }
      else {
        indices[name] = 1;
      }

      let fileName = name.slice(-60) + extension;

      try {
        if (this.request.fileMask && this.request.fileMask.length > 0) {
          const fileAttributes = {
            name,
            type,
            disposition,
            extension,
            jobIndex,
            index: indices[name],
          };

          let fileMask = this.request.fileMask;

          for (let [key, value] of Object.entries(fileAttributes)) {
            // Allow for "[name]-[disposition][extension]" kind of masks, where
            // the desired replacement is a key in fileAttributes.
            fileMask = fileMask.replace(`[${key}]`, value);
          }

          fileName = fileMask;
        }
      }
      catch (exception) {
        console.error("It was not possible to parse the file mask due to ", exception.message); 
        console.warn("Falling back to the default name for the file.");
      }

      this.zip.file(fileName, req.response);
      resolve();
    };
    req.send();
  });
};

chrome.runtime.onConnect.addListener(port => {
  let links = [];
  let cache = {};
  let abort = false;
  const aborting = () => {
    links = [];
    cache = {};
    abort = true;
    try {
      port.postMessage({
        cmd: 'count',
        count: 0
      });
    }
    catch(e) {}
  };
  port.onDisconnect.addListener(aborting);
  const analyze = (url, level) => new Promise(resolve => {
    const req = new XMLHttpRequest();
    req.open('HEAD', url);
    req.timeout = timeout();
    req.onload = () => {
      const type = req.getResponseHeader('content-type') || '';
      if (type.startsWith('image/')) {
        resolve([{
          width: 0,
          height: 0,
          src: url,
          size: Number(req.getResponseHeader('content-length')),
          type,
          filename: guess(
            req.getResponseHeader('Content-Disposition'),
            req.getResponseHeader('Content-Type'),
            url
          )
        }]);
      }
      else if (type.startsWith('text/html') && level === 2) {
        const req = new XMLHttpRequest();
        req.open('GET', url);
        req.responseType = 'document';
        req.timeout = timeout();
        req.onload = () => {
          const imgs = [...req.response.images].map(img => ({
            width: img.width,
            height: img.height,
            src: img.src
          }));
          resolve(imgs);
        };
        req.ontimeout = req.onerror = () => resolve([]);
        req.send();
      }
      else {
        resolve([]);
      }
    };
    req.ontimeout = req.onerror = () => resolve([]);
    req.send();
  });
  let active = false;

  const batch = level => {
    if (active || abort) {
      return;
    }
    port.postMessage({
      cmd: 'count',
      count: links.length
    });
    if (links.length) {
      active = true;
      Promise.all([
        links.shift(),
        links.shift(),
        links.shift(),
        links.shift(),
        links.shift()
      ].filter(l => l).map(url => analyze(url, level))).then(a => a.reduce((p, c) => {
        p.push(...c);
        return p;
      }, []))
      .then(images => {
        chrome.tabs.sendMessage(port.sender.tab.id, {
          cmd: 'found-images',
          images: images.filter(img => img.src)
        }, () => {
          active = false;
          batch(level);
        });
      });
    }
  };

  port.onMessage.addListener(request => {
    if (request.cmd === 'found-links') {
      request.links = request.links.filter(l => {
        const bol = cache[l] !== request.deep;
        cache[l] = request.deep;
        return bol;
      });
      links.push(...request.links);
      batch(request.deep);
    }
    else if (request.cmd === 'stop') {
      aborting();
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'image-data') {
    // data URI
    if (request.src.startsWith('data:')) {
      const type = request.src.split('data:')[1].split(';')[0];
      return response({
        type,
        size: request.src.split(',')[1].length * 0.7, // approximate size
        filename: 'image.' + type.split('/')[1].split('+')[0] // image/svg+xml -> svg
      });
    }
    // http/https
    else {
      const req = new window.XMLHttpRequest();
      req.open('HEAD', request.src);
      req.timeout = timeout();
      req.onload = () => {
        let type = req.getResponseHeader('content-type') || '';
        // https://github.com/belaviyo/save-images/issues/17
        if (!type || type.startsWith('image/') === false) {
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
          response({
            size,
            type,
            filename: guess(
              req.getResponseHeader('Content-Disposition'),
              req.getResponseHeader('Content-Type'),
              request.src
            )
          });
          chrome.runtime.lastError;
        }
        catch (e) {
          console.error(e);
        }
      };
      req.ontimeout = req.onerror = () => response({});
      req.send();
    }

    return true;
  }
  else if (request.cmd === 'get-images') {
    response({
      domain: new URL(sender.tab.url).hostname,
      title: sender.tab.title
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

        // find background images
        var r = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gi;
        try {
          let images = [...document.querySelectorAll('*')]
            .map(e => window.getComputedStyle(e).backgroundImage)
            .map(i => {
              const e = /url\(['"]([^\)]+)["']\)/.exec(i);
              return e && e.length ? e[1] : null;
            }).filter((s, i, l) => s && l.indexOf(s) === i);

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

        // find linked images
        if (${request.deep > 0}) {
          const links = [...document.querySelectorAll('a')].map(a => a.href)
            .filter(s => s && (s.startsWith('http') || s.startsWith('ftp')))
          if (links.length) {
            chrome.runtime.sendMessage({
              cmd: 'found-links',
              links,
              deep: ${request.deep}
            });
          }
        }
        // find hard-coded links
        if (${request.deep > 0}) {
          // decode html special characters; &amp;
          const links = (document.documentElement.innerHTML.match(r) || [])
            .map(s => s.replace(/&amp;/g, '&'));
          if (links.length) {
            chrome.runtime.sendMessage({
              cmd: 'found-links',
              links,
              deep: ${request.deep}
            });
          }
        }
      `,
      runAt: 'document_start',
      allFrames: true,
      matchAboutBlank: true
    });
  }
  else if (request.cmd === 'found-images') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'found-links') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'save-images') {
    notify('Saving ' + request.images.length + ' images');

    if (downloads[sender.tab.id]) {
      downloads[sender.tab.id].terminate();
    }
    downloads[sender.tab.id] = new Download();
    downloads[sender.tab.id].init(request, sender.tab);
  }
  else if (request.cmd === 'abort-downloading') {
    const download = downloads[sender.tab.id];
    if (download) {
      download.terminate();
    }
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
