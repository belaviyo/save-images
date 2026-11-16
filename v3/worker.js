const notify = message => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message,
  iconUrl: '/data/icons/48.png'
}, id => setTimeout(chrome.notifications.clear, 3000, id)));

/* remove the session rules scoped to a tab. The global CORS rule uses the tab
   id, while "apply-referer" rules live in a higher id range; unless "all" is
   true, only the global rule is dropped so in-flight image requests keep
   their CORS headers (e.g. when the profile changes during a search) */
const clearTabRules = async (tabId, all = true) => {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ids = rules.filter(rule => {
      const tabIds = rule.condition && rule.condition.tabIds;
      if (Array.isArray(tabIds) === false || tabIds.includes(tabId) === false) {
        return false;
      }
      return all || rule.id === tabId;
    }).map(rule => rule.id);

    if (ids.length) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: ids
      });
    }
  }
  catch (e) {
    // fallback for browsers that do not expose the session-rule list
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tabId]
      });
    }
    catch (err) {}
  }
};

/* guards an in-flight "update" from re-adding the rule after the panel closed */
const ruleGenerations = new Map();
const bumpRuleGeneration = tabId => {
  const generation = (ruleGenerations.get(tabId) || 0) + 1;
  ruleGenerations.set(tabId, generation);
  return generation;
};

/* the top-frame content script holds the per-panel token; null means closed */
const getLiveToken = tabId => chrome.scripting.executeScript({
  target: {tabId},
  world: 'ISOLATED',
  func: () => globalThis.token
}).then(results => {
  const live = results && results[0] && results[0].result;
  return typeof live === 'string' && live ? live : null;
}, () => null);

/* wait for a download to reach a terminal state (complete or interrupted) */
const waitForDownload = id => new Promise(resolve => {
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
    try {
      chrome.downloads.onChanged.removeListener(onChanged);
    }
    catch (e) {}
    resolve(item || {id, state: 'unknown'});
  };

  const poll = () => {
    try {
      chrome.downloads.search({id}, items => {
        const item = items && items[0];
        if (!item || item.state !== 'in_progress') {
          finish(item);
        }
      });
    }
    catch (e) {
      finish();
    }
  };

  const onChanged = delta => {
    if (delta.id === id && delta.state && delta.state.current !== 'in_progress') {
      poll();
    }
  };

  interval = setInterval(poll, 1000);
  // safety net for downloads that never report a terminal state
  timeout = setTimeout(() => finish(), 10 * 60 * 1000);

  try {
    chrome.downloads.onChanged.addListener(onChanged);
  }
  catch (e) {}
  poll();
});

chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      injectImmediately: true,
      func: tabId => window.tabId = tabId,
      args: [tab.id]
    });
    const r = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      injectImmediately: true,
      files: ['/data/inject/inject.js']
    });
    if (r && (r[0] === undefined || r[0].result === false)) {
      throw Error('Cannot attach panel to the document. Is this an HTML page?');
    }
  }
  catch (e) {
    console.warn(e);
    notify('Cannot collect images on this tab\n\n' + e.message);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  ruleGenerations.delete(tabId);
  clearTabRules(tabId);
});

/* a top-level URL change destroys the panel, so its session rules must go;
   "url" filters out iframe loads, which also toggle the tab status */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    bumpRuleGeneration(tabId);
    clearTabRules(tabId);
  }
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'verify-core') {
    const token = request.token;
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number' || typeof token !== 'string' || !token) {
      response({error: 'Invalid core verification'});
      return true;
    }
    // read the live token from the extension's isolated world in the top frame
    try {
      chrome.scripting.executeScript({
        target: {tabId},
        world: 'ISOLATED',
        func: () => globalThis.token
      }).then(results => {
        const live = results && results[0] && results[0].result;
        if (typeof live === 'string' && live === token) {
          // a fresh panel starts from a clean rule state; persist.js re-adds
          // the global rule after the UI loads
          bumpRuleGeneration(tabId);
          clearTabRules(tabId).then(() => response({ok: true, tabId}));
        }
        else {
          response({error: 'Not authorized'});
        }
      }, e => response({error: e.message || String(e)}));
    }
    catch (e) {
      response({error: e.message || String(e)});
    }
    return true;
  }
  if (request.cmd === 'notify') {
    notify(request.message);
  }
  else if (request.cmd === 'set-badge') {
    const targetTabId = request.tabId || (sender.tab && sender.tab.id);
    if (targetTabId) {
      chrome.action.setBadgeText({
        tabId: targetTabId,
        text: request.text
      });
    }
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
  else if (request.cmd === 'apply-referer') {
    try {
      // the global CORS rule uses the tab id; per-request rules must not collide
      const id = 1000000 + Math.floor(Math.random() * 1000000);
      const referer = typeof request.referer === 'string' && /^https?:/i.test(request.referer) ? request.referer : '';
      /* content scripts are subject to CORS with the origin of the page they
         are injected into. The CORS check compares that page origin with the
         response header, not the referer we send to the server, so never use
         the referer's origin here (it can be a different site, e.g. an image
         host viewer page reached by deep search) */
      let origin = '';
      try {
        origin = sender.origin || (new URL(sender.url)).origin;
      }
      catch (e) {}

      /* content scripts are subject to CORS; every collector fetch needs
         readable response headers, even when no referer is sent */
      const responseHeaders = [{
        'operation': 'set',
        'header': 'access-control-allow-origin',
        'value': origin || '*'
      }, {
        // "content-disposition" is not CORS-safelisted, so it must be
        // explicitly exposed for utils.guess to read the server filename
        'operation': 'set',
        'header': 'access-control-expose-headers',
        'value': 'content-disposition'
      }];

      if (request.credentials === 'include') {
        responseHeaders.push({
          'operation': 'set',
          'header': 'Access-Control-Allow-Credentials',
          'value': 'true'
        });
      }

      const action = {
        type: 'modifyHeaders',
        responseHeaders
      };

      if (referer) {
        action.requestHeaders = [{
          'operation': 'set',
          'header': 'referer',
          'value': referer
        }, {
          'operation': 'remove',
          'header': 'origin'
        }];
      }

      const rule = {
        'id': id,
        'priority': 2,
        'action': action,
        'condition': {
          // fetch strips URL fragments before sending the request
          'urlFilter': typeof request.src === 'string' ? request.src.split('#')[0] : request.src,
          'resourceTypes': ['xmlhttprequest'],
          'tabIds': [sender.tab.id]
        }
      };

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
  else if (request.cmd === 'remove-session-rules') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') {
      response(false);
      return true;
    }

    const clear = () => {
      const generation = bumpRuleGeneration(tabId);
      clearTabRules(tabId).then(() => {
        response(true);
        // catch a per-request rule whose add message was already in flight
        setTimeout(async () => {
          if ((ruleGenerations.get(tabId) || 0) === generation) {
            await clearTabRules(tabId);
          }
        }, 1000);
      }, () => response(false));
    };

    /* the core frame passes its token so an old frame cannot clear the rule
       of a replacement panel */
    if (typeof request.token === 'string' && request.token) {
      getLiveToken(tabId).then(live => {
        if (live === request.token) {
          clear();
        }
        else {
          response(false);
        }
      });
    }
    else {
      clear();
    }
    return true;
  }
  else if (request.cmd === 'update-session-rules') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') {
      response({error: 'Invalid tab'});
      return true;
    }

    (async () => {
      try {
        // a concurrent close/navigation invalidates this update
        const generation = bumpRuleGeneration(tabId);
        // drop the previous global rule but keep in-flight per-request rules,
        // so a toggle during a search does not strip them from running fetches
        await clearTabRules(tabId, false);
        if ((ruleGenerations.get(tabId) || 0) !== generation) {
          response(false);
          return;
        }
        // do not re-add after the panel/host has disappeared
        if (await getLiveToken(tabId) === null) {
          response(false);
          return;
        }
        if ((ruleGenerations.get(tabId) || 0) !== generation) {
          response(false);
          return;
        }
        await chrome.declarativeNetRequest.updateSessionRules({
          addRules: [{
            'id': tabId,
            'priority': 1,
            'action': {
              type: 'modifyHeaders',
              responseHeaders: [{
                'operation': 'set',
                'header': 'access-control-allow-origin',
                'value': '*'
              }, {
                // "content-disposition" is not CORS-safelisted, so it must be
                // explicitly exposed for utils.guess to read the server filename
                'operation': 'set',
                'header': 'access-control-expose-headers',
                'value': 'content-disposition'
              }]
            },
            'condition': {
              'resourceTypes': ['xmlhttprequest'],
              'tabIds': [tabId]
            }
          }]
        });
        if ((ruleGenerations.get(tabId) || 0) !== generation) {
          // a close/navigation happened while the rule was being added
          await clearTabRules(tabId);
          response(false);
          return;
        }
        response(true);
      }
      catch (e) {
        response({error: e.message});
      }
    })();

    return true;
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
  else if (request.cmd === 'wait-downloads') {
    const ids = Array.isArray(request.ids) ? request.ids.filter(id => typeof id === 'number' && isNaN(id) === false) : [];
    Promise.all(ids.map(waitForDownload)).then(results => response({
      results
    })).catch(() => response({
      results: []
    }));

    return true;
  }
  else if (request.cmd === 'open-gallery') {
    try {
      const u = new URL(request.url);
      const isExtension = /^(moz-extension|chrome-extension):$/.test(u.protocol);
      if (!isExtension || !u.pathname.includes('/data/gallery/')) {
        response({error: 'Invalid gallery URL'});
        return true;
      }
      const p = chrome.tabs.create({
        url: request.url
      });
      if (p && typeof p.then === 'function') {
        p.then(t => response(t && t.id)).catch(e => response({error: e.message}));
      }
      else {
        response(true);
      }
    }
    catch (e) {
      response({error: e.message});
    }
    return true;
  }
  else if (request.cmd === 'gallery-build') {
    if (!request.tabId || isNaN(request.tabId)) {
      response({error: 'Invalid tabId'});
      return true;
    }
    const p = chrome.tabs.sendMessage(request.tabId, {
      cmd: 'build'
    });
    if (p && typeof p.then === 'function') {
      p.then(r => response(r)).catch(e => response({error: e.message}));
    }
    else {
      // response will be sent via callback below if not promise-based
      response({error: 'tabs.sendMessage not available'});
    }
    return true;
  }
  else if (request.cmd === 'gallery-save') {
    if (!request.tabId || isNaN(request.tabId)) {
      response({error: 'Invalid tabId'});
      return true;
    }
    if (!request.request || typeof request.request !== 'object') {
      response({error: 'Invalid save request'});
      return true;
    }
    const payload = Object.assign({}, request.request, {
      cmd: 'save-images',
      tabId: request.tabId
    });
    const p = chrome.tabs.sendMessage(request.tabId, payload);
    if (p && typeof p.then === 'function') {
      p.then(r => response(r || true)).catch(e => response({error: e.message}));
    }
    else {
      response(true);
    }
    return true;
  }
  else if (request.cmd === 'gallery-stop') {
    if (!request.tabId || isNaN(request.tabId)) {
      response({error: 'Invalid tabId'});
      return true;
    }
    // clear badge for host tab (detached sender has no tab)
    chrome.action.setBadgeText({
      tabId: request.tabId,
      text: ''
    }).catch(() => {});
    const p = chrome.tabs.sendMessage(request.tabId, {
      cmd: 'stop-collector',
      remove: false,
      response: true,
      tabId: request.tabId
    });
    if (p && typeof p.then === 'function') {
      p.then(() => response(true)).catch(() => response(true));
    }
    else {
      response(true);
    }
    return true;
  }
  else if (request.cmd === 'gallery-meta') {
    if (!request.tabId || isNaN(request.tabId) || !request.src) {
      response({error: 'Invalid gallery-meta'});
      return true;
    }
    const p = chrome.tabs.sendMessage(request.tabId, {
      cmd: 'gallery-meta',
      src: request.src,
      width: request.width,
      height: request.height
    });
    if (p && typeof p.then === 'function') {
      p.then(() => response(true)).catch(() => response(true));
    }
    else {
      response(true);
    }
    return true;
  }
  /* send to collector */
  else if (request.cmd === 'stop-collector') {
    const targetTabId = request.tabId || (sender.tab && sender.tab.id);
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, request);
    }
  }
  /* Firefox Only (from collector to interface) */
  if (navigator.userAgent.includes('Firefox')) {
    /* From collector to iframe */
    if (request.cmd === 'images') {
      // we need to use the same frame to fetch the content later
      request.images.forEach(o => o.frameId = sender.frameId);
      chrome.tabs.sendMessage(sender.tab.id, request);
    }
    else if (['progress', 'links', 'new-frame', 'alternative-image-may-work', 'state'].includes(request.cmd)) {
      chrome.tabs.sendMessage(sender.tab.id, request);
    }
    /* send to the provided frame */
    else if (request.cmd === 'download-image') {
      chrome.tabs.sendMessage(sender.tab.id, request, {
        frameId: request.frameId
      }).then(response);

      return true;
    }
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

/* drop stale session rules from a previous browser session or extension version */
{
  const clear = async () => {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      if (rules.length) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: rules.map(rule => rule.id)
        });
      }
    }
    catch (e) {}
  };
  chrome.runtime.onStartup.addListener(clear);
  chrome.runtime.onInstalled.addListener(clear);
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
