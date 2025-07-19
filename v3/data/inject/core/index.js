/* global InZIP */
'use strict';

const args = new URLSearchParams(location.search);
const tabId = Number(args.get('tabId'));

const notify = e => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message: e.message || e,
  iconUrl: '/data/icons/48.png'
}, id => setTimeout(chrome.notifications.clear, 3000, id)));
self.toast = (msg, timeout = 750, type = 'info') => {
  document.getElementById('toast').notify(msg, type, timeout);
};

const ui = document.getElementById('ui');
const gallery = document.getElementById('gallery');

ui.addEventListener('load', () => {
  ui.dataset.loading = false;
  // Load gallery when UI is ready
  gallery.src = '/data/gallery/index.html' + location.search;
});
gallery.addEventListener('load', () => gallery.dataset.loading = false);

window.addEventListener('load', () => {
  chrome.action.setBadgeText({
    tabId,
    text: ''
  });
  document.body.dataset.loading = false;
  setTimeout(() => {
    ui.src = '/data/ui/index.html' + location.search;
  }, 100);
});

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
const nd = (options, filename = 'images.zip') => new Promise(resolve => chrome.downloads.download(options, id => {
  if (chrome.runtime.lastError) {
    options.filename = filename;
    chrome.downloads.download(options, resolve);
  }
  else {
    resolve(id);
  }
}));

/* get content from frame if failed get from extension's context */
const get = (o, type = 'ab') => new Promise((resolve, reject) => {
  const port = communication.ports[o.frameId];
  const uid = Math.random();
  communication[uid] = async res => {
    if (res.error) {
      reject(Error(res.error));
    }
    else if (type === 'ab') {
      try {
        try {
          const r = await fetch(res.href);
          resolve(await r.arrayBuffer());
        }
        catch (e) {
          const r = await fetch(o.src);
          resolve(await r.arrayBuffer());
        }
      }
      catch (e) {
        reject(e);
      }
      if (res.href) {
        URL.revokeObjectURL(res.href);
      }
    }
    else {
      resolve(res.href || o.src);
    }
  };
  port.postMessage({
    cmd: 'download-image',
    src: o.src,
    referer: o.page,
    capture: false,
    uid
  });
});

const perform = async (request, one) => {
  const indices = {};

  const prefs = await new Promise(resolve => chrome.storage.local.get({
    'download-delay': 100,
    'download-number': 5
  }, resolve));

  for (let n = 0; n < request.images.length; n += prefs['download-number']) {
    chrome.action.setBadgeText({
      tabId,
      text: (n / request.images.length * 100).toFixed(0) + '%'
    });
    window.commands({
      cmd: 'progress',
      value: request.images.length - n
    });

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
  window.commands({
    cmd: 'progress',
    value: 0
  });
  chrome.action.setBadgeText({
    tabId,
    text: ''
  });
};

class ZIP {
  constructor() {
    this.indices = {};
  }
  async perform(request) {
    try {
      const zip = new InZIP();
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
        await zip.add('README.txt', new TextEncoder().encode(content));
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
        return zip.add(filename, u);
      });

      await zip.blob().then(blob => {
        this.indices = {};

        const url = URL.createObjectURL(blob);
        nd({
          url,
          filename: request.filename,
          conflictAction: 'uniquify',
          saveAs: request.saveAs
        }).then(() => {
          window.commands({
            cmd: 'close-me',
            badge: 'done'
          });
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
      }).finally(() => zip.delete());
    }
    catch (e) {
      notify(e);
    }
  }
}

/* in-app communication */
window.commands = request => {
  if (request.cmd === 'stop' || request.cmd === 'close-me' || request.cmd === 'reload-me') {
    chrome.action.setBadgeText({
      tabId,
      text: request.badge === 'done' ? '✓' : ''
    });
    for (const port of Object.values(communication.ports)) {
      port.postMessage({
        cmd: 'stop-collector',
        remove: request.cmd === 'close-me'
      });
    }
    //
    if (request.cmd === 'close-me') {
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tabId]
      }).catch(() => {});
    }
  }

  /**/
  if (request.cmd === 'reload-me') {
    location.reload();
  }
  else if (request.cmd === 'new-frame') {
    ui.contentWindow.commands(request);
  }
  else if (request.cmd === 'progress' || request.cmd === 'close-me' || request.cmd === 'release') {
    ui.contentWindow.commands(request);
    try {
      gallery.contentWindow.commands(request);
    }
    catch (e) {}
  }
  else if (request.cmd === 'images' || request.cmd === 'links') {
    ui.contentWindow.commands(request);
  }
  // save to directory
  else if (request.cmd === 'save-images' && request.directory) {
    const uid = Math.random();
    communication[uid] = o => {
      if (o.error) {
        self.toast(o.error, 2000, 'error');
        window.commands({
          cmd: 'release'
        });
      }
      else {
        return perform(request, async (filename, image) => {
          const href = await get(image, false);

          communication.ports[0].postMessage({
            cmd: 'image-to-directory',
            href,
            filename
          });
        }).then(() => window.commands({
          cmd: 'close-me',
          badge: 'done'
        }));
      }
    };
    communication.ports[0].postMessage({
      uid,
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
    });
  }
  // save to IndexedDB
  else if (request.cmd === 'save-images' && request.zip) {
    const z = new ZIP();
    z.perform(request).then(() => window.commands({
      cmd: 'close-me',
      badge: 'done'
    }));
  }
  // save using download manager
  else if (request.cmd === 'save-images') {
    perform(request, (filename, image) => {
      const path = request.filename.split('/');
      path.pop();
      path.push(image.filename);

      return nd({
        url: image.src,
        filename: path.join('/'),
        conflictAction: 'uniquify',
        saveAs: false
      });
    }).then(() => window.commands({
      cmd: 'close-me',
      badge: 'done'
    }));
  }
  else if (request.cmd === 'alternative-image-may-work') {
    ui.contentWindow.commands(request);
  }
};

const communication = (request, frameId) => {
  // we need to use the same frame to fetch the content later
  if (request.cmd === 'images') {
    request.images.forEach(i => i.frameId = frameId);
  }

  window.commands(request, frameId);
};
communication.ports = {};
chrome.runtime.onConnect.addListener(port => {
  if (port.sender.tab.id === tabId) {
    communication.ports[port.sender.frameId] = port;
    port.onMessage.addListener(request => {
      if (request.uid) {
        communication[request.uid](request);
        delete communication[request.uid];
      }
      else {
        communication(request, port.sender.frameId);
      }
    });
  }
});
