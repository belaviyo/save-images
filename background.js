/* Copyright (C) 2014-2017 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: http://add0n.com/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/ */

'use strict';

const onClicked = tab => {
  window.count += 1;
  chrome.tabs.executeScript(tab.id, {
    file: 'data/inject/inject.js',
    runAt: 'document_start',
    allFrames: false
  }, () => {
    if (chrome.runtime.lastError) {
      window.count -= 1;
      chrome.notifications.create({
        type: 'basic',
        title: 'Save All Images',
        message: 'Cannot collect images on this tab\n\n' + chrome.runtime.lastError.message,
        iconUrl: '/data/icons/48.png'
      });
    }
  });
};
chrome.browserAction.onClicked.addListener(onClicked);

// FAQs & Feedback
chrome.storage.local.get({
  'version': null,
  'faqs': navigator.userAgent.indexOf('Firefox') === -1
}, prefs => {
  const version = chrome.runtime.getManifest().version;

  if (prefs.version ? (prefs.faqs && prefs.version !== version) : true) {
    chrome.storage.local.set({version}, () => {
      chrome.tabs.create({
        url: 'http://add0n.com/save-images.html?version=' + version +
          '&type=' + (prefs.version ? ('upgrade&p=' + prefs.version) : 'install')
      });
    });
  }
});
{
  const {name, version} = chrome.runtime.getManifest();
  chrome.runtime.setUninstallURL('http://add0n.com/feedback.html?name=' + name + '&version=' + version);
}
