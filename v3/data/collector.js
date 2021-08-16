/* Copyright (C) 2014-2020 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* eslint no-var: 0 */

/* global type, size */

/*
  accuracy: accurate -> force calculate size, width, height
  accuracy: partial-accurate -> force calculate width, height
  accuracy: no-accurate -> no external request
*/

'use strict';

var dsize = r => {
  const size = Number(r.headers.get('content-length'));
  if (size && isNaN(size) === false) {
    return size;
  }
  if (r.url && r.url.startsWith('data:')) {
    const [header, ...bodies] = r.url.split(',');
    const body = bodies.join(',');
    if (header && header.indexOf('base64') !== -1) {
      try {
        return atob(body).length;
      }
      catch (e) {}
    }
    if (header) {
      return body.length;
    }
  }
  return 0;
};

var dtype = (p, o) => {
  if (o.type && o.type.startsWith('text/')) {
    return o.type;
  }
  // prefer type from URL, rather than type that is returned by server.
  // Some servers return "application/..." for image types
  return p.type || o.type || '';
};

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
  if (collector.active) {
    chrome.runtime.sendMessage({
      cmd: 'progress',
      value: collector.feeds['1'].length + collector.feeds['2'].length + collector.feeds['3'].length +
        collector['raw-images'].length +
        collector.docs.length
    });
  }
};

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
  }
};

// try to pass this step as fast as possible
collector.meta = async function(o) {
  const extensions = {
    'css': 'text/css',
    'html': 'text/html',
    'js': 'text/javascript',
    // video
    'flv': 'video/flv',
    'mp4': 'video/mp4',
    'm3u8': 'application/x-mpegURL',
    'ts': 'video/MP2T',
    '3gp': 'video/3gpp',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'wmv': 'video/x-ms-wmv',
    // audio
    'm4a': 'audio/mp4',
    'mp3': 'audio/mpeg',
    'ogg': 'audio/x-mpegurl',
    'wav': 'audio/vnd.wav',
    // image
    'png': 'image/png',
    'jpeg': 'image/jpeg',
    'jpg': 'image/jpg',
    'bmp': 'image/bmp',
    'cur': 'image/cur',
    'gif': 'image/gif',
    'ico': 'image/ico',
    'icns': 'image/icns',
    'psd': 'image/psd',
    'svg': 'image/svg',
    'tiff': 'image/tiff',
    'webp': 'image/webp'
  };

  // try to use this fast method when we are going to fetch the image later to get width and height
  let im;

  for (const [ext, type] of Object.entries(extensions)) {
    if (
      o.src.toLowerCase().endsWith('.' + ext) ||
      o.src.toLowerCase().indexOf('.' + ext + '?') !== -1 ||
      o.src.startsWith('data:image/' + ext)
    ) {
      im = {
        meta: {
          type
        },
        origin: 'guess'
      };
    }
  }

  const conds = [
    (window.accuracy === 'accurate' || window.accuracy === 'partial-accurate') && !o.width, // we will later run width and height detection
    (window.accuracy !== 'accurate' || o.size)
  ];

  if (im && conds.some(a => a)) {
    return im;
  }

  if (o.verified === true) {
    return {};
  }

  const prefs = await new Promise(resolve => chrome.storage.local.get({
    'head-timeout': 30 * 1000
  }, resolve));

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), prefs['head-timeout']);

    const r = await fetch(o.src, {
      signal: controller.signal
    });
    if (r.ok) {
      setTimeout(() => controller.abort(), 0);
      return {
        meta: {
          // some websites return binary mime for image types
          type: im ? im.meta.type : (r.headers.get('content-type') || ''),
          size: dsize(r),
          disposition: r.headers.get('content-disposition')
        },
        origin: 'internal.fetch',
        fetch: 'me'
      };
    }
    else {
      throw Error('failed');
    }
  }
  catch (e) {}
  try {
    const meta = (await new Promise(resolve => chrome.runtime.sendMessage({
      cmd: 'read-headers',
      href: o.src
    }, resolve))) || {};
    if (im) {
      meta.type = dtype(im.meta, meta);
    }

    return {
      meta,
      origin: 'bg.fetch',
      fetch: 'bg'
    };
  }
  catch (e) {
    console.warn(e);
  }

  return {};
};

/* collect images */
collector.inspect = function(doc, loc, name, policies) {
  // find images; part 1/1
  for (const img of [...doc.images]) {
    collector.push({
      width: img.naturalWidth,
      height: img.naturalHeight,
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
  // find images; part 1/2
  for (const source of [...doc.querySelectorAll('source')]) {
    if (source.srcset) {
      collector.push({
        src: source.srcset.split(' ')[0],
        type: source.type,
        page: loc.href,
        meta: {
          origin: name + ' - source.element'
        }
      });
    }
  }
  // find background images; part 2
  if (policies.bg) {
    try {
      [...doc.querySelectorAll('*')]
        .map(e => window.getComputedStyle(e).backgroundImage)
        .map(i => {
          const e = /url\(['"]([^)]+)["']\)/.exec(i);
          return e && e.length ? e[1] : null;
        }).filter(s => s).forEach(src => {
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
  // find linked images; part 3
  if (window.deep > 0 && policies.links) {
    [...doc.querySelectorAll('a')].map(a => a.href).forEach(src => collector.push({
      src,
      page: loc.href,
      meta: {
        origin: name + ' - link.href'
      }
    }));
  }
  // find hard-coded links; part 4
  if (window.deep > 0 && policies.extract) {
    const r = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    // decode html special characters; &amp;
    (doc.documentElement.innerHTML.match(r) || [])
      .map(s => {
        return s.replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/\\+$/, '')
          .split(/['")]/)[0]
          .split('</')[0];
      })
      .forEach(src => {
        collector.push({
          src,
          page: loc.href,
          meta: {
            origin: name + ' - regex.hard-coded.link'
          }
        });
      });
  }
};

collector.push = function(o) {
  if (o.src) {
    if (window.regexp && window.regexp.some(r => r.test(o.src)) === false) {
      return;
    }

    // convert relative path to absolute and remove hash section (to prevent duplicates)
    try {
      const loc = new URL(o.src, o.page);

      if (['http:', 'https:', 'file:', 'data:'].some(a => a === loc.protocol) === false) {
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

collector.addImage = function(o) {
  if (window.accuracy === 'accurate' || window.accuracy === 'partial-accurate') {
    if (!o.width) {
      collector['raw-images'].push(o);

      collector.head();
      return;
    }
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
      const controller = new AbortController();

      const next = value => {
        for (const name of ['bmp', 'png', 'gif', 'webp', 'jpg']) {
          if (type[name](value)) {
            const meta = size[name](value);
            if (meta) {
              Object.assign(o, meta);
              o.meta.size = 'size.js';
              break;
            }
          }
        }
        if (!o.width) {
          throw Error('size detection failed');
        }
      };
      const remote = async () => {
        const res = await new Promise(resolve => chrome.runtime.sendMessage({
          cmd: 'fetch-segment',
          href: o.src
        }, resolve));

        if (res && res.ok) {
          o.size = res.size;
          o.type = dtype(o, res);
          o.disposition = res.disposition;
          o.meta.fetch = 'bg';
          next(new Uint8Array(res.segment));
        }
        else {
          throw Error('cannot fetch from bg');
        }
      };

      let r;
      try {
        // do not try to fetch locally when we know it will fail
        if (o.meta.fetch === 'bg') {
          throw Error('ignore');
        }

        setTimeout(() => controller.abort(), prefs['head-timeout']);
        r = await fetch(o.src, {
          signal: controller.signal
        });
      }
      catch (e) {
        await remote();
      }
      if (r) {
        if (r.ok === false) {
          await remote();
        }
        else {
          // lets keep whatever needed
          o.size = dsize(r);
          o.type = dtype(o, {
            type: r.headers.get('content-type') || ''
          });
          o.disposition = r.headers.get('content-disposition');
          o.meta.fetch = 'me';

          const reader = r.body.getReader();
          const {value} = await reader.read();
          controller.abort();

          next(value);
        }
      }
    }
    catch (e) {
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          o.width = img.naturalWidth;
          o.height = img.naturalHeight;
          o.type = dtype(o, {
            type: 'image/unknown'
          });
          o.meta.size = 'size.img.element';
          resolve();
        };
        img.onerror = () => {
          o.type = dtype(o, {
            type: 'image/unknown'
          });
          o.meta.size = 'error';
          resolve();
        };
        img.src = o.src;
      });
    }

    collector['processed-images'].push(o);
    collector.events.image(o);


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
      const {meta, origin, fetch} = await collector.meta(o);
      Object.assign(o, meta);
      o.meta.type = origin;
      o.meta.fetch = fetch;
      rm = fetch ? true : false;

      if (o.type && o.type.startsWith('image/')) {
        collector.addImage(o);
      }
      if (o.type && o.type.startsWith('text/html')) {
        collector.document(o);
        rm = true;
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
    collector.docs.push(o.src);

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

  const href = collector.docs.shift();
  if (href) {
    collector.dig.jobs += 1;

    try {
      let content;

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), prefs['dig-timeout']);

        content = await fetch(href, {
          signal: controller.signal
        }).then(r => {
          if (r.ok) {
            return r.text();
          }
          throw Error('not ok');
        });
      }
      catch (e) {
        content = await new Promise(resolve => chrome.runtime.sendMessage({
          cmd: 'get-content',
          href
        }, resolve));
      }

      if (content) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        // fix wrong base!
        const base = doc.createElement('base');
        base.href = href;
        doc.head.appendChild(base);

        collector.inspect(doc, new URL(href), 'two', {
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

collector.loop = function() {
  collector.inspect(document, location, 'one', {
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
