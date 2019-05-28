/* globals search */
'use strict';

var persist = {};

document.addEventListener('change', ({target}) => {
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
      }
      else if (id === 'prefs-max-warning' || id === 'prefs-zip-warning') {
        value = Math.max(5, value);
      }
      persist[id] = value;
    }
    chrome.storage.local.set({
      persist
    });
  }
});

document.addEventListener('DOMContentLoaded', () => chrome.storage.local.get({persist}, prefs => {
  Object.assign(persist, prefs.persist);
  for (const key of Object.keys(prefs.persist)) {
    const e = document.getElementById(key);
    if (e) {
      if (e.type === 'radio' || e.type === 'checkbox') {
        e.checked = prefs.persist[key];
      }
      else {
        e.value = prefs.persist[key];
      }
    }
  }
  search();
}));

document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'reset' && window.confirm('Are you sure you want to reset all the settings to the defaults?')) {
    chrome.storage.local.remove('persist', () => chrome.runtime.sendMessage({
      cmd: 'reload-me'
    }));
  }
});
