/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* globals JSZip, onClicked, notify, guess */
'use strict';

window.count = 0;

function timeout() {
  return Number(localStorage.getItem('timeout') || 10) * 1000;
}

const downloads = {};

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
  this.mask = request.mask;
  this.noType = request.noType;

  this.one();
};
Download.prototype.terminate = function() {
  if (this.abort === false) {
    notify(`Image downloading is canceled for "${this.tab.title}".
Do not close the panel if you want to keep downloading`);
  }
  if (chrome.browserAction.setBadgeText) {
    chrome.browserAction.setBadgeText({
      tabId: this.tab.id,
      text: ''
    });
  }
  this.abort = true;
  this.jobs = [];
  this.indices = {};
};
Download.prototype.one = function() {
  if (this.abort) {
    return;
  }
  const {id} = this.tab;
  const jobs = this.jobs;
  const request = this.request;

  if (chrome.browserAction.setBadgeText) {
    chrome.browserAction.setBadgeText({
      tabId: id,
      text: jobs.length ? String(jobs.length) : ''
    });
  }
  chrome.tabs.sendMessage(id, {
    cmd: 'progress',
    value: jobs.length
  });
  const [j1, j2, j3, j4, j5] = [jobs.shift(), jobs.shift(), jobs.shift(), jobs.shift(), jobs.shift()];
  if (j1) {
    Promise.all([
      j1 ? this.download(j1).catch(() => {}) : Promise.resolve(),
      j2 ? this.download(j2).catch(() => {}) : Promise.resolve(),
      j3 ? this.download(j3).catch(() => {}) : Promise.resolve(),
      j4 ? this.download(j4).catch(() => {}) : Promise.resolve(),
      j5 ? this.download(j5).catch(() => {}) : Promise.resolve()
    ]).then(() => this.one());
  }
  else {
    if (request.zip) {
      this.zip.generateAsync({type: 'blob'})
        .then(content => {
          this.jobs = [];
          this.indices = {};

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
    else {
      chrome.tabs.sendMessage(id, {
        cmd: 'close-me'
      });
      delete downloads[id];
    }
  }
};
Download.prototype.download = function(obj) {
  const {filename, zip} = this.request;
  if (zip) {
    return new Promise((resolve, reject) => {
      if (this.abort) {
        return;
      }

      const req = new XMLHttpRequest(); // do not use fetch API as it cannot get CORS headers
      req.open('GET', obj.src);
      if (obj.size) {
        // for huge files, we need to alter the timeout
        req.timeout = Math.min(
          Math.max(timeout(), timeout() * obj.size / (100 * 1024)),
          4 * 60 * 1000
        );
      }
      else {
        req.timeout = timeout();
      }
      req.onerror = req.ontimeout = reject;
      req.responseType = 'blob';
      req.onload = () => {
        const fix = () => {
          let filename = obj.filename;
          this.indices[filename] = this.indices[filename] || 0;
          this.indices[filename] += 1;
          if (this.indices[filename] > 1) {
            if (/\.([^.]{1,6})$/.test(filename)) {
              filename = filename.replace(/\.([^.]{1,6})$/, (a, b) => `-${this.indices[filename] - 1}.${b}`);
            }
            else {
              filename += `-${this.indices[filename] - 1}`;
            }
          }
          return filename;
        };

        // if obj.head === false -> request headers are skipped during image collection.
        // We need to use the guess function to find the filename.
        if (obj.head === false) {
          obj.disposition = req.getResponseHeader('content-disposition');
          obj.filename = guess(obj, this.mask, this.noType).filename || obj.filename || 'unknown';
          this.zip.file(fix(), req.response);
          resolve();
        }
        else {
          this.zip.file(fix(), req.response);
          resolve();
        }
      };
      req.send();
    });
  }
  else {
    return new Promise(resolve => {
      const path = filename.split('/');
      path.pop();
      path.push(obj.filename);

      chrome.downloads.download({
        url: obj.src,
        filename: path.join('/'),
        conflictAction: 'uniquify',
        saveAs: false
      }, () => {
        window.setTimeout(resolve, 3000);
      });
    });
  }
};

const cache = {};
chrome.tabs.onRemoved.addListener(tabId => delete cache[tabId]);

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'copy') {
    chrome.permissions.request({
      permissions: ['clipboardWrite']
    }, granted => {
      if (granted) {
        navigator.clipboard.writeText(request.content).then(() => {
          notify('Image links are copied to the clipboard');
          response(true);
        }).catch(() => {
          document.oncopy = e => {
            e.clipboardData.setData('text/plain', request.content);
            e.preventDefault();
          };
          if (document.execCommand('Copy', false, null)) {
            notify('Image links are copied to the clipboard');
            response(true);
          }
          else {
            response(false);
          }
        });
      }
      else {
        response(false);
      }
    });
    return true;
  }
  else if (request.cmd === 'get-images') {
    response({
      domain: new URL(sender.tab.url).hostname,
      title: sender.tab.title
    });
    let regexp = '';
    chrome.storage.local.get({
      'json': {}
    }, prefs => {
      for (const r of Object.keys(prefs.json)) {
        try {
          if ((new RegExp(r)).test(sender.tab.url)) {
            regexp = prefs.json[r];
            break;
          }
        }
        catch (e) {}
      }
      cache[sender.tab.id] = {
        deep: request.deep,
        regexp,
        accuracy: request.accuracy || true,
        calc: request.calc || false // calculate image with and height by loading meta data
      };
      chrome.tabs.executeScript(sender.tab.id, {
        file: '/data/collector.js',
        runAt: 'document_start',
        allFrames: true,
        matchAboutBlank: true
      }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          notify(lastError.message);
        }
      });
    });
  }
  else if (request.cmd === 'prefs') {
    response(cache[sender.tab.id]);
  }
  else if (request.cmd === 'images' || request.cmd === 'links') {
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
  else if (request.cmd === 'xml-head') {
    chrome.tabs.sendMessage(sender.tab.id, {
      cmd: 'header-resolved'
    });
    if (request.src.endsWith('.css') || request.src.indexOf('.css?') !== -1) {
      response({
        type: 'text/css',
        size: 0,
        disposition: ''
      });
    }
    else if (request.src.endsWith('.html') || request.src.indexOf('.html?') !== -1) {
      response({
        type: 'text/html',
        size: 0,
        disposition: ''
      });
    }
    else if (request.src.endsWith('.js') || request.src.indexOf('.js?') !== -1) {
      response({
        type: 'text/javascript',
        size: 0,
        disposition: ''
      });
    }
    else if (request.skip === true) {
      response({
        head: false,
        type: '',
        size: 0,
        disposition: ''
      });
    }
    else {
      // use GET; HEAD is not widely supported
      const req = new XMLHttpRequest();
      req.open('GET', request.src);
      req.timeout = timeout();
      req.ontimeout = req.onerror = () => response({});

      req.onreadystatechange = () => {
        if (req.readyState === req.HEADERS_RECEIVED) {
          response({
            type: req.getResponseHeader('content-type') || '',
            size: req.getResponseHeader('content-length'),
            disposition: req.getResponseHeader('content-disposition')
          });
          req.abort();
        }
      };
      req.send();
    }
    return true;
  }
  else if (request.cmd === 'xml-img') {
    const req = new XMLHttpRequest();
    req.open('GET', request.src);
    req.responseType = 'document';
    req.timeout = timeout();
    req.onload = () => {
      const images = [];
      images.push(...[...req.response.images]
        .map(img => ({
          width: img.width,
          height: img.height,
          src: img.src,
          alt: img.alt,
          verified: true
        })));
      if (request.extractLinks) {
        images.push(...[...req.response.querySelectorAll('a')].map(a => a.href)
          .filter(s => s && (s.startsWith('http') || s.startsWith('ftp') || s.startsWith('data:')))
          .map(src => ({src})));
      }

      response(images);
    };
    req.ontimeout = req.onerror = () => response([]);
    req.send();
    return true;
  }
  //
  if (request.cmd === 'stop' || request.cmd === 'close-me' || request.cmd === 'reload-me') {
    if (request.cmd !== 'save-images') {
      // stop downloading
      const download = downloads[sender.tab.id];
      if (download) {
        download.terminate();
      }
    }
    // stop image collection
    chrome.tabs.executeScript(sender.tab.id, {
      code: `
        if (typeof collector === 'object') {
          collector.active = false;
        }
      `
    });
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
