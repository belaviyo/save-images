/* Copyright (C) 2014-2020 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

/* eslint no-var: 0 */
'use strict';

var collector = {
  active: true,
  cache: {}, // prevents duplicated inspection
  size: src => new Promise(resolve => {
    const image = new Image();
    image.onload = image.onloadedmetadata = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      image.src = '';
    };
    image.onerror = () => resolve({
      width: 0,
      height: 0
    });
    image.src = src;
  }),
  head: (img, callback, skip) => {
    chrome.runtime.sendMessage({
      cmd: 'xml-head',
      src: img.src,
      skip
    }, callback);
  },
  findRoots(doc, list = []) {
    for (const e of doc.querySelectorAll('*')) {
      if (e.shadowRoot) {
        try {
          collector.findRoots(e.shadowRoot, list);
          list.push(e.shadowRoot);
        }
        catch (e) {}
      }
    }
  },
  inspect: img => new Promise((resolve, reject) => {
    const src = img.src.toLowerCase();
    // for known types, force the file extension; also on partial-accurate mode, do not fetch the header
    const EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg'];
    const next = ({type = '', size, disposition, head = true}) => {
      if (type.startsWith('text/html')) {
        reject(type);
      }
      // fix the type when possible
      if (img.src) {
        for (const e of EXTENSIONS) {
          if (src.indexOf('.' + e + '?') !== -1 || src.endsWith('.' + e)) {
            type = 'image/' + e;
          }
        }
        type = type.replace('image/jpg', 'image/jpeg');
      }
      // forced the image file type for verified images
      if (!type && img.verified) {
        type = 'image/unknown';
      }
      if (type && type.startsWith('image/')) {
        Object.assign(img, {
          size: src.startsWith('http') ? (Number(size) || 0) : src.length,
          type,
          disposition: disposition || '',
          head
        });
        if (src.startsWith('http')) {
          if ('width' in img && 'height' in img) {
            resolve(img);
          }
          else if (window.calc) {
            collector.size(src).then(o => {
              Object.assign(img, o);
              resolve(img);
            }).catch(() => resolve(img));
          }
          else {
            resolve(img);
          }
        }
        // get image width and height for data-url images
        else {
          collector.size(src).then(obj => resolve(Object.assign(img, obj)));
        }
      }
      else {
        reject(type);
      }
    };
    // get image header info?
    if (window.accuracy === 'accurate') {
      collector.head(img, next);
    }
    else if (window.accuracy === 'partial-accurate') {
      if (EXTENSIONS.some(e => src.indexOf('.' + e + '?') !== -1 || src.endsWith('.' + e))) {
        collector.head(img, next, true);
      }
      else {
        collector.head(img, next);
      }
    }
    else {
      collector.head(img, next, true);
    }
  }),
  loop: async regexps => {
    const cleanup = images => {
      const list = [];
      for (const img of images) {
        let {src} = img;
        // Make sure img src is defined
        if (!src) {
          continue;
        }

        // remove hash to prevent duplicates
        src = src.split('#')[0];

        // fix src
        if ((src.startsWith('http') === false && src.startsWith('data:') === false && src.startsWith('blob:') === false) && img.page) {
          try {
            img.src = src = (new URL(src, img.page)).href;
          }
          catch (e) {}
        }

        if (src.startsWith('http') || src.startsWith('ftp') || src.startsWith('data:') || src.startsWith('blob:')) {
          if (collector.cache[src] === undefined) {
            collector.cache[src] = true;
            if (regexps && regexps.some(r => r.test(src)) === false) {
              continue;
            }
            list.push(img);
          }
        }
      }
      return list;
    };

    // get info for single link
    const analyze = img => {
      return collector.inspect(img).then(img => [img]).catch(type => {
        if (type && type.startsWith('text/html') && window.deep > 1) {
          return new Promise(resolve => {
            chrome.runtime.sendMessage({
              cmd: 'xml-img',
              src: img.src,
              extractLinks: window.deep === 3
            }, async images => {
              images = cleanup(images);
              // fix page link
              for (const i of images) {
                i.page = img.src;
              }
              if (images.length) {
                chrome.runtime.sendMessage({
                  cmd: 'links',
                  filters: regexps,
                  length: images.length
                });
                const tmp = [];
                for (let i = 0; collector.active && i < images.length; i += 5) {
                  const slice = images.slice(i, i + 5);
                  await Promise.all(slice.map(analyze)).then(images => tmp.push(...images));
                }
                resolve(collector.active ? [].concat([], ...tmp) : []);
              }
              else {
                resolve([]);
              }
            });
          });
        }
        else {
          return [];
        }
      });
    };

    let images = [];
    const docs = [document];
    collector.findRoots(document, docs);

    // find images; part 1/3
    for (const doc of docs) {
      for (const img of (doc.images || doc.querySelectorAll('img'))) {
        const src = img.currentSrc || img.src || img.dataset.src;

        const o = {
          width: img.width,
          height: img.height,
          //  The "data-src" attribute is commonly used for lazy-loading images
          src,
          alt: img.alt,
          custom: img.getAttribute(window.custom) || '',
          verified: true, // this is an image even if content-type cannot be resolved,
          page: location.href
        };
        images.push(o);
        if (src && src.startsWith('blob:')) {
          // is the blob source dead
          await fetch(src).catch(e => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
            o.src = canvas.toDataURL();
          }).catch(e => {});
        }
        if (img.src && img.currentSrc !== img.src) {
          images.push({
            src: img.src,
            alt: img.alt,
            custom: img.getAttribute(window.custom) || '',
            verified: true, // this is an image even if content-type cannot be resolved,
            page: location.href
          });
        }
      }
    }
    // find images; part 2/3
    for (const doc of docs) {
      for (const source of doc.querySelectorAll('source')) {
        try {
          const href = (source.srcset || '').split(' ')[0];
          images.push({
            src: (new URL(href, location.href)).href,
            page: location.href
          });
        }
        catch (e) {
          console.warn('Cannot collect source images', e);
        }
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
            images.push({
              src: entry.name,
              page: location.href
            });
          }
          else if (entry.initiatorType === 'img') {
            images.push({
              src: entry.name,
              verified: true,
              page: location.href
            });
          }
        }
      }
      catch (e) {}
    }

    // find embedded images on SVG elements; part 3/3
    for (const doc of docs) {
      for (const image of [...doc.querySelectorAll('image')]) {
        images.push({
          src: image.href?.baseVal,
          alt: image.alt,
          custom: image.getAttribute(window.custom) || '',
          // if image is verified, we dont have the image size. on accurate mode set it to false
          verified: true,
          page: location.href
        });
      }
    }
    for (const doc of docs) {
      images.push(...[...doc.querySelectorAll('source')].filter(i => i.srcset).map(i => ({
        src: i.srcset.split(' ')[0],
        page: location.href
      })));
    }

    // find background images; part 2
    for (const doc of docs) {
      try {
        [...doc.querySelectorAll('*')]
          .map(e => [
            getComputedStyle(e).backgroundImage,
            getComputedStyle(e, ':before').backgroundImage,
            getComputedStyle(e, ':after').backgroundImage
          ])
          .flat()
          .map(i => {
            const e = /url\(['"]([^)]+)["']\)/.exec(i);
            return e && e.length ? e[1] : null;
          }).filter(s => s).forEach(src => {
            if (src.startsWith('//')) {
              src = document.location.protocol + src;
            }
            else if (src.startsWith('/')) {
              document.location.origin + src;
            }
            images.push({
              src,
              page: location.href
            });
          });
      }
      catch (e) {
        console.warn('Cannot collect background images', e);
      }
    }
    // find SVGs
    for (const doc of docs) {
      try {
        for (const svg of doc.querySelectorAll('svg')) {
          const e = svg.cloneNode(true);
          e.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

          images.push({
            src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(e.outerHTML),
            page: location.href
          });
        }
      }
      catch (e) {
        console.warn('Cannot collect SVG images', e);
      }
    }

    // find linked images; part 3
    for (const doc of docs) {
      if (window.deep > 0) {
        [...doc.querySelectorAll('a')].map(a => a.href)
          .forEach(src => images.push({
            src,
            page: location.href
          }));
      }
    }
    // find hard-coded links; part 4
    for (const doc of docs) {
      if (window.deep > 0) {
        const r = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
        const content = (doc.documentElement?.innerHTML || '') + '\n' + (doc.body?.textContent || '');

        // decode html special characters; &amp;
        (content.match(r) || [])
          .map(s => s.replace(/&amp;/g, '&'))
          .forEach(src => images.push({
            src,
            page: location.href
          }));
      }
    }
    // clean
    images = cleanup(images);
    // notify the total number of links to be parsed
    chrome.runtime.sendMessage({
      cmd: 'links',
      filters: regexps,
      length: images.length
    });
    // loop
    for (let i = 0; collector.active && i < images.length; i += 5) {
      const slice = images.slice(i, i + 5);
      await Promise.all(slice.map(analyze))
        .then(images => collector.active && images.length && chrome.runtime.sendMessage({
          cmd: 'images',
          images: [].concat([], ...images),
          index: slice.length
        })).catch(e => console.error(e));
    }
  }
};
chrome.runtime.sendMessage({
  cmd: 'prefs'
}, prefs => {
  window.deep = prefs ? prefs.deep : 0;
  window.accuracy = prefs ? prefs.accuracy : 'accurate';
  window.calc = prefs.calc || false;
  window.custom = prefs.custom || 'id';
  try {
    if (prefs && prefs.regexp) {
      if (typeof prefs.regexp === 'string') {
        return collector.loop([new RegExp(prefs.regexp)]);
      }
      else {
        return collector.loop(prefs.regexp.map(r => new RegExp(r)));
      }
    }
  }
  catch (e) {
    console.error(e);
  }
  collector.loop();
});
