'use strict';

document.addEventListener('change', ({target}) => {
  const id = target.id;
  if (id) {
    if (target.type === 'radio' || target.type === 'checkbox') {
      localStorage.setItem(id, target.checked);
      // remove other elements in the group
      if (target.type === 'radio') {
        [...document.querySelectorAll(`input[type=radio][name="${target.name}"]`)].filter(e => e !== target)
          .forEach(e => localStorage.removeItem(e.id));
      }
    }
    else {
      localStorage.setItem(id, target.value);
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  for (const key in localStorage) {
    const e = document.getElementById(key);
    if (e) {
      if (e.type === 'radio' || e.type === 'checkbox') {
        e.checked = localStorage.getItem(key) === 'true';
      }
      else {
        e.value = localStorage.getItem(key);
      }
    }
  }
});

document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'reset') {
    for (const key in localStorage) {
      localStorage.removeItem(key);
    }
    chrome.runtime.sendMessage({
      cmd: 'reload-me'
    });
  }
});
