'use strict';

var iframe;
chrome.runtime.sendMessage({
  cmd: 'get-hostname'
}, response => {
  iframe = document.createElement('iframe');
  iframe.setAttribute('style', `
    border: none;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    width: 550px;
    height: 500px;
    max-width: 80%;
    margin: auto;
    background-color: #f0f0f0;
    z-index: 10000000000;
    box-shadow: 0 0 0 10000px rgba(0, 0, 0, 0.3);
  `);
  iframe.src = chrome.runtime.getURL('data/inject/index.html?hostname=' + response);
  document.body.appendChild(iframe);
});

(function (callback) {
  document.addEventListener('click', e => {
    if (e.target !== iframe) {
      callback();
    }
  });
  chrome.runtime.onMessage.addListener(request => {
    if (request.cmd === 'close-me') {
      callback();
    }
  });
})(function () {
  if (iframe) {
    iframe.parentNode.removeChild(iframe);
    iframe = null;
  }
});
