const notify = message => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message,
  iconUrl: '/data/icons/48.png'
}));

chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: tabId => window.tabId = tabId,
      args: [tab.id]
    });
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      files: ['data/inject/inject.js']
    });
  }
  catch (e) {
    console.warn(e);
    notify('Cannot collect images on this tab\n\n' + e.message);
  }
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'who-am-i') {
    response({
      href: sender.tab.url,
      name: sender.tab.title,
      tabId: sender.tab.id
    });
  }
  else if (request.cmd === 'frame-id') {
    response(sender.frameId);
  }
  else if (request.cmd === 'close-me') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'images') {
    // we need to use the same frame to fetch the content later
    for (const image of request.images) {
      image.frameId = sender.frameId;
    }
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'read-headers') {
    chrome.storage.local.get({
      'head-timeout': 30 * 1000
    }, prefs => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), prefs['head-timeout']);

      fetch(request.href, {
        signal: controller.signal
      }).then(r => {
        if (r.ok) {
          response({
            type: r.headers.get('content-type') || '',
            size: Number(r.headers.get('content-length')),
            disposition: r.headers.get('content-disposition') || ''
          });
          controller.abort();
        }
        else {
          response({});
        }
      }).catch(() => response({}));
    });


    return true;
  }
  else if (request.cmd === 'get-content') {
    chrome.storage.local.get({
      'dig-timeout': 30 * 1000
    }, prefs => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), prefs['dig-timeout']);

      fetch(request.href, {
        signal: controller.signal
      }).then(r => {
        if (r.ok) {
          return r.text().then(response);
        }
        throw Error('no');
      }).catch(() => response(''));
    });

    return true;
  }
  else if (request.cmd === 'fetch-segment') {
    chrome.storage.local.get({
      'head-timeout': 30 * 1000
    }, prefs => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), prefs['head-timeout']);

      fetch(request.href, {
        signal: controller.signal
      }).then(r => {
        if (r.ok) {
          const reader = r.body.getReader();
          reader.read().then(({value}) => {
            response({
              ok: true,
              type: r.headers.get('content-type') || '',
              size: Number(r.headers.get('content-length')),
              disposition: r.headers.get('content-disposition') || '',
              segment: [...value]
            });
            controller.abort();
          });
        }
        else {
          throw Error('no');
        }
      }).catch(e => response({
        ok: false,
        message: e.message
      }));
    });

    return true;
  }
  //
  if (request.cmd === 'stop' || request.cmd === 'close-me' || request.cmd === 'reload-me') {
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: ''
    });
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id,
        allFrames: true
      },
      func: () => {
        try {
          window.collector.active = false;
        }
        catch (e) {}
      }
    });
  }
});

/* delete all indexedDBs*/
{
  const once = async () => {
    for (const db of await indexedDB.databases()) {
      indexedDB.deleteDatabase(db.name);
      console.warn('delete a deprecated DB', db.name);
    }
  };
  chrome.runtime.onStartup.addListener(once);
  chrome.runtime.onInstalled.addListener(once);
}

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
