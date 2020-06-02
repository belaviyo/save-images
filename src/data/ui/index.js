/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* global guess */

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  const value = e.dataset.i18nValue || 'textContent';
  e[value] = chrome.i18n.getMessage(e.dataset.i18n);
});

const elements = {
  counter: {
    filters: document.getElementById('filters'),
    images: document.getElementById('images-number'),
    save: document.getElementById('save-number'),
    total: document.getElementById('total-number'),
    progress: document.getElementById('progress')
  },
  group: {
    size: document.getElementById('group-size'),
    dimension: document.getElementById('group-dimension'),
    zip: document.getElementById('group-zip'),
    accurate: document.getElementById('accurate'),
    calc: document.getElementById('calc'),
    type: document.getElementById('group-type'),
    regexp: document.getElementById('group-regexp'),
    blacklist: document.getElementById('group-blacklist'),
    origin: document.getElementById('group-origin'),
    identical: document.getElementById('group-identical')
  },
  files: {
    mask: document.getElementById('file-mask')
  },
  save: {
    directory: document.getElementById('custom-directory'),
    format: document.getElementById('format'),
    filename: document.getElementById('filename'),
    dialog: document.getElementById('open-save-dialog')
  },
  size: {
    min: document.getElementById('size-min'),
    max: document.getElementById('size-max'),
    ignore: document.getElementById('unknown-size-skip')
  },
  dimension: {
    width: {
      min: document.getElementById('dimension-width-min'),
      max: document.getElementById('dimension-width-max')
    },
    height: {
      min: document.getElementById('dimension-height-min'),
      max: document.getElementById('dimension-height-max')
    },
    ignore: document.getElementById('unknown-dimension-skip')
  },
  type: {
    jpeg: document.getElementById('type-jpeg'),
    bmp: document.getElementById('type-bmp'),
    gif: document.getElementById('type-gif'),
    png: document.getElementById('type-png'),
    webp: document.getElementById('type-webp'),
    all: document.getElementById('type-all'),
    noType: document.getElementById('no-type')
  },
  regexp: {
    input: document.getElementById('regexp-input')
  },
  blacklist: {
    input: document.getElementById('blacklist-input')
  },
  deep: {
    level: document.getElementById('deep-level'),
    progress: document.getElementById('deep-progress')
  },
  prefs: {
    max: document.getElementById('prefs-max-warning'),
    zip: document.getElementById('prefs-zip-warning')
  }
};

let domain;
let title;
const images = {};
let total = 0;

function build() {
  const custom = elements.save.directory.value.replace(/[\\\\/:*?"<>|]/g, '_');
  let filename = elements.save.filename.value
    .replace(/\.zip/g, '')
    .replace(/[`~!@#$%^&*()|+=?;:'",.<>{}[\]\\/]/gi, '-') + '.zip';

  filename = custom ? custom + '/' + filename : filename;

  const images = filtered();

  return {
    filename,
    images,
    saveAs: elements.save.dialog.checked,
    get zip() {
      let zip = !elements.group.zip.checked;
      if (zip === false && elements.counter.save.value > Number(elements.prefs.zip.value)) {
        zip = window.confirm('Downloading more than 15 images separately is not recommended. Should I download them as a ZIP archive?');
      }
      return zip;
    }
  };
}

function filtered() {
  const objs = Object.values(images);

  const rtn = objs // size
    .filter(img => {
      if (elements.group.size.checked) {
        const {min, max, ignore} = elements.size;
        if (img.size) {
          if (Number(min.value) && Number(min.value) > img.size) {
            return false;
          }
          if (Number(max.value) && Number(max.value) < img.size) {
            return false;
          }
          return true;
        }
        else {
          return !ignore.checked;
        }
      }
      else {
        return true;
      }
    })
    // dimension
    .filter(img => {
      if (elements.group.dimension.checked) {
        const {width, height, ignore} = elements.dimension;
        if (img.width) {
          if (Number(width.min.value) && Number(width.min.value) > img.width) {
            return false;
          }
          if (Number(width.max.value) && Number(width.max.value) < img.width) {
            return false;
          }
        }
        if (img.height) {
          if (Number(height.min.value) && Number(height.min.value) > img.height) {
            return false;
          }
          if (Number(height.max.value) && Number(height.max.value) < img.height) {
            return false;
          }
        }
        if (img.width && img.height) {
          return true;
        }
        else {
          return !ignore.checked;
        }
      }
      else {
        return true;
      }
    })
    .filter(img => {
      if (elements.type.all.checked || !elements.group.type.checked) {
        return true;
      }
      else {
        if (img.type) {
          const {jpeg, png, bmp, webp, gif} = elements.type;

          if (img.type === 'image/jpeg' && jpeg.checked) {
            return true;
          }
          if (img.type === 'image/png' && png.checked) {
            return true;
          }
          if (img.type === 'image/bmp' && bmp.checked) {
            return true;
          }
          if (img.type === 'image/webp' && webp.checked) {
            return true;
          }
          if (img.type === 'image/gif' && gif.checked) {
            return true;
          }

          return false;
        }
        else {
          return false;
        }
      }
    })
    // regexp
    .filter(img => {
      if (elements.group.regexp.checked) {
        const r = new RegExp(elements.regexp.input.value);
        return r.test(img.src);
      }
      else {
        return true;
      }
    })
    // blacklist
    .filter(img => {
      if (elements.group.blacklist.checked) {
        const list = elements.blacklist.input.value.split(/\s*,\s*/)
          .map(k => k.toLowerCase())
          .filter(a => a);
        return !list.some(keyword => img.src.toLowerCase().indexOf(keyword) !== -1);
      }
      else {
        return true;
      }
    })
    // origin
    .filter(img => {
      if (elements.group.origin.checked) {
        const hostname = img.hostname;
        return domain.endsWith(hostname) || hostname.endsWith(domain) || hostname === 'local';
      }
      else {
        return true;
      }
    });

  const keys = rtn.map(o => o.key);
  const r = rtn.filter((img, index) => {
    if (elements.group.identical.checked) {
      return img.key ? keys.indexOf(img.key) === index : true;
    }
    else {
      return true;
    }
  });
  return r;
}

function update() {
  elements.counter.images.textContent = Object.keys(images).length;
  const index = elements.counter.save.value =
    elements.counter.save.textContent = filtered().length;
  document.querySelector('[data-cmd=save]').disabled = index === 0;
  document.querySelector('[data-cmd=copy]').disabled = index === 0;
  document.querySelector('[data-cmd=gallery]').disabled = index === 0;
}

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'progress') { // for downloading
    elements.counter.progress.dataset.visible = true;
    elements.counter.progress.value = elements.counter.progress.max - request.value;
  }
  else if (request.cmd === 'build') {
    response(build());
  }
  else if (request.cmd === 'images' || request.cmd === 'links') {
    if (sender.tab) { // prevent duplication
      return;
    }
    if (request.cmd === 'images') {
      request.images.filter(img => img.type.startsWith('image/')).forEach(img => {
        if (images[img.src]) {
          return;
        }
        try {
          img.hostname = (new URL(img.src)).hostname;
        }
        catch (e) {}
        img.hostname = img.hostname || 'local';
        img.order = Object.keys(images).length + 1;

        const {filename, name} = guess(img, elements.files.mask.value, elements.type.noType.checked);

        img.filename = filename;
        if (img.size) {
          img.key = name + '.' + img.size + '.' + img.hostname;
        }
        else if (img.width && img.height) {
          img.key = name + '.' + img.width + '.' + img.height + '.' + img.hostname;
        }
        images[img.src] = img;
      });
      update();
    }
    else if (request.cmd === 'links') {
      total += request.length;
      elements.counter.total.textContent = total;
      elements.counter.progress.max = total;
      if (request.filters) {
        elements.counter.filters.textContent = ` (filters: ${request.filters.length})`;
      }
    }
  }
  else if (request.cmd === 'header-resolved') {
    elements.counter.progress.value += 1;
    if (elements.counter.progress.value >= elements.counter.progress.max) {
      elements.counter.progress.dataset.visible = false;
    }
    else {
      elements.counter.progress.dataset.visible = true;
    }
  }
});

// construct ZIP filename
const filename = () => {
  const current = new Date();
  const modified = new Date(document.lastModified);
  let navigation = false;
  if (performance && performance.timing && performance.timing.domInteractive) {
    navigation = new Date(performance.timing.domInteractive);
  }

  elements.save.filename.value = (elements.save.format.value || elements.save.format.placeholder)
    .replace('[title]', title)
    .replace('[date]', current.toLocaleDateString())
    .replace('[current-date]', current.toLocaleDateString())
    .replace('[time]', current.toLocaleTimeString())
    .replace('[current-time]', current.toLocaleTimeString())
    .replace('[modified-date]', modified.toLocaleDateString())
    .replace('[modified-time]', modified.toLocaleTimeString())
    .replace('[navigation-date]', navigation ? navigation.toLocaleDateString() : 'NA')
    .replace('[navigation-time]', navigation ? navigation.toLocaleTimeString() : 'NA');
};
elements.save.format.addEventListener('input', filename);

const search = () => chrome.runtime.sendMessage({
  cmd: 'get-images',
  custom: (() => {
    const custom = (elements.files.mask.value || '[name][extension]').split('[custom=');
    if (custom.length === 2) {
      return custom[1].split(']')[0];
    }
    return '';
  })(),
  deep: Number(elements.deep.level.value),
  accuracy: elements.group.accurate.checked ? 'accurate' : 'partial-accurate', // no-accurate, partial-accurate, accurate
  calc: elements.group.calc.checked // force calculate image with and height
}, result => {
  domain = result.domain || '';
  title = result.title || 'unknown';
  elements.save.directory.value = domain;
  // filename
  filename();
});
elements.deep.level.addEventListener('change', search);

// commands
document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'save') {
    target.disabled = true;
    const obj = Object.assign(build(), {
      cmd: 'save-images',
      mask: elements.files.mask.value,
      noType: elements.type.noType.checked
    });
    // length after filtering
    const len = elements.counter.save.value;
    const save = () => {
      elements.counter.progress.value = 0;
      elements.counter.progress.max = len;
      chrome.runtime.sendMessage(obj);
    };
    if (len > Number(elements.prefs.max.value)) {
      if (window.confirm(`Are you sure you want to download "${len}" images?`)) {
        save();
      }
      else {
        target.disabled = false;
      }
    }
    else {
      save();
    }
  }
  else if (cmd === 'copy') {
    const content = Object.keys(images).join('\n');
    window.copy(content);
  }
  else if (cmd === 'close') {
    chrome.runtime.sendMessage({
      cmd: 'close-me'
    });
  }
  else if (cmd === 'restart') {
    window.location.reload();
  }
  else if (cmd === 'gallery') {
    window.parent.to.gallery();
  }
  else if (cmd === 'stop') {
    chrome.runtime.sendMessage({
      cmd: 'stop'
    });
    elements.counter.progress.dataset.visible = false;
  }
  else if (cmd === 'insert') {
    const input = target.closest('.list').parentNode.querySelector('input');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) +
      target.dataset.value +
      input.value.substring(end, input.value.length);
    input.focus();
    input.selectionStart = input.selectionEnd = end + target.dataset.value.length;
    // trigger persist.js
    input.dispatchEvent(new Event('change', {
      bubbles: true
    }));
    input.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  }
  else if (cmd === 'tdm') {
    let id = 'pabnknalmhfecdheflmcaehlepmhjlaa';

    let link = 'https://chrome.google.com/webstore/detail/pabnknalmhfecdheflmcaehlepmhjlaa';
    if (navigator.userAgent.indexOf('Firefox') !== -1) {
      id = 'jid0-dsq67mf5kjjhiiju2dfb6kk8dfw@jetpack';
      link = 'https://addons.mozilla.org/firefox/addon/turbo-download-manager/';
    }
    else if (navigator.userAgent.indexOf('OPR') !== -1) {
      id = 'lejgoophpfnabjcnfbphcndcjfpinbfk';
      link = 'https://addons.opera.com/extensions/details/turbo-download-manager/';
    }
    else if (navigator.userAgent.indexOf('Edg/') !== -1) {
      id = 'mkgpbehnmcnadhklbcigfbehjfnpdblf';
      link = 'https://microsoftedge.microsoft.com/addons/detail/mkgpbehnmcnadhklbcigfbehjfnpdblf';
    }
    chrome.runtime.sendMessage(id, {
      method: 'add-jobs',
      configs: {
        // prevent multi-threading (CloudFlare image optimization issue)
        'min-segment-size': 10 * 1024 * 1024
      },
      jobs: build().images.map(img => ({
        link: img.src,
        filename: img.filename,
        threads: 3
      }))
    }, resp => {
      if (resp) {
        chrome.runtime.sendMessage({cmd: 'close-me'});
      }
      else {
        chrome.tabs.create({url: link});
      }
    });
  }
});
// update counter
document.addEventListener('change', update);
{ // wait for .5 seconds before updating
  let id;
  const input = () => {
    window.clearTimeout(id);
    window.setTimeout(update, 500);
  };
  document.addEventListener('input', input);
}

// image types
{
  const root = document.getElementById('image-types');
  root.addEventListener('change', () => {
    document.getElementById(
      root.querySelector(':checked') ? 'type-selection' : 'type-all'
    ).checked = true;
  });
}

// disable accurate mode
const accurate = () => {
  if (elements.group.size.checked || elements.group.zip.checked) {
    elements.group.accurate.dataset.checked = elements.group.accurate.checked;
    elements.group.accurate.checked = true;
    elements.group.accurate.closest('tr').classList.add('disabled');
  }
  else {
    elements.group.accurate.closest('tr').classList.remove('disabled');
    elements.group.accurate.checked = elements.group.accurate.dataset.checked === 'true';
  }
  elements.group.accurate.dispatchEvent(new Event('change', {
    bubbles: true
  }));
};
elements.group.size.addEventListener('change', accurate);
elements.group.zip.addEventListener('change', accurate);

// remote get image sizes
window.meta = (url, obj) => {
  if (images[url]) {
    Object.assign(images[url], obj);
  }
};

window.copy = content => chrome.runtime.sendMessage({
  cmd: 'copy',
  content
}, resp => {
  if (resp !== true) {
    const blob = new Blob([content], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'links.txt');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
    chrome.runtime.sendMessage({
      method: 'notify',
      message: 'Image links are downloaded to the default download directory'
    });
  }
});
