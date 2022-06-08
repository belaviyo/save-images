/* global InZIP, post */
'use strict';

const args = new URLSearchParams(location.search);
const tabId = Number(args.get('tabId'));

Object.assign(document.querySelector('body > div').style, {
  width: (args.get('width') || 750) + 'px',
  height: (args.get('height') || 650) + 'px'
});

const notify = e => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message: e.message || e,
  iconUrl: '/data/icons/48.png'
}));

const ui = document.getElementById('ui');
const gallery = document.getElementById('gallery');

ui.addEventListener('load', () => ui.dataset.loading = false);
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

/* download */
const nd = (options, filename = 'images.zip') => new Promise(resolve => chrome.downloads.download(options, id => {
  if (chrome.runtime.lastError) {
    options.filename = filename;
    chrome.downloads.download(options, resolve);
  }
  else {
    resolve(id);
  }
}));

const get = o => {
  if (o.meta.fetch === 'bg') {
    return fetch(o.src).then(r => r.arrayBuffer());
  }
  else {
    const id = Math.random();
    const target = {
      tabId,
      frameIds: [o.frameId]
    };
    return new Promise((resolve, reject) => {
      get.cache[id] = {resolve, reject};
      setTimeout(() => reject(Error('timeout')), 10000);
      chrome.scripting.executeScript({
        target,
        func: (href, id, bg) => {
          fetch(href).then(r => r.blob()).then(b => {
            const href = URL.createObjectURL(b);
            post({
              cmd: 'fetched-on-frame',
              href,
              id
            }, '*');
          }).catch(e => post({
            cmd: 'fetched-on-frame',
            id,
            error: e.message,
            bg,
            href
          }, '*'));
        },
        // if o.meta.fetch !== 'me' and o.meta.fetch !== 'bg' -> try to get from "bg" if "me" failed
        args: [o.src, id, o.meta.fetch !== 'me']
      });
    }).then(href => {
      return fetch(href).then(r => r.arrayBuffer()).then(b => {
        chrome.scripting.executeScript({
          target,
          func: href => URL.revokeObjectURL(href),
          args: [href]
        });

        return b;
      });
    });
  }
};
get.cache = {};

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
      let filename = image.filename;
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
    chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: true
      },
      func: remove => {
        try {
          window.collector.active = false;
          if (remove) {
            window.myframe.remove();
            window.myframe = null;
          }
        }
        catch (e) {}
      },
      args: [request.cmd === 'close-me']
    });
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
  else if (request.cmd === 'progress' || request.cmd === 'close-me') {
    ui.contentWindow.commands(request);
    try {
      gallery.contentWindow.commands(request);
    }
    catch (e) {}
  }
  else if (request.cmd === 'images' || request.cmd === 'links') {
    ui.contentWindow.commands(request);
  }
  // save to directory (1/2)
  else if (request.cmd === 'save-images' && request.directory) {
    console.log(request.images);

    chrome.scripting.executeScript({
      target: {tabId},
      func: async request => {
        try {
          const d = window.directory = await window.showDirectoryPicker();
          // fake; make sure we have write access
          await d.getFileHandle('README.txt', {
            create: true
          }).then(file => file.createWritable()).then(writable => {
            const blob = new Blob([`Downloaded by "${chrome.runtime.getManifest().name}" extension

Page: ${location.href}
Date: ${new Date().toLocaleString()}

Name, Link
----------
${request.images.map(e => e.filename + ', ' + e.src).join('\n')}
`], {
              type: 'text/plain'
            });
            const response = new Response(blob);
            return response.body.pipeTo(writable);
          });

          request.cmd = 'directory-ready';
          post(request, '*');
        }
        catch (e) {
          alert(e.message);
        }
      },
      args: [request]
    });
  }
  // save to directory (2/2)
  else if (request.cmd === 'directory-ready') {
    perform(request, async (filename, image) => {
      let href = image.src;
      if (image.meta.fetch === 'bg') {
        href = await fetch(href).then(r => r.blob()).then(b => URL.createObjectURL(b));
      }
      await chrome.scripting.executeScript({
        target: {tabId},
        func: (filename, href) => {
          Promise.all([
            fetch(href),
            window.directory.getFileHandle(filename, {
              create: true
            }).then(file => file.createWritable())
          ]).then(([response, writable]) => {
            writable.truncate(0).then(() => response.body.pipeTo(writable)).finally(() => URL.revokeObjectURL(href));
          }).catch(e => console.warn(e));
        },
        args: [filename, href]
      });
    }).then(() => window.commands({
      cmd: 'close-me',
      badge: 'done'
    }));
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
  // internal get response
  else if (request.cmd === 'fetched-on-frame') {
    const {resolve, reject} = get.cache[request.id];
    if (request.error && request.bg === false) {
      reject(Error(request.error));
    }
    else {
      resolve(request.href);
    }
    delete get.cache[request.id];
  }
};
// top-frame requests
window.addEventListener('message', e => window.commands(e.data));
// frame requests
chrome.runtime.onMessage.addListener(request => {
  if (request.cmd === 'message') {
    window.commands(request.request);
  }
});

document.addEventListener('click', () => window.commands({
  cmd: 'close-me'
}));

