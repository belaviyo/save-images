/* Copyright (C) 2014-2017 InBasic
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  const value = e.dataset.i18nValue || 'textContent';
  e[value] = chrome.i18n.getMessage(e.dataset.i18n);
});

const toast = document.getElementById('toast');

function restore() {
  chrome.storage.local.get({
    'width': 750,
    'height': 650,
    'notify': true,
    'faqs': true,
    'json': {},
    'head-timeout': 30 * 1000,
    'head-delay': 100,
    'dig-delay': 100,
    'dig-timeout': 30 * 1000
  }, prefs => {
    document.getElementById('json').value = JSON.stringify(prefs.json, null, 2);
    delete prefs.json;
    Object.keys(prefs).forEach(name => {
      if (name === 'head-timeout' || name === 'dig-timeout') {
        document.getElementById(name).value = (prefs[name] / 1000).toFixed(0);
      }
      else {
        document.getElementById(name)[typeof prefs[name] === 'boolean' ? 'checked' : 'value'] = prefs[name];
      }
    });
  });
}

function save() {
  let json = {};
  try {
    json = JSON.parse(document.getElementById('json').value || '{}');
  }
  catch (e) {
    toast.textContent = e.message;
    return setTimeout(() => toast.textContent = '', 2000);
  }
  const prefs = {
    'width': Math.max(650, document.getElementById('width').value),
    'height': Math.max(500, document.getElementById('height').value),
    'notify': document.getElementById('notify').checked,
    'faqs': document.getElementById('faqs').checked,
    'head-timeout': Math.max(5, Number(document.getElementById('head-timeout').value)) * 1000,
    'dig-timeout': Math.max(5, Number(document.getElementById('dig-timeout').value)) * 1000,
    'head-delay': Math.max(0, Number(document.getElementById('head-delay').value)),
    'dig-delay': Math.max(0, Number(document.getElementById('dig-delay').value)),
    json
  };

  chrome.storage.local.set(prefs, () => {
    toast.textContent = 'Options saved.';
    setTimeout(() => toast.textContent = '', 750);
    restore();
  });
}

document.addEventListener('DOMContentLoaded', restore);
document.getElementById('save').addEventListener('click', () => {
  try {
    save();
  }
  catch (e) {
    toast.textContent = e.message;
    setTimeout(() => toast.textContent = '', 750);
  }
});

document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    window.setTimeout(() => toast.textContent = '', 750);
    toast.textContent = 'Double-click to reset!';
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

document.getElementById('tutorial').onclick = () => chrome.tabs.create({
  url: 'https://www.youtube.com/watch?v=YaT5sWRV6JQ'
});

document.getElementById('sample').onclick = () => chrome.tabs.create({
  url: 'https://webbrowsertools.com/test-download-with/'
});

// links
for (const a of [...document.querySelectorAll('[data-href]')]) {
  if (a.hasAttribute('href') === false) {
    a.href = chrome.runtime.getManifest().homepage_url + '#' + a.dataset.href;
  }
}
