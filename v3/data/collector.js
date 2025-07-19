/* Copyright (C) 2014-2023 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* eslint no-var: 0 */

/* global type, size, post, utils, sources */

/*
  accuracy: accurate -> force calculate size, width, height
  accuracy: partial-accurate -> force calculate width, height
  accuracy: no-accurate -> no external request
*/

'use strict';

var collector = {
  'active': true,
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

var report = () => {
  post({
    cmd: 'progress',
    value: collector.feeds['1'].length + collector.feeds['2'].length + collector.feeds['3'].length +
      collector['raw-images'].length +
      collector.docs.length
  });
};

collector.events = {
  image(o) { // called when new image is listed
    post({
      cmd: 'images',
      images: [o]
    });
  },
  feed(length) { // called when a new link is listed
    post({
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
    (window.accuracy === 'accurate' || window.accuracy === 'partial-accurate') && !o.width, // we will later run width and height detection
    (window.accuracy !== 'accurate' || o.size)
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
  for (const doc of docs) {
    const images = doc.images || doc.querySelectorAll('img');
    for (const img of [...images]) {
      //  The "data-src" attribute is commonly used for lazy-loading images
      const src = img.currentSrc || img.src || img.dataset.src;

      sources.set(src, img);
      collector.push({
        width: img.naturalWidth,
        height: img.naturalHeight,
        src,
        alt: img.alt,
        custom: img.getAttribute(window.custom) || '',
        // if image is verified, we dont have the image size. on accurate mode set it to false
        verified: window.accuracy === 'accurate' ? false : true,
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
          custom: img.getAttribute(window.custom) || '',
          // if image is verified, we dont have the image size. on accurate mode set it to false
          verified: window.accuracy === 'accurate' ? false : true,
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
        custom: image.getAttribute(window.custom) || '',
        // if image is verified, we dont have the image size. on accurate mode set it to false
        verified: window.accuracy === 'accurate' ? false : true,
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
  if (window.deep > 0 && policies.links) {
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
  if (window.deep > 0 && policies.extract) {
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
            custom: a.getAttribute(window.custom) || '',
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
  if (window.accuracy === 'accurate' || window.accuracy === 'partial-accurate') {
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
        post({
          cmd: 'alternative-image-may-work'
        });
      }
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          o.width = img.naturalWidth;
          o.height = img.naturalHeight;
          o.type = utils.type(o, {
            type: 'image/unknown'
          });
          o.meta.size = 'size.img.element';
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
};
collector.validate.jobs = 0;

collector.document = function(o) {
  if (collector.active === false) {
    return;
  }
  // do not parse sub documents
  if (window.deep > 1 && o.meta.origin.startsWith('one')) {
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

        post({
          cmd: 'new-frame'
        });

        await collector.inspect(doc, new URL(o.src), 'two', {
          bg: window.deep === 3,
          links: window.deep === 3,
          extract: window.deep === 3
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
