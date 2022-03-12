/* Copyright (C) 2014-2022 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

self.utils = {
  /* OS compatible filename */
  rename(str) {
    return str
      .replace(/[`~!@#$%^&*()|+=?;:'",.<>{}[\]]/gi, '-')
      .replace(/[\\/]/gi, '_');
  },
  /* guess file-name */
  guess(img, mask, noType = true) {
    const indices = {};

    const {disposition, type, src, page, size} = img;

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
    // find name from page's URL when size > 500K.
    // some websites put the actual image name in the page's URL
    // we need to apply this file-naming only to the actual image
    if (!name && page) {
      for (const ext of ['jpeg', 'jpg', 'png', 'gif', 'bmp', 'webp']) {
        const i = page.toLowerCase().indexOf('.' + ext);
        if (i !== -1 && size > 500 * 1024) {
          name = page.slice(0, i).split('/').pop();
          break;
        }
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
    let extension = name.slice(index).slice(0, 10);
    if (extension.length == 0 && noType) {
      extension = '.jpg';
    }
    name = name.slice(0, index);
    if (name.startsWith('%')) {
      name = decodeURIComponent(name);
    }

    if (name in indices) {
      indices[name] += 1;
    }
    else {
      indices[name] = 1;
    }

    // apply masking
    let filename = (mask || '[name][extension]');
    filename = filename.split('[extension]').map(str => {
      str = str
        .replace(/\[name\]/gi, name + (indices[name] === 1 ? '' : '-' + indices[name]))
        .replace(/\[type\]/gi, type || '')
        .replace(/\[disposition\]/gi, disposition || '')
        .replace(/\[alt\]/gi, img.alt || '')
        .replace(/\[order\]/gi, '__ORDER__') // order is not yet resolved
        .replace(/\[index\]/gi, indices[name])
        .replace(/\[custom=[^\]]+\]/gi, img.custom);

      // make sure filename is acceptable
      str = self.utils.rename(str);
      // limit length of each section to 60 chars
      str = str.slice(0, 60);

      return str;
    }).join(extension);

    return {
      filename,
      name
    };
  }
};
