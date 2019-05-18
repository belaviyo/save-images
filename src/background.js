/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

'use strict';

const notify = message => chrome.storage.local.get({
  notify: true
}, prefs => prefs.notify && chrome.notifications.create({
  type: 'basic',
  title: chrome.runtime.getManifest().name,
  message,
  iconUrl: '/data/icons/48.png'
}));

const onClicked = tab => {
  chrome.tabs.executeScript(tab.id, {
    file: 'data/inject/inject.js',
    runAt: 'document_start',
    allFrames: false
  }, () => {
    if (chrome.runtime.lastError) {
      notify('Cannot collect images on this tab\n\n' + chrome.runtime.lastError.message);
    }
  });
};
chrome.browserAction.onClicked.addListener(onClicked);

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.method === 'notify') {
    notify(request.message);
  }
  else if (request.method === 'open-me') {
    const id = sender.tab.id;
    chrome.tabs.create({
      openerTabId: id,
      url: 'data/gallery/index.html?id=' + id
    });
  }
});

{
  const {onInstalled, setUninstallURL, getManifest} = chrome.runtime;
  const {name, version} = getManifest();
  const page = getManifest().homepage_url;
  onInstalled.addListener(({reason, previousVersion}) => {
    chrome.storage.local.get({
      'faqs': false,
      'last-update': 0
    }, prefs => {
      if (reason === 'install' || (prefs.faqs && reason === 'update')) {
        const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
        if (doUpdate && previousVersion !== version) {
          chrome.tabs.create({
            url: page + '?version=' + version +
              (previousVersion ? '&p=' + previousVersion : '') +
              '&type=' + reason,
            active: reason === 'install'
          });
          chrome.storage.local.set({'last-update': Date.now()});
        }
      }
    });
  });
  setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
}
