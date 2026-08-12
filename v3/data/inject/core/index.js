/* global InZIP */
'use strict';

const args = new URLSearchParams(location.search);
const ui = document.getElementById('ui');
const gallery = document.getElementById('gallery');
self.isFirefox = navigator.userAgent.includes('Firefox');

class ZIP {
  constructor() {
    this.indices = {};
  }
  async perform(request) {
    const zip = new InZIP();
    try {
      // Leading directory
      const parent = request.parent;
      await zip.open();

      // write README.txt
      if (request.readme) {
        const content = `Downloaded by "${chrome.runtime.getManifest().name}" extension

Page: ${args.get('href')}
Date: ${new Date().toLocaleString()}

Name, Link
----------
${request.images.map(e => e.filename + ', ' + e.src).join('\n')}
`;
        await zip.add([parent, 'README.txt'], new TextEncoder().encode(content));
      }

      await perform(request, async (filename, image) => {
        let content;
        try {
          content = await get(image);
        }
        catch (e) {
          content = await new Blob([image.src + '\n\nCannot download image; ' + e.message]).arrayBuffer();
          filename += '.txt';
        }
        const u = new Uint8Array(content);
        return zip.add([parent, filename], u);
      });

      const blob = await zip.blob();
      this.indices = {};

      const url = URL.createObjectURL(blob);
      await nd({
        url,
        filename: request.filename,
        conflictAction: 'uniquify',
        saveAs: request.saveAs
      });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    catch (e) {
      notify(e);
    }
    zip.delete();
  }
}

const runtime = {
  sendMessage(message, origin, options) {
    if (!origin) {
      throw Error('origin is required');
    }
    if (self.isFirefox) {
      return chrome.runtime.sendMessage(message);
    }
    if (origin === 'worker') {
      return chrome.runtime.sendMessage(message);
    }
    return chrome.tabs.sendMessage(runtime.tabId, message, options);
  }
};
runtime.tabId = Number(args.get('tabId'));

const notify = e => runtime.sendMessage({
  cmd: 'notify',
  message: e.message || e
}, 'worker');
self.toast = (msg, timeout = 750, type = 'info') => {
  document.getElementById('toast').notify(msg, type, timeout);
};

const button = self.button = {
  badge(text) {
    runtime.sendMessage({
      cmd: 'set-badge',
      text
    }, 'worker');
  }
};

const closing = (badge, remove = true) => {
  button.badge(badge === 'done' ? '✓' : '');
  runtime.sendMessage({
    cmd: 'stop-collector',
    remove
  }, 'page');

  if (remove) {
    runtime.sendMessage({
      cmd: 'remove-session-rules'
    }, 'worker');
  }
};

window.to = {
  gallery: () => {
    gallery.dataset.loading = true;
    document.body.dataset.mode = 'gallery';
    gallery.src = '/data/gallery/index.html' + location.search;
  },
  ui: () => {
    document.body.dataset.mode = 'ui';
    gallery.src = 'about:blank';
  }
};

/* native download */
const nd = async (options, filename = 'images.zip') => {
  if (chrome.downloads) {
    try {
      const id = await chrome.downloads.download(options);
      return id;
    }
    catch (e) {
      options.filename = filename;
      const id = await chrome.downloads.download(options);

      return id;
    }
  }
  else {
    const r = runtime.sendMessage({
      cmd: 'native-download',
      options,
      filename
    }, 'worker');
    if (r.error) {
      throw Error(r.error);
    }
    return r;
  }
};

/* get content from frame if failed get from extension's context */
const get = async (o, type = 'ab') => {
  let href = o.src;

  // skip datauri
  if (!href || href.startsWith('data:') === false) {
    href = await runtime.sendMessage({
      cmd: 'download-image',
      frameId: o.frameId,
      src: o.src,
      referer: o.page,
      capture: false,
      type: navigator.userAgent.includes('Firefox') ? 'datauri' : 'blob' // Firefox does not accept blob://
    }, 'page', {frameId: o.frameId});
    if (href.error) {
      throw Error(href.error);
    }
  }

  if (type === 'ab') {
    try {
      const r = await fetch(href);
      const o = await r.arrayBuffer();
      URL.revokeObjectURL(href);
      return o;
    }
    catch (e) {
      const r = await fetch(o.src);
      return r.arrayBuffer();
    }
  }
  else {
    return href || o.src;
  }
};

const progress = value => {
  ui.contentWindow.progress(value);
  try {
    gallery.contentWindow.progress(value);
  }
  catch (e) {}
};

const perform = async (request, one) => {
  const indices = {};

  const prefs = await chrome.storage.local.get({
    'download-delay': 100,
    'download-number': 5
  });

  for (let n = 0; n < request.images.length; n += prefs['download-number']) {
    button.badge((n / request.images.length * 100).toFixed(0) + '%');
    progress(request.images.length - n);

    await Promise.all([...new Array(prefs['download-number'])].map(async (d, i) => {
      const image = request.images[i + n];
      if (!image) {
        return;
      }
      // filename
      let filename = image.filename || Math.random().toString(36).substring(2, 15);
      indices[filename] = indices[filename] || 0;
      indices[filename] += 1;
      if (indices[filename] > 1) {
        if (/\.([^.]{1,6})$/.test(filename)) {
          filename = filename.replace(/\.([^.]{1,6})$/, (a, b) => ` (${indices[filename] - 1}).${b}`);
        }
        else {
          filename += ` (${indices[filename] - 1})`;
        }
      }
      await one(filename, image);
    }));

    await new Promise(resolve => setTimeout(resolve, prefs['download-delay']));
  }
  progress(0);
  button.badge('');
};

self.stopping = () => {
  button.badge('');
  runtime.sendMessage({
    cmd: 'stop-collector',
    remove: false,
    response: true
  }, 'worker');
};

self.save = async (request, remove = true) => {
  // Save Images
  if (request.cmd === 'save-images') {
    // save to directory
    if (request.directory) {
      try {
        const r = await runtime.sendMessage({
          cmd: 'create-directory',
          name: 'README.txt',
          readme: request.readme,
          content: `Downloaded by "${chrome.runtime.getManifest().name}" extension

Page: ${args.get('href')}
Date: ${new Date().toLocaleString()}

Name, Link
----------
${request.images.map(e => e.filename + ', ' + e.src).join('\n')}
    `
        }, 'page', {frameId: 0});
        if (r.error) {
          throw Error(r.error);
        }

        await perform(request, async (filename, image) => {
          const href = await get(image, false);
          runtime.sendMessage({
            cmd: 'image-to-directory',
            href,
            filename
          }, 'page', {frameId: 0});
        });
        closing('done', remove);
      }
      catch (e) {
        console.error(e);
        self.toast(e.message, 10000, 'error');
        ui.contentWindow.release();
      }
    }
    // save to IndexedDB
    else if (request.zip) {
      const z = new ZIP();
      await z.perform(request);
      closing('done', remove);
    }
    // save using download manager
    else {
      await perform(request, (filename, image) => {
        const path = request.filename.split('/');
        path.pop();
        path.push(image.filename);

        return nd({
          url: image.src,
          filename: path.join('/'),
          conflictAction: 'uniquify',
          saveAs: false
        });
      });
      closing('done', remove);
    }
  }
  else {
    console.error('unknown command');
  }
};

ui.addEventListener('load', () => {
  ui.dataset.loading = false;
  // Load gallery when UI is ready
  gallery.src = '/data/gallery/index.html' + location.search;
});
gallery.addEventListener('load', () => gallery.dataset.loading = false);

addEventListener('load', () => {
  button.badge('');
  document.body.dataset.loading = false;
  setTimeout(() => {
    ui.src = '/data/ui/index.html' + location.search;
  }, 100);
});
