/* Copyright (C) 2014-2025 Joe Ertaba
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
  /* true when the URL embeds another URL in its path (image proxy) */
  proxied(src) {
    try {
      const name = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
      return /^https?:\/\//i.test(name);
    }
    catch (e) {
      return false;
    }
  },
  /* extract a readable file name from a (possibly proxied) URL */
  basename(src) {
    try {
      const url = new URL(src);
      let name = url.pathname.split('/').pop() || url.hostname;
      try {
        name = decodeURIComponent(name);
      }
      catch (e) {}
      // image proxies put the original URL in the path, e.g.
      // /plain/https%3A%2F%2Fhost%2Fpath%2Ffile.jpeg@webp
      if (/^https?:\/\//i.test(name)) {
        try {
          const inner = new URL(name);
          name = decodeURIComponent(inner.pathname.split('/').pop() || name);
        }
        catch (e) {}
      }
      return name || 'image';
    }
    catch (e) {
      return '';
    }
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
          try {
            name = decodeURIComponent(name.split('?')[0].split('&')[0]) || 'image';
          }
          catch (e) {}
        }
        else {
          name = self.utils.basename(url) || 'image';
        }
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
    extension = extension.split('#')[0]; // removes hashes
    // transform suffixes such as ".jpeg@webp" are not real extensions
    if (/^\.[a-z0-9]{1,5}$/i.test(extension) === false) {
      const transform = /@(webp|avif|jpeg|jpg|png|gif|heic|heif|bmp|tiff|ico|svg)$/i.exec(extension);
      if (transform) {
        // imgproxy-style "@webp" requests the output format
        extension = '.' + transform[1];
      }
      else if (type && type !== 'image/unknown') {
        extension = '.' + type.split('/').pop().split(/[+;]/).shift();
      }
      else {
        extension = noType ? '.jpg' : '';
      }
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
    const guess = img.type || '';
    const actual = response.type || '';

    // a non-image guess (e.g. "video/mp4" from "clip.mp4.0007.jpg") must not
    // override an image type that the server reports
    if (guess.startsWith('image/')) {
      return guess;
    }
    if (actual.startsWith('image/')) {
      return actual;
    }
    return guess || actual;
  },
  /* copy text to the clipboard (fallback to execCommand when the async Clipboard API is unavailable or rejects) */
  async copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      throw Error('Clipboard API is not available');
    }
    catch (e) {
      const active = document.activeElement;
      let ta;
      try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        if (typeof document.execCommand !== 'function' || document.execCommand('copy') === false) {
          throw e;
        }
      }
      finally {
        if (ta) {
          ta.remove();
        }
        if (active && active !== document.body && typeof active.focus === 'function') {
          try {
            active.focus();
          }
          catch (err) {}
        }
      }
    }
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

      const props = {
        signal: controller.signal,
        headers: {
          'referer': o.page || location.href
        }
      };
      const attempt = credentials => fetch(o.src, credentials ? Object.assign({}, props, {
        credentials
      }) : props).then(r => {
        if (r.ok) {
          return {
            response: r,
            controller
          };
        }
        throw Error('STATUS_CODE_' + r.status);
      });
      // content scripts are subject to CORS; the per-request DNR rule adds
      // the CORS response headers, and the retry includes credentials
      attempt().catch(() => attempt('include')).then(resolve, reject);
    });
  });
  response.text = o => response(o, 'dig-timeout')
    .then(({response}) => response.text())
    .catch(() => '');
  response.segment = o => response(o, 'head-timeout').then(async o => {
    const reader = o.response.body.getReader();
    let segment = new Uint8Array(0);

    // the image parsers need up to 40 bytes (the extended WebP header needs 30);
    // some servers deliver the body in smaller chunks, so keep reading
    while (segment.byteLength < 64) {
      const {value, done} = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const merged = new Uint8Array(segment.byteLength + value.byteLength);
        merged.set(segment);
        merged.set(value, segment.byteLength);
        segment = merged;
      }
    }
    // release the rest of the body; the response is aborted below anyway
    reader.cancel().catch(() => {});

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

{
  // a known extension only counts when it ends at a URL boundary; "clip.mp4.0007.jpg"
  // must resolve to "jpg", not "mp4". The rightmost match wins.
  const re = new RegExp('\\.(' + Object.keys(self.utils.EXTENSIONS).join('|') + ')(?=[/?#&@]|$)', 'gi');

  self.utils.extension = src => {
    if (src.startsWith('data:')) {
      const mediatype = src.slice(5, src.indexOf(',')).split(';')[0].toLowerCase();

      return mediatype.startsWith('image/') ? mediatype : '';
    }

    // the file name lives in the path; only fall back to the query/hash when the
    // path does not name a known type (e.g. "/image.php?file=photo.jpg")
    const end = src.search(/[?#]/);
    re.lastIndex = 0;
    let type = '';
    let path = '';
    let m;

    while ((m = re.exec(src)) !== null) {
      const found = self.utils.EXTENSIONS[m[1].toLowerCase()] || '';
      if (found) {
        type = found;
        if (end === -1 || m.index < end) {
          path = found;
        }
      }
    }

    return path || type;
  };
}

// eslint-disable-next-line semi
''
