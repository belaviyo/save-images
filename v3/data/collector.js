/* Copyright (C) 2014-2025 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* eslint no-var: 0 */

/* global type, size, utils */

/*
  accuracy: accurate -> force calculate size, width, height
  accuracy: partial-accurate -> force calculate width, height
  accuracy: no-accurate -> no external request
*/

'use strict';

var collector = self.collector = {
  'feeds': { // all kind of detected links (1: images, 2: same origin, 3: misc)
    '1': [],
    '2': [],
    '3': []
  },
  'processed-images': [], // all links that are image and are processed
  'raw-images': [], // all images that need to be parsed for metadata
  'docs': [], // all documents in the page
  'cache': new Set() // all links that have already been evaluated
};
{
  let active = true;
  Object.defineProperty(collector, 'active', {
    get() {
      return active;
    },
    set(value) {
      if (active === false) {
        return;
      }
      active = value;
      if (value === false) {
        chrome.runtime.sendMessage({
          cmd: 'state',
          value: 'done'
        });
      }
    }
  });
}

var report = () => collector.active && chrome.runtime.sendMessage({
  cmd: 'progress',
  value: collector.feeds['1'].length + collector.feeds['2'].length + collector.feeds['3'].length +
    collector['raw-images'].length +
    collector.docs.length
});

var sources = new Map();

collector.events = {
  image(o) { // called when new image is listed
    chrome.runtime.sendMessage({
      cmd: 'images',
      images: [o]
    });
  },
  feed(length) { // called when a new link is listed
    chrome.runtime.sendMessage({
      cmd: 'links',
      filters: (window.regexp || []).length,
      length
    });
  },
  document() {// called when a new document is listed
    report();
  },
  validate() { // called when a new document is listed
    report();
  },
  raw() { // called when a raw image is listed
    report();
  },
  guess: {
    done() {
      if (collector.active) {
        if (
          collector['raw-images'].length === 0 &&
          collector.feeds[1].length === 0 &&
          collector.feeds[2].length === 0 &&
          collector.feeds[3].length === 0 &&
          collector.docs.length === 0
        ) {
          collector.active = false;
        }
      }
    }
  }
};

// try to pass this step as fast as possible
collector.meta = async function(o) {
  // try to use this fast method when we are going to fetch the image later to get width and height
  let im;

  for (const [ext, type] of Object.entries(utils.EXTENSIONS)) {
    if (
      o.src.toLowerCase().endsWith('.' + ext) ||
      (o.width && o.src.toLowerCase().indexOf('.' + ext) !== -1) || // e.g. http:../3522.jpg/0
      o.src.toLowerCase().indexOf('.' + ext + '?') !== -1 ||
      o.src.startsWith('data:image/' + ext)
    ) {
      im = {
        meta: {
          type
        },
        origin: 'guess'
      };
      break;
    }
  }

  const conds = [
    (self.accuracy === 'accurate' || self.accuracy === 'partial-accurate') && !o.width, // we will later run width and height detection
    (self.accuracy !== 'accurate' || o.size)
  ];
  if (im && conds.some(a => a)) {
    return im;
  }

  // if (o.verified === true) {
  //   return {
  //     meta: {
  //       type: 'image/unkown'
  //     },
  //     origin: 'guess'
  //   };
  // }

  try {
    const meta = await utils.response.heads(o);

    meta.type = utils.type(im?.meta, meta);
    if (o.verified && !meta.type) {
      meta.type = 'image/unknown';
    }

    return {
      meta,
      origin: 'bg.fetch'
    };
  }
  catch (e) {
    console.warn(e);
  }

  return {};
};

collector.findRoots = function(doc, list = []) {
  for (const e of doc.querySelectorAll('*')) {
    if (e.shadowRoot) {
      try {
        collector.findRoots(e.shadowRoot, list);
        list.push(e.shadowRoot);
      }
      catch (e) {}
    }
  }
};

/* collect images */
collector.inspect = async function(doc, loc, name, policies) {
  const prefs = await chrome.storage.local.get({
    'custom-extensions': ['pdf']
  });

  const docs = [doc];
  collector.findRoots(doc, docs);

  // find images; part 1/4
  const loading = []; // incomplete images that we forced to load
  for (const doc of docs) {
    chrome.runtime.sendMessage({
      cmd: 'new-frame'
    });

    const images = doc.images || doc.querySelectorAll('img');
    for (const img of [...images]) {
      // image element is not loaded yet (e.g., loading="lazy"): force it to load
      // and wait for it so that naturalWidth/naturalHeight are valid
      if (img.complete === false) {
        img.loading = 'eager';
        loading.push(img.decode());
      }

      //  The "data-src" attribute is commonly used for lazy-loading images
      const src = img.currentSrc || img.src || img.dataset.src;

      sources.set(src, img);
      collector.push({
        width: img.naturalWidth,
        height: img.naturalHeight,
        src,
        alt: img.alt,
        custom: img.getAttribute(self.custom) || '',
        // if image is verified, we dont have the image size. on accurate mode set it to false
        verified: self.accuracy === 'accurate' ? false : true,
        page: loc.href,
        meta: {
          origin: name + ' - document.images',
          size: 'img.element',
          type: 'skipped'
        }
      });

      if (img.src && img.currentSrc !== img.src) {
        sources.set(img.src, img);
        collector.push({
          src: img.src,
          alt: img.alt,
          custom: img.getAttribute(self.custom) || '',
          // if image is verified, we dont have the image size. on accurate mode set it to false
          verified: self.accuracy === 'accurate' ? false : true,
          page: loc.href,
          meta: {
            origin: name + ' - document.images',
            size: 'img.element',
            type: 'skipped'
          }
        });
      }
    }
  }
  // wait for all forced images to load; rejects (broken/invalid images) are ignored
  await Promise.allSettled(loading);

  // find images; part 2/4
  for (const doc of docs) {
    for (const source of [...doc.querySelectorAll('source')]) {
      if (source.srcset) {
        const src = source.srcset.split(' ')[0];
        sources.set(src, source);
        collector.push({
          src,
          type: source.type,
          page: loc.href,
          meta: {
            origin: name + ' - source.element'
          }
        });
      }
    }
  }
  // find images; part 3/4
  for (const doc of docs) {
    for (const svg of doc.querySelectorAll('svg')) {
      const e = svg.cloneNode(true);
      e.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      collector.push({
        src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(e.outerHTML),
        type: 'image/svg+xml',
        page: loc.href,
        meta: {
          origin: name + ' - svg.query'
        }
      });
    }
  }
  // find images from the loaded resources
  for (const doc of docs) {
    try {
      for (const entry of doc.defaultView.performance.getEntriesByType('resource')) {
        if (entry.initiatorType === 'css') {
          // ignore fonts
          if (
            entry.name.includes('.ttf') || entry.name.includes('.eot') ||
            entry.name.includes('.otf') || entry.name.includes('.woff')
          ) {
            continue;
          }

          collector.push({
            src: entry.name,
            type: '',
            page: loc.href,
            meta: {
              origin: name + ' - ' + 'css.performance'
            }
          });
        }
        else if (entry.initiatorType === 'img') {
          // Exclude entries with no response data (most likely not an image)
          if (entry.transferSize === 0 && entry.encodedBodySize === 0 && entry.decodedBodySize === 0) {
            continue;
          }

          collector.push({
            src: entry.name,
            type: 'image/unknown',
            verified: true,
            page: loc.href,
            meta: {
              origin: name + ' - ' + 'img.performance'
            }
          });
        }
      }
    }
    catch (e) {}
  }

  // find embedded images on SVG elements; part 4/4
  for (const doc of docs) {
    for (const image of [...doc.querySelectorAll('image')]) {
      const src = image.href?.baseVal;
      sources.set(src, image);
      collector.push({
        src,
        alt: image.alt,
        custom: image.getAttribute(self.custom) || '',
        // if image is verified, we dont have the image size. on accurate mode set it to false
        verified: self.accuracy === 'accurate' ? false : true,
        page: loc.href,
        meta: {
          origin: name + ' - svg.images',
          size: 'img.element',
          type: 'skipped'
        }
      });
    }
  }
  const extract = content => {
    try {
      const r = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
      return content.match(r) || [];
    }
    catch (e) {
      console.info('link extraction failed', e);
    }
    return [];
  };


  // find background images; part 2
  if (policies.bg) {
    for (const doc of docs) {
      try {
        [...doc.querySelectorAll('*')]
          .map(e => [
            getComputedStyle(e).backgroundImage,
            getComputedStyle(e, ':before').backgroundImage,
            getComputedStyle(e, ':after').backgroundImage
          ])
          .flat()
          .filter(s => s && s.includes('url('))
          .map(s => extract(s)).flat().filter(s => s).forEach(src => {
            collector.push({
              src,
              page: loc.href,
              meta: {
                origin: name + ' - link'
              }
            });
          });
      }
      catch (e) {
        console.warn('Cannot collect background images', e);
      }
    }
  }
  // find linked images; part 3
  if (self.deep > 0 && policies.links) {
    for (const doc of docs) {
      [...doc.querySelectorAll('a')].map(a => a.href).forEach(src => collector.push({
        src,
        page: loc.href,
        meta: {
          origin: name + ' - link.href'
        }
      }));
    }
  }
  // find hard-coded links; part 4
  if (self.deep > 0 && policies.extract) {
    for (const doc of docs) {
      // "textContent" can extract data from input elements
      const content = (doc.documentElement?.innerHTML || '') + '\n\n' + doc.textContent;

      extract(content).map(s => {
        // decode html special characters; &amp;
        return s.replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/\\+$/, '')
          .split(/['")]/)[0]
          .split('</')[0];
      }).forEach(src => {
        collector.push({
          src,
          page: loc.href,
          meta: {
            origin: name + ' - regex.hard-coded.link'
          }
        });
      });
    }
  }
  //
  if (prefs['custom-extensions'].length) {
    for (const doc of docs) {
      for (const a of doc.querySelectorAll('a')) {
        if (a.href && prefs['custom-extensions'].some(e => a.href.includes('.' + e))) {
          collector.push({
            width: 1,
            height: 1,
            src: a.href,
            custom: a.getAttribute(self.custom) || '',
            // if image is verified, we dont have the image size. on accurate mode set it to false
            verified: true,
            page: loc.href,
            type: 'image/unknown',
            meta: {
              origin: name + ' - custom.extensions',
              size: 'custom.extensions',
              type: 'skipped'
            }
          });
        }
      }
    }
  }
};

collector.push = function(o) {
  if (o.src) {
    if (window.regexp && window.regexp.some(r => r.test(o.src)) === false) {
      return;
    }
    // try to arrange items
    o.position = collector.position ++;

    // convert relative path to absolute and remove hash section (to prevent duplicates)
    try {
      const loc = new URL(o.src, o.page);

      if (['http:', 'https:', 'file:', 'data:', 'blob:'].some(a => a === loc.protocol) === false) {
        return;
      }

      o.src = loc.href;

      // o.src = o.src.split('#')[0]; // dont use this

      if (collector.cache.has(o.src) === false) {
        collector.cache.add(o.src);

        // try to place important requests on top of the list
        if (o.width) {
          collector.feeds['1'].push(o);
        }
        else if (['bmp', 'png', 'gif', 'webp', 'jpg', 'svg', 'ico'].some(n => {
          return o.src.indexOf('.' + n) !== -1 || o.src.startsWith('data:image/' + n);
        })) {
          collector.feeds['1'].push(o);
        }
        else if (loc.origin === location.origin) { // same origins
          collector.feeds['2'].push(o);
        }
        else { // misc
          collector.feeds['3'].push(o);
        }

        collector.events.feed(1);
      }
    }
    catch (e) {
      console.warn('invalid URL', o);
    }
  }
};
collector.position = 0;

collector.addImage = function(o) {
  if (self.accuracy === 'accurate' || self.accuracy === 'partial-accurate') {
    if (!o.width) {
      collector['raw-images'].push(o);
      collector.head();
      return;
    }
  }

  // we are not sure this is an image file
  if (!o.type.startsWith('image/')) {
    collector['raw-images'].push(o);
    collector.head();
    return;
  }
  collector['processed-images'].push(o);

  collector.events.image(o);
};

// try to detect width, and height of an image
collector.head = async function() {
  if (collector.head.jobs > 5 || collector.active === false) {
    return;
  }

  const prefs = await new Promise(resolve => chrome.storage.local.get({
    'head-timeout': 30 * 1000,
    'head-delay': 100
  }, resolve));

  const o = collector['raw-images'].shift();
  if (o) {
    collector.head.jobs += 1;

    try {
      const r = await utils.response.segment(o);

      o.size = r.size;
      o.type = utils.type(o, r);
      o.disposition = r.disposition;

      // detect type
      for (const name of ['bmp', 'png', 'gif', 'webp', 'jpg']) {
        if (type[name](r.segment)) {
          const meta = size[name](r.segment);
          if (meta) {
            Object.assign(o, meta);
            o.meta.size = 'size.js';
            break;
          }
        }
      }
      if (!o.width) {
        throw Error('size detection failed' + o.src);
      }
    }
    catch (e) {
      // report resolving by alternative method. The user might need to toggle the "referer" header
      if (e.message === 'STATUS_CODE_403') {
        chrome.runtime.sendMessage({
          cmd: 'alternative-image-may-work'
        });
      }
      await new Promise(resolve => {
        const img = new Image();

        img.onload = () => {
          o.width = img.naturalWidth;
          o.height = img.naturalHeight;
          // for data URIs the type is declared in the first part of the URI
          let fallback = 'image/unknown';
          if (o.src.startsWith('data:')) {
            const mediatype = o.src.slice(5, o.src.indexOf(',')).split(';')[0];
            if (mediatype) {
              fallback = mediatype;
            }
          }
          o.type = utils.type(o, {
            type: fallback
          });
          o.meta.size = 'size.img.element';
          // keep this decoded element around for the capture download path
          if (sources.has(o.src) === false) {
            sources.set(o.src, img);
          }
          resolve();
        };
        img.onerror = () => {
          o.meta.size = 'error';
          resolve();
        };
        img.src = o.src;
      });
    }

    if (o.type.startsWith('image/')) {
      collector['processed-images'].push(o);
      collector.events.image(o);
    }

    // lazy done
    setTimeout(() => {
      collector.head.jobs -= 1;
      collector.events.raw();
      collector.head();
    }, prefs['head-delay']);
  }
  else {
    if (collector.head.jobs === 0) {
      collector.events.guess.done();
    }
  }
};
collector.head.jobs = 0;

/* validate if a feed is an image or a document or must be dropped */
collector.validate = async function() {
  if (collector.validate.jobs > 5 || collector.active === false) {
    return;
  }

  const o = collector.feeds['1'].length ? collector.feeds['1'].shift() : (
    collector.feeds['2'].length ? collector.feeds['2'].shift() : collector.feeds['3'].shift()
  );

  let rm = false; // true if we have a remote request and need to slow down
  if (o) {
    collector.validate.jobs += 1;

    try {
      // skip for custom extension
      if (o.verified && o.meta.size === 'custom.extensions') {
        collector.addImage(o);
      }
      else {
        const {meta, origin} = await collector.meta(o);

        Object.assign(o, meta);
        o.meta.type = origin;

        if (o.type) {
          if (o.type.startsWith('image/')) {
            collector.addImage(o);
          }
          else if (o.type.startsWith('application/')) {
            collector.addImage(o);
          }
          else if (o.type.startsWith('text/html')) {
            collector.document(o);
            rm = true;
          }
        }
      }
    }
    catch (e) {
      console.warn('cannot validate', o, e);
    }

    const done = () => {
      collector.validate.jobs -= 1;
      collector.events.validate();
      collector.validate();
    };

    // lazy done
    chrome.storage.local.get({
      'validate-delay': 100
    }, prefs => setTimeout(() => done(), rm ? prefs['validate-delay'] : 0));
  }
  else {
    if (collector.validate.jobs === 0) {
      collector.events.guess.done();
    }
  }
};
collector.validate.jobs = 0;

collector.document = function(o) {
  if (collector.active === false) {
    return;
  }
  // do not parse sub documents
  if (self.deep > 1 && o.meta.origin.startsWith('one')) {
    collector.docs.push(o);

    collector.dig();
    collector.dig();
    collector.dig();
    collector.dig();
    collector.dig();
  }
};

collector.dig = async function() {
  // deep = 2; extract images
  // deep = 3; extract links and images

  if (collector.dig.jobs > 5 || collector.active === false) {
    return;
  }

  const prefs = await new Promise(resolve => chrome.storage.local.get({
    'dig-delay': 100,
    'dig-timeout': 30 * 1000
  }, resolve));

  const o = collector.docs.shift();
  if (o && o.src) {
    collector.dig.jobs += 1;

    try {
      const content = await utils.response.text(o);

      if (content) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        // fix wrong base!
        const base = doc.createElement('base');
        base.href = o.src;
        doc.head.appendChild(base);

        chrome.runtime.sendMessage({
          cmd: 'new-frame'
        });

        await collector.inspect(doc, new URL(o.src), 'two', {
          bg: self.deep === 3,
          links: self.deep === 3,
          extract: self.deep === 3
        });

        collector.validate();
        collector.validate();
        collector.validate();
        collector.validate();
        collector.validate();
      }
    }
    catch (e) {}

    // lazy done
    setTimeout(() => {
      collector.dig.jobs -= 1;
      collector.events.document();
      collector.dig();
    }, prefs['dig-delay']);
  }
};
collector.dig.jobs = 0;

collector.loop = async function() {
  chrome.runtime.sendMessage({
    cmd: 'state',
    value: 'start'
  });
  await collector.inspect(document, location, 'one', {
    bg: true,
    links: true,
    extract: true
  });

  collector.validate();
  collector.validate();
  collector.validate();
  collector.validate();
  collector.validate();
};

collector.observe = (request, sender, response) => {
  if (request.cmd === 'stop-collector') {
    collector.active = false;

    if (request.remove && window.top === window) {
      chrome.runtime.sendMessage({
        cmd: 'set-badge',
        text: ''
      });
      for (const e of document.querySelectorAll('dialog.daimages')) {
        e.remove();
      }
      chrome.runtime.onMessage.removeListener(collector.observe);
    }
  }
  // For create-directory, we cannot redirect form worker. it is too late and will get "User activation required."
  else if (request.cmd === 'create-directory') {
    window.showDirectoryPicker().then(async d => {
      self.directory = d;
      if (request.readme) {
        const file = await d.getFileHandle(request.name, {
          create: true
        });
        const writable = await file.createWritable();
        const blob = new Blob([request.content], {
          type: 'text/plain'
        });
        const response = new Response(blob);
        await response.body.pipeTo(writable);
      }
      response(true);
    }).catch(e => {
      response({error: e.message});
    });
    return true;
  }
  else if (request.cmd === 'image-to-directory') {
    Promise.all([
      fetch(request.href),
      self.directory.getFileHandle(request.filename, {
        create: true
      }).then(file => file.createWritable())
    ]).then(async ([r, writable]) => {
      await writable.truncate(0);
      await r.body.pipeTo(writable);

      response(true);
    }).catch(e => {
      console.error(e);
      response({
        error: e.message
      });
    }).finally(() => URL.revokeObjectURL(request.href));

    return true;
  }
  else if (request.cmd === 'download-image') {
    const img = sources.get(request.src);

    // try to find the image on page and download it (it is useful specially if the image src is a dead blob)
    const capture = () => new Promise((resolve, reject) => {
      const e = img || document.querySelector(`img[src="${request.src}"]`);
      if (e) {
        const next = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          canvas.width = e.naturalWidth;
          canvas.height = e.naturalHeight;

          if (e.naturalWidth === 0 || e.naturalHeight === 0) {
            reject(Error('image is collapsed; capture'));
          }
          ctx.drawImage(e, 0, 0, e.naturalWidth, e.naturalHeight);
          resolve(canvas.toDataURL());
        };

        // is image loaded
        if (e.complete) {
          return next();
        }
        else {
          chrome.storage.local.get({
            'capture-timeout': 10 * 1000
          }).then(prefs => {
            e.addEventListener('load', () => next(), {once: true});
            e.addEventListener('error', () => reject(Error('image loading failed; capture')), {once: true});
            setTimeout(() => reject(Error('image loading timeout; capture')), prefs['capture-timeout']);
            e.loading = 'eager';
          });
        }
      }
      else {
        reject(Error('image not found; capture'));
      }
    });

    const props = {
      headers: {
        referer: request.referer
      }
    };
    if (img && request.referer) {
      if (img.referrerPolicy) {
        if (img.referrerPolicy === 'origin') {
          try {
            props.headers.referer = (new URL(request.referer)).origin + '/';
          }
          catch (e) {}
        }
        else if (img.referrerPolicy === 'no-referrer') {
          delete props.headers.referer;
        }
      }
    }

    fetch(request.src, props).then(r => {
      if (!r.ok) {
        throw Error('STATUS_CODE_' + r.status);
      }
      return r.blob();
    }).catch(() => {
      // try to include credentials
      props.credentials = 'include';
      return fetch(request.src, props).then(r => {
        if (!r.ok) {
          throw Error('STATUS_CODE_' + r.status);
        }
        return r.blob();
      });
    }).then(blob => {
      if (request.type === 'blob') {
        response(URL.createObjectURL(blob));
      }
      // Security Error: Content at moz-extension://.../core/index.html may not load data from blob:http://...
      else {
        const reader = new FileReader();
        reader.onload = () => response(reader.result);
        reader.readAsDataURL(blob);
      }
    }).catch(() => {
      // can we get the image from an image element
      try {
        capture().then(response, e => response({
          error: e.message
        }));
      }
      catch (e) {
        console.error(request, e);
        response({
          error: e.message
        });
      }
    });
    return true;
  }
  else if (request.cmd === 'file-picker-available') {
    response('showDirectoryPicker' in window);
  }
};
chrome.runtime.onMessage.addListener(collector.observe);

// eslint-disable-next-line semi
''
