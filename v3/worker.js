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
    await chrome.scripting.insertCSS({
      target: {tabId: tab.id},
      files: ['/data/inject/inject.css']
    });
    const r = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
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
