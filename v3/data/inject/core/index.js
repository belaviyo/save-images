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
      const id = await nd({
        url,
        filename: request.filename,
        conflictAction: 'uniquify',
        saveAs: request.saveAs
      });

      // the caller keeps the blob URL alive until the download is over
      return {id, url, size: blob.size};
    }
    catch (e) {
      diagnostics.add({
        mode: 'zip',
        error: e.message || String(e)
      });
      notify(e);
      return null;
    }
    finally {
      try {
        zip.delete();
      }
      catch (e) {}
    }
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

/* save diagnostics; only recorded when "debug-save" is enabled in the options page */
let report = null;
const diagnostics = {
  start: request => {
    report = {
      version: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      date: new Date().toISOString(),
      mode: request.directory ? 'directory' : (request.zip ? 'zip' : 'separate'),
      images: request.images.length,
      filenames: request.images.map(o => o.filename),
      frameIds: request.images.map(o => o.frameId),
      downloads: []
    };
  },
  add: entry => {
    if (report) {
      report.downloads.push(entry);
    }
  },
  save: () => new Promise(resolve => {
    if (report === null) {
      return resolve();
    }
    try {
      console.info('[save-images] last save', report);
      chrome.storage.local.set({'save-diagnostics': report}, resolve);
    }
    catch (e) {
      resolve();
    }
  })
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
    const r = await runtime.sendMessage({
      cmd: 'native-download',
      options,
      filename
    }, 'worker');
    if (r && r.error) {
      throw Error(r.error);
    }
    return r;
  }
};

/* search a download item; the callback form works on both Chrome and Firefox */
const search = id => new Promise(resolve => {
  try {
    chrome.downloads.search({id}, items => resolve(items && items[0]));
  }
  catch (e) {
    resolve();
  }
});

/* wait for a download to reach a terminal state (complete or interrupted) */
const waitOne = id => new Promise(resolve => {
  let done = false;
  let interval;
  let timeout;

  const finish = item => {
    if (done) {
      return;
    }
    done = true;
    clearInterval(interval);
    clearTimeout(timeout);
    if (chrome.downloads && chrome.downloads.onChanged) {
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      }
      catch (e) {}
    }
    resolve(item || {id, state: 'unknown'});
  };

  const poll = () => search(id).then(item => {
    if (!item || item.state !== 'in_progress') {
      finish(item);
    }
  });

  const onChanged = delta => {
    if (delta.id === id && delta.state && delta.state.current !== 'in_progress') {
      poll();
    }
  };

  interval = setInterval(poll, 1000);
  // safety net for downloads that never report a terminal state
  timeout = setTimeout(() => finish(), 10 * 60 * 1000);

  if (chrome.downloads && chrome.downloads.onChanged) {
    try {
      chrome.downloads.onChanged.addListener(onChanged);
    }
    catch (e) {}
  }
  poll();
});

/* downloads are created by the worker when the downloads API is not available in this frame */
const waitForDownloads = async ids => {
  ids = (ids || []).filter(id => typeof id === 'number' && isNaN(id) === false);
  if (ids.length === 0) {
    return [];
  }
  if (chrome.downloads && chrome.downloads.onChanged) {
    return Promise.all(ids.map(waitOne));
  }
  try {
    const r = await runtime.sendMessage({
      cmd: 'wait-downloads',
      ids
    }, 'worker');
    return (r && r.results) || [];
  }
  catch (e) {
    return [];
  }
};

/* get content from frame if failed get from extension's context */
const get = async (o, type = 'ab') => {
  let href = o.src;

  // skip datauri
  if (!href || href.startsWith('data:') === false) {
    const options = typeof o.frameId === 'number' ? {frameId: o.frameId} : undefined;
    href = await runtime.sendMessage({
      cmd: 'download-image',
      frameId: o.frameId,
      src: o.src,
      referer: o.page,
      capture: false,
      type: navigator.userAgent.includes('Firefox') ? 'datauri' : 'blob' // Firefox does not accept blob://
    }, 'page', options);
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
  const results = [];

  const prefs = await chrome.storage.local.get({
    'download-delay': 100,
    'download-number': 5
  });

  for (let n = 0; n < request.images.length; n += prefs['download-number']) {
    button.badge((n / request.images.length * 100).toFixed(0) + '%');
    progress(request.images.length - n);

    const settled = await Promise.allSettled([...new Array(prefs['download-number'])].map(async (d, i) => {
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
      try {
        return await one(filename, image);
      }
      catch (e) {
        const error = e instanceof Error ? e : Error(e && e.message ? e.message : String(e));
        error.filename = error.filename || filename;
        throw error;
      }
    }));

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value !== undefined) {
          results.push(r.value);
        }
      }
      // one broken image must not cancel the remaining downloads
      else {
        console.warn('Download failed', r.reason);
        diagnostics.add({
          filename: r.reason && r.reason.filename,
          error: r.reason && (r.reason.message || String(r.reason))
        });
      }
    }

    await new Promise(resolve => setTimeout(resolve, prefs['download-delay']));
  }
  progress(0);
  button.badge('');

  return results;
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
  if (request.cmd !== 'save-images') {
    console.error('unknown command');
    return;
  }

  let debug = false;
  report = null;
  try {
    const prefs = await chrome.storage.local.get({
      'debug-save': false
    });
    debug = prefs['debug-save'] === true;
  }
  catch (e) {}
  if (debug) {
    try {
      diagnostics.start(request);
    }
    catch (e) {}
  }

  try {
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
      const r = await z.perform(request);
      if (r) {
        // keep the panel and the blob URL alive until the archive is written
        const items = await waitForDownloads([r.id]);
        if (debug) {
          items.forEach(item => diagnostics.add(Object.assign({
            size: r.size
          }, item)));
        }
        URL.revokeObjectURL(r.url);
      }
      closing('done', remove);
    }
    // save using download manager
    else {
      const downloads = (await perform(request, async (filename, image) => {
        const path = request.filename.split('/');
        path.pop();
        path.push(filename);

        const id = await nd({
          url: image.src,
          filename: path.join('/'),
          conflictAction: 'uniquify',
          saveAs: false
        }, filename);

        return {id, filename};
      })).filter(o => o && typeof o.id === 'number');

      const items = await waitForDownloads(downloads.map(o => o.id));
      if (debug) {
        items.forEach((item, i) => diagnostics.add(Object.assign({
          filename: downloads[i] && downloads[i].filename
        }, item)));
      }
      closing('done', remove);
    }
  }
  finally {
    if (debug) {
      await diagnostics.save();
    }
  }
};

// handle save-images forwarded from detached gallery tab
chrome.runtime.onMessage.addListener((request, sender, response) => {
  // only handle 'save-images' delivered via tabs.sendMessage (direct from detached gallery
  // or forwarded by worker from 'gallery-save'). Ignore 'gallery-save' runtime messages here
  // to avoid double-saving when both worker and core receive the runtime message.
  if (request.cmd !== 'save-images') {
    return;
  }
  const payload = request;
  // only accept if targeting this host tab
  if (request.tabId && request.tabId !== runtime.tabId) {
    return;
  }
  // prevent random page scripts from triggering saves:
  // tabs.sendMessage from extension pages has sender.url starting with extension scheme,
  // while page origin would have http(s) url; accept extension-originated or worker-proxied messages.
  const senderUrl = sender.url || (sender.tab && sender.tab.url) || '';
  // If sender has no url property (worker proxy), accept.
  // If senderUrl exists and is not extension scheme, ignore to avoid abuse from web pages.
  if (senderUrl && !/^(moz-extension|chrome-extension):/.test(senderUrl)) {
    return;
  }
  self.stopping();
  self.save(payload).then(() => {
    try {
      if (response) {
        response(true);
      }
    }
    catch (e) {}
  }).catch(e => {
    try {
      if (response) {
        response({error: e.message});
      }
    }
    catch (err) {}
  });
  return true;
});

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
