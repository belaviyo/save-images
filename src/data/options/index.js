/* Copyright (C) 2014-2017 InBasic
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Home: http://add0n.com/bookmarks-manager.html
 * GitHub: https://github.com/inbasic/bookmarks-manager/
*/

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  const value = e.dataset.i18nValue || 'textContent';
  e[value] = chrome.i18n.getMessage(e.dataset.i18n);
});

var log = document.getElementById('status');

function restore() {
  chrome.storage.local.get({
    width: 750,
    height: 650,
    notify: true,
    faqs: true,
    json: {}
  }, prefs => {
    document.getElementById('json').value = JSON.stringify(prefs.json, null, 2);
    delete prefs.json;
    Object.keys(prefs).forEach(name => {
      document.getElementById(name)[typeof prefs[name] === 'boolean' ? 'checked' : 'value'] = prefs[name];
    });
  });
}

function save() {
  let json = {};
  try {
    json = JSON.parse(document.getElementById('json').value || '{}');
  }
  catch (e) {
    log.textContent = e.message;
    return setTimeout(() => log.textContent = '', 2000);
  }
  const prefs = {
    width: Math.max(650, document.getElementById('width').value),
    height: Math.max(500, document.getElementById('height').value),
    notify: document.getElementById('notify').checked,
    faqs: document.getElementById('faqs').checked,
    json
  };

  chrome.storage.local.set(prefs, () => {
    log.textContent = 'Options saved.';
    setTimeout(() => log.textContent = '', 750);
    restore();
  });
}

document.addEventListener('DOMContentLoaded', restore);
document.getElementById('save').addEventListener('click', () => {
  try {
    save();
  }
  catch (e) {
    log.textContent = e.message;
    setTimeout(() => log.textContent = '', 750);
  }
});

document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    window.setTimeout(() => log.textContent = '', 750);
    log.textContent = 'Double-click to reset!';
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});

document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '?rd=donate'
}));

if (navigator.userAgent.indexOf('Firefox') !== -1) {
  document.getElementById('rate').href =
    'https://addons.mozilla.org/en-US/firefox/addon/save-all-images-webextension/reviews/';
}
else if (navigator.userAgent.indexOf('OPR') !== -1) {
  document.getElementById('rate').href =
    'https://addons.opera.com/en/extensions/details/save-all-images/#feedback-container';
}
else if (navigator.userAgent.indexOf('Edg/') !== -1) {
  document.getElementById('rate').href =
    'https://microsoftedge.microsoft.com/addons/detail/focinmnfmbmhknhdaamhppgdhahnbgif';
}

document.getElementById('open').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({
    url: chrome.runtime.getManifest().homepage_url + '#faq16'
  });
});
