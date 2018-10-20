'use strict';

if (typeof deep === 'undefined') {
  window.deep = 0;
}
if (typeof timeout === 'undefined') {
  window.timeout = 10000;
}

var collector = {
  links: {},
  active: true,
  size: src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight
    });
    image.onerror = () => resolve({
      width: 0,
      height: 0
    });
    image.src = src;
  }),
  inspect: img => new Promise((resolve, reject) => {
    const next = type => {
      // fix the type when possible
      if (img.src.indexOf('.png?') !== -1 || img.src.endsWith('.png')) {
        type = 'image/png';
      }
      else if (
        img.src.indexOf('.jpg?') !== -1 ||
        img.src.indexOf('.jpeg?') !== -1 ||
        img.src.endsWith('.jpg') ||
        img.src.endsWith('.jpeg')
      ) {
        type = 'image/jpeg';
      }
      else if (img.src.indexOf('.bmp?') !== -1 || img.src.endsWith('.bmp')) {
        type = 'image/bmp';
      }
      else if (img.src.indexOf('.gif?') !== -1 || img.src.endsWith('.gif')) {
        type = 'image/gif';
      }
      // forced the image file type for verified images
      if (!type && img.verified) {
        type = 'image/unknown';
      }
      if (type.startsWith('image/')) {
        let size;
        if (img.src.startsWith('http')) {
          size = Number(req.getResponseHeader('content-length')) || 0;
        }
        else {
          size = img.src.length;
        }
        Object.assign(img, {
          size,
          type,
          disposition: req.getResponseHeader('content-disposition') || ''
        });
        if (img.src.startsWith('http')) {
          resolve(img);
        }
        // get image width and height for data-url images
        else {
          collector.size(img.src).then(obj => resolve(Object.assign(img, obj)));
        }
      }
      else {
        reject(type);
      }
    };
    const req = new XMLHttpRequest();
    req.open('HEAD', img.src);
    req.timeout = window.timeout;
    req.ontimeout = req.onerror = req.onload = () => {
      const type = req.getResponseHeader('content-type') || '';
      next(type);
    };
    req.send();
  }),
  loop: async() => {
    // get info for single link
    const analyze = img => {
      return collector.inspect(img).then(img => [img]).catch(type => {
        if (type && type.startsWith('text/html') && window.deep === 2) {
          return new Promise(resolve => {
            const req = new XMLHttpRequest();
            req.open('GET', img.src);
            req.responseType = 'document';
            req.timeout = window.timeout;
            req.onload = async() => {
              const images = [...req.response.images]
                .filter(img => collector.links[img.src] !== true)
                .map(img => ({
                  width: img.width,
                  height: img.height,
                  src: img.src,
                  verified: true
                }));
              // store
              images.forEach(img => collector.links[img.src] = true);
              //
              let tmp = [];
              for (let i = 0; collector.active && i < images.length; i += 5) {
                const slice = images.slice(i, i + 5);
                await Promise.all(slice.map(analyze)).then(images => tmp.push(...images));
              }
              resolve(collector.active ? [].concat([], ...tmp) : []);
            };
            req.ontimeout = req.onerror = () => resolve([]);
            req.send();
          });
        }
        else {
          return [];
        }
      });
    };
    // find images; part 1
    let images = [...document.images].map(img => ({
      width: img.width,
      height: img.height,
      src: img.src,
      verified: true // this is an image even if content-type cannot be resolved
    })).filter(img => img.src);
    // find background images; part 2
    const r = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\\/%?=~_|!:,.;]*[-A-Z0-9+&@#\\/%=~_|])/gi;
    try {
      [...document.querySelectorAll('*')]
        .map(e => window.getComputedStyle(e).backgroundImage)
        .map(i => {
          const e = /url\(['"]([^)]+)["']\)/.exec(i);
          return e && e.length ? e[1] : null;
        }).filter((s, i, l) => s && l.indexOf(s) === i).forEach(src => {
          if (src.startsWith('//')) {
            src = document.location.protocol + src;
          }
          else if (src.startsWith('/')) {
            document.location.origin + src;
          }
          images.push({src});
        });
    }
    catch (e) {}
    // find linked images; part 3
    if (window.deep > 0) {
      [...document.querySelectorAll('a')].map(a => a.href)
        .filter(s => s && (s.startsWith('http') || s.startsWith('ftp') || s.startsWith('data:')))
        .forEach(src => images.push({src}));
    }
    // find hard-coded links; part 4
    if (window.deep > 0) {
      // decode html special characters; &amp;
      (document.documentElement.innerHTML.match(r) || [])
        .map(s => s.replace(/&amp;/g, '&'))
        .forEach(src => images.push({src}));
    }

    // filter duplicates
    images = images.filter((s, i, l) => l.indexOf(s) === i);
    // store
    images.forEach(key => collector.links[key] = true);
    // notify the total number of links to be parsed
    chrome.runtime.sendMessage({
      cmd: 'links',
      length: images.length
    });
    // loop
    for (let i = 0; collector.active && i < images.length; i += 5) {
      const slice = images.slice(i, i + 5);
      await Promise.all(
        slice.map(analyze)).then(images => collector.active && images.length && chrome.runtime.sendMessage({
          cmd: 'images',
          images: [].concat([], ...images),
          index: slice.length
        })
      ).catch(e => console.log(e));
    }
  }
};
collector.loop();
