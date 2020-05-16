/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  const value = e.dataset.i18nValue || 'textContent';
  e[value] = chrome.i18n.getMessage(e.dataset.i18n);
});

const t = document.getElementById('entry');
const body = document.getElementById('body');
const download = document.querySelector('[data-cmd=download]');
const rename = document.querySelector('[data-cmd=rename]');
const copy = document.querySelector('[data-cmd=copy]');
const progress = document.getElementById('progress');

let resp;

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

{
  const init = r => {
    resp = r;
    Object.values(resp.images).forEach(obj => {
      const clone = document.importNode(t.content, true);
      const img = clone.querySelector('img');
      img.src = obj.src;
      clone.querySelector('div').info = obj;
      clone.querySelector('input[type=text]').value = obj.filename;

      const a = clone.querySelector('a');
      let title = obj.size ? humanFileSize(obj.size) : '-';
      if (obj.width && obj.height) {
        title += ' (' + obj.width + '✕' + obj.height + ')';
      }
      else {
        img.onload = () => {
          a.textContent += ' (' + img.naturalWidth + '✕' + img.naturalHeight + ')';
          // set image size for the "ui" view
          window.parent.ui.contentWindow.meta(obj.src, {
            width: img.naturalWidth,
            height: img.naturalHeight
          });
        };
      }
      a.textContent = title;
      a.href = obj.src;

      body.appendChild(clone);
    });
  };
  if (window.top === window) {
    document.body.dataset.top = true;

    const id = Number(location.search.split('id=')[1].split('&')[0]);
    chrome.tabs.sendMessage(id, {
      cmd: 'build'
    }, init);
  }
  else {
    const resp = window.parent.ui.contentWindow.build();
    init(resp);
  }
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
      const input = e.closest('div').querySelector('input[type=text]');
      let index = input.value.lastIndexOf('.');
      if (index === -1) {
        index = input.value.length;
      }
      const extension = (input.value.substr(index) || '').substr(0, 10);
      const name = pattern
        .replace(/\[#=*\d*\]/gi, ('000000' + (i + offset)).substr(o))
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
    const images = [...document.querySelectorAll('.entry :checked')].map(i => {
      const div = i.closest('div');
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

      chrome.runtime.sendMessage({
        cmd: 'save-images',
        custom: resp.custom,
        filename: resp.filename,
        images,
        saveAs: resp.saveAs,
        zip: resp.zip
      });
    }
    else {
      const content = images.map(o => o.src).join('\n');
      window.parent.ui.contentWindow.copy(content);
    }
  }
  else if (cmd === 'window') {
    chrome.runtime.sendMessage({
      method: 'open-me'
    });
  }
  else if (cmd === 'close') {
    if (window.top === window) {
      window.close();
    }
    else {
      window.parent.to.ui();
    }
  }
  last = target;
});

document.addEventListener('change', () => {
  copy.disabled = rename.disabled = download.disabled = document.querySelector('.entry :checked') === null;
});
// make sure the user-defined name is used for the filename
document.addEventListener('input', e => {
  e.target.dataset.modified = e.target.value ? true : false;
});


chrome.runtime.onMessage.addListener(request => {
  if (request.cmd === 'progress') {
    progress.value = progress.max - request.value;
  }
  else if (request.cmd === 'close-me') {
    progress.dataset.visible = false;
  }
});
