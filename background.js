'use strict';

chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.executeScript(tab.id, {
    file: 'data/inject/inject.js',
    runAt: 'document_start',
    allFrames: false
  });
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'image-data') {
    // data URI
    if (request.src.startsWith('data:')) {
      let size = null;
      try {
        size = window.atob(request.src.split(',')[1]).length;
      } catch (e) {}

      return response({
        type: request.src.split('data:')[1].split(';')[0],
        size
      });
    }
    // http/https
    else {
      let req = new window.XMLHttpRequest();
      req.open('HEAD', request.src);
      req.timeout = 10000;
      req.onload = () => {
        let type = req.getResponseHeader('content-type');
        if (!type) {
          if (request.src.indexOf('.png') !== -1) {
            type = 'image/png';
          }
          else if (request.src.indexOf('.jpg') !== -1 || request.src.indexOf('.jpeg') !== -1) {
            type = 'image/jpeg';
          }
          else if (request.src.indexOf('.bmp') !== -1) {
            type = 'image/bmp';
          }
        }
        let size = null;
        try {
          size = +req.getResponseHeader('content-length');
        } catch (e) {}
        response({
          size,
          type
        });
      };
      req.ontimeout = req.onerror = () => response({});
      req.send();
    }

    return true;
  }
  else if (request.cmd === 'get-images') {
    response({
      domain: new URL(sender.tab.url).hostname
    });
    chrome.tabs.executeScript(sender.tab.id, {
      code: `
        chrome.runtime.sendMessage({
          cmd: 'found-images',
          images: [...document.images].map(img => ({
            width: img.width,
            height: img.height,
            src: img.src
          })).filter(img => img.src)
        });
      `,
      runAt: 'document_start',
      allFrames: true,
      matchAboutBlank: true
    });
  }
  else if (request.cmd === 'found-images') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.cmd === 'save-images') {
    request.images.forEach(img => {
      if (img.src.startsWith('data:')) {
        fetch(img.src)
          .then(res => res.blob())
          .then(blob => {
            let url = URL.createObjectURL(blob);
            chrome.downloads.download({
              url
            });
          });
      }
      else {
        chrome.downloads.download({
          url: img.src
        });
      }
    });
  }
  //
  if (request.cmd === 'close-me') {
    chrome.tabs.sendMessage(sender.tab.id, {
      cmd: 'close-me'
    });
  }
});
// FAQs & Feedback
chrome.storage.local.get({
  'version': null,
  'faqs': navigator.userAgent.toLowerCase().indexOf('firefox') === -1 ? true : false
}, prefs => {
  let version = chrome.runtime.getManifest().version;

  if (prefs.version ? (prefs.faqs && prefs.version !== version) : true) {
    chrome.storage.local.set({version}, () => {
      chrome.tabs.create({
        url: 'http://add0n.com/save-images.html?version=' + version +
          '&type=' + (prefs.version ? ('upgrade&p=' + prefs.version) : 'install')
      });
    });
  }
});
(function () {
  let {name, version} = chrome.runtime.getManifest();
  chrome.runtime.setUninstallURL('http://add0n.com/feedback.html?name=' + name + '&version=' + version);
})();
