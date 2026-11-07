/* Copyright (C) 2014-2025 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  const value = e.dataset.i18nValue || 'textContent';
  e[value] = chrome.i18n.getMessage(e.dataset.i18n);
});

const args = new URLSearchParams(location.search);
const tabId = Number(args.get('tabId'));
self.isFirefox = navigator.userAgent.includes('Firefox');

const t = document.getElementById('entry');
const body = document.getElementById('body');
const download = document.querySelector('[data-cmd=download]');
const rename = document.querySelector('[data-cmd=rename]');
const copy = document.querySelector('[data-cmd=copy]');
const progress = document.getElementById('progress');

let resp;

self.progress = value => {
  progress.value = progress.max - value;
};

chrome.runtime.onMessage.addListener((request, sender) => {
  const isDetached = window.top === window;
  if (self.isFirefox) { // on Firefox only accept proxied requests from worker
    if (sender.tab && !(isDetached && request.cmd === 'progress')) {
      return;
    }
  }
  else { // on Chrome only accept from same tab
    if (sender.tab) {
      if (sender.tab.id !== tabId && !(isDetached && request.cmd === 'progress')) {
        return;
      }
    }
    else if (!(isDetached && request.cmd === 'progress')) {
      return;
    }
  }

  if (request.cmd === 'progress') {
    self.progress(request.value);
  }
});

const notify = msg => {
  try {
    if (window.top !== window && parent && typeof parent.toast === 'function') {
      parent.toast(msg);
      return;
    }
    throw Error('no parent toast');
  }
  catch (e) {
    const t = document.title;
    document.title = msg;
    setTimeout(() => document.title = t, 750);
  }
};

function humanFileSize(bytes) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes.toFixed(1) + ' B';
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  }
  while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[u];
}

let last;
document.addEventListener('click', e => {
  const {target} = e;
  const cmd = target.dataset.cmd;

  // select list by shift+click
  if (target.type === 'checkbox' && e.shiftKey && last) {
    const entries = [...document.querySelectorAll('.entry')];
    const i = entries.indexOf(target.closest('.entry'));
    const j = entries.indexOf(last.closest('.entry'));
    for (let k = Math.min(i, j) + 1; k < Math.max(i, j); k += 1) {
      entries[k].querySelector('input[type=checkbox]').checked = true;
    }
  }

  // data URL is not allowed in a new browser tab (chrome)
  if (target.href && target.href.startsWith('data:')) {
    if (navigator.userAgent.indexOf('Firefox') === -1) {
      e.preventDefault();
      fetch(target.href)
        .then(res => res.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          target.href = url;
          target.click();
        });
    }
  }

  if (cmd === 'rename') {
    const pattern = document.getElementById('pattern').value;
    let offset = /\[#=*(\d*)\]/.exec(pattern);
    if (offset && offset.length && isNaN(offset[1]) === false) {
      offset = Number(offset[1]);
    }
    else {
      offset = 1;
    }

    const entries = [...document.querySelectorAll('.entry :checked')];
    const o = -1 * String(offset + entries.length + 1).length;
    entries.forEach((e, i) => {
      const input = e.closest('label').querySelector('input[type=text]');
      let index = input.value.lastIndexOf('.');
      if (index === -1) {
        index = input.value.length;
      }
      const extension = (input.value.slice(index) || '').slice(0, 10);
      const name = pattern
        .replace(/\[#=*\d*\]/gi, ('000000' + (i + offset)).slice(o))
        .replace(/\[extension\]/gi, extension);
      input.value = name;
      input.dispatchEvent(new Event('input'));
    });
  }
  else if (cmd === 'select-all') {
    [...document.querySelectorAll('.entry')].forEach(e => e.querySelector('input[type=checkbox]').checked = true);
    document.dispatchEvent(new Event('change'));
  }
  else if (cmd === 'select-none') {
    [...document.querySelectorAll('.entry')].forEach(e => e.querySelector('input[type=checkbox]').checked = false);
    document.dispatchEvent(new Event('change'));
  }
  else if (cmd === 'download' || cmd === 'copy') {
    const isDetached = window.top === window;
    if (!isDetached && parent && typeof parent.stopping === 'function') {
      parent.stopping();
    }
    else if (isDetached) {
      // detached: stop collector in host tab via direct or worker proxy
      if (chrome.tabs && chrome.tabs.sendMessage) {
        try {
          const p = chrome.tabs.sendMessage(tabId, {
            cmd: 'stop-collector',
            remove: false,
            response: true,
            tabId
          });
          if (p && typeof p.catch === 'function') {
            p.catch(() => {});
          }
        }
        catch (e) {}
      }
      if (chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const p = chrome.runtime.sendMessage({
            cmd: 'gallery-stop',
            tabId
          });
          if (p && typeof p.catch === 'function') {
            p.catch(() => {});
          }
        }
        catch (e) {}
      }
    }

    const images = [...document.querySelectorAll('.entry :checked')].map(i => {
      const div = i.closest('label');
      const info = div.info;
      const input = div.querySelector('input[type=text]');
      // in gallery mode we use the name as it is
      const filename = input.value;
      return Object.assign(info, {
        filename,
        head: true // make sure content-disposition is not being used to rename the file
      });
    });
    if (cmd === 'download') {
      progress.dataset.visible = true;
      progress.max = images.length;

      const payload = {
        cmd: 'save-images',
        custom: resp.custom,
        parent: resp.parent,
        filename: resp.filename,
        images,
        saveAs: resp.saveAs,
        zip: resp.zip,
        tabId
      };
      if (!isDetached && parent && typeof parent.save === 'function') {
        parent.save(payload);
      }
      else if (isDetached) {
        // detached: forward to host tab's core.save via direct or worker proxy
        if (chrome.tabs && chrome.tabs.sendMessage) {
          try {
            const p = chrome.tabs.sendMessage(tabId, payload);
            if (p && typeof p.catch === 'function') {
              p.catch(async e => {
                // direct failed - try worker proxy as fallback
                if (chrome.runtime && chrome.runtime.sendMessage) {
                  try {
                    const r = await chrome.runtime.sendMessage({
                      cmd: 'gallery-save',
                      tabId,
                      request: payload
                    });
                    if (r && r.error) {
                      notify(r.error);
                    }
                  }
                  catch (err) {
                    notify(err.message || String(err));
                  }
                }
                else {
                  notify(e.message || String(e));
                }
              });
            }
          }
          catch (e) {
            if (chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                cmd: 'gallery-save',
                tabId,
                request: payload
              }).catch(err => notify(err.message || String(err)));
            }
            else {
              notify(e.message || String(e));
            }
          }
        }
        else if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            cmd: 'gallery-save',
            tabId,
            request: payload
          }).then(r => {
            if (r && r.error) {
              notify(r.error);
            }
          }).catch(e => notify(e.message || String(e)));
        }
        else {
          notify('Cannot download from detached view: extension APIs unavailable');
        }
      }
      else {
        notify('Cannot download: parent not available');
      }
    }
    else {
      const links = images.map(o => o.src);
      const message = links.length + ` link${links.length === 1 ? '' : 's'} copied to the clipboard`;
      utils.copy(links.join('\n')).then(() => {
        notify(message);
      }, e => {
        notify(e.message || String(e));
      });
    }
  }
  else if (cmd === 'window') {
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({
        url: location.href
      });
    }
    else if (chrome.runtime && chrome.runtime.sendMessage) {
      // Firefox embedded iframe has no chrome.tabs
      try {
        const p = chrome.runtime.sendMessage({
          cmd: 'open-gallery',
          url: location.href
        });
        if (p && typeof p.catch === 'function') {
          p.catch(e => notify(e.message || String(e)));
        }
      }
      catch (e) {
        notify(e.message || String(e));
      }
    }
    else {
      window.open(location.href, '_blank');
    }
  }
  else if (cmd === 'close') {
    if (window.top === window) {
      window.close();
    }
    else if (parent && parent.to && typeof parent.to.ui === 'function') {
      parent.to.ui();
    }
  }
  last = target;
});

document.addEventListener('change', () => {
  copy.disabled = rename.disabled = download.disabled = document.querySelector('.entry :checked') === null;

  const n = document.querySelectorAll('.entry :checked').length;
  download.value = 'Download' + (n ? ` (${n})` : '');
});
// make sure the user-defined name is used for the filename
document.addEventListener('input', e => {
  e.target.dataset.modified = e.target.value ? true : false;
});

{
  const init = r => {
    resp = r;
    Object.values(resp.images).forEach(obj => {
      const clone = document.importNode(t.content, true);
      const img = clone.querySelector('img');
      img.src = obj.src;
      clone.querySelector('label').info = obj;
      img.alt = clone.querySelector('input[type=text]').value = obj.filename;

      const a = clone.querySelector('a');
      let title = obj.size ? humanFileSize(obj.size) : 'no size';
      if (obj.width && obj.height) {
        title += ' (' + obj.width + '✕' + obj.height + ')';
      }
      else {
        img.onload = () => {
          a.textContent += ' (' + img.naturalWidth + '✕' + img.naturalHeight + ')';
          // set image size for the "ui" view
          if (window.top !== window && window.parent && window.parent.ui && window.parent.ui.contentWindow && typeof window.parent.ui.contentWindow.meta === 'function') {
            try {
              window.parent.ui.contentWindow.meta(obj.src, {
                width: img.naturalWidth,
                height: img.naturalHeight
              });
            }
            catch (e) {}
          }
          else if (window.top === window) {
            // detached: forward dimensions to host tab's ui via tabs/runtime proxy
            const metaPayload = {
              cmd: 'gallery-meta',
              tabId,
              src: obj.src,
              width: img.naturalWidth,
              height: img.naturalHeight
            };
            if (chrome.tabs && chrome.tabs.sendMessage) {
              try {
                const p = chrome.tabs.sendMessage(tabId, metaPayload);
                if (p && typeof p.catch === 'function') {
                  p.catch(() => {});
                }
              }
              catch (e) {}
            }
            if (chrome.runtime && chrome.runtime.sendMessage) {
              try {
                const p = chrome.runtime.sendMessage(metaPayload);
                if (p && typeof p.catch === 'function') {
                  p.catch(() => {});
                }
              }
              catch (e) {}
            }
          }
        };
      }
      a.textContent = title;
      a.href = obj.src;

      body.appendChild(clone);
    });
    document.dispatchEvent(new Event('change'));
  };
  if (window.top === window) {
    document.body.dataset.top = true;

    if (chrome.tabs && chrome.tabs.sendMessage) {
      try {
        chrome.tabs.sendMessage(tabId, {
          cmd: 'build'
        }, init);
      }
      catch (e) {
        // fallback to worker proxy if tabs API is unavailable or throws
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            cmd: 'gallery-build',
            tabId
          }).then(r => {
            if (r && r.error) {
              notify(r.error);
            }
            else if (r) {
              init(r);
            }
          }).catch(err => notify(err.message || String(err)));
        }
      }
    }
    else if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        cmd: 'gallery-build',
        tabId
      }).then(r => {
        if (r && r.error) {
          notify(r.error);
        }
        else if (r) {
          init(r);
        }
      }).catch(err => notify(err.message || String(err)));
    }
  }
  else {
    const resp = window.parent.ui.contentWindow.build();
    init(resp);
  }
}

// pattern
{
  const e = document.getElementById('pattern');
  chrome.storage.local.get({
    'gallery-pattern': 'image-[#=1][extension]'
  }).then(prefs => e.value = prefs['gallery-pattern'] || 'image-[#=1][extension]');

  e.onchange = () => chrome.storage.local.set({
    'gallery-pattern': e.value
  });
}
