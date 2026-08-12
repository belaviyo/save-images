const notify = message => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message,
  iconUrl: '/data/icons/48.png'
}, id => setTimeout(chrome.notifications.clear, 3000, id)));

chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      injectImmediately: true,
      func: tabId => window.tabId = tabId,
      args: [tab.id]
    });
    await chrome.scripting.insertCSS({
      target: {tabId: tab.id},
      files: ['/data/inject/inject.css']
    });
    const r = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      injectImmediately: true,
      files: ['/data/inject/inject.js']
    });

    if (r && r[0].result === false) {
      throw Error('Cannot attach panel to the document. Is this an HTML page?');
    }
  }
  catch (e) {
    console.warn(e);
    notify('Cannot collect images on this tab\n\n' + e.message);
  }
});

chrome.tabs.onRemoved.addListener(tabId => chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [tabId]
}).catch(() => {}));

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'notify') {
    notify(request.message);
  }
  else if (request.cmd === 'apply-referer') {
    try {
      const id = Math.floor(Math.random() * 1000000);
      const rule = {
        'id': id,
        'priority': 2,
        'action': {
          type: 'modifyHeaders',
          requestHeaders: [{
            'operation': 'set',
            'header': 'referer',
            'value': request.referer
          }, {
            'operation': 'remove',
            'header': 'origin'
          }]
        },
        'condition': {
          'urlFilter': request.src,
          'resourceTypes': ['xmlhttprequest', 'image'],
          'tabIds': [sender.tab.id]
        }
      };
      if (request.credentials === 'include') {
        let o = request.referer;
        try {
          o = (new URL(request.referer)).origin;
        }
        catch (e) {}

        rule.action.responseHeaders = [{
          'operation': 'set',
          'header': 'access-control-allow-origin',
          'value': o
        }, {
          'operation': 'set',
          'header': 'Access-Control-Allow-Credentials',
          'value': 'true'
        }];
      }

      chrome.declarativeNetRequest.updateSessionRules({
        addRules: [rule]
      }).then(() => response(id), () => response(-1));

      return true;
    }
    catch (e) {
      response(-1);
    }
  }
  else if (request.cmd === 'revoke-referer') {
    if (request.id === -1) {
      response();
    }
    else {
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [request.id]
      }).then(() => response(), () => response());

      return true;
    }
  }
  else if (request.cmd === 'set-badge') {
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: request.text
    });
  }
  else if (request.cmd === 'install-collector') {
    /* collect images */
    (async () => {
      // install collector on all frames
      try {
        const target = {
          tabId: sender.tab.id,
          allFrames: request.allFrames
        };
        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          files: ['/data/fetch.js']
        });
        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          files: ['/data/utils.js']
        });
        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          files: ['/data/collector.js']
        });

        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          files: ['/data/size.js']
        });
        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          func: (deep, accuracy, regexp, custom, cframe, sframe) => {
            // do not crawl cross-origin frames
            if (cframe && parent !== window) {
              try {
                parent.location.href;
              }
              catch (e) {
                return;
              }
            }
            if (sframe && parent !== window) {
              try {
                parent.location.href;
                return;
              }
              catch (e) {}
            }

            self.deep = deep;
            self.accuracy = accuracy || 'partial-accurate';
            self.custom = custom || 'id';

            try {
              if (regexp && typeof regexp === 'string') {
                window.regexp = [new RegExp(regexp)];
              }
              if (regexp && Array.isArray(regexp)) {
                window.regexp = regexp.map(r => new RegExp(r));
              }
            }
            catch (e) {
              console.warn('cannot use the provided JSON rules', e);
            }

            self.collector.loop();
          },
          args: request.args
        });

        response(true);
      }
      catch (e) {
        console.warn(e);
        response({error: e.message});
      }
    })();
    return true;
  }
  else if (request.cmd === 'file-picker-available') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id
      },
      injectImmediately: true,
      func: () => 'showDirectoryPicker' in window
    }).then(a => response(a[0].result));
    return true;
  }
  else if (request.cmd === 'remove-session-rules') {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [sender.tab.id]
    }).catch(() => {});
  }
  else if (request.cmd === 'update-session-rules') {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [sender.tab.id],
      addRules: [{
        'id': sender.tab.id,
        'priority': 1,
        'action': {
          type: 'modifyHeaders',
          responseHeaders: [{
            'operation': 'set',
            'header': 'access-control-allow-origin',
            'value': '*'
          }, {
            'operation': 'remove',
            'header': 'referrer-policy'
          }]
        },
        'condition': {
          'resourceTypes': ['xmlhttprequest', 'image'],
          'tabIds': [sender.tab.id]
        }
      }]
    }).then(() => response(true)).catch(e => response({
      error: e.message
    }));
  }
  else if (request.cmd === 'native-download') {
    chrome.downloads.download(request.options).catch(e => {
      request.options.filename = request.filename;
      return chrome.downloads.download(request.options);
    }).then(id => response(id)).catch(e => response({
      error: e.message
    }));

    return true;
  }
  /* send to page */
  else if ([
    'progress', 'images', 'links', 'new-frame', 'alternative-image-may-work', 'stop-collector', 'state'
  ].includes(request.cmd)) {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  /* send to core */
  else if (['create-directory', 'image-to-directory'].includes(request.cmd)) {
    chrome.tabs.sendMessage(sender.tab.id, request, {
      frameId: 0
    }).then(response);

    return true;
  }
  /* send to frame */
  else if (['download-image'].includes(request.cmd)) {
    chrome.tabs.sendMessage(sender.tab.id, request, {
      frameId: request.frameId
    }).then(response);

    return true;
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
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
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
