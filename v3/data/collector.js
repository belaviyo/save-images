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
  'cache': new Map() // normalized src -> pending candidate; null once evaluated
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
          collector.docs.length === 0 &&
          // a document is shifted out of "docs" before it is parsed; without
          // these checks the collector stops while a worker is still busy
          collector.head.jobs === 0 &&
          collector.validate.jobs === 0 &&
          collector.dig.jobs === 0
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
  // image proxies hide the real URL in their path; always ask the server for
  // its content-disposition instead of trusting the extensions inside that URL
  const proxied = utils.proxied(o.src);
  const type = proxied ? '' : utils.extension(o.src);

  if (type) {
    im = {
      meta: {
        type
      },
      origin: 'guess'
    };
  }

  // a rendered <img> (naturalWidth > 0) is an image even when its URL ends with
  // a video/audio extension, e.g. screenshots named "clip.mp4.0007.jpg"
  if (im && im.meta.type.startsWith('image/') === false && o.width) {
    im = {
      meta: {
        type: 'image/unknown'
      },
      origin: 'guess'
    };
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

/* parse a "srcset" value into candidate URLs and their size descriptors */
collector.parseSrcset = function(value) {
  const candidates = [];
  // data URIs may contain commas, so do not split on every comma
  const parts = (value || '').match(/(?:data:[^,]+,)?[^\s,]+(?:\s+\d+(?:\.\d+)?[wx])?/gi) || [];

  for (const part of parts) {
    const [src, descriptor = ''] = part.trim().split(/\s+/);
    if (!src || src.startsWith('#') || /^javascript:/i.test(src)) {
      continue;
    }
    // a comma inside a normal URL can leave a fragment such as "2" behind
    if (/[/.?]/.test(src) === false && /^(?:https?|blob|file):/i.test(src) === false) {
      continue;
    }

    const d = /^(\d+(?:\.\d+)?)(w|x)$/i.exec(descriptor);

    candidates.push({
      src,
      width: d && d[2].toLowerCase() === 'w' ? Number(d[1]) : 0,
      density: d && d[2].toLowerCase() === 'x' ? Number(d[1]) : 0
    });
  }

  return candidates;
};

/* common lazy-loading attributes that point at the real image */
collector.lazy = function(img) {
  const names = [
    'data-src',
    'data-original',
    'data-lazy',
    'data-lazy-src',
    'data-original-src',
    'data-large',
    'data-large-src',
    'data-full',
    'data-full-src',
    'data-image',
    'data-url',
    'data-zoom',
    'data-zoom-image',
    'data-zoom-src',
    'data-hi-res',
    'data-highres'
  ];
  const values = [];

  for (const name of names) {
    const value = img.getAttribute(name);
    if (
      value && value.trim() &&
      value.startsWith('#') === false &&
      /^javascript:/i.test(value) === false &&
      /^\d+$/.test(value) === false
    ) {
      values.push(value.trim());
    }
  }

  return values;
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

      // lazy-loading attributes often hold the real (larger) image
      for (const candidate of collector.lazy(img)) {
        sources.set(candidate, img);
        collector.push({
          src: candidate,
          alt: img.alt,
          custom: img.getAttribute(self.custom) || '',
          verified: self.accuracy === 'accurate' ? false : true,
          page: loc.href,
          meta: {
            origin: name + ' - document.images',
            size: 'img.element',
            type: 'skipped'
          }
        });
      }

      // every responsive candidate, including larger variants that are not currentSrc
      for (const value of [
        img.getAttribute('srcset'),
        img.getAttribute('data-srcset'),
        img.getAttribute('data-lazy-srcset'),
        img.getAttribute('data-original-srcset')
      ]) {
        for (const candidate of collector.parseSrcset(value)) {
          sources.set(candidate.src, img);
          collector.push({
            src: candidate.src,
            alt: img.alt,
            custom: img.getAttribute(self.custom) || '',
            verified: self.accuracy === 'accurate' ? false : true,
            page: loc.href,
            srcsetWidth: candidate.width || undefined,
            srcsetDensity: candidate.density || undefined,
            meta: {
              origin: name + ' - document.images',
              size: 'img.element',
              type: 'skipped'
            }
          });
        }
      }
    }
  }
  // wait for all forced images to load; rejects (broken/invalid images) are ignored
  await Promise.allSettled(loading);

  // find images; part 2/4
  for (const doc of docs) {
    for (const source of [...doc.querySelectorAll('source')]) {
      for (const value of [
        source.getAttribute('srcset'),
        source.getAttribute('data-srcset'),
        source.getAttribute('data-lazy-srcset'),
        source.getAttribute('data-original-srcset')
      ]) {
        for (const candidate of collector.parseSrcset(value)) {
          sources.set(candidate.src, source);
          collector.push({
            src: candidate.src,
            type: source.type,
            page: loc.href,
            srcsetWidth: candidate.width || undefined,
            srcsetDensity: candidate.density || undefined,
            meta: {
              origin: name + ' - source.element'
            }
          });
        }
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
      for (const a of doc.querySelectorAll('a')) {
        collector.push({
          src: a.href,
          page: loc.href,
          meta: {
            origin: name + ' - link.href'
          }
        }, collector.context(a));
      }
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

/* collect the small amount of element context that helps scoring a link;
   only plain data is stored, never the DOM node itself */
collector.context = function(a) {
  const text = ((a.getAttribute('title') || '') + ' ' + (a.textContent || '')).trim();
  const img = a.querySelector('img, image');
  let media = false;

  if (img) {
    const src = (img.currentSrc || img.src || img.getAttribute('href') || '').toLowerCase();
    const size = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
    const badge = /(?:^|[/_.\-])(logo|logos|icon|icons|avatar|avatars|sprite|sprites|badge|emoji|favicon)(?=[/_.\-?&#]|$)/i.test(src);

    // a thumbnail link rather than an inline icon or a text link with a badge
    media = badge === false && text.length < 100 && (size === 0 || size >= 100);
  }

  return {
    media,
    download: a.hasAttribute('download'),
    lightbox: /lightbox|gallery|zoom|fancybox|photoswipe|magnific|highslide/i.test(
      (a.getAttribute('class') || '') + ' ' + (a.getAttribute('rel') || '')
    ),
    text: text.slice(0, 200)
  };
};

/* Score how likely a candidate is a high-resolution image. The score drives
   the processing order through collector.next(); it never filters candidates. */
{
  const HIGH = /(?:^|[/_.\-])(original|originals|orig|fullsize|full-size|fullimage|full-image|full|largeimage|large-image|large|big|hires|hi-res|highres|high-res|highresolution|high-resolution|master|raw|source|download|wallpaper|retina|uhd|4k|5k|8k)(?=[/_.\-?&#]|$)/i;
  const LOW = /(?:^|[/_.\-])(thumb|thumbs|thumbnail|thumbnails|small|tiny|mini|icon|icons|favicon|avatar|avatars|logo|logos|sprite|sprites|placeholder|preview|prev|blur|lowres|low-res|compressed|resize|resized|emoji|badge|button|banner|spinner|loading|grey|gray)(?=[/_.\-?&#]|$)/i;
  const WH = /(?:^|[^\d])(\d{2,5})\s*[x×]\s*(\d{2,5})(?:[^\d]|$)/i;
  const DENSITY = /(?:@|%40)(\d(?:\.\d)?)x(?=[/_.\-?&#]|$)/i;
  const CLOUDINARY = /(?:^|[/_,.\-])[wh][_=](\d{2,5})(?=[/_,.\-]|$)/gi;
  const TEXT_HIGH = /original|full[ -]?size|fullsize|high[ -]?res|highest resolution|download|\b(?:4k|8k|uhd|raw)\b|原图|原圖|大图|大圖|高清|オリジナル|高画質|고화질/i;

  const dimension = n => {
    if (n >= 2000) {
      return 120;
    }
    if (n >= 1200) {
      return 80;
    }
    if (n >= 800) {
      return 40;
    }
    if (n > 0 && n <= 400) {
      return -100;
    }
    return 0;
  };

  const evaluate = (o, context, reasons) => {
    if (typeof o === 'string') {
      o = {src: o};
    }

    let score = 0;
    const add = (value, reason) => {
      if (value) {
        score += value;
        if (reasons) {
          reasons.push((value > 0 ? '+' : '') + value + ': ' + reason);
        }
      }
    };

    const src = o.src || '';
    const data = src.startsWith('data:');

    // file type
    const ext = utils.extension(src);
    if (ext.startsWith('image/')) {
      if (['image/svg', 'image/ico', 'image/icns', 'image/cur'].includes(ext)) {
        add(-30, 'vector or icon type');
      }
      else {
        add(40, 'raster image extension');
      }
    }

    // size of an image that is already rendered on the page
    const fake = o.meta && o.meta.size === 'custom.extensions';
    if (!fake && (o.width || o.height)) {
      add(dimension(Math.max(o.width || 0, o.height || 0)), 'element dimension');
    }

    // width declared by a srcset descriptor, e.g. "photo.jpg 2400w"
    if (o.srcsetWidth) {
      add(dimension(o.srcsetWidth), 'srcset width');
    }
    if (o.srcsetDensity >= 3) {
      add(90, 'srcset density ' + o.srcsetDensity + 'x');
    }
    else if (o.srcsetDensity >= 2) {
      add(60, 'srcset density ' + o.srcsetDensity + 'x');
    }

    let path = '';
    if (data === false) {
      try {
        const url = new URL(src);
        path = url.pathname + url.search + url.hash;

        // query-based dimensions, e.g. ?w=2400 or ?width=1920
        let max = 0;
        for (const key of ['w', 'width', 'h', 'height', 'size', 'res', 'resolution', 'dimension', 'dimensions']) {
          const n = Number(url.searchParams.get(key));
          if (n > max) {
            max = n;
          }
        }
        if (max) {
          add(dimension(max), 'query dimension');
        }

        // pixel density, e.g. ?dpr=2 or ?scale=3
        let density = 0;
        for (const key of ['dpr', 'scale', 'density', 'pixelratio']) {
          const n = Number(url.searchParams.get(key));
          if (n > density) {
            density = n;
          }
        }
        if (density >= 3) {
          add(90, 'density ' + density + 'x');
        }
        else if (density >= 2) {
          add(60, 'density ' + density + 'x');
        }
      }
      catch (e) {}
    }

    // path tokens; blob UUIDs and base64 do not carry meaningful names
    if (data === false && src.startsWith('blob:') === false) {
      if (HIGH.test(path)) {
        add(100, 'high-resolution token');
      }
      if (LOW.test(path)) {
        add(-100, 'thumbnail/icon token');
      }

      const wh = WH.exec(path);
      if (wh) {
        const n = Math.max(Number(wh[1]), Number(wh[2]));
        add(dimension(n), 'dimension token ' + wh[1] + 'x' + wh[2]);
      }

      const density = DENSITY.exec(path);
      if (density) {
        const n = Number(density[1]);
        if (n >= 3) {
          add(90, 'density ' + n + 'x');
        }
        else if (n >= 2) {
          add(60, 'density ' + n + 'x');
        }
      }

      // image-service style dimensions, e.g. /w_1920,h_1080/ or /w=2400/
      let max = 0;
      let m;
      CLOUDINARY.lastIndex = 0;
      while ((m = CLOUDINARY.exec(path)) !== null) {
        const n = Number(m[1]);
        if (n > max) {
          max = n;
        }
      }
      if (max) {
        add(dimension(max), 'image-service dimension');
      }
    }

    // data URIs carry their size inline
    if (data) {
      if (src.length >= 700 * 1024) {
        add(60, 'large data URI');
      }
      else if (src.length <= 5 * 1024) {
        add(-30, 'small data URI');
      }
    }

    // where the candidate was discovered
    const origin = (o.meta && o.meta.origin) || '';
    if (origin.includes('custom.extensions')) {
      add(50, 'user-defined extension');
    }
    else if (origin.includes('img.performance')) {
      add(40, 'loaded image resource');
    }
    else if (origin.includes('source.element')) {
      add(20, 'responsive source');
    }
    else if (origin.includes('css.performance')) {
      add(10, 'stylesheet resource');
    }
    else if (origin.includes('svg.')) {
      add(-20, 'inline svg');
    }

    if (o.verified) {
      add(20, 'verified image');
    }

    // the link itself points at something likely to be larger
    if (context) {
      if (context.media) {
        add(80, 'anchor wraps media');
      }
      if (context.download) {
        add(100, 'download attribute');
      }
      if (context.lightbox) {
        add(80, 'lightbox marker');
      }
      if (context.text && TEXT_HIGH.test(context.text)) {
        add(60, 'anchor text');
      }
    }

    // byte size when it is already known
    if (o.size) {
      if (o.size >= 1024 * 1024) {
        add(120, 'size above 1MB');
      }
      else if (o.size >= 500 * 1024) {
        add(80, 'size above 500KB');
      }
      else if (o.size >= 100 * 1024) {
        add(30, 'size above 100KB');
      }
      else if (o.size <= 5 * 1024) {
        add(-60, 'size below 5KB');
      }
    }

    return score;
  };

  collector.score = (o, context) => evaluate(o, context);
  collector.score.explain = (o, context) => {
    const reasons = [];

    return {
      score: evaluate(o, context, reasons),
      reasons
    };
  };
}

collector.push = function(o, context) {
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

      const existing = collector.cache.get(o.src);

      if (collector.cache.has(o.src)) {
        // promote a pending candidate when it is rediscovered with a stronger
        // signal (e.g., the same URL as a thumbnail and as a full-size link)
        if (existing) {
          try {
            const score = collector.score(o, context);
            if (score > (existing.score || 0)) {
              existing.score = score;
            }
          }
          catch (e) {
            console.warn('cannot score candidate', o.src, e);
          }
        }
      }
      else {
        collector.cache.set(o.src, o);

        // annotate the candidate; this does not affect the feed it is placed in
        try {
          o.score = collector.score(o, context);
        }
        catch (e) {
          console.warn('cannot score candidate', o.src, e);
        }

        // bucket the candidate; collector.next() decides the processing order
        if (o.width) {
          collector.feeds['1'].push(o);
        }
        else if ((utils.extension(o.src) || '').startsWith('image/')) {
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

/* release the pending reference; the key stays for deduplication */
collector.done = function(o) {
  if (o && o.src && collector.cache.has(o.src)) {
    collector.cache.set(o.src, null);
  }
};

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
  collector.done(o);

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

  const o = collector.next(collector['raw-images']);
  if (o) {
    collector.head.jobs += 1;

    try {
      const r = await utils.response.segment(o);

      o.size = r.size;
      o.type = utils.type(o, r);
      o.disposition = r.disposition;

      // an HTML page behind an image-like URL; crawl it for embedded images
      // instead of dropping it (collector.document ignores the deep level 1)
      if (o.type.startsWith('text/html')) {
        collector.document(o);
      }
      else {
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
        // the page referer is trimmed to its origin on cross-site requests and
        // then rejected by hotlink-protected hosts (e.g. ImageTwist originals)
        img.referrerPolicy = 'no-referrer';

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
          // keep this decoded element around for the capture download path.
          // An earlier entry may be an inert element from a parsed document
          // (deep search), which can never be drawn to a canvas
          const current = sources.get(o.src);
          if (!current || !current.naturalWidth) {
            sources.set(o.src, img);
          }
          resolve();
        };
        img.onerror = () => {
          o.meta.size = 'error';
          // neither the network probe nor the image element could decode this
          // candidate; it is not an image (e.g. a viewer page behind a .jpg URL)
          o.type = '';
          resolve();
        };
        img.src = o.src;
      });
    }

    if (o.type.startsWith('image/')) {
      collector['processed-images'].push(o);
      collector.events.image(o);
    }

    // an HTML document queued by collector.document() is still pending;
    // every other outcome is final
    if (o.type.startsWith('text/html') === false) {
      collector.done(o);
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

/* pick the highest scored item from one or more queues; equal scores keep
   the global discovery order (position) */
collector.next = function(...queues) {
  if (queues.length === 0) {
    queues = [collector.feeds['1'], collector.feeds['2'], collector.feeds['3']];
  }

  let best = null;
  let index = -1;
  let queue = null;

  for (const q of queues) {
    for (let i = 0; i < q.length; i += 1) {
      const o = q[i];
      const score = o.score || 0;
      const bestScore = best ? best.score || 0 : 0;

      if (
        best === null ||
        score > bestScore ||
        (score === bestScore && (o.position || 0) < (best.position || 0))
      ) {
        best = o;
        index = i;
        queue = q;
      }
    }
  }

  if (best) {
    queue.splice(index, 1);
  }

  return best;
};

/* validate if a feed is an image or a document or must be dropped */
collector.validate = async function() {
  if (collector.validate.jobs > 5 || collector.active === false) {
    return;
  }

  const o = collector.next();

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
          else {
            collector.done(o);
          }
        }
        else {
          collector.done(o);
        }
      }
    }
    catch (e) {
      console.warn('cannot validate', o, e);
      collector.done(o);
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
    collector.done(o);
    return false;
  }

  // do not parse sub documents
  if (self.deep > 1 && o.meta.origin.startsWith('one')) {
    collector.docs.push(o);

    collector.dig();
    collector.dig();
    collector.dig();
    collector.dig();
    collector.dig();

    return true;
  }

  collector.done(o);
  return false;
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

  const o = collector.next(collector.docs);
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

    collector.done(o);

    // lazy done
    setTimeout(() => {
      collector.dig.jobs -= 1;
      collector.events.document();
      collector.dig();
      // a finished document (with or without images) must re-evaluate completion
      collector.events.guess.done();
    }, prefs['dig-delay']);
  }
  else if (o) {
    collector.done(o);
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
      for (const e of document.querySelectorAll('div.daimages-host, dialog.daimages')) {
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
      let e = img || document.querySelector(`img[src="${request.src}"]`);
      if (!e) {
        reject(Error('image not found; capture'));
        return;
      }
      // an element from a parsed document (deep search) or a <source>/<image>
      // never decodes; request the pixels again with a real image element
      if (!('naturalWidth' in e) || (e.complete && e.naturalWidth === 0)) {
        e = new Image();
        // do not send the page referer; it is trimmed to the page origin and
        // rejected by hotlink-protected image hosts
        e.referrerPolicy = 'no-referrer';
        e.src = utils.upgrade(request.src);
      }
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
    });

    const props = {
      // the DNR rule supplies the referer where the browser honors it; never
      // let the page's own (trimmed) referer leak to the image host
      referrerPolicy: 'no-referrer',
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

    fetch(utils.upgrade(request.src), props).then(r => {
      if (!r.ok) {
        throw Error('STATUS_CODE_' + r.status);
      }
      return r.blob();
    }).catch(() => {
      // try to include credentials
      props.credentials = 'include';
      return fetch(utils.upgrade(request.src), props).then(r => {
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
