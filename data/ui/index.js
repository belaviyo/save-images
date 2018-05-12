/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

'use strict';

var domain;
var port = chrome.runtime.connect({name: 'parser'});

var elements = {
  counter: {
    processed: document.getElementById('processed-number'),
    save: document.getElementById('save-number'),
    total: document.getElementById('total-number'),
    progress: document.getElementById('progress')
  },
  group: {
    size: document.getElementById('group-size'),
    dimension: document.getElementById('group-dimension'),
    type: document.getElementById('group-type'),
    regexp: document.getElementById('group-regexp'),
    origin: document.getElementById('group-origin'),
  },
  save: {
    directory: document.getElementById('custom-directory'),
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
    all: document.getElementById('type-all'),
    noType: document.getElementById('no-type'),
  },
  regexp: {
    input: document.getElementById('regexp-input')
  },
  deep: {
    level: document.getElementById('deep-level'),
    stat: document.getElementById('deep-stat'),
    progress: document.getElementById('deep-progress')
  }
};

var images = {};
var processed = 0;

function build() {
  return {
    custom: elements.save.directory.value.replace(/[\\\\/:*?"<>|]/g, '_'),
    addJPG: elements.type.noType.checked,
    images: filtered(),
    saveAs: elements.save.dialog.checked
  };
}

function filtered() {
  return Object.values(images)
  // size
  .filter(img => {
    if (elements.group.size.checked) {
      if (img.size) {
        if (Number(elements.size.min.value) && Number(elements.size.min.value) > img.size) {
          return false;
        }
        if (Number(elements.size.max.value) && Number(elements.size.max.value) < img.size) {
          return false;
        }
        return true;
      }
      else {
        return !elements.size.ignore.checked;
      }
    }
    else {
      return true;
    }
  })
  // dimension
  .filter(img => {
    if (elements.group.dimension.checked) {
      if (img.width) {
        if (Number(elements.dimension.width.min.value) && Number(elements.dimension.width.min.value) > img.width) {
          return false;
        }
        if (Number(elements.dimension.width.max.value) && Number(elements.dimension.width.max.value) < img.width) {
          return false;
        }
      }
      if (img.height) {
        if (Number(elements.dimension.height.min.value) && Number(elements.dimension.height.min.value) > img.height) {
          return false;
        }
        if (Number(elements.dimension.height.max.value) && Number(elements.dimension.height.max.value) < img.height) {
          return false;
        }
      }
      if (img.width && img.height) {
        return true;
      }
      else {
        return !elements.dimension.ignore.checked;
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
        if (img.type === 'image/jpeg' && elements.type.jpeg.checked) {
          return true;
        }
        if (img.type === 'image/png' && elements.type.png.checked) {
          return true;
        }
        if (img.type === 'image/bmp' && elements.type.bmp.checked) {
          return true;
        }
        if (img.type === 'image/gif' && elements.type.gif.checked) {
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
  //origin
  .filter(img => {
    if (elements.group.origin.checked) {
      const hostname = (new URL(img.src)).hostname;
      return domain.endsWith(hostname) || hostname.endsWith(domain);
    }
    else {
      return true;
    }
  });
}

function update() {
  const index = elements.counter.save.textContent = filtered().length;
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
  else if (request.cmd === 'found-images') {
    if (sender.tab) {
      // prevent duplication
      return;
    }
    request.images.forEach(img => {
      if (!images[img.src]) {
        images[img.src] = img;
        if (!img.type) {
          chrome.runtime.sendMessage({
            cmd: 'image-data',
            src: img.src
          }, response => {
            images[img.src] = Object.assign(images[img.src], response);
            processed += 1;

            if (response.type.startsWith('image/') === false) {
              delete images[img.src];
              elements.counter.total.textContent = Object.keys(images).length;
              processed -= 1;
            }

            elements.counter.processed.textContent = processed;
            update();
          });
        }
        else {
          processed += 1;
          elements.counter.processed.textContent = processed;
          update();
        }
      }
    });
    elements.counter.total.textContent = Object.keys(images).length;
    update();
  }
  else if (request.cmd === 'found-links') {
    port.postMessage(request);
  }
  else if (request.cmd === 'get-images') {
    response(build());
  }
});
var search = () => chrome.runtime.sendMessage({
  cmd: 'get-images',
  deep: Number(elements.deep.level.value)
}, result => {
  domain = result.domain;
  if (result.diSupport) {
    elements.save.directory.value = domain;
  }
  else {
    elements.save.directory.disabled = true;
  }
});
document.addEventListener('DOMContentLoaded', search);
elements.deep.level.addEventListener('change', search);

// commands
document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'save') {
    target.disabled = true;
    const obj = Object.assign(build(), {
      cmd: 'save-images'
    });
    const save = () => {
      elements.counter.progress.value = 0;
      elements.counter.progress.max = obj.images.length;
      chrome.runtime.sendMessage(obj);
    };

    if (images.length > 30) {
      if (window.confirm(`Are you sure you want to download "${images.length}" images?`)) {
        save();
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
});
// update counter
document.addEventListener('change', update);

// port
let count = 0;
port.onMessage.addListener(request => {
  if (request.cmd === 'count') {
    count = Math.max(request.count, count);
    elements.deep.stat.textContent = request.count;
    elements.deep.progress.value = request.count;
    elements.deep.progress.max = count;
    elements.deep.progress.dataset.visible = request.count !== 0;
  }
});
