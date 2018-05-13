'use strict';

var t = document.getElementById('entry');
var body = document.getElementById('body');
var download = document.querySelector('[data-cmd=download]');
var rename = document.querySelector('[data-cmd=rename]');
var copy = document.querySelector('[data-cmd=copy]');
var progress = document.getElementById('progress');
var custom = '';
var addJPG = true;

function humanFileSize(bytes) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  }
  while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[u];
}

{
  const init = resp => {
    custom = resp.custom;
    addJPG = resp.addJPG;
    document.getElementById('saveAs').checked = resp.saveAs;

    Object.values(resp.images).forEach(obj => {
      const clone = document.importNode(t.content, true);
      clone.querySelector('img').src = obj.src;
      clone.querySelector('div').info = obj;
      if (obj.size) {
        const a = clone.querySelector('a');
        a.textContent = humanFileSize(obj.size);
        a.href = obj.src;
      }
      body.appendChild(clone);
    });
  };
  if (window.top === window) {
    document.body.dataset.top = true;

    const id = Number(location.search.split('id=')[1].split('&')[0]);
    chrome.tabs.sendMessage(id, {
      cmd: 'build'
    }, init);
  }
  else {
    const resp = window.parent.ui.contentWindow.build();
    init(resp);
  }
}

document.addEventListener('click', e => {
  const {target} = e;
  const cmd = target.dataset.cmd;

  // data URL is not allowed in a new browser tab (chrome)
  if (target.href && target.href.startsWith('data:')) {
    if (navigator.userAgent.indexOf('Firefox') === -1) {
      e.preventDefault();
      fetch(target.href)
        .then(res => res.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          target.href = url;
          target.click();
        });
    }
  }

  if (cmd === 'rename') {
    const pattern = document.getElementById('pattern').value;
    let offset = /\[#=*(\d*)\]/.exec(pattern);
    if (offset && offset.length && isNaN(offset[1]) === false) {
      offset = Number(offset[1]);
    }
    else {
      offset = 1;
    }

    const entries = [...document.querySelectorAll('.entry :checked')];
    const o = -1 * String(offset + entries.length + 1).length;
    entries.forEach((e, i) => {
      const name = pattern.replace(/\[#=*\d*\]/, ('000000' + (i + offset)).substr(o));
      e.closest('div').querySelector('input[type=text]').value = name;
    });
  }
  else if (cmd === 'select-all') {
    [...document.querySelectorAll('.entry')].forEach(e => e.querySelector('input[type=checkbox]').checked = true);
    document.dispatchEvent(new Event('change'));
  }
  else if (cmd === 'select-none') {
    [...document.querySelectorAll('.entry')].forEach(e => e.querySelector('input[type=checkbox]').checked = false);
    document.dispatchEvent(new Event('change'));
  }
  else if (cmd === 'download' || cmd === 'copy') {
    const images = [...document.querySelectorAll('.entry :checked')].map(i => {
      const div = i.closest('div');
      const info = div.info;
      const filename = div.querySelector('input[type=text]').value;
      return Object.assign(info, {
        filename
      });
    });

    if (cmd === 'download') {
      progress.dataset.visible = true;
      progress.max = images.length;

      chrome.runtime.sendMessage({
        cmd: 'save-images',
        custom,
        addJPG,
        images,
        saveAs: document.getElementById('saveAs').checked
      });
    }
    else {
      const cb = document.getElementById('clipboard');
      cb.style.display = 'block';
      cb.value = images.map(o => o.src).join('\n');
      cb.focus();
      cb.select();
      const bol = document.execCommand('copy');
      cb.style.display = 'none';

      chrome.runtime.sendMessage({
        method: 'notify',
        message: bol ? 'Image links are copied to the clipboard' : 'Cannot copy to the clipboard'
      });
    }
  }
  else if (cmd === 'window') {
    chrome.runtime.sendMessage({
      method: 'open-me'
    });
  }
  else if (cmd === 'close') {
    if (window.top === window) {
      window.close();
    }
    else {
      window.parent.to.ui();
    }
  }
});

document.addEventListener('change', () => {
  copy.disabled = rename.disabled = download.disabled = document.querySelector('.entry :checked') === null;
});

chrome.runtime.onMessage.addListener(request => {
  if (request.cmd === 'progress') {
    progress.value = progress.max - request.value;
  }
  else if (request.cmd === 'close-me') {
    progress.dataset.visible = false;
  }
});
