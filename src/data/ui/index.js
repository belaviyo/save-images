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

var elements = {
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
  }
};

var domain;
var title;
var images = {};
var total = 0;
var indices = {};

/* guess filename */
function guess(img) {
  const {disposition, type, src} = img;
  let name = img.name || '';
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
    if (src.startsWith('http')) {
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
      catch (e) {}
    }
    else { // data-url
      name = 'image';
    }
  }
  if (disposition && name) {
    const arr = [...name].map(v => v.charCodeAt(0)).filter(v => v <= 255);
    name = (new TextDecoder('UTF-8')).decode(Uint8Array.from(arr));
  }
  // extension
  if (name.indexOf('.') === -1 && type && type !== 'image/unknown') {
    name += '.' + type.split('/').pop().split(/[+;]/).shift();
  }
  let index = name.lastIndexOf('.');
  if (index === -1) {
    index = name.length;
  }
  let extension = name.substr(index).substr(0, 10);
  if (extension.length == 0 && elements.type.noType.checked) {
    extension = '.jpg';
  }
  name = name.substr(0, index);

  if (name in indices) {
    indices[name] += 1;
  }
  else {
    indices[name] = 1;
  }

  // apply masking
  let filename = (elements.files.mask.value || '[name][extension]');
  filename = filename.split('[extension]').map(str => str
    .replace(/\[name\]/gi, name + (indices[name] === 1 ? '' : '-' + indices[name]))
    .replace(/\[type\]/gi, type || '')
    .replace(/\[disposition\]/gi, disposition || '')
    .replace(/\[order\]/gi, img.order || 0)
    .replace(/\[index\]/gi, indices[name])
    // make sure filename is acceptable
    .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-')
    // limit length of each section to 60 chars
    .substr(0, 60)).join(extension);

  return {
    filename,
    name
  };
}

function build() {
  const custom = elements.save.directory.value.replace(/[\\\\/:*?"<>|]/g, '_');
  let filename = elements.save.filename.value
    .replace(/\.zip/g, '')
    .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-') + '.zip';

  filename = custom ? custom + '/' + filename : filename;

  const images = filtered();

  return {
    filename,
    images,
    saveAs: elements.save.dialog.checked,
    get zip() {
      let zip = !elements.group.zip.checked;
      if (zip === false && elements.counter.save.value > 15) {
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

  return rtn.filter((img, index) => {
    if (elements.group.identical.checked) {
      return img.size ? keys.indexOf(img.key) === index : true;
    }
    else {
      return true;
    }
  });
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
  if (request.cmd === 'progress') {
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
        const {filename, name} = guess(img);
        img.filename = filename;
        img.key = name + img.size + img.hostname;
        images[img.src] = img;
      });
      // we might have more images due to html parsing, so lets update all counters
      if (request.images.length > request.index) {
        total += (request.images.length - request.index);
        elements.counter.total.textContent = total;
        elements.counter.progress.max = total;
      }
      elements.counter.progress.value += Math.max(request.images.length, request.index);
      elements.counter.progress.dataset.visible = elements.counter.progress.value !== total;
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
});

// construct ZIP filename
var filename = () => {
  const time = new Date();
  elements.save.filename.value = (elements.save.format.value || elements.save.format.placeholder)
    .replace('[title]', title)
    .replace('[date]', time.toLocaleDateString())
    .replace('[time]', time.toLocaleTimeString());
};
elements.save.format.addEventListener('input', filename);

var search = () => chrome.runtime.sendMessage({
  cmd: 'get-images',
  deep: Number(elements.deep.level.value)
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
      cmd: 'save-images'
    });
    // length after filtering
    const len = elements.counter.save.value;
    const save = () => {
      elements.counter.progress.value = 0;
      elements.counter.progress.max = len;
      chrome.runtime.sendMessage(obj);
    };
    if (len > 30) {
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
    const cb = document.getElementById('clipboard');
    cb.style.display = 'block';
    cb.value = Object.keys(images).join('\n');
    cb.focus();
    cb.select();
    const bol = document.execCommand('copy');
    cb.style.display = 'none';

    chrome.runtime.sendMessage({
      method: 'notify',
      message: bol ? 'Image links are copied to the clipboard' : 'Cannot copy to the clipboard'
    });
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
    var start = input.selectionStart;
    var end = input.selectionEnd;
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
  else if (cmd === 'help') {
    chrome.tabs.create({
      url: chrome.runtime.getManifest().homepage_url
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
