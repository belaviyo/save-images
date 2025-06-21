/* Copyright (C) 2014-2023 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

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
  },
  size(r) {
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
  },
  type(img = {}, response) {
    if (response.type && response.type.startsWith('text/')) {
      return response.type;
    }

    // prefer type from URL, rather than type that is returned by server.
    // Some servers return "application/..." for image types
    return img.type || response.type || '';
  }
};

{
  /* get response of a src */
  const response = (o, timeout = 'default-timeout') => new Promise((resolve, reject) => {
    chrome.storage.local.get({
      [timeout]: 30 * 1000
    }, prefs => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), prefs[timeout]);

      fetch(o.src, {
        signal: controller.signal,
        headers: {
          'referer': o.page
        }
      }).then(r => {
        if (r.ok) {
          resolve({
            response: r,
            controller
          });
        }
        else {
          throw Error('STATUS_CODE_' + r.status);
        }
      }).catch(reject);
    });
  });
  response.text = o => response(o, 'dig-timeout')
    .then(({response}) => response.text())
    .catch(() => '');
  response.segment = o => response(o, 'head-timeout').then(async o => {
    const segment = (await o.response.body.getReader().read()).value;

    setTimeout(() => o.controller.abort());
    return {
      ok: true,
      type: o.response.headers.get('content-type') || '',
      size: self.utils.size(o.response),
      disposition: o.response.headers.get('content-disposition') || '',
      segment
    };
  });
  response.heads = o => response(o, 'head-timeout').then(o => {
    setTimeout(() => o.controller.abort());
    return {
      ok: true,
      type: o.response.headers.get('content-type') || '',
      size: self.utils.size(o.response),
      disposition: o.response.headers.get('content-disposition') || ''
    };
  }).catch(() => ({}));

  self.utils.response = response;
}

self.utils.EXTENSIONS = {
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
