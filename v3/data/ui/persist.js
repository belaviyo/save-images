/* Copyright (C) 2014-2023 Joe Ertaba
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Home: https://webextension.org/listing/save-images.html
 * GitHub: https://github.com/belaviyo/save-images/
 */

/* global search, accurate, elements, tabId */
'use strict';

const persist = {};
const profiles = [{
  title: chrome.i18n.getMessage('ui_profiles_default'),
  value: 'default'
}];

const fill = () => {
  for (const key of Object.keys(persist)) {
    const e = document.getElementById(key);
    if (e) {
      if (e.type === 'radio' || e.type === 'checkbox') {
        e.checked = persist[key];
      }
      else {
        e.value = persist[key];
      }
    }
  }
  elements.group.accurate.dataset.checked = elements.group.accurate.checked;
};

const change = key => {
  const n = profiles.findIndex(o => o.value === elements.profiles.select.value);

  if (n > -1) {
    chrome.storage.local.get({
      [key]: {}
    }, prefs => {
      Object.assign(persist, prefs[key]);

      fill();
      elements.profiles.select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    return;
  }
};

document.addEventListener('change', e => {
  const {target} = e;

  const id = target.id;
  if (id) {
    if (target.type === 'radio' || target.type === 'checkbox') {
      persist[id] = target.checked;

      // remove other elements in the group
      if (target.type === 'radio') {
        [...document.querySelectorAll(`input[type=radio][name="${target.name}"]`)].filter(e => e !== target)
          .forEach(e => delete persist[e.id]);
      }
    }
    else {
      let value = target.value;
      if (id === 'timeout') {
        value = Math.min(Math.max(5, value), 120);
        localStorage.setItem('timeout', value);
      }
      else if (id === 'detection_delay') {
        value = Math.max(0, value);
        localStorage.setItem('pause-detection', value);
      }
      else if (id === 'download_delay') {
        value = Math.max(0, value);
        localStorage.setItem('pause-download', value);
      }
      else if (id === 'prefs-max-warning' || id === 'prefs-zip-warning') {
        value = Math.max(5, value);
      }
      else if (id === 'prefs-stop-after') {
        value = Math.max(0, value);
      }
      persist[id] = value;
    }

    const key = elements.profiles.select.value + '-profile';

    if (id === 'profiles' && e.isTrusted) {
      return change(key);
    }
    chrome.storage.local.set({
      persist,
      [key]: persist
    });
  }
});

document.addEventListener('DOMContentLoaded', () => chrome.storage.local.get({
  persist,
  profiles
}, prefs => {
  Object.assign(persist, prefs.persist);
  Object.assign(profiles, prefs.profiles);

  // profiles
  for (const o of prefs.profiles) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.title;

    elements.profiles.select.append(option);
  }
  elements.profiles.delete.disabled = prefs.profiles.length < 2;

  fill();
  accurate();

  // install network
  if (elements.group.cors.checked) {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId],
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
            'operation': 'remove',
            'header': 'referrer-policy'
          }]
        },
        'condition': {
          'resourceTypes': ['xmlhttprequest', 'image'],
          'tabIds': [tabId]
        }
      }]
    }, search);
  }
  else {
    search();
  }
}));

document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'reset' && window.confirm('Are you sure you want to reset all the settings to the defaults?')) {
    chrome.storage.local.remove('persist', () => parent.commands({
      cmd: 'reload-me'
    }));
  }
  if (cmd === 'delete-profile') {
    const n = profiles.findIndex(o => o.value === elements.profiles.select.value);
    if (n > -1 && window.confirm(`Are you sure you want to delete "${profiles[n].title}" profile?`)) {
      profiles.splice(n, 1);
      chrome.storage.local.set({profiles});
      chrome.storage.local.remove(elements.profiles.select.value + '-profile');

      const m = Math.max(0, n - 1);
      elements.profiles.select.selectedOptions[0].remove();
      elements.profiles.select.value = profiles[m].value;
      change(elements.profiles.select.value + '-profile');
      elements.profiles.delete.disabled = profiles.length < 2;
    }
  }
  if (cmd === 'add-profile') {
    const title = prompt('Profile name:');
    if (title) {
      const value = Math.random().toString(36).substring(2, 15);

      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      option.selected = true;
      elements.profiles.select.append(option);
      elements.profiles.delete.disabled = false;

      profiles.push({
        title,
        value
      });
      chrome.storage.local.set({
        profiles
      });
      elements.profiles.select.dispatchEvent(new Event('change', {bubbles: true}));
    }
  }
});
