/* Copyright (C) 2014-2023 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* global utils */

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  for (const m of e.dataset.i18n.split('|')) {
    const [key, value] = m.split('@');
    e[value || 'textContent'] = chrome.i18n.getMessage(key);
  }
});

const args = new URLSearchParams(location.search);
const tabId = Number(args.get('tabId'));

// When confirm is not allowed, return true; https://www.pixiv.net/en/artworks/88641171
const vconfirm = msg => {
  const a = Date.now();
  const r = window.confirm(msg);
  if (Date.now() - a < 10) {
    return true;
  }

  return r;
};

const elements = {
  notify: document.getElementById('notify'),
  counter: {
    filters: document.getElementById('filters'),
    images: document.getElementById('images-number'),
    frames: document.getElementById('frames-number'),
    save: document.getElementById('save-number'),
    total: document.getElementById('total-number'),
    progress: document.getElementById('progress')
  },
  group: {
    size: document.getElementById('group-size'),
    dimension: document.getElementById('group-dimension'),
    zip: document.getElementById('group-zip'),
    readme: document.getElementById('add-readme'),
    accurate: document.getElementById('accurate'),
    calc: document.getElementById('calc'),
    type: document.getElementById('group-type'),
    regexp: document.getElementById('group-regexp'),
    blacklist: document.getElementById('group-blacklist'),
    origin: document.getElementById('group-origin'),
    cframe: document.getElementById('exclude-cors-frames'),
    sframe: document.getElementById('exclude-sorg-frames'),
    identical: document.getElementById('group-identical'),
    cors: document.getElementById('network-cors')

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
    ignore: document.getElementById('unknown-dimension-skip'),
    operation: document.getElementById('dimension-operation'),
    exchange: document.getElementById('dimension-exchange')
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
    stop: document.getElementById('prefs-stop-after'),
    max: document.getElementById('prefs-max-warning'),
    zip: document.getElementById('prefs-zip-warning')
  },
  profiles: {
    select: document.getElementById('profiles'),
    add: document.querySelector('button[data-cmd="add-profile"]'),
    delete: document.querySelector('button[data-cmd="delete-profile"]')
  }
};

const domain = elements.save.directory.value = new URL(args.get('href')).hostname;
const title = args.get('title');

const images = {};
let total = 0;
let errors = 0;

function build() {
  const custom = elements.save.directory.value.replace(/[\\\\/:*?"<>|]/g, '_');
  let filename = utils.rename(elements.save.filename.value.replace(/\.zip/g, '')) + '.zip';

  filename = custom ? custom + '/' + filename : filename;

  const images = filtered();
  // sort images
  const stats = {};
  for (const img of images) {
    stats[img.frameId] = (stats[img.frameId] || 0) + 1;
  }
  const keys = Object.keys(stats).map(Number);
  for (const img of images) {
    const p = keys.indexOf(img.frameId);
    const offset = keys.slice(0, p).reduce((p, c) => p + stats[c], 0);
    img.order = offset + img.position;
  }
  images.sort((a, b) => a.order - b.order);
  // fix filename
  for (const img of images) {
    img.filename = img.filename.replace('__ORDER__', img.order);
  }

  return {
    filename,
    images,
    saveAs: elements.save.dialog.checked,
    get zip() {
      let zip = !elements.group.zip.checked;
      if (zip === false && elements.counter.save.value > Number(elements.prefs.zip.value)) {
        zip = vconfirm('Downloading more than 15 images separately is not recommended. Should I download them as a ZIP archive?');
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
          if (min.valueAsNumber && min.valueAsNumber > img.size) {
            return false;
          }
          if (max.valueAsNumber && max.valueAsNumber < img.size) {
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
        const {width, height, ignore, operation, exchange} = elements.dimension;

        let wmatch = true;
        if (img.width) {
          if (width.min.valueAsNumber && width.min.valueAsNumber > img.width) {
            wmatch = false;
          }
          if (width.max.valueAsNumber && width.max.valueAsNumber < img.width) {
            wmatch = false;
          }
        }

        let hmatch = true;
        if (img.height) {
          if (height.min.valueAsNumber && height.min.valueAsNumber > img.height) {
            hmatch = false;
          }
          if (height.max.valueAsNumber && height.max.valueAsNumber < img.height) {
            hmatch = false;
          }
        }

        // exchange
        let whmatch = true;
        let hwmatch = true;

        if (exchange.value === 'allow') {
          if (img.height) {
            if (width.min.valueAsNumber && width.min.valueAsNumber > img.height) {
              whmatch = false;
            }
            if (width.max.valueAsNumber && width.max.valueAsNumber < img.height) {
              whmatch = false;
            }
          }
          if (img.width) {
            if (height.min.valueAsNumber && height.min.valueAsNumber > img.width) {
              hwmatch = false;
            }
            if (height.max.valueAsNumber && height.max.valueAsNumber < img.width) {
              hwmatch = false;
            }
          }
        }

        // logical operation
        if (operation.value === 'and') {
          if (exchange.value === 'allow') {
            if ((wmatch === false || hmatch === false) && (whmatch === false || hwmatch === false)) {
              return false;
            }
          }
          else {
            if (wmatch === false || hmatch === false) {
              return false;
            }
          }
        }
        if (operation.value === 'or') {
          if (exchange.value === 'allow') {
            if ((wmatch === false && hmatch === false) && (whmatch === false && hwmatch === false)) {
              return false;
            }
          }
          else {
            if (wmatch === false && hmatch === false) {
              return false;
            }
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

          if ((img.type === 'image/jpeg' || img.type === 'image/jpg') && jpeg.checked) {
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
  const count = Object.keys(images).length;
  if (elements.prefs.stop.valueAsNumber > 0 && count >= elements.prefs.stop.valueAsNumber) {
    document.querySelector('[data-cmd="stop"]').click();
  }
  elements.counter.images.textContent = count;
  const index = elements.counter.save.value =
    elements.counter.save.textContent = filtered().length;
  document.querySelector('[data-cmd=save]').disabled = index === 0;

  chrome.scripting.executeScript({
    target: {
      tabId
    },
    injectImmediately: true,
    func: () => 'showDirectoryPicker' in window
  }).then(a => {
    document.querySelector('[data-cmd=save-dir]').disabled = a[0].result === false;
  });

  document.querySelector('[data-cmd=copy]').disabled = index === 0;
  document.querySelector('[data-cmd=gallery]').disabled = index === 0;
}

let frames = 1;
window.commands = request => {
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

      const {filename, name} = utils.guess(img, elements.files.mask.value, elements.type.noType.checked);

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
  else if (request.cmd === 'progress') { // for downloading
    elements.counter.progress.dataset.visible = request.value !== 0;
    elements.counter.progress.value = elements.counter.progress.max - request.value;
  }
  else if (request.cmd === 'links') {
    total += request.length;
    elements.counter.total.textContent = total;
    elements.counter.progress.max = total;
    if (request.filters) {
      elements.counter.filters.textContent = ` (filters: ${request.filters})`;
    }
  }
  else if (request.cmd === 'alternative-image-may-work') {
    errors += 1;
  }
  else if (request.cmd === 'release') {
    document.querySelector('[data-cmd=save]').disabled = false;
    document.querySelector('[data-cmd=save-dir]').disabled = false;
  }
  else if (request.cmd === 'new-frame') {
    frames += 1;
    elements.counter.frames.textContent = frames;
  }
};

chrome.runtime.onMessage.addListener((request, sender, response) => {
  // open gallery view on a separate window
  if (request.cmd === 'build') {
    response(build());
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

  let o = {};
  try {
    o = new URL(args.get('href'));
  }
  catch (e) {}

  elements.save.filename.value = (elements.save.format.value || elements.save.format.placeholder)
    .replace('[href]', args.get('href') || 'NA')
    .replace('[href-hostname]', o.hostname || 'NA')
    .replace('[href-pathname]', o.pathname || 'NA')
    .replace('[href-search]', o.search || 'NA')
    .replace('[href-hash]', o.hash || 'NA')
    .replace('[title]', title || 'NA')
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

const search = () => {
  // filename
  filename();

  // collect
  const custom = (() => {
    const custom = (elements.files.mask.value || '[name][extension]').split('[custom=');
    if (custom.length === 2) {
      return custom[1].split(']')[0];
    }
    return '';
  })();

  const accuracy = elements.group.accurate.checked ? 'accurate' : (
    elements.group.calc.checked ? 'partial-accurate' : 'no-accurate'
  );

  /* collect images */
  let regexp = '';
  chrome.storage.local.get({
    'json': {}
  }, async prefs => {
    for (const r of Object.keys(prefs.json)) {
      try {
        if ((new RegExp(r)).test(args.get('href'))) {
          regexp = prefs.json[r];
          break;
        }
      }
      catch (e) {}
    }
    // install collector on all frames
    try {
      const target = {
        tabId,
        allFrames: elements.group.cframe.checked && elements.group.sframe.checked ? false : true
      };
      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        files: ['/data/fetch.js']
      });
      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        files: ['/data/utils.js']
      });
      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        files: ['/data/port.js']
      });

      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        files: ['/data/collector.js']
      });

      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        files: ['/data/size.js']
      });

      await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        func: (deep, accuracy, regexp, custom, cframe, sframe) => {
          // do not crawl cross-origin frames
          if (cframe && parent !== window) {
            try {
              parent.location.href;
            }
            catch (e) {
              return;
            }
          }
          if (sframe && parent !== window) {
            try {
              parent.location.href;
              return;
            }
            catch (e) {}
          }

          window.deep = deep;
          window.accuracy = accuracy || 'partial-accurate';
          window.custom = custom || 'id';

          try {
            if (regexp && typeof regexp === 'string') {
              window.regexp = [new RegExp(regexp)];
            }
            if (regexp && Array.isArray(regexp)) {
              window.regexp = regexp.map(r => new RegExp(r));
            }
          }
          catch (e) {
            console.warn('cannot use the provided JSON rules', e);
          }
          window.collector.loop();
        },
        args: [
          elements.deep.level.valueAsNumber,
          accuracy,
          regexp,
          custom,
          elements.group.cframe.checked,
          elements.group.sframe.checked
        ]
      });
    }
    catch (e) {
      console.warn(e);
      alert(e.message);
    }
  });
};

elements.deep.level.addEventListener('change', search);

// commands
document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'stop' || cmd === 'save' || cmd === 'save-dir') {
    document.body.classList.add('stopped');
    parent.commands({
      cmd: 'stop'
    });
    elements.counter.progress.dataset.visible = false;
  }
  //
  if (cmd === 'save' || cmd === 'save-dir') {
    document.querySelector('[data-cmd=save]').disabled = true;
    document.querySelector('[data-cmd=save-dir]').disabled = true;

    const obj = Object.assign(build(), {
      cmd: 'save-images',
      directory: cmd === 'save-dir',
      mask: elements.files.mask.value,
      noType: elements.type.noType.checked,
      readme: elements.group.readme.checked
    });
    // length after filtering
    const len = elements.counter.save.value;
    const save = () => {
      elements.counter.progress.value = 0;
      elements.counter.progress.max = len;
      parent.commands(obj);
    };
    if (len > elements.prefs.max.valueAsNumber && cmd === 'save') {
      if (vconfirm(`Are you sure you want to download "${len}" images?`)) {
        save();
      }
      else {
        document.querySelector('[data-cmd=save]').disabled = false;
        document.querySelector('[data-cmd=save-dir]').disabled = false;
      }
    }
    else {
      save();
    }
  }
  else if (cmd === 'copy') {
    const links = build().images.map(s => s.src);
    chrome.scripting.executeScript({
      target: {tabId},
      injectImmediately: true,
      func: links => {
        navigator.clipboard.writeText(links.join('\n')).catch(e => alert(e.message));
      },
      args: [links]
    });
    parent.toast(links.length + ` link${links.length === 1 ? '' : 's'} copied to the clipboard`);
  }
  else if (cmd === 'restart') {
    window.location.reload();
  }
  else if (cmd === 'gallery') {
    window.parent.to.gallery();
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

// links
for (const a of [...document.querySelectorAll('[data-href]')]) {
  if (a.hasAttribute('href') === false) {
    if (a.dataset.href === 'debug') {
      a.href = 'https://webbrowsertools.com/test-image-downloader/';
    }
    else {
      a.href = chrome.runtime.getManifest().homepage_url + '#' + a.dataset.href;
    }
  }
}

// options
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
